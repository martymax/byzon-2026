import { createDatabaseClient, schema } from '@byzon/database';
import {
  adminEventSettingsSchema,
  adminEventSettingsUpdateResponseSchema,
} from '@byzon/domain/contracts';
import { and, count, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { handleAdminSettings } from './admin-settings';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const origin = 'http://localhost:3000';

integration('admin settings integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-admin-settings-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const eventSlug = `admin-settings-${eventId}`;
  const adminId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const endpoint = `${origin}/api/v1/admin/events/${eventId}/settings`;
  const supportMessage = 'V případě potíží kontaktujte organizační tým BYZON.';

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: eventSlug,
      name: 'Settings integration event',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T16:00:00Z'),
      timezone: 'Europe/Prague',
      status: 'activation_open',
    });
    await client.db.insert(schema.users).values([
      {
        id: adminId,
        name: 'Settings admin',
        email: `settings-admin-${adminId}@example.invalid`,
      },
      {
        id: participantId,
        name: 'Settings participant',
        email: `settings-participant-${participantId}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values([
      { eventId, userId: adminId, status: 'active' },
      { eventId, userId: participantId, status: 'active' },
    ]);
    await client.db.insert(schema.eventRoles).values([
      {
        id: crypto.randomUUID(),
        eventId,
        userId: adminId,
        role: 'organizer_admin',
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: participantId,
        role: 'participant',
      },
    ]);
  });

  afterAll(async () => {
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.db
      .delete(schema.users)
      .where(inArray(schema.users.id, [adminId, participantId]));
    await client.close();
  });

  const dependencies = (actorId = adminId) => ({
    db: client.db,
    allowedOrigin: origin,
    currentEventSlug: eventSlug,
    getSession: vi.fn(async () => ({ user: { id: actorId } })),
    now: () => new Date('2026-09-02T10:00:00.000Z'),
  });

  const update = (
    key: string,
    expectedVersion: number,
    settings: {
      registrationMode: 'closed' | 'invite_only' | 'open';
      reservationChangesAllowed: boolean;
      supportMessage: string;
    },
  ) =>
    handleAdminSettings(
      new Request(endpoint, {
        method: 'PUT',
        headers: {
          origin,
          'content-type': 'application/json',
          'idempotency-key': key,
          'x-request-id': 'settings-integration-request',
        },
        body: JSON.stringify({
          expectedVersion,
          settings,
          reason: 'Změna provozních pravidel pro integrační ověření.',
        }),
      }),
      eventId,
      dependencies(),
    );

  it('reads defaults and exact-retries an audited core update', async () => {
    const read = await handleAdminSettings(
      new Request(endpoint),
      eventId,
      dependencies(),
    );
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('private, no-store');
    expect(adminEventSettingsSchema.parse(await read.json())).toMatchObject({
      eventId,
      registrationMode: 'invite_only',
      reservationChangesAllowed: true,
      supportMessage,
      version: 1,
    });

    const key = crypto.randomUUID();
    const body = {
      registrationMode: 'closed' as const,
      reservationChangesAllowed: false,
      supportMessage,
    };
    const first = await update(key, 1, body);
    expect(first.status).toBe(200);
    const changed = adminEventSettingsUpdateResponseSchema.parse(
      await first.json(),
    );
    expect(changed.settings).toMatchObject({
      registrationMode: 'closed',
      reservationChangesAllowed: false,
      supportMessage,
      version: 2,
    });
    const replay = await update(key, 1, body);
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(await replay.json()).toEqual(changed);

    const [auditCount] = await client.db
      .select({ value: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, eventId),
          eq(schema.auditLogs.action, 'settings.update'),
        ),
      );
    expect(auditCount?.value).toBe(1);
    const audit = await client.db.query.auditLogs.findFirst({
      where: and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.action, 'settings.update'),
      ),
    });
    expect(
      JSON.stringify({ before: audit?.before, after: audit?.after }),
    ).not.toContain(supportMessage);
  });

  it('rejects support-message tampering, stale versions and archived writes', async () => {
    const tampered = await update(crypto.randomUUID(), 2, {
      registrationMode: 'open',
      reservationChangesAllowed: true,
      supportMessage: 'Nepotvrzené místo podpory.',
    });
    expect(tampered.status).toBe(409);
    expect(await tampered.json()).toMatchObject({
      code: 'ADMIN_INVALID_TRANSITION',
    });

    const stale = await update(crypto.randomUUID(), 1, {
      registrationMode: 'open',
      reservationChangesAllowed: true,
      supportMessage,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: 'STALE_VERSION',
      currentVersion: 2,
    });

    await client.db
      .update(schema.events)
      .set({ status: 'archived' })
      .where(eq(schema.events.id, eventId));
    const archived = await update(crypto.randomUUID(), 2, {
      registrationMode: 'open',
      reservationChangesAllowed: true,
      supportMessage,
    });
    expect(archived.status).toBe(409);
    expect(await archived.json()).toMatchObject({
      code: 'ADMIN_INVALID_TRANSITION',
    });
    const read = await handleAdminSettings(
      new Request(endpoint),
      eventId,
      dependencies(),
    );
    expect(read.status).toBe(200);
  });

  it('denies an event member without settings permission', async () => {
    const response = await handleAdminSettings(
      new Request(endpoint),
      eventId,
      dependencies(participantId),
    );
    expect(response.status).toBe(403);
  });
});
