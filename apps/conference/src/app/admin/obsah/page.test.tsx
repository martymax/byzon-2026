import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  previewAvailable: vi.fn(),
  loadCurrentEvent: vi.fn(),
}));

vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: mocks.previewAvailable,
}));
vi.mock('@/server/current-event', () => ({
  loadCurrentEvent: mocks.loadCurrentEvent,
}));
vi.mock('@/components/admin-content-demo-workspace', () => ({
  AdminContentDemoWorkspace: () => (
    <section data-testid="synthetic-content">Syntetický obsah</section>
  ),
}));
vi.mock('@/components/admin-content-console', () => ({
  AdminContentConsole: () => (
    <section data-testid="integrated-console">Editor obsahu</section>
  ),
}));
vi.mock('@/components/publication-control', () => ({
  PublicationControl: () => (
    <section data-testid="integrated-publication">Publikace</section>
  ),
}));

import AdminContentPage from './page';

describe('/admin/obsah preview and production branches', () => {
  beforeEach(() => {
    mocks.previewAvailable.mockReset();
    mocks.loadCurrentEvent.mockReset();
  });

  it('uses a safe synthetic content snapshot without touching the DB in preview', async () => {
    mocks.previewAvailable.mockReturnValue(true);

    const markup = renderToStaticMarkup(await AdminContentPage());

    expect(markup).toContain('synthetic-content');
    expect(markup).not.toContain('integrated-console');
    expect(mocks.loadCurrentEvent).not.toHaveBeenCalled();
  });

  it('preserves the integrated publication and content console in production', async () => {
    mocks.previewAvailable.mockReturnValue(false);
    mocks.loadCurrentEvent.mockResolvedValue({
      id: 'event-integrated-0001',
      timezone: 'Europe/Prague',
    });

    const markup = renderToStaticMarkup(await AdminContentPage());

    expect(markup).toContain('integrated-publication');
    expect(markup).toContain('integrated-console');
    expect(markup).not.toContain('synthetic-content');
    expect(mocks.loadCurrentEvent).toHaveBeenCalledOnce();
  });
});
