import { createDatabaseClient, schema } from '@byzon/database';
import {
  adminRoleAssignmentListResponseSchema,
  adminRolePersonSearchResponseSchema,
  adminRoleScopeOptionsResponseSchema,
} from '@byzon/domain/contracts';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  handleAdminRoleAssignment,
  handleAdminRoleAssignmentList,
  handleAdminRolePersonSearch,
  handleAdminRoleScopeOptions,
} from './admin-role-export';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const origin = 'http://localhost:3000';

integration('admin role assignment integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-admin-role-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const eventSlug = `admin-role-${eventId}`;
  const adminId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const dayId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const stationId = crypto.randomUUID();
  const assignmentId = crypto.randomUUID();
  const url = `${origin}/api/v1/admin/events/${eventId}/role-assignments`;

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: eventSlug,
      name: 'Role integration event',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T16:00:00Z'),
      timezone: 'Europe/Prague',
      status: 'activation_open',
    });
    await client.db.insert(schema.users).values([
      {
        id: adminId,
        name: 'Role admin',
        email: `role-admin-${adminId}@example.invalid`,
      },
      {
        id: staffId,
        name: 'Patrik Provozní',
        email: `patrik-${staffId}@example.invalid`,
        emailVerified: true,
      },
      {
        id: participantId,
        name: 'Bez oprávnění',
        email: `participant-${participantId}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values(
      [adminId, staffId, participantId].map((userId) => ({
        eventId,
        userId,
        status: 'active' as const,
      })),
    );
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
    await client.db.insert(schema.eventFeatures).values({
      eventId,
      questionsEnabled: true,
    });
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Hlavní den',
      sortOrder: 0,
    });
    await client.db.insert(schema.programSessions).values({
      id: sessionId,
      eventId,
      dayId,
      slug: `role-session-${sessionId}`,
      title: 'Růst bez zkratek',
      type: 'workshop',
      startsAt: new Date('2026-09-18T08:00:00Z'),
      endsAt: new Date('2026-09-18T09:00:00Z'),
      status: 'published',
      capacityMode: 'reservation',
      capacity: 20,
      questionsEnabled: true,
      sortOrder: 0,
    });
    await client.db.insert(schema.checkinStations).values({
      id: stationId,
      eventId,
      name: 'Hlavní vstup',
    });
    await client.db.insert(schema.eventRoles).values({
      id: assignmentId,
      eventId,
      userId: staffId,
      role: 'room_operator',
      scope: { sessionIds: [sessionId] },
      grantedBy: adminId,
    });
  });

  afterAll(async () => {
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.db
      .delete(schema.users)
      .where(inArray(schema.users.id, [adminId, staffId, participantId]));
    await client.close();
  });

  const dependencies = (actorId = adminId) => ({
    db: client.db,
    allowedOrigin: origin,
    currentEventSlug: eventSlug,
    getSession: vi.fn(async () => ({ user: { id: actorId } })),
  });

  it('lists named scopes and searches only through a masked POST response', async () => {
    const list = await handleAdminRoleAssignmentList(
      new Request(url),
      eventId,
      dependencies(),
    );
    expect(list.status).toBe(200);
    const listed = adminRoleAssignmentListResponseSchema.parse(
      await list.json(),
    );
    expect(listed.items).toEqual([
      expect.objectContaining({
        assignmentId,
        operatorLabel: 'Patrik Provozní',
        scope: expect.objectContaining({
          kind: 'session',
          label: 'Růst bez zkratek',
        }),
      }),
    ]);

    const search = await handleAdminRolePersonSearch(
      new Request(`${url}/search`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'patrik' }),
      }),
      eventId,
      dependencies(),
    );
    expect(search.status).toBe(200);
    const found = adminRolePersonSearchResponseSchema.parse(
      await search.json(),
    );
    expect(found.items[0]).toMatchObject({
      operatorId: staffId,
      displayName: 'Patrik Provozní',
    });
    expect(found.items[0]?.maskedVerifiedContact).toContain('***@');
    expect(JSON.stringify(found)).not.toContain(`patrik-${staffId}@`);
  });

  it('returns only role-compatible server-named scope options', async () => {
    for (const [role, expectedKind] of [
      ['checkin_operator', 'station'],
      ['moderator', 'session'],
      ['room_operator', 'session'],
    ] as const) {
      const response = await handleAdminRoleScopeOptions(
        new Request(`${url}/scope-options`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({ role }),
        }),
        eventId,
        dependencies(),
      );
      expect(response.status).toBe(200);
      const body = adminRoleScopeOptionsResponseSchema.parse(
        await response.json(),
      );
      expect(body.options).toEqual([
        expect.objectContaining({ kind: expectedKind }),
      ]);
    }
  });

  it('rejects missing permission and a scope outside the current event', async () => {
    const denied = await handleAdminRoleAssignmentList(
      new Request(url),
      eventId,
      dependencies(participantId),
    );
    expect(denied.status).toBe(403);

    const mutation = await handleAdminRoleAssignment(
      new Request(url, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: 'grant',
          operatorId: staffId,
          role: 'moderator',
          scope: {
            kind: 'session',
            sessionId: crypto.randomUUID(),
            label: 'Cizí aktivita',
          },
          expectedVersion: 1,
          reason: 'Negativní test rozsahu role v jiné akci.',
        }),
      }),
      eventId,
      dependencies(),
    );
    expect(mutation.status).toBe(409);
    expect(await mutation.json()).toMatchObject({
      code: 'ADMIN_INVALID_TRANSITION',
    });
  });
});
