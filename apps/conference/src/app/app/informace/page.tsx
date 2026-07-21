import { PracticalContent } from '@/components/content-directory';
import { loadCurrentEventId } from '@/server/current-event';
export const dynamic = 'force-dynamic';
export default async function InformationPage() {
  const eventId = await loadCurrentEventId();
  return (
    <section className="app-page">
      <p className="eyebrow">Na místě</p>
      <h1>Praktické informace</h1>
      {eventId ? (
        <PracticalContent eventId={eventId} />
      ) : (
        <p role="alert">Akce není dostupná.</p>
      )}
    </section>
  );
}
