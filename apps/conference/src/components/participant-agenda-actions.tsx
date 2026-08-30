'use client';

import type { ParticipantAgendaItem } from '@byzon/domain/contracts';
import { Button } from '@byzon/ui';

import { participantAgendaActions } from './participant-agenda-model';
import type { ParticipantAgendaResource } from './participant-agenda-resource';

export const ParticipantAgendaItemActions = ({
  item,
  resource,
}: {
  readonly item: ParticipantAgendaItem;
  readonly resource: ParticipantAgendaResource;
}) => {
  const actions = participantAgendaActions(item);
  const offline = resource.offline.cached;
  const visibleActions = offline
    ? actions.filter(
        ({ intent }) => intent.action === 'add' || intent.action === 'remove',
      )
    : actions;
  const pendingForItem =
    resource.pending?.sessionId === item.session.id
      ? resource.pending.action
      : null;
  const reconciliationPending =
    resource.feedback !== null && resource.feedback.retry !== 'none';

  if (resource.readOnly) {
    return (
      <p className="agenda-read-only-item">
        Po skončení akce je tato položka jen ke čtení.
      </p>
    );
  }

  if (offline && visibleActions.length === 0) {
    return (
      <p className="agenda-read-only-item">
        Tato změna potřebuje aktuální potvrzení serveru.
      </p>
    );
  }

  if (visibleActions.length === 0) return null;

  return (
    <div
      className="agenda-item-actions"
      aria-label={`Akce pro ${item.session.title}`}
    >
      {visibleActions.map(({ intent, label, variant }) => (
        <Button
          disabled={
            resource.pending !== null ||
            reconciliationPending ||
            resource.offline.queue.total > 0 ||
            resource.offline.syncing
          }
          key={`${intent.action}-${intent.sessionId}`}
          loading={pendingForItem === intent.action}
          loadingLabel="Potvrzuji se serverem…"
          onClick={() => void resource.mutate(intent)}
          variant={variant}
        >
          {label}
        </Button>
      ))}
    </div>
  );
};
