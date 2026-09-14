import {
  createDatabaseClient,
  generateUuidV7 as id,
  schema,
} from '@byzon/database';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eventSurveyFixture } from '../test/fixtures/event-survey';
vi.mock('./current-event', () => ({ CURRENT_EVENT_SLUG: 'byzon-2026' }));
import { handleRatings, submitQuestion } from './questions';
import { readQuestionContext } from './own-questions';
import { readSpeakerQuestions } from './speaker-questions';
import {
  mutateParticipantAgenda,
  readParticipantAgenda,
} from './participant-agenda';
import {
  isTimelessTestMode,
  timelessTestCookieValue,
  TIMELESS_TEST_COOKIE,
} from './timeless-test-mode';
import { updateTimelessTestMode } from './timeless-test-settings';

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)('admin timeless testing', () => {
  const client = createDatabaseClient({
    connectionString: url!,
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'timeless-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = id(),
    adminId = id(),
    participantId = id(),
    dayId = id(),
    venueId = id(),
    roomId = id(),
    sessionId = id(),
    roleId = id();
  const origin = 'https://app.example.test';
  const before = new Date('2026-09-14T12:00:00Z');
  const after = new Date('2026-09-20T12:00:00Z');
  const deps = (userId = adminId, now = before) => ({
    db: client.db,
    allowedOrigin: origin,
    currentEventSlug: `timeless-${eventId}`,
    getSession: async () => ({ user: { id: userId } }),
    now: () => now,
  });
  const authCookie = 'better-auth.session_token=test-browser-login';
  const testCookie = (userId = adminId) =>
    `${authCookie}; ${TIMELESS_TEST_COOKIE}=${timelessTestCookieValue(new Headers({ cookie: authCookie }), eventId, userId)}`;
  const request = (path: string, body?: unknown, cookie = testCookie()) =>
    new Request(`${origin}${path}`, {
      ...(body === undefined
        ? {}
        : { method: 'POST', body: JSON.stringify(body) }),
      headers: {
        cookie,
        origin,
        'content-type': 'application/json',
        'idempotency-key': id(),
      },
    });
  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: `timeless-${eventId}`,
      name: 'Testovací konference',
      status: 'activation_open',
      timezone: 'Europe/Prague',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T20:00:00Z'),
    });
    await client.db.insert(schema.users).values(
      [adminId, participantId].map((userId) => ({
        id: userId,
        name: 'Test',
        email: `${userId}@example.invalid`,
      })),
    );
    await client.db.insert(schema.eventMemberships).values(
      [adminId, participantId].map((userId) => ({
        eventId,
        userId,
        status: 'active' as const,
      })),
    );
    await client.db.insert(schema.eventRoles).values([
      ...[adminId, participantId].map((userId) => ({
        id: id(),
        eventId,
        userId,
        role: 'participant' as const,
      })),
      { id: roleId, eventId, userId: adminId, role: 'organizer_admin' },
    ]);
    await client.db.insert(schema.participantProfiles).values(
      [adminId, participantId].map((userId) => ({
        eventId,
        userId,
        firstName: 'Test',
        lastName: 'Účastník',
        contactEmail: `${userId}@example.invalid`,
        onboardingCompletedAt: before,
      })),
    );
    await client.db
      .insert(schema.eventFeatures)
      .values({ eventId, ratingsEnabled: true, questionsEnabled: true });
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Pátek',
      sortOrder: 0,
    });
    await client.db.insert(schema.venues).values({
      id: venueId,
      eventId,
      slug: 'venue',
      name: 'Venue',
      status: 'published',
      sortOrder: 0,
    });
    await client.db.insert(schema.rooms).values({
      id: roomId,
      eventId,
      venueId,
      slug: 'room',
      name: 'Room',
      status: 'published',
      sortOrder: 0,
    });
    const session = {
      id: sessionId,
      dayId,
      roomId,
      slug: 'workshop',
      title: 'Workshop',
      type: 'workshop' as const,
      status: 'published' as const,
      startsAt: '2026-09-18T10:00:00Z',
      endsAt: '2026-09-18T11:00:00Z',
      sortOrder: 0,
      capacityMode: 'reservation' as const,
      capacity: 1,
      reservationOpensAt: '2026-09-17T10:00:00Z',
      reservationClosesAt: '2026-09-18T10:00:00Z',
    };
    await client.db.insert(schema.programSessions).values({
      ...session,
      eventId,
      startsAt: new Date(session.startsAt),
      endsAt: new Date(session.endsAt),
      reservationOpensAt: new Date(session.reservationOpensAt),
      reservationClosesAt: new Date(session.reservationClosesAt),
      questionMode: 'moderated_follow_up',
      questionsEnabled: true,
    });
    await client.db.insert(schema.contentPublications).values({
      id: id(),
      eventId,
      version: 1,
      checksumSha256: 'a'.repeat(64),
      publishedBy: adminId,
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
          rooms: [{ id: roomId, slug: 'room', name: 'Room', sortOrder: 0 }],
          sessions: [session],
        },
      },
    });
  });
  afterAll(async () => {
    await client.close();
  });

  it('enables and disables an HttpOnly preference only for active admins, with origin and body checks', async () => {
    const path = '/api/v1/me/test-mode';
    const on = await updateTimelessTestMode(
      request(path, { enabled: true }, authCookie),
      deps(),
    );
    expect(on.status).toBe(200);
    expect(on.headers.get('set-cookie')).toContain(
      'HttpOnly; SameSite=Lax; Max-Age=28800; Secure',
    );
    expect(on.headers.get('set-cookie')).toContain(testCookie().split('; ')[1]);
    const off = await updateTimelessTestMode(
      request(path, { enabled: false }),
      deps(),
    );
    expect(off.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(
      (
        await updateTimelessTestMode(
          request(path, { enabled: true }),
          deps(participantId),
        )
      ).status,
    ).toBe(403);
    expect(
      (await updateTimelessTestMode(request(path, { enabled: 'true' }), deps()))
        .status,
    ).toBe(400);
    const foreign = request(path, { enabled: true });
    foreign.headers.set('origin', 'https://other.example');
    expect((await updateTimelessTestMode(foreign, deps())).status).toBe(400);
    expect(
      (
        await updateTimelessTestMode(request(path, { enabled: true }), {
          ...deps(),
          getSession: async () => null,
        })
      ).status,
    ).toBe(401);
  });
  it('rejects copied cookies, changed login, suspended membership and revoked admin role', async () => {
    const active = (cookie = testCookie(), userId = adminId) =>
      isTimelessTestMode(client.db, new Headers({ cookie }), eventId, userId);
    expect(await active()).toBe(true);
    expect(await active(testCookie(), participantId)).toBe(false);
    expect(await active(testCookie(participantId), participantId)).toBe(false);
    expect(
      await active(testCookie().replace('test-browser-login', 'another-login')),
    ).toBe(false);
    expect(await active(authCookie)).toBe(false);
    await client.db
      .update(schema.eventRoles)
      .set({ revokedAt: before })
      .where(eq(schema.eventRoles.id, roleId));
    expect(await active()).toBe(false);
    await client.db
      .update(schema.eventRoles)
      .set({ revokedAt: null })
      .where(eq(schema.eventRoles.id, roleId));
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'suspended' })
      .where(
        and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, adminId),
        ),
      );
    expect(await active()).toBe(false);
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'active' })
      .where(
        and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, adminId),
        ),
      );
  });
  it('opens event and session ratings early, validates the future published program and persists once', async () => {
    const path = '/api/v1/me/ratings';
    expect(
      (
        await handleRatings(
          request(`${path}?targetType=event`, undefined, authCookie),
          deps(),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleRatings(
          request(
            `${path}?targetType=event`,
            undefined,
            testCookie(participantId),
          ),
          deps(participantId),
        )
      ).status,
    ).toBe(404);
    const status = await handleRatings(
      request(`${path}?targetType=event`),
      deps(),
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      completed: false,
      surveyProgram: { sessions: [{ id: sessionId }] },
    });
    expect(
      (
        await handleRatings(
          request(`${path}?targetType=session&sessionId=${sessionId}`),
          deps(),
        )
      ).status,
    ).toBe(200);
    const payload = {
      targetType: 'event',
      score: 4,
      comment: null,
      survey: {
        ...eventSurveyFixture(),
        workshopsAttended: true,
        workshopsScore: 4,
        programVersion: 1,
        sessions: [{ sessionId, score: 4 }],
      },
    };
    expect(
      (
        await handleRatings(
          request(path, {
            ...payload,
            survey: {
              ...payload.survey,
              sessions: [{ sessionId: id(), score: 4 }],
            },
          }),
          deps(),
        )
      ).status,
    ).toBe(422);
    expect((await handleRatings(request(path, payload), deps())).status).toBe(
      201,
    );
    expect((await handleRatings(request(path, payload), deps())).status).toBe(
      409,
    );
    await client.db
      .update(schema.eventFeatures)
      .set({ ratingsEnabled: false })
      .where(eq(schema.eventFeatures.eventId, eventId));
    expect(
      (await handleRatings(request(`${path}?targetType=event`), deps())).status,
    ).toBe(409);
    await client.db
      .update(schema.eventFeatures)
      .set({ ratingsEnabled: true })
      .where(eq(schema.eventFeatures.eventId, eventId));
  });
  it('opens closed question collection only for the tester, preserving disabled features', async () => {
    const path = `/api/v1/sessions/${sessionId}/questions`;
    const context = await readQuestionContext(
      request(path),
      sessionId,
      deps(adminId, after),
    );
    expect(await context.json()).toMatchObject({
      state: 'open',
      canSubmit: true,
    });
    const normal = await readQuestionContext(
      request(path, undefined, authCookie),
      sessionId,
      deps(adminId, after),
    );
    expect(await normal.json()).toMatchObject({
      state: 'closed',
      canSubmit: false,
    });
    expect(
      (
        await submitQuestion(
          request(path, { text: 'Testovací dotaz po skončení.' }),
          sessionId,
          deps(adminId, after),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await submitQuestion(
          request(path, { text: 'Bez přepínače.' }, authCookie),
          sessionId,
          deps(adminId, after),
        )
      ).status,
    ).toBe(409);
    await client.db
      .update(schema.eventFeatures)
      .set({ questionsEnabled: false })
      .where(eq(schema.eventFeatures.eventId, eventId));
    expect(
      (
        await submitQuestion(
          request(path, { text: 'Vypnutá funkce.' }),
          sessionId,
          deps(adminId, after),
        )
      ).status,
    ).toBe(409);
  });
  it('projects and enforces early reservations, capacity and cancellation after start', async () => {
    const path = '/api/v1/me/agenda/actions';
    expect(
      (
        await mutateParticipantAgenda(
          request(path, { action: 'add', sessionId, expectedVersion: 1 }),
          deps(),
        )
      ).status,
    ).toBe(200);
    const read = async (cookie = testCookie()) => {
      const response = await readParticipantAgenda(
        new Request(`${origin}/api/v1/me/agenda`, { headers: { cookie } }),
        deps(),
      );
      expect(response.status).toBe(200);
      return response.json();
    };
    expect((await read(authCookie)).items[0].action.state).toBe('closed');
    expect((await read()).items[0].action.state).toBe('available');
    expect(
      (
        await mutateParticipantAgenda(
          request(
            path,
            { action: 'reserve', sessionId, expectedVersion: 2 },
            authCookie,
          ),
          deps(),
        )
      ).status,
    ).toBe(409);
    const reserved = await mutateParticipantAgenda(
      request(path, { action: 'reserve', sessionId, expectedVersion: 2 }),
      deps(),
    );
    expect(reserved.status).toBe(200);
    const body = await reserved.json();
    expect(body.items[0].state).toBe('reserved');
    expect(body.items[0].capacity.remaining).toBe(0);
    expect(
      (
        await mutateParticipantAgenda(
          request(
            path,
            { action: 'add', sessionId, expectedVersion: 1 },
            authCookie,
          ),
          deps(participantId),
        )
      ).status,
    ).toBe(200);
    const full = await mutateParticipantAgenda(
      request(
        path,
        { action: 'reserve', sessionId, expectedVersion: 2 },
        authCookie,
      ),
      deps(participantId, new Date('2026-09-17T12:00:00Z')),
    );
    expect(full.status).toBe(409);
    expect((await full.json()).code).toBe('CAPACITY_FULL');
    const cancelled = await mutateParticipantAgenda(
      request(path, {
        action: 'cancel',
        sessionId,
        expectedVersion: body.version,
      }),
      deps(adminId, after),
    );
    expect(cancelled.status).toBe(200);
    const row = await client.db.query.reservations.findFirst({
      where: and(
        eq(schema.reservations.eventId, eventId),
        eq(schema.reservations.userId, adminId),
      ),
    });
    expect(row?.status).toBe('cancelled');
  });
  it('opens assigned speaker follow-ups early without bypassing speaker assignment or the feature switch', async () => {
    const profileId = id();
    await client.db
      .insert(schema.eventRoles)
      .values({ id: id(), eventId, userId: adminId, role: 'speaker' });
    await client.db.insert(schema.speakerProfiles).values({
      id: profileId,
      eventId,
      userId: adminId,
      slug: 'test-speaker',
      firstName: 'Test',
      lastName: 'Řečník',
      status: 'published',
      sortOrder: 0,
    });
    await client.db.insert(schema.sessionSpeakers).values({
      eventId,
      sessionId,
      speakerProfileId: profileId,
      sortOrder: 0,
    });
    await client.db
      .update(schema.eventFeatures)
      .set({ questionFollowUpsEnabled: true })
      .where(eq(schema.eventFeatures.eventId, eventId));
    const path = `/api/v1/speaker/sessions/${sessionId}/questions`;
    expect(
      (await readSpeakerQuestions(request(path), sessionId, deps())).status,
    ).toBe(200);
    expect(
      (
        await readSpeakerQuestions(
          request(path, undefined, authCookie),
          sessionId,
          deps(),
        )
      ).status,
    ).toBe(409);
    expect(
      (await readSpeakerQuestions(request(path), id(), deps())).status,
    ).toBe(403);
    await client.db
      .update(schema.eventFeatures)
      .set({ questionFollowUpsEnabled: false })
      .where(eq(schema.eventFeatures.eventId, eventId));
    expect(
      (await readSpeakerQuestions(request(path), sessionId, deps())).status,
    ).toBe(409);
  });
});
