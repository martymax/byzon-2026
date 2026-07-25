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
  }: {
    readonly children: React.ReactNode;
  }) => <div data-testid="mock-admin-shell">{children}</div>,
}));

import AdminLayout from './layout';

describe('admin layout preview isolation', () => {
  beforeEach(() => {
    previewMocks.available.mockReset();
  });

  it('keeps the integrated /admin/obsah child unwrapped in production', () => {
    previewMocks.available.mockReturnValue(false);

    const markup = renderToStaticMarkup(
      <AdminLayout>
        <section data-testid="integrated-admin-content">Obsah akce</section>
      </AdminLayout>,
    );

    expect(markup).toContain('integrated-admin-content');
    expect(markup).not.toContain('mock-admin-shell');
  });

  it('unifies admin journeys under the mock shell only in preview', () => {
    previewMocks.available.mockReturnValue(true);

    const markup = renderToStaticMarkup(
      <AdminLayout>
        <section>Import</section>
      </AdminLayout>,
    );

    expect(markup).toContain('mock-admin-shell');
  });
});
