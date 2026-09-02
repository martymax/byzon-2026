import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  previewAvailable: vi.fn(),
}));

vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: mocks.previewAvailable,
}));
vi.mock('../../../components/admin-content-demo-workspace', () => ({
  AdminContentDemoWorkspace: () => (
    <section data-testid="synthetic-content">Syntetický obsah</section>
  ),
}));
vi.mock('@/components/admin-content-production-workspace', () => ({
  AdminContentProductionWorkspace: ({
    initialResource,
  }: {
    readonly initialResource: string;
  }) => (
    <section
      data-initial-resource={initialResource}
      data-testid="integrated-content-workspace"
    >
      Editor a publikace
    </section>
  ),
}));

import AdminContentPage from './page';

describe('/admin/obsah preview and production branches', () => {
  beforeEach(() => {
    mocks.previewAvailable.mockReset();
  });

  it('uses a safe synthetic content snapshot without touching the DB in preview', async () => {
    mocks.previewAvailable.mockReturnValue(true);

    const markup = renderToStaticMarkup(await AdminContentPage());

    expect(markup).toContain('synthetic-content');
    expect(markup).not.toContain('integrated-content-workspace');
  });

  it('mounts the production workspace that reads the authoritative shell scope', async () => {
    mocks.previewAvailable.mockReturnValue(false);

    const markup = renderToStaticMarkup(await AdminContentPage());

    expect(markup).toContain('integrated-content-workspace');
    expect(markup).toContain('data-initial-resource="sessions"');
    expect(markup).not.toContain('synthetic-content');
  });

  it('maps only allowlisted view and type query values into initial content state', async () => {
    mocks.previewAvailable.mockReturnValue(false);

    const selected = renderToStaticMarkup(
      await AdminContentPage({
        searchParams: Promise.resolve({
          oblast: 'practical',
          typ: 'faqs',
          unsafe: 'participant@example.test',
        }),
      }),
    );
    const rejected = renderToStaticMarkup(
      await AdminContentPage({
        searchParams: Promise.resolve({
          oblast: 'practical',
          typ: 'sessions',
        }),
      }),
    );

    expect(selected).toContain('data-initial-resource="faqs"');
    expect(selected).not.toContain('participant@example.test');
    expect(rejected).toContain('data-initial-resource="pages"');
  });
});
