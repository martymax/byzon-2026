import { SpeakerDetail } from '@/components/content-directory';
import { loadCurrentEventId } from '@/server/current-event';
export const dynamic = 'force-dynamic';
export default async function SpeakerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [eventId, { slug }] = await Promise.all([loadCurrentEventId(), params]);
  return (
    <section className="app-page">
      {eventId ? (
        <SpeakerDetail eventId={eventId} slug={slug} />
      ) : (
        <p role="alert">Akce není dostupná.</p>
      )}
    </section>
  );
}
