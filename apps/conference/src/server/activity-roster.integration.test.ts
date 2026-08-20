import { createDatabaseClient, schema } from '@byzon/database';
import { activityRosterResponseSchema } from '@byzon/domain/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  readActivityRoster,
  type ActivityRosterDependencies,
} from './activity-roster';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('CS-ROSTER-01 HTTP integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-activity-roster-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const isolationEventId = crypto.randomUUID();
  const eventSlug = `roster-${eventId}`;
  const isolationEventSlug = `roster-isolation-${isolationEventId}`;
  const eventDayId = crypto.randomUUID();
  const isolationDayId = crypto.randomUUID();
  const assignedSessionId = crypto.randomUUID();
  const unassignedSessionId = crypto.randomUUID();
  const networkingSessionId = crypto.randomUUID();
  const nonCapacitySessionId = crypto.randomUUID();
  const draftSessionId = crypto.randomUUID();
  const isolationSessionId = crypto.randomUUID();
  const operatorId = crypto.randomUUID();
  const emptyOperatorId = crypto.randomUUID();
  const noRoleUserId = crypto.randomUUID();
  const suspendedOperatorId = crypto.randomUUID();
  const revokedOperatorId = crypto.randomUUID();
  const malformedScopeOperatorId = crypto.randomUUID();
  const isolationOperatorId = crypto.randomUUID();
  const reservedUserId = crypto.randomUUID();
  const waitingUserId = crypto.randomUUID();
  const inactiveUserId = crypto.randomUUID();
  const reservationId = crypto.randomUUID();
  const waitingEntryId = crypto.randomUUID();
  const fixedNow = new Date('2026-09-18T08:00:00.000Z');
  const allUserIds = [
    operatorId,
    emptyOperatorId,
    noRoleUserId,
    suspendedOperatorId,
    revokedOperatorId,
    malformedScopeOperatorId,
    isolationOperatorId,
    reservedUserId,
    waitingUserId,
    inactiveUserId,
  ];

  const sessionFor = (userId: string) => ({ user: { id: userId } });
  const dependencies = (userId: string | null): ActivityRosterDependencies => ({
    db: client.db,
    currentEventSlug: eventSlug,
    getSession: vi.fn(async () => (userId ? sessionFor(userId) : null)),
    now: () => fixedNow,
  });
  const request = (path = '/api/v1/activity-roster') =>
    new Request(`http://localhost:3000${path}`, {
      headers: { 'x-request-id': 'roster-test-request' },
    });

  beforeAll(async () => {
    await client.db.insert(schema.events).values([
      {
        id: eventId,
        slug: eventSlug,
        name: 'Roster integration event',
        startsAt: new Date('2026-09-18T06:00:00Z'),
        endsAt: new Date('2026-09-19T16:30:00Z'),
        timezone: 'Europe/Prague',
        status: 'live',
      },
      {
        id: isolationEventId,
        slug: isolationEventSlug,
        name: 'Roster isolation event',
        startsAt: new Date('2026-10-01T08:00:00Z'),
        endsAt: new Date('2026-10-01T16:00:00Z'),
        timezone: 'Europe/Prague',
        status: 'live',
      },
    ]);
    await client.db.insert(schema.users).values(
      allUserIds.map((id) => ({
        id,
        name: `Roster user ${id}`,
        email: `roster-${id}@example.invalid`,
      })),
    );
    await client.db.insert(schema.eventMemberships).values([
      ...allUserIds
        .filter((id) => id !== isolationOperatorId)
        .map((userId) => ({
          eventId,
          userId,
          status:
            userId === suspendedOperatorId
              ? ('suspended' as const)
              : userId === inactiveUserId
                ? ('revoked' as const)
                : ('active' as const),
        })),
      {
        eventId: isolationEventId,
        userId: isolationOperatorId,
        status: 'active',
      },
    ]);
    await client.db.insert(schema.eventRoles).values([
      {
        id: crypto.randomUUID(),
        eventId,
        userId: operatorId,
        role: 'room_operator',
        scope: {
          sessionIds: [
            assignedSessionId,
            networkingSessionId,
            nonCapacitySessionId,
            draftSessionId,
            isolationSessionId,
          ],
        },
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: emptyOperatorId,
        role: 'room_operator',
        scope: {},
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: suspendedOperatorId,
        role: 'room_operator',
        scope: { sessionIds: [assignedSessionId] },
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: revokedOperatorId,
        role: 'room_operator',
        scope: { sessionIds: [assignedSessionId] },
        revokedAt: new Date('2026-09-01T08:00:00Z'),
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: malformedScopeOperatorId,
        role: 'room_operator',
        scope: { sessionIds: ['not-a-uuid'] } as never,
      },
      {
        id: crypto.randomUUID(),
        eventId: isolationEventId,
        userId: isolationOperatorId,
        role: 'room_operator',
        scope: { sessionIds: [isolationSessionId] },
      },
    ]);
    await client.db.insert(schema.participantProfiles).values([
      {
        eventId,
        userId: reservedUserId,
        firstName: 'Alex',
        lastName: 'Novák',
        company: 'Ukázková firma',
        contactEmail: `private-${reservedUserId}@example.invalid`,
        phone: '+420777123456',
      },
      {
        eventId,
        userId: waitingUserId,
        firstName: 'Mila',
        lastName: 'Testová',
        contactEmail: `private-${waitingUserId}@example.invalid`,
        phone: '+420777654321',
      },
      {
        eventId,
        userId: inactiveUserId,
        firstName: 'Skrytý',
        lastName: 'Účastník',
        company: 'Nezobrazovat',
        contactEmail: `private-${inactiveUserId}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventDays).values([
      {
        id: eventDayId,
        eventId,
        localDate: '2026-09-18',
        title: 'Roster day',
        sortOrder: 0,
      },
      {
        id: isolationDayId,
        eventId: isolationEventId,
        localDate: '2026-10-01',
        title: 'Isolation roster day',
        sortOrder: 0,
      },
    ]);
    await client.db.insert(schema.programSessions).values([
      {
        id: assignedSessionId,
        eventId,
        dayId: eventDayId,
        slug: `assigned-${assignedSessionId}`,
        title: 'Přiřazený mastermind',
        type: 'mastermind',
        startsAt: new Date('2026-09-18T08:00:00Z'),
        endsAt: new Date('2026-09-18T09:00:00Z'),
        status: 'draft',
        capacityMode: 'reservation',
        capacity: 2,
        sortOrder: 0,
      },
      {
        id: unassignedSessionId,
        eventId,
        dayId: eventDayId,
        slug: `unassigned-${unassignedSessionId}`,
        title: 'Cizí workshop',
        type: 'workshop',
        startsAt: new Date('2026-09-18T09:00:00Z'),
        endsAt: new Date('2026-09-18T10:00:00Z'),
        status: 'published',
        capacityMode: 'reservation',
        capacity: 20,
        sortOrder: 1,
      },
      {
        id: networkingSessionId,
        eventId,
        dayId: eventDayId,
        slug: `networking-${networkingSessionId}`,
        title: 'Blokovaný networking',
        type: 'networking',
        startsAt: new Date('2026-09-18T10:00:00Z'),
        endsAt: new Date('2026-09-18T11:00:00Z'),
        status: 'published',
        capacityMode: 'reservation',
        capacity: 10,
        sortOrder: 2,
      },
      {
        id: nonCapacitySessionId,
        eventId,
        dayId: eventDayId,
        slug: `talk-${nonCapacitySessionId}`,
        title: 'Nekapacitní přednáška',
        type: 'talk',
        startsAt: new Date('2026-09-18T11:00:00Z'),
        endsAt: new Date('2026-09-18T12:00:00Z'),
        status: 'published',
        capacityMode: 'none',
        capacity: null,
        sortOrder: 3,
      },
      {
        id: draftSessionId,
        eventId,
        dayId: eventDayId,
        slug: `draft-${draftSessionId}`,
        title: 'Nepublikovaná aktivita',
        type: 'workshop',
        startsAt: new Date('2026-09-18T12:00:00Z'),
        endsAt: new Date('2026-09-18T13:00:00Z'),
        status: 'draft',
        capacityMode: 'reservation',
        capacity: 20,
        sortOrder: 4,
      },
      {
        id: isolationSessionId,
        eventId: isolationEventId,
        dayId: isolationDayId,
        slug: `isolation-${isolationSessionId}`,
        title: 'Cizí event aktivita',
        type: 'workshop',
        startsAt: new Date('2026-10-01T09:00:00Z'),
        endsAt: new Date('2026-10-01T10:00:00Z'),
        status: 'published',
        capacityMode: 'reservation',
        capacity: 20,
        sortOrder: 0,
      },
    ]);
    await client.db.insert(schema.contentPublications).values({
      id: crypto.randomUUID(),
      eventId,
      version: 1,
      snapshot: {
        program: {
          days: [
            {
              id: eventDayId,
              localDate: '2026-09-18',
              title: 'Roster day',
              sortOrder: 0,
            },
          ],
          rooms: [],
          sessions: [
            {
              id: assignedSessionId,
              dayId: eventDayId,
              roomId: null,
              slug: `assigned-${assignedSessionId}`,
              title: 'Přiřazený mastermind',
              type: 'mastermind',
              status: 'published',
              startsAt: '2026-09-18T08:00:00.000Z',
              endsAt: '2026-09-18T09:00:00.000Z',
              sortOrder: 0,
            },
            {
              id: unassignedSessionId,
              dayId: eventDayId,
              roomId: null,
              slug: `unassigned-${unassignedSessionId}`,
              title: 'Cizí workshop',
              type: 'workshop',
              status: 'published',
              startsAt: '2026-09-18T09:00:00.000Z',
              endsAt: '2026-09-18T10:00:00.000Z',
              sortOrder: 1,
            },
            {
              id: networkingSessionId,
              dayId: eventDayId,
              roomId: null,
              slug: `networking-${networkingSessionId}`,
              title: 'Blokovaný networking',
              type: 'networking',
              status: 'published',
              startsAt: '2026-09-18T10:00:00.000Z',
              endsAt: '2026-09-18T11:00:00.000Z',
              sortOrder: 2,
            },
            {
              id: nonCapacitySessionId,
              dayId: eventDayId,
              roomId: null,
              slug: `talk-${nonCapacitySessionId}`,
              title: 'Nekapacitní přednáška',
              type: 'talk',
              status: 'published',
              startsAt: '2026-09-18T11:00:00.000Z',
              endsAt: '2026-09-18T12:00:00.000Z',
              sortOrder: 3,
            },
          ],
        },
      },
      checksumSha256: 'c'.repeat(64),
      publishedBy: operatorId,
      publishedAt: new Date('2026-08-20T08:00:00Z'),
    });
    await client.db.insert(schema.reservations).values([
      {
        id: reservationId,
        eventId,
        sessionId: assignedSessionId,
        userId: reservedUserId,
        status: 'confirmed',
        source: 'participant',
        createdAt: new Date('2026-08-01T08:00:00Z'),
      },
      {
        id: crypto.randomUUID(),
        eventId,
        sessionId: assignedSessionId,
        userId: inactiveUserId,
        status: 'confirmed',
        source: 'participant',
        createdAt: new Date('2026-08-01T09:00:00Z'),
      },
      {
        id: crypto.randomUUID(),
        eventId,
        sessionId: unassignedSessionId,
        userId: reservedUserId,
        status: 'confirmed',
        source: 'participant',
      },
      {
        id: crypto.randomUUID(),
        eventId,
        sessionId: assignedSessionId,
        userId: waitingUserId,
        status: 'cancelled',
        source: 'participant',
        cancelledAt: new Date('2026-08-02T08:00:00Z'),
      },
    ]);
    await client.db.insert(schema.waitlistEntries).values([
      {
        id: waitingEntryId,
        eventId,
        sessionId: assignedSessionId,
        userId: waitingUserId,
        status: 'waiting',
        positionSequence: 1,
      },
      {
        id: crypto.randomUUID(),
        eventId,
        sessionId: assignedSessionId,
        userId: reservedUserId,
        status: 'cancelled',
        positionSequence: 2,
        cancelledAt: new Date('2026-08-03T08:00:00Z'),
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('returns publication-allowed imported draft sessions and minimal active roster PII', async () => {
    const response = await readActivityRoster(
      request(),
      dependencies(operatorId),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization, Cookie');
    const raw = await response.text();
    const body = activityRosterResponseSchema.parse(JSON.parse(raw));
    expect(body).toEqual({
      eventId,
      generatedAt: fixedNow.toISOString(),
      sessions: [
        {
          sessionId: assignedSessionId,
          title: 'Přiřazený mastermind',
          startsAt: '2026-09-18T08:00:00.000Z',
          capacity: 2,
          participants: [
            {
              reservationId,
              state: 'reserved',
              displayName: 'Alex Novák',
              company: 'Ukázková firma',
            },
            {
              reservationId: waitingEntryId,
              state: 'waitlisted',
              displayName: 'Mila Testová',
              company: null,
            },
          ],
        },
      ],
    });
    expect(raw).not.toContain('@example.invalid');
    expect(raw).not.toContain('+420');
    expect(raw).not.toContain(inactiveUserId);
    expect(raw).not.toContain(unassignedSessionId);
    expect(raw).not.toContain(networkingSessionId);
    expect(raw).not.toContain(isolationSessionId);
  });

  it('returns one assigned detail and hides every unassigned identifier behind 404', async () => {
    const assigned = await readActivityRoster(
      request(`/api/v1/activity-roster/${assignedSessionId}`),
      dependencies(operatorId),
      assignedSessionId,
    );
    expect(assigned.status).toBe(200);
    expect(
      activityRosterResponseSchema.parse(await assigned.json()).sessions,
    ).toHaveLength(1);

    for (const sessionId of [
      unassignedSessionId,
      draftSessionId,
      isolationSessionId,
      crypto.randomUUID(),
      'not-a-uuid',
    ]) {
      const response = await readActivityRoster(
        request(`/api/v1/activity-roster/${sessionId}`),
        dependencies(operatorId),
        sessionId,
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'ROSTER_NOT_FOUND' });
    }
  });

  it('returns an explicit empty state for a valid operator without assignments', async () => {
    const response = await readActivityRoster(
      request(),
      dependencies(emptyOperatorId),
    );

    expect(response.status).toBe(200);
    expect(
      activityRosterResponseSchema.parse(await response.json()).sessions,
    ).toEqual([]);
  });

  it('stops returning roster PII at the operational anonymization deadline', async () => {
    await client.db
      .update(schema.events)
      .set({ operationalDataAnonymizesAt: new Date('2026-09-18T08:00:00Z') })
      .where(eq(schema.events.id, eventId));
    try {
      const response = await readActivityRoster(
        request(),
        dependencies(operatorId),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: 'EVENT_ACCESS_DENIED',
      });
    } finally {
      await client.db
        .update(schema.events)
        .set({ operationalDataAnonymizesAt: null })
        .where(eq(schema.events.id, eventId));
    }
  });

  it.each([
    ['anonymous', null, 401],
    ['member without role', noRoleUserId, 403],
    ['suspended membership', suspendedOperatorId, 403],
    ['revoked assignment', revokedOperatorId, 403],
    ['malformed assignment scope', malformedScopeOperatorId, 403],
    ['operator from another event', isolationOperatorId, 403],
  ])('fails closed for %s', async (_label, userId, status) => {
    const response = await readActivityRoster(request(), dependencies(userId));

    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization, Cookie');
    expect(await response.json()).toMatchObject({
      code: status === 401 ? 'AUTHENTICATION_REQUIRED' : 'EVENT_ACCESS_DENIED',
      requestId: 'roster-test-request',
    });
  });
});
