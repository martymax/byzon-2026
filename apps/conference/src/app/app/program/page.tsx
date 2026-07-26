import { ProgramView } from '@/components/program-view';
import { loadCurrentEventId } from '@/server/current-event';
export const dynamic = 'force-dynamic';
export default async function ProgramPage() {
  const eventId = await loadCurrentEventId();
  return (
    <section className="app-page">
      <p className="eyebrow">BYZON 2026</p>
      <h1 data-route-heading tabIndex={-1}>
        Program
      </h1>
      {eventId ? (
        <ProgramView eventId={eventId} />
      ) : (
        <p role="alert">Akce není dostupná.</p>
      )}
    </section>
  );
}
