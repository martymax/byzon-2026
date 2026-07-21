import { AdminContentConsole } from '@/components/admin-content-console';
import { loadCurrentEventId } from '@/server/current-event';
export const dynamic = 'force-dynamic';
export default async function AdminContentPage() {
  const eventId = await loadCurrentEventId();
  return (
    <section className="app-page">
      <p className="eyebrow">Administrace</p>
      <h1>Obsah akce</h1>
      {eventId ? (
        <AdminContentConsole eventId={eventId} />
      ) : (
        <p role="alert">Akce není dostupná.</p>
      )}
    </section>
  );
}
