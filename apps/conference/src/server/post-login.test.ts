import type { Database } from '@byzon/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolvePostLoginDestination } from './post-login';

const queryMocks = vi.hoisted(() => ({
  event: vi.fn(),
  membership: vi.fn(),
  role: vi.fn(),
}));

const database = {
  query: {
    events: { findFirst: queryMocks.event },
    eventMemberships: { findFirst: queryMocks.membership },
    eventRoles: { findFirst: queryMocks.role },
  },
} as unknown as Database;

describe('post-login destination', () => {
  beforeEach(() => {
    queryMocks.event.mockReset();
    queryMocks.membership.mockReset();
    queryMocks.role.mockReset();
    queryMocks.event.mockResolvedValue({ id: 'event-id' });
    queryMocks.membership.mockResolvedValue({ userId: 'user-id' });
    queryMocks.role.mockResolvedValue({ userId: 'user-id' });
  });

  it('sends an active organizer admin to the admin workspace', async () => {
    await expect(
      resolvePostLoginDestination(database, 'user-id'),
    ).resolves.toBe('/admin');
  });

  it.each([
    ['missing event', 'event'],
    ['inactive membership', 'membership'],
    ['missing organizer role', 'role'],
  ] as const)('sends a participant to the app for %s', async (_label, gap) => {
    queryMocks[gap].mockResolvedValueOnce(undefined);

    await expect(
      resolvePostLoginDestination(database, 'user-id'),
    ).resolves.toBe('/app');
  });
});
