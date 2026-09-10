import { EventRating } from '@/components/live-interactions';
import { loadCurrentEvent } from '@/server/current-event';

export const dynamic = 'force-dynamic';
export default async function EventRatingPage() {
  const event = await loadCurrentEvent();
  return (
    <section className="app-page">
      <p className="eyebrow">Vaše zkušenost</p>
      <h1>Jaký byl váš BYZON?</h1>
      <p>Děkujeme za zpětnou vazbu. Pomůže nám připravit další ročník.</p>
      {event ? (
        <EventRating endsAt={event.endsAt.toISOString()} />
      ) : (
        <p role="alert">Hodnocení není dostupné.</p>
      )}
    </section>
  );
}
