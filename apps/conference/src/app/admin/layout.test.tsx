import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewMocks = vi.hoisted(() => ({
  available: vi.fn(),
}));

vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: previewMocks.available,
}));
vi.mock('@/components/admin-workspace-shell', () => ({
  AdminWorkspaceShell: ({
    children,
    environment,
  }: {
    readonly children: React.ReactNode;
    readonly environment?: string;
  }) => (
    <div data-environment={environment} data-testid="admin-shell">
      {children}
    </div>
  ),
}));

import AdminLayout from './layout';

describe('admin layout preview isolation', () => {
  beforeEach(() => {
    previewMocks.available.mockReset();
  });

  it('uses the authoritative production shell for integrated admin routes', () => {
    previewMocks.available.mockReturnValue(false);

    const markup = renderToStaticMarkup(
      <AdminLayout>
        <section data-testid="integrated-admin-content">Obsah akce</section>
      </AdminLayout>,
    );

    expect(markup).toContain('integrated-admin-content');
    expect(markup).toContain('admin-shell');
    expect(markup).toContain('data-environment="production"');
  });

  it('keeps synthetic journeys explicitly marked as mocked in preview', () => {
    previewMocks.available.mockReturnValue(true);

    const markup = renderToStaticMarkup(
      <AdminLayout>
        <section>Import</section>
      </AdminLayout>,
    );

    expect(markup).toContain('admin-shell');
    expect(markup).toContain('data-environment="mocked"');
  });
});
