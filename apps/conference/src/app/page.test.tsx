import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewMocks = vi.hoisted(() => ({
  isFrontendPreviewAvailable: vi.fn(),
}));

vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: previewMocks.isFrontendPreviewAvailable,
}));

import HomePage from './page';

describe('development journey hub', () => {
  beforeEach(() => {
    previewMocks.isFrontendPreviewAvailable.mockReset();
  });

  it('links every synthetic user journey when the preview is enabled', () => {
    previewMocks.isFrontendPreviewAvailable.mockReturnValue(true);

    const markup = renderToStaticMarkup(<HomePage />);

    expect(
      [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    ).toEqual(['/aktivace', '/app', '/admin', '/check-in', '/offline']);
    expect(markup).toContain('Syntetické uživatelské průchody');
    expect(markup).toContain('výhradně syntetická data');
  });

  it('does not expose preview routes outside the gated environment', () => {
    previewMocks.isFrontendPreviewAvailable.mockReturnValue(false);

    const markup = renderToStaticMarkup(<HomePage />);

    expect(markup).toContain('Aplikaci právě připravujeme');
    expect(markup).not.toContain('href=');
    expect(markup).not.toContain('Syntetické uživatelské průchody');
  });
});
