import type { Metadata } from 'next';
import type { AdminContentResource } from '@/lib/admin-content-api';
import { AdminContentWorkspace } from '@/components/admin-content-workspace';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';
import { loadCurrentEvent } from '@/server/current-event';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: { absolute: 'Program a obsah | Administrace BYZON' },
};

const resourceForQuery = (
  area: string | string[] | undefined,
  type: string | string[] | undefined,
): AdminContentResource => {
  const selectedArea = typeof area === 'string' ? area : '';
  const selectedType = typeof type === 'string' ? type : '';
  const allowed = {
    program: ['sessions', 'days'],
    speakers: ['speakers'],
    places: ['venues', 'rooms'],
    partners: ['partners'],
    practical: ['pages', 'faqs'],
  } as const;
  const resources = allowed[selectedArea as keyof typeof allowed];
  return resources?.includes(selectedType as never)
    ? (selectedType as AdminContentResource)
    : (resources?.[0] ?? 'sessions');
};

export default async function AdminContentPage({
  searchParams = Promise.resolve({}),
}: {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
} = {}) {
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
  const query = await searchParams;
  return (
    <section className="app-page">
      <p className="eyebrow">Administrace</p>
      <h1>Program a obsah</h1>
      {event ? (
        <AdminContentWorkspace
          eventId={event.id}
          initialResource={resourceForQuery(query.oblast, query.typ)}
          readOnly={event.status === 'archived'}
          timezone={event.timezone}
        />
      ) : (
        <p role="alert">Akce není dostupná.</p>
      )}
    </section>
  );
}
