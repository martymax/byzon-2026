import type { Database } from '@byzon/database';
import { adminAuditResponseSchema } from '@byzon/domain/contracts';
import { describe, expect, it, vi } from 'vitest';

import { handleAdminAudit } from './admin-audit';

const ids = {
  event: '019fb300-0000-7000-8000-000000000001',
  user: '019fb300-0000-7000-8000-000000000002',
  newest: '019fb300-0000-7000-8000-000000000005',
  middle: '019fb300-0000-7000-8000-000000000004',
  oldest: '019fb300-0000-7000-8000-000000000003',
} as const;

const rows = [
  {
    id: ids.newest,
    action: 'settings.update',
    targetType: 'event',
    targetId: ids.event,
    actorType: 'organizer_admin',
    reason: 'Schválená změna nastavení.',
    afterVersion: 7,
    createdAt: new Date('2026-09-02T12:00:00.000Z'),
  },
  {
    id: ids.middle,
    action: 'settings.update',
    targetType: 'event',
    targetId: ids.event,
    actorType: 'system',
    reason: 'Automatická synchronizace nastavení.',
    afterVersion: 6,
    createdAt: new Date('2026-09-02T11:00:00.000Z'),
  },
  {
    id: ids.oldest,
    action: 'settings.update',
    targetType: 'event',
    targetId: ids.event,
    actorType: 'organizer_admin',
    reason: 'Starší změna nastavení.',
    afterVersion: 5,
    createdAt: new Date('2026-09-02T10:00:00.000Z'),
  },
] as const;

const database = () => {
  let auditSelection: Record<string, unknown> | undefined;
  let requestedLimit: number | undefined;
  const select = vi.fn((selection: Record<string, unknown>) => {
    if (Object.hasOwn(selection, 'role')) {
      return {
        from: () => ({
          where: async () => [{ role: 'organizer_admin' }],
        }),
      };
    }
    auditSelection = selection;
    return {
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async (limit: number) => {
              requestedLimit = limit;
              return rows.slice(0, limit);
            },
          }),
        }),
      }),
    };
  });
  return {
    db: {
      query: {
        eventMemberships: {
          findFirst: async () => ({ userId: ids.user }),
        },
      },
      select,
    } as unknown as Database,
    auditSelection: () => auditSelection,
    requestedLimit: () => requestedLimit,
  };
};

const dependencies = (db: Database) => ({
  db,
  getSession: async () => ({ user: { id: ids.user } }),
});

describe('admin audit query', () => {
  it('returns a bounded redacted page and an opaque cursor', async () => {
    const fixture = database();
    const response = await handleAdminAudit(
      new Request(
        `https://app.byzon.test/api/v1/admin/events/${ids.event}/audit?category=settings&action=settings.update&actor=user&outcome=succeeded&requestId=admin-request-0001&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-03T00%3A00%3A00.000Z&limit=2`,
        { headers: { 'x-request-id': 'audit-query-test-0001' } },
      ),
      ids.event,
      dependencies(fixture.db),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization, Cookie');
    const body = adminAuditResponseSchema.parse(await response.json());
    expect(body.items).toHaveLength(2);
    expect(body.pageInfo).toMatchObject({ hasMore: true });
    expect(body.pageInfo.nextCursor).not.toBeNull();
    expect(body.items[0]).toMatchObject({
      actorLabel: 'Oprávněný uživatel',
      category: 'settings',
      redacted: true,
      resultingVersion: 7,
    });
    expect(body.items[1]?.actorLabel).toBe('Systém BYZON');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(fixture.requestedLimit()).toBe(3);
    expect(Object.keys(fixture.auditSelection() ?? {})).toEqual([
      'id',
      'action',
      'targetType',
      'targetId',
      'actorType',
      'reason',
      'afterVersion',
      'createdAt',
    ]);
  });

  it('rejects a malformed cursor before reading audit rows', async () => {
    const fixture = database();
    const response = await handleAdminAudit(
      new Request(
        `https://app.byzon.test/api/v1/admin/events/${ids.event}/audit?cursor=not-a-cursor`,
      ),
      ids.event,
      dependencies(fixture.db),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(fixture.auditSelection()).toBeUndefined();
  });
});
