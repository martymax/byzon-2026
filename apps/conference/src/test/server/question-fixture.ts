import { randomUUID } from 'node:crypto';
import { createDatabaseClient, schema } from '@byzon/database';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';

export async function createQuestionFixture() {
  const client = createDatabaseClient({
    connectionString: process.env.TEST_DATABASE_URL!,
    max: 6,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'byzon-qa-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = randomUUID(),
    dayId = randomUUID(),
    roomId = randomUUID();
  const users = {
    admin: randomUUID(),
    participant: randomUUID(),
    other: randomUUID(),
    speaker: randomUUID(),
    speaker2: randomUUID(),
    moderator: randomUUID(),
    coach: randomUUID(),
    unready: randomUUID(),
  };
  const venueId = randomUUID();
  const sessionId = randomUUID(),
    unsupportedId = randomUUID(),
    part1 = randomUUID(),
    part2 = randomUUID();
  const speakerProfileId = randomUUID(),
    speakerProfile2Id = randomUUID();
  const slug = `qa-${eventId}`;
  let now = new Date('2026-09-18T09:30:00Z');
  await client.db.insert(schema.events).values({
    id: eventId,
    slug,
    name: 'Synthetic QA',
    timezone: 'Europe/Prague',
    startsAt: new Date('2026-09-18T07:00:00Z'),
    endsAt: new Date('2026-09-19T20:00:00Z'),
    status: 'live',
  });
  await client.db.insert(schema.users).values(
    Object.entries(users).map(([name, id]) => ({
      id,
      name: `Synthetic ${name}`,
      email: `${id}@example.test`,
      emailVerified: false,
    })),
  );
  await client.db.insert(schema.eventMemberships).values(
    Object.values(users).map((userId) => ({
      eventId,
      userId,
      status: 'active' as const,
    })),
  );
  await client.db.insert(schema.participantProfiles).values(
    Object.entries(users)
      .filter(([name]) => name !== 'unready')
      .map(([name, userId]) => ({
        eventId,
        userId,
        firstName: 'Synthetic',
        lastName: name,
        contactEmail: `${userId}@example.test`,
      })),
  );
  await client.db.insert(schema.eventRoles).values([
    ...Object.entries(users)
      .filter(([name]) => name !== 'unready')
      .map(([, userId]) => ({
        id: randomUUID(),
        eventId,
        userId,
        role: 'participant' as const,
      })),
    { id: randomUUID(), eventId, userId: users.admin, role: 'organizer_admin' },
    { id: randomUUID(), eventId, userId: users.speaker, role: 'speaker' },
    { id: randomUUID(), eventId, userId: users.speaker2, role: 'speaker' },
    {
      id: randomUUID(),
      eventId,
      userId: users.moderator,
      role: 'moderator',
      scope: { sessionIds: [sessionId] },
    },
  ]);
  await client.db.insert(schema.eventFeatures).values({
    eventId,
    questionsEnabled: true,
    questionFollowUpsEnabled: true,
  });
  await client.db.insert(schema.eventAdminVersions).values({ eventId });
  await client.db.insert(schema.eventDays).values({
    id: dayId,
    eventId,
    localDate: '2026-09-18',
    title: 'Friday',
    sortOrder: 0,
  });
  await client.db.insert(schema.venues).values({
    id: venueId,
    eventId,
    slug: venueId,
    name: 'Test venue',
    sortOrder: 0,
  });
  await client.db.insert(schema.rooms).values({
    id: roomId,
    eventId,
    venueId,
    slug: 'koucovaci-zona-radim',
    name: 'Coach room',
    sortOrder: 0,
  });
  await client.db.insert(schema.programSessions).values(
    [sessionId, unsupportedId, part1, part2].map((id, index) => ({
      id,
      eventId,
      dayId,
      roomId,
      slug: id,
      title: `Test session ${index}`,
      startsAt: new Date('2026-09-18T09:00:00Z'),
      endsAt: new Date('2026-09-18T10:00:00Z'),
      status: 'published' as const,
      questionMode:
        id === sessionId
          ? ('moderated_follow_up' as const)
          : ('disabled' as const),
      questionsEnabled: true,
      sortOrder: index,
      type: index >= 2 ? ('mastermind' as const) : ('talk' as const),
      capacityMode: index >= 2 ? ('reservation' as const) : ('none' as const),
      capacity: index >= 2 ? 6 : null,
    })),
  );
  await client.db
    .update(schema.programSessions)
    .set({ reservationGroupId: part1 })
    .where(eq(schema.programSessions.id, part1));
  await client.db
    .update(schema.programSessions)
    .set({ reservationGroupId: part1 })
    .where(eq(schema.programSessions.id, part2));
  await client.db.insert(schema.speakerProfiles).values(
    [
      { id: speakerProfileId, userId: users.speaker, slug: speakerProfileId },
      {
        id: speakerProfile2Id,
        userId: users.speaker2,
        slug: speakerProfile2Id,
      },
    ].map((row) => ({
      ...row,
      eventId,
      firstName: 'Synthetic',
      lastName: 'Speaker',
      sortOrder: 0,
      status: 'published' as const,
    })),
  );
  await client.db.insert(schema.sessionSpeakers).values([
    { eventId, sessionId, speakerProfileId, sortOrder: 0 },
    { eventId, sessionId, speakerProfileId: speakerProfile2Id, sortOrder: 1 },
    { eventId, sessionId: part1, speakerProfileId, sortOrder: 0 },
    { eventId, sessionId: part2, speakerProfileId, sortOrder: 0 },
  ]);
  const publishedSessions = await client.db.query.programSessions.findMany({
    where: eq(schema.programSessions.eventId, eventId),
  });
  await client.db.insert(schema.contentPublications).values({
    id: randomUUID(),
    eventId,
    version: 1,
    publishedBy: users.admin,
    checksumSha256: 'a'.repeat(64),
    snapshot: {
      program: {
        days: [
          {
            id: dayId,
            localDate: '2026-09-18',
            title: 'Friday',
            sortOrder: 0,
          },
        ],
        rooms: [
          {
            id: roomId,
            slug: 'coach-room',
            name: 'Coach room',
            sortOrder: 0,
          },
        ],
        sessions: publishedSessions.map((session) => ({
          id: session.id,
          dayId,
          roomId,
          slug: session.slug,
          title: session.title,
          type: session.type,
          status: 'published',
          startsAt: session.startsAt.toISOString(),
          endsAt: session.endsAt.toISOString(),
          sortOrder: session.sortOrder,
          questionsEnabled: false,
        })),
      },
    },
  });
  const origin = 'https://app.byzon.test';
  return {
    client,
    eventId,
    slug,
    users,
    sessionId,
    unsupportedId,
    part1,
    part2,
    roomId,
    speakerProfileId,
    speakerProfile2Id,
    origin,
    setNow: (value: string) => {
      now = new Date(value);
    },
    dependencies: (userId: string = users.participant) => ({
      db: client.db,
      allowedOrigin: origin,
      currentEventSlug: slug,
      getSession: async () => ({ user: { id: userId } }),
      now: () => now,
    }),
    request: (path: string, body?: unknown, key: string = randomUUID()) =>
      new Request(`${origin}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          ...(body === undefined ? {} : { 'idempotency-key': key }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    // Publications are intentionally immutable. Keep synthetic fixtures in the
    // disposable test database, as the existing publication integration suite does.
    cleanup: async () => {
      await client.close();
    },
  };
}
