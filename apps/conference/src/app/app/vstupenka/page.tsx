import { ParticipantTicket } from '@/components/participant-ticket';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { loadCurrentEventId } from '@/server/current-event';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ParticipantTicketPage() {
  if (!isFrontendPreviewAvailable()) notFound();
  const eventId = await loadCurrentEventId();
  if (!eventId) {
    return (
      <section className="app-page ticket-page">
        <p role="alert">Akce není dostupná.</p>
      </section>
    );
  }
  return <ParticipantTicket eventId={eventId} />;
}
