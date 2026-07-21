import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { readParticipantProgram } from './participant-program';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('participant program integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-participant-program-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7();
  const otherEventId = generateUuidV7();
  const userId = generateUuidV7();
  const publisherId = generateUuidV7();
  const dayOneId = generateUuidV7();
  const dayTwoId = generateUuidV7();
  const roomOneId = generateUuidV7();
  const roomTwoId = generateUuidV7();
  const sessionOneId = generateUuidV7();
  const sessionTwoId = generateUuidV7();
  const headers = new Headers({ cookie: 'session=test' });

  const snapshot = {
    program: {
      days: [
        { id: dayOneId, localDate: '2026-09-18', title: 'Pátek', sortOrder: 0 },
        {
          id: dayTwoId,
          localDate: '2026-09-19',
          title: 'Sobota',
          sortOrder: 1,
        },
      ],
      rooms: [
        { id: roomOneId, slug: 'main-stage', name: 'Main Stage', sortOrder: 0 },
        { id: roomTwoId, slug: 'workshop', name: 'Workshop', sortOrder: 1 },
      ],
      sessions: [
        {
          id: sessionOneId,
          dayId: dayOneId,
          roomId: roomOneId,
          slug: 'opening',
          title: 'Opening',
          type: 'talk',
          startsAt: '2026-09-18T07:00:00.000Z',
          endsAt: '2026-09-18T08:00:00.000Z',
          sortOrder: 0,
        },
        {
          id: sessionTwoId,
          dayId: dayTwoId,
          roomId: roomTwoId,
          slug: 'workshop',
          title: 'Workshop',
          type: 'workshop',
          startsAt: '2026-09-19T07:00:00.000Z',
          endsAt: '2026-09-19T08:00:00.000Z',
          sortOrder: 0,
        },
      ],
    },
  };

  beforeAll(async () => {
    await client.db.insert(schema.events).values([
      {
        id: eventId,
        slug: `program-${eventId}`,
        name: 'Program API event',
        timezone: 'Europe/Prague',
        startsAt: new Date('2026-09-18T06:00:00.000Z'),
        endsAt: new Date('2026-09-19T20:00:00.000Z'),
      },
      {
        id: otherEventId,
        slug: `program-other-${otherEventId}`,
        name: 'Other event',
        timezone: 'Europe/Prague',
        startsAt: new Date('2026-09-18T06:00:00.000Z'),
        endsAt: new Date('2026-09-19T20:00:00.000Z'),
      },
    ]);
    await client.db.insert(schema.users).values([
      {
        id: userId,
        name: 'Program participant',
        email: `${userId}@example.invalid`,
      },
      {
        id: publisherId,
        name: 'Program publisher',
        email: `${publisherId}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values([
      { eventId, userId, status: 'active' },
      { eventId, userId: publisherId, status: 'active' },
    ]);
    await client.db.insert(schema.eventRoles).values({
      id: generateUuidV7(),
      eventId,
      userId,
      role: 'participant',
    });
    await client.db.insert(schema.contentPublications).values([
      {
        id: generateUuidV7(),
        eventId,
        version: 1,
        snapshot: { program: { days: [], rooms: [], sessions: [] } },
        checksumSha256: 'a'.repeat(64),
        publishedBy: publisherId,
      },
      {
        id: generateUuidV7(),
        eventId,
        version: 2,
        snapshot,
        checksumSha256: 'b'.repeat(64),
        publishedBy: publisherId,
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  const dependencies = {
    db: client.db,
    getSession: async () => ({ user: { id: userId } }),
  };

  it('returns only the latest immutable snapshot and applies filters', async () => {
    const response = await readParticipantProgram(
      new Request(
        `https://app.byzon.test/api/v1/events/${eventId}/program?day=2026-09-19&type=workshop`,
        { headers },
      ),
      eventId,
      dependencies,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('etag')).toMatch(/^"[a-f0-9]{64}"$/);
    expect(body).toMatchObject({
      eventId,
      version: 2,
      program: {
        days: [{ id: dayTwoId }],
        rooms: [{ id: roomTwoId }],
        sessions: [{ id: sessionTwoId, type: 'workshop' }],
      },
    });
  });

  it('returns 304 for the same authorized filtered representation', async () => {
    const url = `https://app.byzon.test/api/v1/events/${eventId}/program?room=main-stage`;
    const first = await readParticipantProgram(
      new Request(url, { headers }),
      eventId,
      dependencies,
    );
    const secondHeaders = new Headers(headers);
    secondHeaders.set(
      'if-none-match',
      `"not-current", W/${first.headers.get('etag')!}`,
    );
    const second = await readParticipantProgram(
      new Request(url, { headers: secondHeaders }),
      eventId,
      dependencies,
    );

    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('can read an explicit immutable publication version', async () => {
    const response = await readParticipantProgram(
      new Request(
        `https://app.byzon.test/api/v1/events/${eventId}/program?version=1`,
        { headers },
      ),
      eventId,
      dependencies,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      version: 1,
      program: { days: [], rooms: [], sessions: [] },
    });
  });

  it('does not reveal an event outside the authenticated membership', async () => {
    const response = await readParticipantProgram(
      new Request(
        `https://app.byzon.test/api/v1/events/${otherEventId}/program`,
        { headers },
      ),
      otherEventId,
      dependencies,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PROGRAM_NOT_FOUND',
    });
  });

  it('rejects an anonymous request before reading a publication', async () => {
    const response = await readParticipantProgram(
      new Request(`https://app.byzon.test/api/v1/events/${eventId}/program`),
      eventId,
      { db: client.db, getSession: async () => null },
    );

    expect(response.status).toBe(401);
  });
});
