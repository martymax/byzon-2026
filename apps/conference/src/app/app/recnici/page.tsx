import { SpeakerDirectory } from '@/components/content-directory';
import { loadCurrentEventId } from '@/server/current-event';
export const dynamic = 'force-dynamic';
export default async function SpeakersPage() {
  const eventId = await loadCurrentEventId();
  return (
    <section className="app-page">
      <p className="eyebrow">Lidé na pódiu</p>
      <h1 data-route-heading tabIndex={-1}>
        Řečníci
      </h1>
      {eventId ? (
        <SpeakerDirectory eventId={eventId} />
      ) : (
        <p role="alert">Akce není dostupná.</p>
      )}
    </section>
  );
}
