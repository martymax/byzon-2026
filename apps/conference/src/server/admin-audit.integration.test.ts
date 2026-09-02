import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import { adminAuditResponseSchema } from '@byzon/domain/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { handleAdminAudit } from './admin-audit';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('admin audit integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-admin-audit-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7();
  const isolationEventId = generateUuidV7();
  const organizerId = generateUuidV7();
  const dependencies = {
    db: client.db,
    getSession: async () => ({ user: { id: organizerId } }),
  };
  const request = (search: string) =>
    new Request(
      `https://app.byzon.test/api/v1/admin/events/${eventId}/audit${search}`,
      { headers: { 'x-request-id': 'audit-integration-request' } },
    );

  beforeAll(async () => {
    await client.db.insert(schema.events).values([
      {
        id: eventId,
        slug: `audit-${eventId}`,
        name: 'Audit integration event',
        timezone: 'Europe/Prague',
        startsAt: new Date('2026-09-18T06:00:00.000Z'),
        endsAt: new Date('2026-09-19T20:00:00.000Z'),
        status: 'activation_open',
      },
      {
        id: isolationEventId,
        slug: `audit-isolation-${isolationEventId}`,
        name: 'Audit isolation event',
        timezone: 'Europe/Prague',
        startsAt: new Date('2026-10-01T06:00:00.000Z'),
        endsAt: new Date('2026-10-02T20:00:00.000Z'),
        status: 'activation_open',
      },
    ]);
    await client.db.insert(schema.users).values({
      id: organizerId,
      name: 'Audit Organizer',
      email: `audit-${organizerId}@example.invalid`,
    });
    await client.db.insert(schema.eventMemberships).values({
      eventId,
      userId: organizerId,
      status: 'active',
    });
    await client.db.insert(schema.eventRoles).values({
      id: generateUuidV7(),
      eventId,
      userId: organizerId,
      role: 'organizer_admin',
    });
    await client.db.insert(schema.auditLogs).values([
      {
        id: generateUuidV7(),
        eventId,
        actorId: organizerId,
        actorType: 'organizer_admin',
        action: 'settings.update',
        targetType: 'event',
        targetId: eventId,
        requestId: 'audit-settings-newer',
        reason: 'Novější bezpečná změna.',
        before: { email: '[REDACTED]' },
        after: { version: 3, secret: '[REDACTED]' },
        createdAt: new Date('2026-09-02T12:00:00.000Z'),
      },
      {
        id: generateUuidV7(),
        eventId,
        actorId: organizerId,
        actorType: 'organizer_admin',
        action: 'reservation.admin_cancelled',
        targetType: 'reservation',
        targetId: generateUuidV7(),
        requestId: 'audit-reservation-between',
        reason: 'Provozní storno.',
        createdAt: new Date('2026-09-02T11:30:00.000Z'),
      },
      {
        id: generateUuidV7(),
        eventId,
        actorId: organizerId,
        actorType: 'organizer_admin',
        action: 'settings.update',
        targetType: 'event',
        targetId: eventId,
        requestId: 'audit-settings-older',
        reason: 'Starší bezpečná změna.',
        after: { version: 2 },
        createdAt: new Date('2026-09-02T11:00:00.000Z'),
      },
      {
        id: generateUuidV7(),
        eventId: isolationEventId,
        actorId: null,
        actorType: 'system',
        action: 'settings.update',
        targetType: 'event',
        targetId: isolationEventId,
        requestId: 'audit-cross-event',
        reason: 'Změna jiné akce.',
        createdAt: new Date('2026-09-02T13:00:00.000Z'),
      },
    ]);
  });

  afterAll(async () => {
    await client.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.eventId, eventId));
    await client.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.eventId, isolationEventId));
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.db
      .delete(schema.events)
      .where(eq(schema.events.id, isolationEventId));
    await client.db
      .delete(schema.users)
      .where(eq(schema.users.id, organizerId));
    await client.close();
  });

  it('applies event, category and cursor filters in the database query', async () => {
    const firstResponse = await handleAdminAudit(
      request('?category=settings&limit=1'),
      eventId,
      dependencies,
    );
    expect(firstResponse.status).toBe(200);
    const first = adminAuditResponseSchema.parse(await firstResponse.json());
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      category: 'settings',
      reason: 'Novější bezpečná změna.',
      resultingVersion: 3,
      redacted: true,
    });
    expect(first.pageInfo.hasMore).toBe(true);

    const secondResponse = await handleAdminAudit(
      request(
        `?category=settings&limit=1&cursor=${encodeURIComponent(first.pageInfo.nextCursor!)}`,
      ),
      eventId,
      dependencies,
    );
    expect(secondResponse.status).toBe(200);
    const second = adminAuditResponseSchema.parse(await secondResponse.json());
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({
      category: 'settings',
      reason: 'Starší bezpečná změna.',
      resultingVersion: 2,
    });
    expect(second.pageInfo).toEqual({ hasMore: false, nextCursor: null });
    const serialized = JSON.stringify([first, second]);
    expect(serialized).not.toContain('audit-cross-event');
    expect(serialized).not.toContain('audit-reservation-between');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('secret');
  });
});
