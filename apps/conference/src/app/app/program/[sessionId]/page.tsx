import { SessionView } from '@/components/program-view';
import { loadCurrentEventId } from '@/server/current-event';
export const dynamic = 'force-dynamic';
export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const [eventId, { sessionId }] = await Promise.all([
    loadCurrentEventId(),
    params,
  ]);
  return (
    <section className="app-page">
      {eventId ? (
        <SessionView eventId={eventId} sessionId={sessionId} />
      ) : (
        <p role="alert">Akce není dostupná.</p>
      )}
    </section>
  );
}
