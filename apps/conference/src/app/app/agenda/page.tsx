import { ParticipantAgenda } from '@/components/participant-agenda';
import { loadCurrentEventId } from '@/server/current-event';

export const dynamic = 'force-dynamic';

export default async function ParticipantAgendaPage() {
  const eventId = await loadCurrentEventId();
  if (!eventId) {
    return (
      <section className="app-page">
        <p className="eyebrow">Můj plán</p>
        <h1 data-route-heading tabIndex={-1}>
          Osobní agenda není dostupná
        </h1>
        <p role="alert">
          Aktuální akci se nepodařilo bezpečně určit. Zkuste to prosím později.
        </p>
      </section>
    );
  }
  return <ParticipantAgenda eventId={eventId} />;
}
