import { renderToStaticMarkup } from 'react-dom/server';
import { activityRosterFixtures } from '@byzon/test-support/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pageMocks = vi.hoisted(() => ({
  frontendPreviewAvailable: vi.fn(),
  loadActivityRoster: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ notFound: pageMocks.notFound }));
vi.mock('@/components/activity-roster', () => ({
  ActivityRoster: ({
    data,
  }: {
    data: { sessions: Array<{ title: string }> };
  }) => <div>{data.sessions[0]?.title ?? 'Nemáte přiřazenou aktivitu'}</div>,
}));
vi.mock('@/lib/frontend-preview', () => ({
  isFrontendPreviewAvailable: pageMocks.frontendPreviewAvailable,
}));
vi.mock(
  '@/server/api/problem',
  async () => import('../../../server/api/problem'),
);
vi.mock('@/server/activity-roster', () => ({
  loadActivityRoster: pageMocks.loadActivityRoster,
}));
vi.mock('@/server/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));
vi.mock('@/server/database', () => ({ database: { db: {} } }));
vi.mock('../../../test/mocks/activity-roster-preview', () => ({
  ActivityRosterPreview: () => <div>Read-only roster preview</div>,
}));

import { ApiProblemError } from '../../../server/api/problem';
import ActivityRosterPage from './page';

describe('activity roster preview boundary', () => {
  beforeEach(() => {
    pageMocks.frontendPreviewAvailable.mockReset();
    pageMocks.loadActivityRoster.mockReset();
    pageMocks.notFound.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders the live assigned-session roster in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    pageMocks.loadActivityRoster.mockResolvedValueOnce(
      activityRosterFixtures.assigned!,
    );

    const markup = renderToStaticMarkup(await ActivityRosterPage());

    expect(markup).toContain('Mastermind Expertního Boardu');
    expect(pageMocks.loadActivityRoster).toHaveBeenCalledOnce();
    expect(pageMocks.frontendPreviewAvailable).not.toHaveBeenCalled();
  });

  it('fails closed when the live account lacks roster access', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    pageMocks.loadActivityRoster.mockRejectedValueOnce(
      new ApiProblemError({
        status: 403,
        code: 'EVENT_ACCESS_DENIED',
        title: 'Event access denied',
        detail: 'Roster access denied.',
      }),
    );

    await expect(ActivityRosterPage()).rejects.toThrow('NEXT_NOT_FOUND');

    expect(pageMocks.notFound).toHaveBeenCalledOnce();
  });

  it('renders only when the development/test preview gate is available', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    pageMocks.frontendPreviewAvailable.mockReturnValueOnce(true);

    const markup = renderToStaticMarkup(await ActivityRosterPage());

    expect(markup).toContain('Read-only roster preview');
    expect(pageMocks.loadActivityRoster).not.toHaveBeenCalled();
    expect(pageMocks.notFound).not.toHaveBeenCalled();
  });

  it('uses the live loader outside an enabled preview', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    pageMocks.frontendPreviewAvailable.mockReturnValueOnce(false);
    pageMocks.loadActivityRoster.mockResolvedValueOnce(
      activityRosterFixtures.empty!,
    );

    const markup = renderToStaticMarkup(await ActivityRosterPage());

    expect(markup).toContain('Nemáte přiřazenou aktivitu');
    expect(pageMocks.loadActivityRoster).toHaveBeenCalledOnce();
  });
});
