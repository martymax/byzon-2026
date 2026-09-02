'use client';

import type { AgendaSessionSnapshot } from '@byzon/domain/contracts';
import { Button, Dialog } from '@byzon/ui';
import Link from 'next/link';
import { useCallback } from 'react';

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

const restoreRouteHeadingFocus = (): void => {
  window.requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) {
      document.querySelector<HTMLElement>('h1[data-route-heading]')?.focus();
    }
  });
};

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
  const reservationConflict = conflict?.action === 'join_waitlist';
  const closeConflict = useCallback(() => {
    resource.dismissConflict();
    restoreRouteHeadingFocus();
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
          ? 'Čekací listina se překrývá s programem'
          : 'Uložený bod se překrývá s programem'
      }
    >
      {conflict ? (
        <div className="agenda-dialog-content">
          <p>
            {reservationConflict
              ? 'Požadavek jsme uložili. Jeho čas se ale překrývá s dalšími body ve vaší agendě; rozhodnutí můžete kdykoli změnit.'
              : 'Bod jsme uložili do agendy. Jeho čas se ale překrývá s dalšími body; svůj plán můžete kdykoli změnit.'}
          </p>
          <div className="agenda-conflict-target">
            <span>Právě uloženo</span>
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
                ? 'Rozumím, ponechat požadavek'
                : 'Rozumím, ponechat v agendě'}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
};

const agendaDeadline = (value: string, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      month: 'long',
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return 'do začátku aktivity';
  }
};

export const ParticipantAgendaReservationOfferDialog = ({
  resource,
  timezone,
}: {
  readonly resource: ParticipantAgendaResource;
  readonly timezone: string;
}) => {
  const offer = resource.reservationOffer;
  const item =
    resource.state.status === 'ready' && offer
      ? resource.state.data.items.find(
          ({ session }) => session.id === offer.sessionId,
        )
      : null;
  const pending =
    offer !== null &&
    resource.pending?.sessionId === offer.sessionId &&
    resource.pending.action === offer.action;
  const close = useCallback(() => {
    if (!pending) {
      resource.dismissReservationOffer();
      restoreRouteHeadingFocus();
    }
  }, [pending, resource]);
  const confirm = useCallback(() => {
    if (offer) void resource.mutate(offer);
  }, [offer, resource]);

  return (
    <Dialog
      className="agenda-dialog"
      onClose={close}
      open={
        offer !== null &&
        resource.conflict === null &&
        resource.reservationConflict === null
      }
      title={
        offer?.action === 'join_waitlist'
          ? 'Přidat se na čekací listinu?'
          : 'Rezervovat místo?'
      }
    >
      {offer && item ? (
        <div className="agenda-dialog-content">
          <p>
            Tento bod vyžaduje registraci. V agendě už ho máte; místo je potřeba
            potvrdit zvlášť.
          </p>
          <div className="agenda-conflict-target">
            <span>Nově v agendě</span>
            <strong>{item.session.title}</strong>
            <span>{agendaSessionTime(item.session, timezone)}</span>
          </div>
          <div className="agenda-dialog-actions">
            <Button disabled={pending} onClick={close} variant="secondary">
              Zatím ponechat jen v agendě
            </Button>
            <Button
              loading={pending}
              loadingLabel="Potvrzuji se serverem…"
              onClick={confirm}
            >
              {offer.action === 'join_waitlist'
                ? 'Přidat se na čekací listinu'
                : 'Rezervovat místo'}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
};

export const ParticipantAgendaReservationConflictDialog = ({
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
  const problem = resource.reservationConflict;
  const pending =
    problem !== null &&
    resource.pending?.action === 'reserve' &&
    resource.pending.sessionId === problem.sessionId;
  const close = useCallback(() => {
    if (!pending) {
      resource.dismissReservationConflict();
      restoreRouteHeadingFocus();
    }
  }, [pending, resource]);
  const openSession = useCallback(() => {
    onOpenSession?.();
    resource.dismissReservationConflict();
  }, [onOpenSession, resource]);
  const replace = useCallback(() => {
    if (!problem?.replacement.allowed) return;
    void resource.mutate({
      action: 'reserve',
      sessionId: problem.sessionId,
      replaceReservationSessionIds: problem.replacement.reservationSessionIds,
    });
  }, [problem, resource]);

  return (
    <Dialog
      className="agenda-dialog"
      onClose={close}
      open={problem !== null}
      title="Rezervace se časově překrývají"
    >
      {problem ? (
        <div className="agenda-dialog-content">
          <p>
            Na překrývající se aktivity nelze mít dvě rezervace. Novou rezervaci
            jsme zatím nevytvořili.
          </p>
          <div className="agenda-conflict-target">
            <span>Nová volba</span>
            <strong>
              {problem.conflict.targetSessions
                .map(({ title }) => title)
                .join(' + ')}
            </strong>
            <span>
              {problem.conflict.targetSessions
                .map((session) => agendaSessionTime(session, timezone))
                .join(', ')}
            </span>
          </div>
          <h3>Stávající rezervace</h3>
          <ul className="agenda-conflict-list">
            {problem.conflict.conflictingSessions.map((session) => (
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
          <p className="agenda-dialog-kicker">
            {problem.replacement.allowed
              ? `Volbu můžete změnit nejpozději do ${agendaDeadline(problem.replacement.until, timezone)}.`
              : 'Časový limit už uplynul. Zahájenou ani minulou rezervaci nelze zpětně změnit.'}
          </p>
          <div className="agenda-dialog-actions">
            <Button disabled={pending} onClick={close} variant="secondary">
              Ponechat původní rezervaci
            </Button>
            {problem.replacement.allowed ? (
              <Button
                loading={pending}
                loadingLabel="Měním rezervaci…"
                onClick={replace}
              >
                Přihlásit na novou a odhlásit z původní
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
};
