import { AdminContentConsole } from '@/components/admin-content-console';
import { AdminContentDemoWorkspace } from '@/components/admin-content-demo-workspace';
import { PublicationControl } from '@/components/publication-control';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { loadCurrentEvent } from '@/server/current-event';
export const dynamic = 'force-dynamic';
export default async function AdminContentPage() {
  if (isFrontendPreviewAvailable()) {
    return <AdminContentDemoWorkspace />;
  }
  const event = await loadCurrentEvent();
  return (
    <section className="app-page">
      <p className="eyebrow">Administrace</p>
      <h1>Obsah akce</h1>
      {event ? (
        <>
          <PublicationControl eventId={event.id} />
          <AdminContentConsole eventId={event.id} timezone={event.timezone} />
        </>
      ) : (
        <p role="alert">Akce není dostupná.</p>
      )}
    </section>
  );
}
