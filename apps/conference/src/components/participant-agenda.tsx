'use client';

import type {
  ParticipantAgendaItem,
  ParticipantAgendaResponse,
} from '@byzon/domain/contracts';
import { ActionLink, Alert, StatePanel, StatusBadge } from '@byzon/ui';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import { subscribeToPrivateResourceInvalidation } from '@/lib/private-resource-events';

import { ParticipantAgendaItemActions } from './participant-agenda-actions';
import {
  ParticipantAgendaConflictDialog,
  ParticipantAgendaOfferDialog,
} from './participant-agenda-dialogs';
import { ParticipantAgendaCalendarExport } from './participant-agenda-export';
import {
  formatAgendaLocalDate,
  groupParticipantAgendaByDay,
  participantAgendaCapacityCopy,
  participantAgendaItemStatus,
} from './participant-agenda-model';
import {
  useParticipantAgendaResource,
  type ParticipantAgendaResource,
} from './participant-agenda-resource';
import {
  ParticipantAgendaOfflineStatus,
  ParticipantAgendaMutationFeedback,
  ParticipantAgendaResourceStatus,
} from './participant-agenda-status';

const agendaScrollPositions = new Map<string, number>();

const readRememberedScroll = (scopeKey: string): number | null =>
  agendaScrollPositions.get(scopeKey) ?? null;

const rememberAgendaScroll = (scopeKey: string): void => {
  if (
    agendaScrollPositions.size >= 16 &&
    !agendaScrollPositions.has(scopeKey)
  ) {
    const oldest = agendaScrollPositions.keys().next().value;
    if (oldest) agendaScrollPositions.delete(oldest);
  }
  agendaScrollPositions.set(
    scopeKey,
    Math.min(10_000_000, Math.max(0, Math.round(window.scrollY))),
  );
};

const useAgendaScrollContinuity = (readyVersion: number, scopeKey: string) => {
  const restored = useRef(false);
  const remember = useCallback(
    () => rememberAgendaScroll(scopeKey),
    [scopeKey],
  );
  useEffect(() => {
    window.addEventListener('pagehide', remember);
    return () => window.removeEventListener('pagehide', remember);
  }, [remember]);
  useEffect(
    () =>
      subscribeToPrivateResourceInvalidation(() => {
        agendaScrollPositions.clear();
      }),
    [],
  );
  useEffect(() => {
    if (restored.current) return;
    const frame = window.requestAnimationFrame(() => {
      const position = readRememberedScroll(scopeKey);
      if (position !== null) window.scrollTo({ top: position });
      restored.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [readyVersion, scopeKey]);
  return remember;
};

const agendaTime = (value: string, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return 'Čas bude upřesněn';
  }
};

const AgendaItem = ({
  item,
  onOpenOffer,
  onOpenSession,
  resource,
  timezone,
}: {
  readonly item: ParticipantAgendaItem;
  readonly onOpenOffer: (item: ParticipantAgendaItem) => void;
  readonly onOpenSession: () => void;
  readonly resource: ReturnType<typeof useParticipantAgendaResource>;
  readonly timezone: string;
}) => {
  const status = participantAgendaItemStatus(item);
  const capacity = participantAgendaCapacityCopy(item);
  const cancelled =
    item.session.status === 'cancelled' || item.action.state === 'cancelled';

  return (
    <article
      className={`agenda-item agenda-item--${status.tone}${
        cancelled ? ' agenda-item--cancelled' : ''
      }`}
    >
      <div className="agenda-item-main">
        <div className="agenda-item-topline">
          <p className="agenda-item-time">
            <time dateTime={item.session.startsAt}>
              {agendaTime(item.session.startsAt, timezone)}
            </time>
            {'–'}
            <time dateTime={item.session.endsAt}>
              {agendaTime(item.session.endsAt, timezone)}
            </time>
          </p>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>
        <h3>
          <Link
            href={`/app/program/${encodeURIComponent(item.session.id)}?from=agenda`}
            onClick={onOpenSession}
          >
            {item.session.title}
          </Link>
        </h3>
        <div className="agenda-item-meta">
          {item.session.room ? <span>{item.session.room.name}</span> : null}
          <span>{status.detail}</span>
        </div>
        {capacity ? <p className="agenda-capacity">{capacity}</p> : null}
      </div>
      <ParticipantAgendaItemActions
        item={item}
        onOpenOffer={onOpenOffer}
        resource={resource}
      />
    </article>
  );
};

type WaitlistedAgendaItem = Extract<
  ParticipantAgendaItem,
  { readonly state: 'waitlisted' }
>;
type OfferedAgendaItem = WaitlistedAgendaItem & {
  readonly waitlist: Extract<
    WaitlistedAgendaItem['waitlist'],
    { readonly state: 'offered' }
  >;
};
const isOfferedAgendaItem = (
  item: ParticipantAgendaItem,
): item is OfferedAgendaItem =>
  item.state === 'waitlisted' && item.waitlist.state === 'offered';

const ParticipantAgendaReadyView = ({
  ready,
  resource,
  scopeKey,
}: {
  readonly ready: ParticipantAgendaResponse;
  readonly resource: ParticipantAgendaResource;
  readonly scopeKey: string;
}) => {
  const groups = useMemo(
    () => groupParticipantAgendaByDay(ready.items),
    [ready.items],
  );
  const rememberScroll = useAgendaScrollContinuity(ready.version, scopeKey);
  const [selectedOfferSessionId, setSelectedOfferSessionId] = useState<
    string | null
  >(null);
  const [dismissedOfferIds, setDismissedOfferIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const offeredItems = useMemo(
    () => ready.items.filter(isOfferedAgendaItem),
    [ready.items],
  );
  const selectedOffer =
    offeredItems.find(({ session }) => session.id === selectedOfferSessionId) ??
    offeredItems.find(
      ({ waitlist }) =>
        waitlist.state === 'offered' &&
        !dismissedOfferIds.has(waitlist.offerId),
    ) ??
    null;

  const closeOffer = useCallback(() => {
    if (
      selectedOffer?.state === 'waitlisted' &&
      selectedOffer.waitlist.state === 'offered'
    ) {
      setDismissedOfferIds((current) => {
        const next = new Set(current);
        next.add(selectedOffer.waitlist.offerId);
        return next;
      });
    }
    setSelectedOfferSessionId(null);
  }, [selectedOffer]);

  return (
    <>
      <ParticipantAgendaOfflineStatus resource={resource} />
      {resource.readOnly ? (
        <Alert title="Agenda je jen ke čtení" tone="info">
          <p>
            Akce už skončila. Položky a kalendář můžete otevřít, ale rezervace
            ani čekací listinu už nelze měnit.
          </p>
        </Alert>
      ) : null}
      <ParticipantAgendaMutationFeedback resource={resource} />
      {ready.items.length === 0 ? (
        <StatePanel
          action={
            <ActionLink href="/app/program">Prohlédnout program</ActionLink>
          }
          kind="empty"
          title="Osobní agenda je zatím prázdná"
        >
          <p>
            Otevřete si detail bodu programu a přidejte ho do svého plánu. Po
            prvním načtení zůstane osobní agenda bezpečně oddělená pro tuto akci
            a účet i v offline režimu.
          </p>
        </StatePanel>
      ) : (
        <div className="agenda-days">
          {groups.map((group) => (
            <section
              aria-labelledby={`agenda-day-${group.localDate}`}
              className="agenda-day"
              key={group.localDate}
            >
              <div className="agenda-day-heading">
                <p>{group.title}</p>
                <h2 id={`agenda-day-${group.localDate}`}>
                  {formatAgendaLocalDate(group.localDate)}
                </h2>
              </div>
              <ol className="agenda-item-list">
                {group.items.map((item) => (
                  <li key={item.session.id}>
                    <AgendaItem
                      item={item}
                      onOpenOffer={(offered) =>
                        setSelectedOfferSessionId(offered.session.id)
                      }
                      onOpenSession={rememberScroll}
                      resource={resource}
                      timezone={ready.eventTimezone}
                    />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
      <ParticipantAgendaCalendarExport calendarExport={ready.calendarExport} />
      <ParticipantAgendaConflictDialog
        onOpenSession={rememberScroll}
        resource={resource}
        returnOrigin="agenda"
        timezone={ready.eventTimezone}
      />
      <ParticipantAgendaOfferDialog
        item={selectedOffer}
        onClose={closeOffer}
        resource={resource}
      />
    </>
  );
};

export const ParticipantAgenda = ({
  api,
  eventId,
}: {
  readonly api?: ApiPort;
  readonly eventId: string;
}) => {
  const resource = useParticipantAgendaResource(eventId, api);

  return (
    <section className="app-page agenda-page">
      <header className="agenda-heading">
        <p className="eyebrow">Můj plán</p>
        <h1 data-route-heading tabIndex={-1}>
          Osobní agenda
        </h1>
        <p className="lead">
          Uložené body, potvrzené rezervace i čekací listina v jednom kanonickém
          přehledu.
        </p>
      </header>
      {resource.state.status === 'ready' ? (
        <ParticipantAgendaReadyView
          key={resource.state.scopeKey}
          ready={resource.state.data}
          resource={resource}
          scopeKey={resource.state.scopeKey}
        />
      ) : (
        <ParticipantAgendaResourceStatus
          onRetry={resource.retry}
          state={resource.state}
        />
      )}
    </section>
  );
};
