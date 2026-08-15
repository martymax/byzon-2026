import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pageMocks = vi.hoisted(() => ({
  frontendPreviewAvailable: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({ notFound: pageMocks.notFound }));
vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: pageMocks.frontendPreviewAvailable,
}));
vi.mock('../../../test/mocks/activity-roster-preview', () => ({
  ActivityRosterPreview: () => <div>Read-only roster preview</div>,
}));

import ActivityRosterPage from './page';

describe('activity roster preview boundary', () => {
  beforeEach(() => {
    pageMocks.frontendPreviewAvailable.mockReset();
    pageMocks.notFound.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('fails closed in production before consulting the preview flag', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await expect(ActivityRosterPage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(pageMocks.frontendPreviewAvailable).not.toHaveBeenCalled();
  });

  it('renders only when the development/test preview gate is available', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    pageMocks.frontendPreviewAvailable.mockReturnValueOnce(true);

    const markup = renderToStaticMarkup(await ActivityRosterPage());

    expect(markup).toContain('Read-only roster preview');
    expect(pageMocks.notFound).not.toHaveBeenCalled();
  });
});
