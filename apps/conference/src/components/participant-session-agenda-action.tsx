'use client';

import { Button, Skeleton, StatusBadge } from '@byzon/ui';
import Link from 'next/link';

import type { ApiPort } from '@/lib/api';

import { ParticipantAgendaItemActions } from './participant-agenda-actions';
import {
  ParticipantAgendaConflictDialog,
  ParticipantAgendaReservationConflictDialog,
  ParticipantAgendaReservationOfferDialog,
} from './participant-agenda-dialogs';
import { participantAgendaItemStatus } from './participant-agenda-model';
import { useParticipantAgendaResource } from './participant-agenda-resource';
import { ParticipantAgendaMutationFeedback } from './participant-agenda-status';

export const ParticipantSessionAgendaAction = ({
  agendaApi,
  eventId,
  sessionId,
}: {
  readonly agendaApi?: ApiPort;
  readonly eventId: string;
  readonly sessionId: string;
}) => {
  const resource = useParticipantAgendaResource(eventId, agendaApi);
  const { state } = resource;

  if (state.status === 'loading') {
    return (
      <section aria-label="Osobní agenda" className="agenda-session-action">
        <Skeleton label="Načítám stav osobní agendy" lines={2} />
      </section>
    );
  }

  if (state.status !== 'ready') {
    return (
      <section aria-label="Osobní agenda" className="agenda-session-action">
        <strong>Osobní agenda teď není dostupná.</strong>
        <Link href="/app/agenda">Otevřít osobní agendu</Link>
      </section>
    );
  }

  const mutationPresentation = (
    <>
      <ParticipantAgendaMutationFeedback resource={resource} />
      <ParticipantAgendaConflictDialog
        resource={resource}
        timezone={state.data.eventTimezone}
      />
      <ParticipantAgendaReservationOfferDialog
        resource={resource}
        timezone={state.data.eventTimezone}
      />
      <ParticipantAgendaReservationConflictDialog
        resource={resource}
        timezone={state.data.eventTimezone}
      />
    </>
  );
  const item = state.data.items.find(({ session }) => session.id === sessionId);
  if (item) {
    const status = participantAgendaItemStatus(item);
    return (
      <section aria-label="Osobní agenda" className="agenda-session-action">
        {mutationPresentation}
        <div>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <p>{status.detail}</p>
        </div>
        <ParticipantAgendaItemActions item={item} resource={resource} />
        <Link href="/app/agenda">Spravovat v osobní agendě</Link>
      </section>
    );
  }

  if (resource.readOnly) {
    return (
      <section aria-label="Osobní agenda" className="agenda-session-action">
        {mutationPresentation}
        <strong>Osobní agenda je po skončení akce jen ke čtení.</strong>
        <Link href="/app/agenda">Otevřít osobní agendu</Link>
      </section>
    );
  }

  return (
    <section aria-label="Osobní agenda" className="agenda-session-action">
      {mutationPresentation}
      <div>
        <strong>Tento bod ještě nemáte v osobní agendě.</strong>
        <p>
          {resource.offline.cached
            ? 'Přidání se bezpečně zařadí do fronty. V agendě se projeví až po potvrzení serverem.'
            : 'Přidání potvrdí server a bezpečně uloží do kopie agendy pro tento účet.'}
        </p>
      </div>
      <Button
        disabled={
          resource.pending !== null ||
          (resource.feedback !== null && resource.feedback.retry !== 'none') ||
          resource.offline.queue.total > 0 ||
          resource.offline.syncing
        }
        loading={
          resource.pending?.sessionId === sessionId &&
          resource.pending.action === 'add'
        }
        loadingLabel="Přidávám do agendy…"
        onClick={() => void resource.mutate({ action: 'add', sessionId })}
      >
        Přidat do agendy
      </Button>
    </section>
  );
};
