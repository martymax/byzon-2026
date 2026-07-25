'use client';

import type {
  AgendaSessionSnapshot,
  ParticipantAgendaItem,
} from '@byzon/domain/contracts';
import { Button, Dialog } from '@byzon/ui';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  agendaOfferIntents,
  formatOfferCountdown,
  remainingOfferSeconds,
} from './participant-agenda-model';
import type { ParticipantAgendaResource } from './participant-agenda-resource';

const agendaSessionTime = (
  session: AgendaSessionSnapshot,
  timezone: string,
): string => {
  try {
    const formatter = new Intl.DateTimeFormat('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone,
    });
    return `${formatter.format(new Date(session.startsAt))}–${formatter.format(
      new Date(session.endsAt),
    )}`;
  } catch {
    return 'Čas bude upřesněn';
  }
};

const useCanonicalElapsed = (active: boolean, snapshotKey: string): number => {
  const anchor = useRef({ key: snapshotKey, startedAt: 0 });
  const [clock, setClock] = useState({ elapsed: 0, key: snapshotKey });

  useEffect(() => {
    const startedAt =
      typeof performance === 'undefined' ? 0 : performance.now();
    anchor.current = { key: snapshotKey, startedAt };
  }, [snapshotKey]);

  useEffect(() => {
    if (!active) return;
    const update = () => {
      const current = anchor.current;
      if (current.key !== snapshotKey) return;
      const elapsed =
        typeof performance === 'undefined'
          ? 0
          : Math.max(0, performance.now() - current.startedAt);
      setClock({ elapsed, key: snapshotKey });
    };
    const frame = window.requestAnimationFrame(update);
    const interval = window.setInterval(update, 1_000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
    };
  }, [active, snapshotKey]);

  return clock.key === snapshotKey ? clock.elapsed : 0;
};

type AgendaOfferIntents = NonNullable<ReturnType<typeof agendaOfferIntents>>;
type OfferedWaitlist = Extract<
  Extract<ParticipantAgendaItem, { readonly state: 'waitlisted' }>['waitlist'],
  { readonly state: 'offered' }
>;

export const ParticipantAgendaConflictDialog = ({
  onOpenSession,
  resource,
  returnOrigin = 'program',
  timezone,
}: {
  readonly onOpenSession?: () => void;
  readonly resource: ParticipantAgendaResource;
  readonly returnOrigin?: 'agenda' | 'program';
  readonly timezone: string;
}) => {
  const conflict = resource.conflict;
  const reservationConflict =
    conflict?.action === 'reserve' || conflict?.action === 'accept_offer';
  const closeConflict = useCallback(() => {
    resource.dismissConflict();
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active === null || active === document.body || !active.isConnected) {
        document.querySelector<HTMLElement>('h1[data-route-heading]')?.focus();
      }
    });
  }, [resource]);
  const openSession = useCallback(() => {
    onOpenSession?.();
    resource.dismissConflict();
  }, [onOpenSession, resource]);
  return (
    <Dialog
      className="agenda-dialog"
      onClose={closeConflict}
      open={conflict !== null}
      title={
        reservationConflict
          ? 'Rezervace se překrývá s programem'
          : 'Uložený bod se překrývá s programem'
      }
    >
      {conflict ? (
        <div className="agenda-dialog-content">
          <p>
            {reservationConflict
              ? 'Rezervaci jsme uložili. Její čas se ale překrývá s dalšími body ve vaší agendě; rozhodnutí můžete kdykoli změnit.'
              : 'Bod jsme uložili do agendy. Jeho čas se ale překrývá s dalšími body; svůj plán můžete kdykoli změnit.'}
          </p>
          <div className="agenda-conflict-target">
            <span>
              {reservationConflict ? 'Právě rezervováno' : 'Právě uloženo'}
            </span>
            <strong>{conflict.targetSession.title}</strong>
            <span>{agendaSessionTime(conflict.targetSession, timezone)}</span>
          </div>
          <ul className="agenda-conflict-list">
            {conflict.conflictingSessions.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/app/program/${encodeURIComponent(session.id)}${
                    returnOrigin === 'agenda' ? '?from=agenda' : ''
                  }`}
                  onClick={openSession}
                >
                  <strong>{session.title}</strong>
                  <span>{agendaSessionTime(session, timezone)}</span>
                  {session.room ? <span>{session.room.name}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
          <div className="agenda-dialog-actions">
            <Button onClick={closeConflict}>
              {reservationConflict
                ? 'Rozumím, ponechat rezervaci'
                : 'Rozumím, ponechat v agendě'}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
};

const ParticipantAgendaOfferDialogContent = ({
  elapsedMilliseconds,
  expiresAt,
  item,
  intents,
  onClose,
  resource,
  serverNow,
}: {
  readonly elapsedMilliseconds: number;
  readonly expiresAt: string;
  readonly intents: AgendaOfferIntents;
  readonly item: ParticipantAgendaItem | null;
  readonly onClose: () => void;
  readonly resource: ParticipantAgendaResource;
  readonly serverNow: string;
}) => {
  const seconds = remainingOfferSeconds(
    serverNow,
    expiresAt,
    elapsedMilliseconds,
  );
  const expired = seconds <= 0;
  const working =
    item !== null && resource.pending?.sessionId === item.session.id;
  const reconciliationPending =
    resource.feedback !== null && resource.feedback.retry !== 'none';

  if (!item) return null;

  return (
    <div className="agenda-dialog-content">
      <div>
        <p className="agenda-dialog-kicker">Dočasně držené místo</p>
        <h3>{item.session.title}</h3>
        <p>
          Nabídka je určená tomuto účtu. Rezervace vznikne až po kanonickém
          potvrzení serveru.
        </p>
      </div>
      <p className="agenda-offer-countdown" role="timer">
        {expired ? (
          <strong>Čas nabídky právě vypršel</strong>
        ) : (
          <>
            Zbývající čas: <strong>{formatOfferCountdown(seconds)}</strong>
          </>
        )}
      </p>
      <span aria-live="polite" className="ui-visually-hidden">
        {expired ? 'Nabídka místa právě vypršela.' : ''}
      </span>
      {expired ? (
        <p>
          Místo už nelze lokálně potvrdit. Načtěte aktuální stav ze serveru.
        </p>
      ) : null}
      <div className="agenda-dialog-actions">
        <Button
          disabled={working || reconciliationPending}
          loading={working && resource.pending?.action === 'decline_offer'}
          loadingLabel="Odmítám nabídku…"
          onClick={() => void resource.mutate(intents.decline)}
          variant="secondary"
        >
          Odmítnout nabídku
        </Button>
        {expired ? (
          <Button
            onClick={() => {
              onClose();
              resource.retry();
            }}
          >
            Načíst aktuální stav
          </Button>
        ) : (
          <Button
            disabled={working || reconciliationPending}
            loading={working && resource.pending?.action === 'accept_offer'}
            loadingLabel="Potvrzuji místo…"
            onClick={() => void resource.mutate(intents.accept)}
          >
            Přijmout a rezervovat
          </Button>
        )}
      </div>
    </div>
  );
};

export const ParticipantAgendaOfferDialog = ({
  item,
  onClose,
  resource,
}: {
  readonly item: ParticipantAgendaItem | null;
  readonly onClose: () => void;
  readonly resource: ParticipantAgendaResource;
}) => {
  const offer: OfferedWaitlist | null =
    item?.state === 'waitlisted' && item.waitlist.state === 'offered'
      ? item.waitlist
      : null;
  const serverNow =
    resource.state.status === 'ready' ? resource.state.data.serverNow : null;
  const intents = item ? agendaOfferIntents(item) : null;
  const snapshotKey =
    resource.state.status === 'ready'
      ? `${resource.state.scopeKey}\u0000${resource.state.data.serverNow}`
      : 'unavailable';
  const requiresRecovery =
    resource.feedback !== null && resource.feedback.retry !== 'none';
  const open =
    !resource.readOnly &&
    offer !== null &&
    intents !== null &&
    serverNow !== null &&
    !requiresRecovery;
  useEffect(() => {
    if (offer && requiresRecovery) onClose();
  }, [offer, onClose, requiresRecovery]);
  const elapsedMilliseconds = useCanonicalElapsed(open, snapshotKey);

  return (
    <Dialog
      className="agenda-dialog"
      onClose={onClose}
      open={open}
      title="Nabídka místa z čekací listiny"
    >
      {item && offer && intents && serverNow ? (
        <ParticipantAgendaOfferDialogContent
          elapsedMilliseconds={elapsedMilliseconds}
          expiresAt={offer.expiresAt}
          intents={intents}
          item={item}
          key={`${offer.offerId}:${offer.expiresAt}:${serverNow}`}
          onClose={onClose}
          resource={resource}
          serverNow={serverNow}
        />
      ) : null}
    </Dialog>
  );
};
