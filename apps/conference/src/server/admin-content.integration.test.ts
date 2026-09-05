import { and, count, eq, isNull } from 'drizzle-orm';
import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { handleAdminContent } from './admin-content';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const origin = 'https://app.byzon.test';

integration('admin content CRUD integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-admin-content-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7();
  const organizerId = generateUuidV7();
  const participantId = generateUuidV7();
  const dependencies = (userId: string) => ({
    db: client.db,
    allowedOrigin: origin,
    getSession: async () => ({ user: { id: userId } }),
  });

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: `admin-${eventId}`,
      name: 'Admin event',
      timezone: 'Europe/Prague',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T20:00:00Z'),
    });
    await client.db.insert(schema.users).values([
      {
        id: organizerId,
        name: 'Organizer',
        email: `${organizerId}@example.invalid`,
      },
      {
        id: participantId,
        name: 'Participant',
        email: `${participantId}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values([
      { eventId, userId: organizerId },
      { eventId, userId: participantId },
    ]);
    await client.db.insert(schema.eventRoles).values([
      {
        id: generateUuidV7(),
        eventId,
        userId: organizerId,
        role: 'organizer_admin',
      },
      {
        id: generateUuidV7(),
        eventId,
        userId: participantId,
        role: 'participant',
      },
    ]);
    await client.db.insert(schema.participantProfiles).values({
      eventId,
      userId: participantId,
      firstName: 'Pat',
      lastName: 'Participant',
      contactEmail: `${participantId}@example.invalid`,
    });
  });
  afterAll(async () => client.close());

  it('creates, lists, version-updates and archives an event-scoped partner with audit', async () => {
    const createRequestId = crypto.randomUUID();
    const create = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-request-id': createRequestId,
        },
        body: JSON.stringify({
          slug: 'partner-test',
          name: 'Partner Test',
          sortOrder: 0,
        }),
      }),
      eventId,
      'partners',
      null,
      dependencies(organizerId),
    );
    expect(create.status).toBe(201);
    const { id } = await create.json();
    const list = await handleAdminContent(
      new Request(`${origin}/api`),
      eventId,
      'partners',
      null,
      dependencies(organizerId),
    );
    expect((await list.json()).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id,
          publicationState: 'unpublished',
          slug: 'partner-test',
        }),
      ]),
    );
    const update = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'PATCH',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Partner Updated', version: 1 }),
      }),
      eventId,
      'partners',
      id,
      dependencies(organizerId),
    );
    expect(update.status).toBe(200);
    const stale = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'PATCH',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Stale', version: 1 }),
      }),
      eventId,
      'partners',
      id,
      dependencies(organizerId),
    );
    expect(stale.status).toBe(409);
    const archived = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'DELETE',
        headers: { origin, 'if-match': '"2"' },
      }),
      eventId,
      'partners',
      id,
      dependencies(organizerId),
    );
    expect(archived.status).toBe(200);
    const [auditCount] = await client.db
      .select({ value: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, eventId),
          eq(schema.auditLogs.targetId, id),
        ),
      );
    expect(auditCount!.value).toBe(3);
    const audit = await client.db.query.auditLogs.findFirst({
      where: and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.action, 'content.post'),
      ),
    });
    expect(audit?.requestId).toBe(createRequestId);
    expect(audit?.after).toMatchObject({ httpRequestId: createRequestId });
  });

  it('creates and updates event-scoped speaker assignments', async () => {
    const dayId = generateUuidV7();
    const speakerId = generateUuidV7();
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-19',
      title: 'Speaker day',
      sortOrder: 98,
    });
    await client.db.insert(schema.speakerProfiles).values({
      id: speakerId,
      eventId,
      slug: `speaker-${speakerId}`,
      firstName: 'Test',
      lastName: 'Speaker',
      sortOrder: 0,
    });
    const create = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          dayId,
          roomId: null,
          slug: `speaker-session-${speakerId}`,
          title: 'Speaker session',
          type: 'talk',
          startsAt: '2026-09-19T08:00:00.000Z',
          endsAt: '2026-09-19T09:00:00.000Z',
          sortOrder: 0,
          speakerIds: [speakerId],
        }),
      }),
      eventId,
      'sessions',
      null,
      dependencies(organizerId),
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };
    const links = await client.db.query.sessionSpeakers.findMany({
      where: and(
        eq(schema.sessionSpeakers.eventId, eventId),
        eq(schema.sessionSpeakers.sessionId, id),
      ),
    });
    expect(links.map((link) => link.speakerProfileId)).toEqual([speakerId]);

    const update = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'PATCH',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ speakerIds: [], version: 1 }),
      }),
      eventId,
      'sessions',
      id,
      dependencies(organizerId),
    );
    expect(update.status).toBe(200);
    expect(
      await client.db.query.sessionSpeakers.findMany({
        where: eq(schema.sessionSpeakers.sessionId, id),
      }),
    ).toEqual([]);
  });

  it('links a speaker to one existing participant identity and can unlink it', async () => {
    const accountEmail = `${participantId}@example.invalid`;
    const create = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          accountEmail: accountEmail.toUpperCase(),
          slug: `linked-speaker-${participantId}`,
          firstName: 'Pat',
          lastName: 'Participant',
          sortOrder: 77,
        }),
      }),
      eventId,
      'speakers',
      null,
      dependencies(organizerId),
    );
    expect(create.status).toBe(201);
    const { id } = (await create.json()) as { id: string };

    await expect(
      client.db.query.speakerProfiles.findFirst({
        columns: { userId: true },
        where: eq(schema.speakerProfiles.id, id),
      }),
    ).resolves.toMatchObject({ userId: participantId });
    await expect(
      client.db.query.eventRoles.findFirst({
        where: and(
          eq(schema.eventRoles.eventId, eventId),
          eq(schema.eventRoles.userId, participantId),
          eq(schema.eventRoles.role, 'speaker'),
          isNull(schema.eventRoles.revokedAt),
        ),
      }),
    ).resolves.toBeTruthy();

    const list = await handleAdminContent(
      new Request(`${origin}/api`),
      eventId,
      'speakers',
      null,
      dependencies(organizerId),
    );
    expect((await list.json()).items).toEqual(
      expect.arrayContaining([expect.objectContaining({ id, accountEmail })]),
    );

    const unlink = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'PATCH',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ accountEmail: null, version: 1 }),
      }),
      eventId,
      'speakers',
      id,
      dependencies(organizerId),
    );
    expect(unlink.status).toBe(200);
    await expect(
      client.db.query.speakerProfiles.findFirst({
        columns: { userId: true },
        where: eq(schema.speakerProfiles.id, id),
      }),
    ).resolves.toMatchObject({ userId: null });
    await expect(
      client.db.query.eventRoles.findFirst({
        where: and(
          eq(schema.eventRoles.eventId, eventId),
          eq(schema.eventRoles.userId, participantId),
          eq(schema.eventRoles.role, 'speaker'),
          isNull(schema.eventRoles.revokedAt),
        ),
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects linking a speaker before the participant account exists', async () => {
    const response = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          accountEmail: 'missing-speaker@example.invalid',
          slug: `missing-speaker-${participantId}`,
          firstName: 'Missing',
          lastName: 'Speaker',
          sortOrder: 78,
        }),
      }),
      eventId,
      'speakers',
      null,
      dependencies(organizerId),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'SPEAKER_ACCOUNT_NOT_FOUND',
      fieldErrors: {
        accountEmail: [expect.stringContaining('Účastníci')],
      },
    });
  });

  it('does not expose admin resources to a participant or accept cross-origin writes', async () => {
    const denied = await handleAdminContent(
      new Request(`${origin}/api`),
      eventId,
      'partners',
      null,
      dependencies(participantId),
    );
    expect(denied.status).toBe(404);
    const crossOrigin = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'POST',
        headers: {
          origin: 'https://evil.invalid',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ slug: 'bad', name: 'Bad', sortOrder: 1 }),
      }),
      eventId,
      'partners',
      null,
      dependencies(organizerId),
    );
    expect(crossOrigin.status).toBe(403);
  });

  it('rejects unsafe URL schemes and timestamps without an explicit offset', async () => {
    const unsafeUrl = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: 'unsafe-link',
          name: 'Unsafe',
          websiteUrl: 'javascript:alert(1)',
          sortOrder: 2,
        }),
      }),
      eventId,
      'partners',
      null,
      dependencies(organizerId),
    );
    expect(unsafeUrl.status).toBe(400);

    const localTimestamp = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          dayId: generateUuidV7(),
          slug: 'missing-offset',
          title: 'Missing offset',
          type: 'talk',
          startsAt: '2026-09-18T10:00:00',
          endsAt: '2026-09-18T11:00:00',
          sortOrder: 0,
        }),
      }),
      eventId,
      'sessions',
      null,
      dependencies(organizerId),
    );
    expect(localTimestamp.status).toBe(400);
  });

  it('returns a safe conflict when a day is still used by a session', async () => {
    const dayId = generateUuidV7();
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Used day',
      sortOrder: 99,
    });
    await client.db.insert(schema.programSessions).values({
      id: generateUuidV7(),
      eventId,
      dayId,
      slug: `used-day-${dayId}`,
      title: 'Used day session',
      startsAt: new Date('2026-09-18T12:00:00Z'),
      endsAt: new Date('2026-09-18T13:00:00Z'),
      sortOrder: 0,
    });
    const response = await handleAdminContent(
      new Request(`${origin}/api`, { method: 'DELETE', headers: { origin } }),
      eventId,
      'days',
      dayId,
      dependencies(organizerId),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONTENT_IN_USE',
    });
  });
});
