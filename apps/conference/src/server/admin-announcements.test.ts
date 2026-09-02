import type { Database } from '@byzon/database';
import { adminAnnouncementTargetListResponseSchema } from '@byzon/domain/contracts';
import { describe, expect, it, vi } from 'vitest';

import { handleAdminAnnouncementTargets } from './admin-announcements';

const ids = {
  event: '019fb200-0000-7000-8000-000000000001',
  session: '019fb200-0000-7000-8000-000000000002',
  user: '019fb200-0000-7000-8000-000000000003',
} as const;

const database = ({
  announcementsEnabled = true,
  role = 'organizer_admin',
}: {
  readonly announcementsEnabled?: boolean;
  readonly role?: 'organizer_admin' | 'participant';
} = {}): Database => {
  const select = vi.fn((selection: Record<string, unknown>) => {
    if (Object.hasOwn(selection, 'role')) {
      return {
        from: () => ({ where: async () => [{ role }] }),
      };
    }
    return {
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [
                {
                  roomLabel: 'Sál Vltava',
                  sessionId: ids.session,
                  startsAt: new Date('2026-09-19T07:30:00.000Z'),
                  title: 'Růst bez zkratek',
                },
              ],
            }),
          }),
        }),
      }),
    };
  });
  return {
    query: {
      eventFeatures: {
        findFirst: async () => ({ announcementsEnabled }),
      },
      eventMemberships: { findFirst: async () => ({ userId: ids.user }) },
    },
    select,
  } as unknown as Database;
};

const request = () =>
  new Request(
    `https://app.byzon.test/api/v1/admin/events/${ids.event}/announcements/targets`,
    { headers: { 'x-request-id': 'announcement-target-test-0001' } },
  );

const dependencies = (db: Database) => ({
  db,
  allowedOrigin: 'https://app.byzon.test',
  getSession: async () => ({ user: { id: ids.user } }),
});

describe('admin announcement targets', () => {
  it('returns event-scoped named sessions as a private no-store read', async () => {
    const response = await handleAdminAnnouncementTargets(
      request(),
      ids.event,
      dependencies(database()),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization, Cookie');
    await expect(response.json()).resolves.toEqual(
      adminAnnouncementTargetListResponseSchema.parse({
        eventId: ids.event,
        options: [
          {
            roomLabel: 'Sál Vltava',
            sessionId: ids.session,
            startsAt: '2026-09-19T07:30:00.000Z',
            title: 'Růst bez zkratek',
          },
        ],
      }),
    );
  });

  it('fails closed for a non-admin actor and a disabled feature', async () => {
    const denied = await handleAdminAnnouncementTargets(
      request(),
      ids.event,
      dependencies(database({ role: 'participant' })),
    );
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      code: 'EVENT_ACCESS_DENIED',
    });

    const disabled = await handleAdminAnnouncementTargets(
      request(),
      ids.event,
      dependencies(database({ announcementsEnabled: false })),
    );
    expect(disabled.status).toBe(409);
    await expect(disabled.json()).resolves.toMatchObject({
      code: 'ANNOUNCEMENTS_DISABLED',
    });
  });
});
