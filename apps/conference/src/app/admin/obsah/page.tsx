import type { Metadata } from 'next';
import type { AdminContentResource } from '@/lib/admin-content-api';
import { AdminContentProductionWorkspace } from '@/components/admin-content-production-workspace';
import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

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
  const query = await searchParams;
  return (
    <AdminContentProductionWorkspace
      initialResource={resourceForQuery(query.oblast, query.typ)}
    />
  );
}
