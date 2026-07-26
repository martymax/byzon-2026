import { AdminContentWorkspace } from '@/components/admin-content-workspace';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { loadCurrentEvent } from '@/server/current-event';

export const dynamic = 'force-dynamic';

export default async function AdminContentPage() {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test'
  ) {
    if (isFrontendPreviewAvailable()) {
      const { AdminContentDemoWorkspace } =
        await import('../../../components/admin-content-demo-workspace');
      return <AdminContentDemoWorkspace />;
    }
  }
  const event = await loadCurrentEvent();
  return (
    <section className="app-page">
      <p className="eyebrow">Administrace</p>
      <h1>Obsah akce</h1>
      {event ? (
        <AdminContentWorkspace
          eventId={event.id}
          readOnly={event.status === 'archived'}
          timezone={event.timezone}
        />
      ) : (
        <p role="alert">Akce není dostupná.</p>
      )}
    </section>
  );
}
