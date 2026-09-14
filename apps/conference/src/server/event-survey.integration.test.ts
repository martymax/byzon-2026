import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eventSurveyFixture } from '../test/fixtures/event-survey';

vi.mock('./current-event', () => ({ CURRENT_EVENT_SLUG: 'byzon-2026' }));
import { handleRatings } from './questions';

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;
integration('post-conference survey persistence and access', () => {
  const client = createDatabaseClient({
    connectionString: url!,
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'byzon-survey-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7();
  const userId = generateUuidV7();
  const otherUserId = generateUuidV7();
  const sessionId = generateUuidV7();
  const dayId = generateUuidV7();
  const roomId = generateUuidV7();
  const origin = 'https://app.example.test';
  const now = new Date('2026-09-20T12:00:00Z');
  const dependencies = {
    db: client.db,
    allowedOrigin: origin,
    currentEventSlug: `survey-${eventId}`,
    getSession: async () => ({ user: { id: userId } }),
    now: () => now,
  };
  const read = () =>
    new Request(`${origin}/api/v1/me/ratings?targetType=event`);
  const body = () => ({
    targetType: 'event',
    score: 4,
    comment: 'Díky.',
    survey: {
      ...eventSurveyFixture(),
      programVersion: 1,
      sessions: [{ sessionId, score: 3 }],
    },
  });
  const request = (
    data: unknown,
    key = generateUuidV7(),
    requestOrigin = origin,
  ) =>
    new Request(`${origin}/api/v1/me/ratings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: requestOrigin,
        'idempotency-key': key,
      },
      body: JSON.stringify(data),
    });

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: dependencies.currentEventSlug,
      name: 'Survey test',
      status: 'ended',
      timezone: 'Europe/Prague',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T20:00:00Z'),
    });
    await client.db.insert(schema.users).values(
      [userId, otherUserId].map((id) => ({
        id,
        name: 'Survey participant',
        email: `${id}@example.invalid`,
      })),
    );
    await client.db
      .insert(schema.eventMemberships)
      .values({ eventId, userId, status: 'active' });
    await client.db
      .insert(schema.eventRoles)
      .values({ id: generateUuidV7(), eventId, userId, role: 'participant' });
    await client.db
      .insert(schema.eventFeatures)
      .values({ eventId, ratingsEnabled: true });
    await client.db.insert(schema.contentPublications).values({
      id: generateUuidV7(),
      eventId,
      version: 1,
      checksumSha256: 'a'.repeat(64),
      publishedBy: userId,
      snapshot: {
        program: {
          days: [
            {
              id: dayId,
              localDate: '2026-09-18',
              title: 'Pátek',
              sortOrder: 0,
            },
          ],
          rooms: [
            { id: roomId, slug: 'byzon', name: 'BYZON stage', sortOrder: 0 },
          ],
          sessions: [
            {
              id: sessionId,
              dayId,
              roomId,
              slug: 'talk',
              title: 'Letošní přednáška',
              type: 'talk',
              status: 'published',
              startsAt: '2026-09-18T10:00:00Z',
              endsAt: '2026-09-18T11:00:00Z',
              sortOrder: 0,
            },
          ],
        },
      },
    });
  });
  // Publications are immutable, including in test databases. This suite uses
  // unique IDs and a disposable database, like the other publication tests.
  afterAll(async () => {
    await client.close();
  });

  it('requires a signed-in active participant for both reading and writing', async () => {
    for (const input of [read(), request(body())]) {
      expect(
        (
          await handleRatings(input, {
            ...dependencies,
            getSession: async () => null,
          })
        ).status,
      ).toBe(401);
    }
    expect(
      (
        await handleRatings(read(), {
          ...dependencies,
          getSession: async () => ({ user: { id: otherUserId } }),
        })
      ).status,
    ).toBe(403);
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'suspended' })
      .where(
        and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, userId),
        ),
      );
    expect((await handleRatings(request(body()), dependencies)).status).toBe(
      403,
    );
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'active' })
      .where(
        and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, userId),
        ),
      );
  });
  it('enforces event end and the organizer feature switch', async () => {
    const beforeEnd = {
      ...dependencies,
      now: () => new Date('2026-09-18T12:00:00Z'),
    };
    expect((await handleRatings(read(), beforeEnd)).status).toBe(404);
    expect((await handleRatings(request(body()), beforeEnd)).status).toBe(404);
    await client.db
      .update(schema.eventFeatures)
      .set({ ratingsEnabled: false })
      .where(eq(schema.eventFeatures.eventId, eventId));
    expect((await handleRatings(request(body()), dependencies)).status).toBe(
      409,
    );
    await client.db
      .update(schema.eventFeatures)
      .set({ ratingsEnabled: true })
      .where(eq(schema.eventFeatures.eventId, eventId));
  });
  it('returns only the current event published program with private cache headers', async () => {
    const response = await handleRatings(read(), dependencies);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({
      completed: false,
      surveyProgram: {
        version: 1,
        sessions: [
          { id: sessionId, title: 'Letošní přednáška', stage: 'BYZON stage' },
        ],
      },
    });
  });
  it('rejects invented sessions, unpublished versions, invalid answers and foreign origin', async () => {
    const invalid = body();
    invalid.survey.sessions[0]!.sessionId = generateUuidV7();
    expect((await handleRatings(request(invalid), dependencies)).status).toBe(
      422,
    );
    expect(
      (
        await handleRatings(
          request({
            ...body(),
            survey: { ...body().survey, programVersion: 999 },
          }),
          dependencies,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await handleRatings(
          request({ ...body(), survey: { ...body().survey, websiteScore: 5 } }),
          dependencies,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await handleRatings(
          request(body(), generateUuidV7(), 'https://other.example.test'),
          dependencies,
        )
      ).status,
    ).toBe(422);
  });
  it('atomically saves a long survey, replays the same submission and rejects duplicates', async () => {
    const payload = body();
    payload.survey.lunchComment = 'Č'.repeat(1900);
    payload.survey.breaksComment = 'Č'.repeat(1900);
    payload.survey.networkingComment = 'Č'.repeat(1900);
    const key = generateUuidV7();
    const response = await handleRatings(request(payload, key), dependencies);
    expect(response.status).toBe(201);
    const replay = await handleRatings(request(payload, key), dependencies);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect((await handleRatings(request(payload), dependencies)).status).toBe(
      409,
    );
    const rows = await client.db
      .select()
      .from(schema.ratings)
      .where(eq(schema.ratings.eventId, eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId, score: 4, survey: payload.survey });
    expect(
      await (await handleRatings(read(), dependencies)).json(),
    ).toMatchObject({ completed: true });
  });
});
