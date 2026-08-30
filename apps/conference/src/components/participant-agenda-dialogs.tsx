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
    conflict?.action === 'reserve' || conflict?.action === 'join_waitlist';
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
