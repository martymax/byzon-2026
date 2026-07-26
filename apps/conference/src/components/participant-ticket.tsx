'use client';

import type {
  ParticipantTicketStatus,
  TicketPresentationUnavailableReason,
} from '@byzon/domain/contracts';
import { Card } from '@byzon/ui';

import type { ApiPort } from '@/lib/api';
import { TicketResourceStatus, useParticipantTicket } from './ticket-state';

export const participantTicketStatusCopy: Record<
  ParticipantTicketStatus,
  {
    readonly detail: string;
    readonly label: string;
    readonly title: string;
  }
> = {
  valid: {
    label: 'Platná',
    title: 'Vstupenka je přiřazená',
    detail: 'Stav vstupenky pro tuto akci je v pořádku.',
  },
  cancelled: {
    label: 'Zrušená',
    title: 'Vstupenka byla zrušena',
    detail:
      'Tuto vstupenku nelze použít pro vstup. Pokud je stav neočekávaný, obraťte se na podporu.',
  },
  refunded: {
    label: 'Vrácená',
    title: 'Vstupenka byla vrácena',
    detail:
      'Tuto vstupenku nelze použít pro vstup. Případné nejasnosti vyřeší podpora.',
  },
  blocked: {
    label: 'Blokovaná',
    title: 'Vstupenka je blokovaná',
    detail:
      'Tuto vstupenku teď nelze použít. Pro ověření dalšího postupu kontaktujte podporu.',
  },
};

const presentationCopy: Record<
  TicketPresentationUnavailableReason,
  { readonly detail: string; readonly title: string }
> = {
  security_gate_pending: {
    title: 'Skenovatelná vstupenka zatím není dostupná',
    detail:
      'Bezpečný formát se ještě připravuje. Z maskované reference proto nevytváříme žádný kód.',
  },
  ticket_inactive: {
    title: 'Prezentační plocha není aktivní',
    detail: 'Aktuální stav vstupenky neumožňuje zobrazit skenovatelnou podobu.',
  },
  event_ended: {
    title: 'Akce už skončila',
    detail:
      'Po skončení akce zůstává dostupný pouze stav vstupenky, ne skenovatelná podoba.',
  },
};

const TicketMark = ({ valid }: { readonly valid: boolean }) => (
  <svg
    aria-hidden="true"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.8"
  >
    <path d="M12 3 5 6v5c0 4.5 2.8 8.3 7 10 4.2-1.7 7-5.5 7-10V6l-7-3Z" />
    {valid ? <path d="m9 12 2 2 4-5" /> : <path d="M12 8v5m0 3h.01" />}
  </svg>
);

export const ParticipantTicket = ({
  api,
  eventId,
}: {
  readonly api?: ApiPort;
  readonly eventId: string;
}) => {
  const state = useParticipantTicket(eventId, api);
  if (state.status !== 'ready') {
    return (
      <section className="app-page ticket-page">
        <header className="ticket-heading">
          <p className="eyebrow">Můj vstup</p>
          <h1 data-route-heading tabIndex={-1}>
            Vstupenka
          </h1>
          <p className="lead">
            Stav vaší vstupenky se načítá pouze pro tento účet.
          </p>
        </header>
        <TicketResourceStatus state={state} onRetry={state.retry} />
      </section>
    );
  }

  const { ticket } = state.data;
  const status = participantTicketStatusCopy[ticket.status];
  const presentation = presentationCopy[ticket.presentation.reason];
  const isValid = ticket.status === 'valid';

  return (
    <section className="app-page ticket-page">
      <header className="ticket-heading">
        <p className="eyebrow">Můj vstup</p>
        <h1 data-route-heading tabIndex={-1}>
          Vstupenka
        </h1>
        <p className="lead">
          Ověřte stav a držitele. Skenovatelná podoba může být dostupná až po
          dokončení bezpečnostního kontraktu.
        </p>
      </header>

      <Card
        className={`ticket-card ticket-card--${ticket.status}`}
        aria-labelledby="ticket-status-title"
      >
        <div className="ticket-card-summary">
          <span className="ticket-mark">
            <TicketMark valid={isValid} />
          </span>
          <div>
            <p className="ticket-card-kicker">Stav vstupenky</p>
            <h2 id="ticket-status-title">{status.title}</h2>
            <p>{status.detail}</p>
          </div>
          <span className="ticket-status-label">{status.label}</span>
        </div>
        <dl className="ticket-details">
          <div>
            <dt>Držitel</dt>
            <dd>{ticket.holder.displayName}</dd>
          </div>
          <div>
            <dt>Maskovaná reference</dt>
            <dd
              className="ticket-reference"
              aria-label={`Reference končící ${ticket.referenceSuffix}`}
            >
              •••• {ticket.referenceSuffix}
            </dd>
          </div>
        </dl>
      </Card>

      <Card
        className="ticket-presentation"
        aria-labelledby="ticket-presentation-title"
      >
        <span className="ticket-presentation-mark">
          <TicketMark valid={false} />
        </span>
        <div>
          <p className="ticket-card-kicker">Prezentační plocha</p>
          <h2 id="ticket-presentation-title">{presentation.title}</h2>
          <p>{presentation.detail}</p>
          <p className="ticket-privacy-note">
            Maskovaná reference není vstupní kód a nelze ji použít ke skenování.
          </p>
        </div>
      </Card>
    </section>
  );
};
