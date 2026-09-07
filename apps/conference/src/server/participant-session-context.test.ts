import type { Database } from '@byzon/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./current-event', () => ({ CURRENT_EVENT_SLUG: 'byzon-2026' }));
import { resolveParticipantSessionContext } from './participant-session-context';

const event = vi.fn();
const membership = vi.fn();
const roles = vi.fn();
const db = {
  query: {
    events: { findFirst: event },
    eventMemberships: { findFirst: membership },
    eventRoles: { findMany: roles },
  },
} as unknown as Database;

describe('participant shell session context', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    event.mockResolvedValue({ id: 'event-id' });
    membership.mockResolvedValue({ userId: 'user-id' });
  });

  it.each([
    [['organizer_admin'], { isAdmin: true, isParticipant: false }],
    [
      ['organizer_admin', 'participant'],
      { isAdmin: true, isParticipant: true },
    ],
    [['participant'], { isAdmin: false, isParticipant: true }],
    [[], { isAdmin: false, isParticipant: false }],
  ])(
    'resolves navigation for roles %j without reading a profile',
    async (values, expected) => {
      roles.mockResolvedValue((values as string[]).map((role) => ({ role })));
      await expect(
        resolveParticipantSessionContext(db, 'user-id'),
      ).resolves.toEqual(expected);
    },
  );

  it('does not expose role context without a session or active membership', async () => {
    await expect(
      resolveParticipantSessionContext(db, undefined),
    ).resolves.toBeNull();
    expect(event).not.toHaveBeenCalled();
    membership.mockResolvedValue(undefined);
    await expect(
      resolveParticipantSessionContext(db, 'user-id'),
    ).resolves.toBeNull();
    expect(roles).not.toHaveBeenCalled();
  });
});
