'use client';

import type { ParticipantAgendaItem } from '@byzon/domain/contracts';
import { Button } from '@byzon/ui';

import { participantAgendaActions } from './participant-agenda-model';
import type { ParticipantAgendaResource } from './participant-agenda-resource';

export const ParticipantAgendaItemActions = ({
  item,
  onOpenOffer,
  resource,
}: {
  readonly item: ParticipantAgendaItem;
  readonly onOpenOffer: (item: ParticipantAgendaItem) => void;
  readonly resource: ParticipantAgendaResource;
}) => {
  const offered =
    item.state === 'waitlisted' && item.waitlist.state === 'offered';
  const actions = participantAgendaActions(item);
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

  if (!offered && actions.length === 0) return null;

  return (
    <div
      className="agenda-item-actions"
      aria-label={`Akce pro ${item.session.title}`}
    >
      {offered ? (
        <Button
          disabled={resource.pending !== null || reconciliationPending}
          onClick={() => onOpenOffer(item)}
        >
          Otevřít nabídku místa
        </Button>
      ) : null}
      {actions.map(({ intent, label, variant }) => (
        <Button
          disabled={resource.pending !== null || reconciliationPending}
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
