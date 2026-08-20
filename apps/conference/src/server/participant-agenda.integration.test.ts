import {
  acquireTransactionLock,
  createDatabaseClient,
  schema,
  withTransaction,
} from '@byzon/database';
import {
  participantAgendaMutationProblemSchema,
  participantAgendaMutationResponseSchema,
  participantAgendaProblemSchema,
  participantAgendaResponseSchema,
} from '@byzon/domain/contracts';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  mutateParticipantAgenda,
  readParticipantAgenda,
  type ParticipantAgendaDependencies,
} from './participant-agenda';
import { createParticipantAgendaRateLimiter } from './participant-agenda-rate-limit';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const appOrigin = 'http://localhost:3000';

integration('CS-AGENDA-01 HTTP integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 6,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-participant-agenda-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const eventSlug = `participant-agenda-${eventId}`;
  const isolationEventId = crypto.randomUUID();
  const isolationEventSlug = `participant-agenda-isolation-${isolationEventId}`;
  const dayId = crypto.randomUUID();
  const roomId = crypto.randomUUID();
  const publisherId = crypto.randomUUID();
  const primaryUserId = crypto.randomUUID();
  const contenderOneId = crypto.randomUUID();
  const contenderTwoId = crypto.randomUUID();
  const isolationUserId = crypto.randomUUID();
  const inactiveTicketUserId = crypto.randomUUID();
  const driftUserId = crypto.randomUUID();
  const cancellationRaceUserId = crypto.randomUUID();
  const cutoffRaceUserId = crypto.randomUUID();
  const replayUserId = crypto.randomUUID();
  const savedSessionId = crypto.randomUUID();
  const conflictingSessionId = crypto.randomUUID();
  const reservedSessionId = crypto.randomUUID();
  const lastSeatSessionId = crypto.randomUUID();
  const closedSessionId = crypto.randomUUID();
  const networkingSessionId = crypto.randomUUID();
  const cancellationRaceSessionId = crypto.randomUUID();
  const cutoffRaceSessionId = crypto.randomUUID();
  const archivedOperationalSessionId = crypto.randomUUID();
  const fixedNow = new Date('2026-09-18T07:00:00.000Z');
  const onOperationalDrift = vi.fn();

  const dependencies = (
    userId: string | null,
  ): ParticipantAgendaDependencies => ({
    db: client.db,
    allowedOrigin: appOrigin,
    currentEventSlug: eventSlug,
    getSession: vi.fn(async () => (userId ? { user: { id: userId } } : null)),
    now: () => fixedNow,
    onOperationalDrift,
  });
  const readRequest = () =>
    new Request(`${appOrigin}/api/v1/me/agenda`, {
      headers: { 'x-request-id': 'agenda-read-request' },
    });
  const mutationRequest = (body: unknown, key: string, origin = appOrigin) =>
    new Request(`${appOrigin}/api/v1/me/agenda/actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': key,
        origin,
        'x-request-id': 'agenda-mutation-request',
      },
      body: JSON.stringify(body),
    });
  const mutate = (
    userId: string,
    body: unknown,
    key: string,
    origin = appOrigin,
  ) =>
    mutateParticipantAgenda(
      mutationRequest(body, key, origin),
      dependencies(userId),
    );
  const publishedSession = (
    id: string,
    slug: string,
    title: string,
    startsAt: string,
    endsAt: string,
    type: 'mastermind' | 'networking' | 'talk' | 'workshop',
  ) => ({
    id,
    dayId,
    roomId,
    slug,
    title,
    summary: null,
    description: null,
    type,
    status: 'published' as const,
    startsAt,
    endsAt,
    sortOrder: 0,
  });

  beforeAll(async () => {
    await client.db.insert(schema.events).values([
      {
        id: eventId,
        slug: eventSlug,
        name: 'Participant agenda integration event',
        startsAt: new Date('2026-09-18T06:00:00Z'),
        endsAt: new Date('2026-09-19T16:30:00Z'),
        timezone: 'Europe/Prague',
        status: 'live',
      },
      {
        id: isolationEventId,
        slug: isolationEventSlug,
        name: 'Participant agenda isolation event',
        startsAt: new Date('2026-10-01T06:00:00Z'),
        endsAt: new Date('2026-10-01T16:00:00Z'),
        timezone: 'Europe/Prague',
        status: 'live',
      },
    ]);
    const userIds = [
      publisherId,
      primaryUserId,
      contenderOneId,
      contenderTwoId,
      isolationUserId,
      inactiveTicketUserId,
      driftUserId,
      cancellationRaceUserId,
      cutoffRaceUserId,
      replayUserId,
    ];
    await client.db.insert(schema.users).values(
      userIds.map((id) => ({
        id,
        name: `Agenda user ${id}`,
        email: `agenda-${id}@example.invalid`,
      })),
    );
    await client.db.insert(schema.eventMemberships).values([
      ...[
        publisherId,
        primaryUserId,
        contenderOneId,
        contenderTwoId,
        inactiveTicketUserId,
        driftUserId,
        cancellationRaceUserId,
        cutoffRaceUserId,
        replayUserId,
      ].map((userId) => ({ eventId, userId, status: 'active' as const })),
      {
        eventId: isolationEventId,
        userId: isolationUserId,
        status: 'active',
      },
    ]);
    await client.db.insert(schema.eventRoles).values(
      [
        primaryUserId,
        contenderOneId,
        contenderTwoId,
        inactiveTicketUserId,
        driftUserId,
        cancellationRaceUserId,
        cutoffRaceUserId,
        replayUserId,
      ].map((userId) => ({
        id: crypto.randomUUID(),
        eventId,
        userId,
        role: 'participant' as const,
      })),
    );
    await client.db.insert(schema.eventRoles).values({
      id: crypto.randomUUID(),
      eventId: isolationEventId,
      userId: isolationUserId,
      role: 'participant',
    });
    await client.db.insert(schema.tickets).values(
      [
        primaryUserId,
        contenderOneId,
        contenderTwoId,
        inactiveTicketUserId,
        cancellationRaceUserId,
        cutoffRaceUserId,
      ].map((userId, index) => ({
        id: crypto.randomUUID(),
        eventId,
        codeHmac: (index + 1).toString(16).padStart(64, '0'),
        codeSuffix: `agenda-${index + 1}`,
        status:
          userId === inactiveTicketUserId
            ? ('blocked' as const)
            : ('activated' as const),
        holderUserId: userId,
        ...(userId === inactiveTicketUserId ? {} : { claimedAt: fixedNow }),
      })),
    );
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Pátek',
      sortOrder: 0,
    });
    await client.db.insert(schema.venues).values({
      id: crypto.randomUUID(),
      eventId,
      slug: `agenda-venue-${eventId}`,
      name: 'Agenda venue',
      status: 'published',
      sortOrder: 0,
    });
    const venue = await client.db.query.venues.findFirst({
      columns: { id: true },
      where: eq(schema.venues.eventId, eventId),
    });
    await client.db.insert(schema.rooms).values({
      id: roomId,
      eventId,
      venueId: venue!.id,
      slug: `agenda-room-${eventId}`,
      name: 'Workshop room',
      status: 'published',
      sortOrder: 0,
    });
    const sessions = [
      {
        id: savedSessionId,
        slug: `saved-${savedSessionId}`,
        title: 'Uložený bod',
        startsAt: new Date('2026-09-18T08:00:00Z'),
        endsAt: new Date('2026-09-18T09:00:00Z'),
        type: 'talk' as const,
        capacityMode: 'none' as const,
        capacity: null,
      },
      {
        id: conflictingSessionId,
        slug: `conflict-${conflictingSessionId}`,
        title: 'Překrývající se bod',
        startsAt: new Date('2026-09-18T08:30:00Z'),
        endsAt: new Date('2026-09-18T09:30:00Z'),
        type: 'workshop' as const,
        capacityMode: 'none' as const,
        capacity: null,
      },
      {
        id: reservedSessionId,
        slug: `reserved-${reservedSessionId}`,
        title: 'Rezervovatelný workshop',
        startsAt: new Date('2026-09-18T10:00:00Z'),
        endsAt: new Date('2026-09-18T11:00:00Z'),
        type: 'workshop' as const,
        capacityMode: 'reservation' as const,
        capacity: 2,
      },
      {
        id: lastSeatSessionId,
        slug: `last-seat-${lastSeatSessionId}`,
        title: 'Poslední místo',
        startsAt: new Date('2026-09-18T12:00:00Z'),
        endsAt: new Date('2026-09-18T13:00:00Z'),
        type: 'mastermind' as const,
        capacityMode: 'reservation' as const,
        capacity: 1,
      },
      {
        id: closedSessionId,
        slug: `closed-${closedSessionId}`,
        title: 'Uzavřená rezervace',
        startsAt: new Date('2026-09-18T06:30:00Z'),
        endsAt: new Date('2026-09-18T07:30:00Z'),
        type: 'workshop' as const,
        capacityMode: 'reservation' as const,
        capacity: 2,
      },
      {
        id: networkingSessionId,
        slug: `networking-${networkingSessionId}`,
        title: 'Řízený networking',
        startsAt: new Date('2026-09-18T14:00:00Z'),
        endsAt: new Date('2026-09-18T15:00:00Z'),
        type: 'networking' as const,
        capacityMode: 'reservation' as const,
        capacity: 10,
      },
      {
        id: cancellationRaceSessionId,
        slug: `cancellation-race-${cancellationRaceSessionId}`,
        title: 'Rezervace souběžná se stornem',
        startsAt: new Date('2026-09-18T15:00:00Z'),
        endsAt: new Date('2026-09-18T16:00:00Z'),
        type: 'workshop' as const,
        capacityMode: 'reservation' as const,
        capacity: 2,
      },
      {
        id: cutoffRaceSessionId,
        slug: `cutoff-race-${cutoffRaceSessionId}`,
        title: 'Rezervace čekající přes uzávěrku',
        startsAt: new Date('2026-09-18T15:00:00Z'),
        endsAt: new Date('2026-09-18T16:00:00Z'),
        type: 'workshop' as const,
        capacityMode: 'reservation' as const,
        capacity: 2,
        reservationClosesAt: new Date('2026-09-18T07:00:30Z'),
      },
      {
        id: archivedOperationalSessionId,
        slug: `archived-operational-${archivedOperationalSessionId}`,
        title: 'Only present in the immutable publication',
        startsAt: new Date('2026-09-18T15:00:00Z'),
        endsAt: new Date('2026-09-18T16:00:00Z'),
        type: 'talk' as const,
        capacityMode: 'none' as const,
        capacity: null,
        status: 'archived' as const,
      },
    ];
    await client.db.insert(schema.programSessions).values(
      sessions.map((session, index) => ({
        ...session,
        eventId,
        dayId,
        roomId,
        status: 'status' in session ? session.status : ('draft' as const),
        waitlistMode: 'disabled' as const,
        sortOrder: index,
      })),
    );
    await client.db.insert(schema.contentPublications).values({
      id: crypto.randomUUID(),
      eventId,
      version: 3,
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
            {
              id: roomId,
              slug: `agenda-room-${eventId}`,
              name: 'Workshop room',
              sortOrder: 0,
            },
          ],
          sessions: sessions
            .map((session) =>
              publishedSession(
                session.id,
                session.slug,
                session.title,
                session.startsAt.toISOString(),
                session.endsAt.toISOString(),
                session.type,
              ),
            )
            .map((session, index) => ({ ...session, sortOrder: index })),
        },
      },
      checksumSha256: 'a'.repeat(64),
      publishedBy: publisherId,
      publishedAt: new Date('2026-08-20T08:00:00Z'),
    });
  });

  afterAll(async () => {
    await client.close();
  });

  it('enforces authentication, event scope, private caching and a bounded empty snapshot', async () => {
    const anonymous = await readParticipantAgenda(
      readRequest(),
      dependencies(null),
    );
    expect(anonymous.status).toBe(401);

    const malformedIdentity = await readParticipantAgenda(
      readRequest(),
      dependencies('not-a-uuid'),
    );
    expect(malformedIdentity.status).toBe(401);

    const crossEvent = await readParticipantAgenda(
      readRequest(),
      dependencies(isolationUserId),
    );
    expect(crossEvent.status).toBe(403);

    const response = await readParticipantAgenda(
      readRequest(),
      dependencies(primaryUserId),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization, Cookie');
    expect(
      participantAgendaResponseSchema.parse(await response.json()),
    ).toMatchObject({
      eventId,
      userId: primaryUserId,
      version: 1,
      publicationVersion: 3,
      items: [],
      calendarExport: { state: 'unavailable', reason: 'empty' },
    });
  });

  it('applies the authenticated rate-limit gate and fails mutations closed', async () => {
    const readRateLimit = vi.fn(async () => ({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetAt: new Date(fixedNow.getTime() + 60_000),
      retryAfterSeconds: 60,
    }));
    const read = await readParticipantAgenda(readRequest(), {
      ...dependencies(primaryUserId),
      rateLimit: readRateLimit,
    });
    expect(read.status).toBe(200);
    expect(read.headers.get('ratelimit-limit')).toBe('120');
    expect(read.headers.get('ratelimit-remaining')).toBe('119');
    expect(readRateLimit).toHaveBeenCalledWith('read', primaryUserId);

    const exhaustedReadRateLimit = createParticipantAgendaRateLimiter({
      store: {
        consume: vi.fn(async () => ({
          count: 121,
          resetAt: new Date(fixedNow.getTime() + 42_000),
        })),
      },
      subjectSecret: 'test-agenda-rate-limit-secret-at-least-32-chars',
      eventSlug,
      now: () => fixedNow,
    });
    const limitedRead = await readParticipantAgenda(readRequest(), {
      ...dependencies(primaryUserId),
      rateLimit: exhaustedReadRateLimit,
    });
    expect(limitedRead.status).toBe(429);
    expect(limitedRead.headers.get('retry-after')).toBe('42');
    expect(
      participantAgendaProblemSchema.parse(await limitedRead.json()),
    ).toMatchObject({ code: 'RATE_LIMITED' });

    const mutationRateLimit = vi.fn(async () => {
      throw new Error('shared rate-limit store unavailable');
    });
    const mutation = await mutateParticipantAgenda(
      mutationRequest(
        { action: 'add', sessionId: savedSessionId, expectedVersion: 1 },
        'agenda-rate-limit-unavailable-0001',
      ),
      {
        ...dependencies(primaryUserId),
        rateLimit: mutationRateLimit,
      },
    );
    expect(mutation.status).toBe(500);
    expect(await mutation.json()).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(mutationRateLimit).toHaveBeenCalledWith('mutation', primaryUserId);
    expect(
      await client.db.query.participantAgendas.findFirst({
        where: and(
          eq(schema.participantAgendas.eventId, eventId),
          eq(schema.participantAgendas.userId, primaryUserId),
        ),
      }),
    ).toBeUndefined();
  });

  it('applies add/remove idempotently and returns a canonical non-blocking conflict', async () => {
    const added = await mutate(
      primaryUserId,
      { action: 'add', sessionId: savedSessionId, expectedVersion: 1 },
      'agenda-add-saved-0001',
    );
    expect(added.status).toBe(200);
    expect(
      participantAgendaMutationResponseSchema.parse(await added.json()),
    ).toMatchObject({
      version: 2,
      mutation: { action: 'add', outcome: 'applied' },
      timeConflict: null,
    });

    const conflict = await mutate(
      primaryUserId,
      { action: 'add', sessionId: conflictingSessionId, expectedVersion: 2 },
      'agenda-add-conflict-0001',
    );
    const conflictBody = participantAgendaMutationResponseSchema.parse(
      await conflict.json(),
    );
    expect(conflictBody).toMatchObject({
      version: 3,
      mutation: { action: 'add', outcome: 'applied' },
      timeConflict: {
        sessionId: conflictingSessionId,
        conflictingSessions: [{ id: savedSessionId }],
      },
    });

    const removed = await mutate(
      primaryUserId,
      { action: 'remove', sessionId: conflictingSessionId, expectedVersion: 3 },
      'agenda-remove-conflict-0001',
    );
    const removedBody = participantAgendaMutationResponseSchema.parse(
      await removed.json(),
    );
    expect(removedBody.version).toBe(4);
    expect(
      removedBody.items.some(
        ({ session }) => session.id === conflictingSessionId,
      ),
    ).toBe(false);

    const noOp = await mutate(
      primaryUserId,
      { action: 'remove', sessionId: conflictingSessionId, expectedVersion: 4 },
      'agenda-remove-conflict-0002',
    );
    expect(
      participantAgendaMutationResponseSchema.parse(await noOp.json()),
    ).toMatchObject({ version: 4, mutation: { outcome: 'already_applied' } });
  });

  it('reserves atomically, replays the stored response and keeps future actions disabled', async () => {
    const added = await mutate(
      primaryUserId,
      { action: 'add', sessionId: reservedSessionId, expectedVersion: 4 },
      'agenda-add-reservable-0001',
    );
    expect(added.status).toBe(200);

    const body = {
      action: 'reserve' as const,
      sessionId: reservedSessionId,
      expectedVersion: 5,
    };
    const reserved = await mutate(
      primaryUserId,
      body,
      'agenda-reserve-primary-0001',
    );
    const reservedBody = participantAgendaMutationResponseSchema.parse(
      await reserved.clone().json(),
    );
    expect(reserved.status).toBe(200);
    expect(reservedBody).toMatchObject({
      version: 6,
      mutation: { action: 'reserve', outcome: 'applied' },
      calendarExport: { state: 'unavailable', reason: 'not_ready' },
    });
    expect(
      reservedBody.items.find(
        ({ session }) => session.id === reservedSessionId,
      ),
    ).toMatchObject({
      state: 'reserved',
      reservation: {
        cancellation: { state: 'unavailable', reason: 'policy_pending' },
      },
    });

    const replay = await mutate(
      primaryUserId,
      body,
      'agenda-reserve-primary-0001',
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(await replay.json()).toEqual(reservedBody);
    const reservationAudits = await client.db
      .select({ value: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, eventId),
          eq(schema.auditLogs.actorId, primaryUserId),
          eq(schema.auditLogs.action, 'reservation.created'),
          eq(schema.auditLogs.targetId, reservedSessionId),
        ),
      );
    expect(reservationAudits[0]?.value).toBe(1);
    const storedReceipts = await client.db.query.idempotencyKeys.findMany({
      columns: { responseBody: true },
      where: and(
        eq(schema.idempotencyKeys.eventId, eventId),
        eq(schema.idempotencyKeys.actorId, primaryUserId),
        eq(schema.idempotencyKeys.scope, 'participant.agenda-action'),
      ),
    });
    const storedReceipt = storedReceipts.find(
      ({ responseBody }) => responseBody?.action === 'reserve',
    );
    expect(storedReceipt?.responseBody).toEqual({
      action: 'reserve',
      sessionId: reservedSessionId,
      outcome: 'applied',
      version: 6,
    });

    const blockedRemove = await mutate(
      primaryUserId,
      { action: 'remove', sessionId: reservedSessionId, expectedVersion: 6 },
      'agenda-remove-reservation-blocked-0001',
    );
    expect(blockedRemove.status).toBe(422);

    const reused = await mutate(
      primaryUserId,
      { ...body, sessionId: lastSeatSessionId },
      'agenda-reserve-primary-0001',
    );
    expect(reused.status).toBe(409);
    expect(
      participantAgendaMutationProblemSchema.parse(await reused.json()).code,
    ).toBe('IDEMPOTENCY_KEY_REUSED');

    const blockedCancel = await mutate(
      primaryUserId,
      { action: 'cancel', sessionId: reservedSessionId, expectedVersion: 6 },
      'agenda-cancel-blocked-0001',
    );
    expect(blockedCancel.status).toBe(422);
  });

  it('returns an explicit superseded replay after a later inverse mutation', async () => {
    const addBody = {
      action: 'add' as const,
      sessionId: savedSessionId,
      expectedVersion: 1,
    };
    const added = await mutate(
      replayUserId,
      addBody,
      'agenda-superseded-add-0001',
    );
    expect(added.status).toBe(200);

    const removeBody = {
      action: 'remove' as const,
      sessionId: savedSessionId,
      expectedVersion: 2,
    };
    const removed = await mutate(
      replayUserId,
      removeBody,
      'agenda-superseded-remove-0001',
    );
    expect(removed.status).toBe(200);

    const replayedAdd = await mutate(
      replayUserId,
      addBody,
      'agenda-superseded-add-0001',
    );
    expect(replayedAdd.status).toBe(200);
    expect(replayedAdd.headers.get('idempotency-replayed')).toBe('true');
    expect(
      participantAgendaMutationResponseSchema.parse(await replayedAdd.json()),
    ).toMatchObject({
      version: 3,
      items: [],
      mutation: { action: 'add', outcome: 'superseded' },
      timeConflict: null,
    });

    const restored = await mutate(
      replayUserId,
      { action: 'add', sessionId: savedSessionId, expectedVersion: 3 },
      'agenda-superseded-add-0002',
    );
    expect(restored.status).toBe(200);

    const replayedRemove = await mutate(
      replayUserId,
      removeBody,
      'agenda-superseded-remove-0001',
    );
    expect(replayedRemove.status).toBe(200);
    expect(replayedRemove.headers.get('idempotency-replayed')).toBe('true');
    expect(
      participantAgendaMutationResponseSchema.parse(
        await replayedRemove.json(),
      ),
    ).toMatchObject({
      version: 4,
      items: [{ state: 'saved', session: { id: savedSessionId } }],
      mutation: { action: 'remove', outcome: 'superseded' },
      timeConflict: null,
    });
  });

  it('allows exactly one of two contenders to reserve the final place', async () => {
    const addResponses = await Promise.all([
      mutate(
        contenderOneId,
        { action: 'add', sessionId: lastSeatSessionId, expectedVersion: 1 },
        'agenda-contender-one-add-0001',
      ),
      mutate(
        contenderTwoId,
        { action: 'add', sessionId: lastSeatSessionId, expectedVersion: 1 },
        'agenda-contender-two-add-0001',
      ),
    ]);
    expect(addResponses.map(({ status }) => status)).toEqual([200, 200]);

    const responses = await Promise.all([
      mutate(
        contenderOneId,
        { action: 'reserve', sessionId: lastSeatSessionId, expectedVersion: 2 },
        'agenda-contender-one-reserve-0001',
      ),
      mutate(
        contenderTwoId,
        { action: 'reserve', sessionId: lastSeatSessionId, expectedVersion: 2 },
        'agenda-contender-two-reserve-0001',
      ),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const loser = responses.find(({ status }) => status === 409)!;
    const problem = participantAgendaMutationProblemSchema.parse(
      await loser.json(),
    );
    expect(problem).toMatchObject({
      code: 'CAPACITY_FULL',
      sessionId: lastSeatSessionId,
      agenda: {
        items: [
          {
            state: 'saved',
            action: { state: 'capacity_full' },
            capacity: { mode: 'reservation', remaining: 0 },
          },
        ],
      },
    });
    const confirmedRows = await client.db
      .select({ confirmed: count() })
      .from(schema.reservations)
      .where(
        and(
          eq(schema.reservations.eventId, eventId),
          eq(schema.reservations.sessionId, lastSeatSessionId),
          eq(schema.reservations.status, 'confirmed'),
        ),
      );
    expect(confirmedRows[0]?.confirmed).toBe(1);
  });

  it('serializes reservation creation with an operational cancellation', async () => {
    const added = await mutate(
      cancellationRaceUserId,
      {
        action: 'add',
        sessionId: cancellationRaceSessionId,
        expectedVersion: 1,
      },
      'agenda-cancellation-race-add-0001',
    );
    expect(added.status).toBe(200);

    let signalAdminLocked!: () => void;
    const adminLocked = new Promise<void>((resolve) => {
      signalAdminLocked = resolve;
    });
    let releaseAdminMutation!: () => void;
    const adminRelease = new Promise<void>((resolve) => {
      releaseAdminMutation = resolve;
    });
    const cancellation = withTransaction(client.db, async (transaction) => {
      await acquireTransactionLock(transaction, `content-publish:${eventId}`);
      await transaction
        .update(schema.programSessions)
        .set({ status: 'cancelled' })
        .where(eq(schema.programSessions.id, cancellationRaceSessionId));
      signalAdminLocked();
      await adminRelease;
    });
    await adminLocked;

    const reservation = mutate(
      cancellationRaceUserId,
      {
        action: 'reserve',
        sessionId: cancellationRaceSessionId,
        expectedVersion: 2,
      },
      'agenda-cancellation-race-reserve-0001',
    );
    const stateBeforeCancellationCommit = await Promise.race([
      reservation.then(() => 'settled' as const),
      new Promise<'blocked'>((resolve) => {
        setTimeout(() => resolve('blocked'), 100);
      }),
    ]);
    releaseAdminMutation();
    await cancellation;
    const response = await reservation;

    expect(stateBeforeCancellationCommit).toBe('blocked');
    expect(response.status).toBe(404);
    const confirmedRows = await client.db
      .select({ value: count() })
      .from(schema.reservations)
      .where(
        and(
          eq(schema.reservations.eventId, eventId),
          eq(schema.reservations.userId, cancellationRaceUserId),
          eq(schema.reservations.sessionId, cancellationRaceSessionId),
          eq(schema.reservations.status, 'confirmed'),
        ),
      );
    expect(confirmedRows[0]?.value).toBe(0);
  });

  it('re-evaluates the reservation cutoff after acquiring transaction locks', async () => {
    const added = await mutate(
      cutoffRaceUserId,
      {
        action: 'add',
        sessionId: cutoffRaceSessionId,
        expectedVersion: 1,
      },
      'agenda-cutoff-race-add-0001',
    );
    expect(added.status).toBe(200);

    const afterCutoff = new Date('2026-09-18T07:00:31.000Z');
    const authoritativeNow = vi
      .fn<() => Date>()
      .mockReturnValueOnce(fixedNow)
      .mockReturnValue(afterCutoff);
    const response = await mutateParticipantAgenda(
      mutationRequest(
        {
          action: 'reserve',
          sessionId: cutoffRaceSessionId,
          expectedVersion: 2,
        },
        'agenda-cutoff-race-reserve-0001',
      ),
      {
        ...dependencies(cutoffRaceUserId),
        now: authoritativeNow,
      },
    );

    expect(authoritativeNow).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(409);
    expect(
      participantAgendaMutationProblemSchema.parse(await response.json()),
    ).toMatchObject({
      code: 'RESERVATION_CLOSED',
      sessionId: cutoffRaceSessionId,
      agenda: {
        serverNow: afterCutoff.toISOString(),
        items: [
          {
            state: 'saved',
            session: { id: cutoffRaceSessionId },
            action: { state: 'closed' },
          },
        ],
      },
    });
  });

  it('returns canonical stale and closed problems and rejects networking reservation', async () => {
    const stale = await mutate(
      primaryUserId,
      { action: 'add', sessionId: closedSessionId, expectedVersion: 1 },
      'agenda-stale-primary-0001',
    );
    expect(stale.status).toBe(409);
    expect(
      participantAgendaMutationProblemSchema.parse(await stale.json()),
    ).toMatchObject({ code: 'STALE_VERSION', currentVersion: 6 });

    const contenderSnapshot = participantAgendaResponseSchema.parse(
      await (
        await readParticipantAgenda(readRequest(), dependencies(contenderOneId))
      ).json(),
    );
    const closedAdded = await mutate(
      contenderOneId,
      {
        action: 'add',
        sessionId: closedSessionId,
        expectedVersion: contenderSnapshot.version,
      },
      'agenda-closed-add-0001',
    );
    expect(closedAdded.status).toBe(200);
    const closedAddedBody = participantAgendaMutationResponseSchema.parse(
      await closedAdded.json(),
    );
    const closed = await mutate(
      contenderOneId,
      {
        action: 'reserve',
        sessionId: closedSessionId,
        expectedVersion: closedAddedBody.version,
      },
      'agenda-closed-reserve-0001',
    );
    expect(closed.status).toBe(409);
    expect(
      participantAgendaMutationProblemSchema.parse(await closed.json()),
    ).toMatchObject({
      code: 'RESERVATION_CLOSED',
      sessionId: closedSessionId,
    });

    const networkingAdded = await mutate(
      contenderOneId,
      {
        action: 'add',
        sessionId: networkingSessionId,
        expectedVersion: closedAddedBody.version,
      },
      'agenda-networking-add-0001',
    );
    expect(networkingAdded.status).toBe(200);
    const networkingAddedBody = participantAgendaMutationResponseSchema.parse(
      await networkingAdded.json(),
    );
    const networking = await mutate(
      contenderOneId,
      {
        action: 'reserve',
        sessionId: networkingSessionId,
        expectedVersion: networkingAddedBody.version,
      },
      'agenda-networking-reserve-0001',
    );
    expect(networking.status).toBe(404);
  });

  it('requires an active ticket for the reservation itself', async () => {
    const added = await mutate(
      inactiveTicketUserId,
      { action: 'add', sessionId: reservedSessionId, expectedVersion: 1 },
      'agenda-inactive-ticket-add-0001',
    );
    expect(added.status).toBe(200);

    const response = await mutate(
      inactiveTicketUserId,
      { action: 'reserve', sessionId: reservedSessionId, expectedVersion: 2 },
      'agenda-inactive-ticket-reserve-0001',
    );
    expect(response.status).toBe(409);
    expect(
      participantAgendaMutationProblemSchema.parse(await response.json()),
    ).toMatchObject({
      code: 'TICKET_INACTIVE',
      sessionId: reservedSessionId,
      agenda: {
        version: 2,
        items: [{ state: 'saved', session: { id: reservedSessionId } }],
      },
    });
  });

  it('keeps the remaining agenda readable and reports reservation capacity drift', async () => {
    onOperationalDrift.mockClear();
    await client.db
      .update(schema.programSessions)
      .set({ capacityMode: 'none', capacity: null })
      .where(eq(schema.programSessions.id, reservedSessionId));

    const response = await readParticipantAgenda(
      readRequest(),
      dependencies(primaryUserId),
    );
    expect(response.status).toBe(200);
    const body = participantAgendaResponseSchema.parse(await response.json());
    expect(
      body.items.find(({ session }) => session.id === reservedSessionId),
    ).toMatchObject({
      state: 'reserved',
      action: { state: 'closed' },
      capacity: { mode: 'reservation', remaining: 0 },
    });
    expect(
      body.items.some(({ session }) => session.id === savedSessionId),
    ).toBe(true);
    expect(onOperationalDrift).toHaveBeenCalledWith({
      code: 'confirmed_reservation_without_capacity',
      eventId,
      sessionId: reservedSessionId,
    });
  });

  it('fails closed when immutable publication and operational status drift', async () => {
    const response = await mutate(
      driftUserId,
      {
        action: 'add',
        sessionId: archivedOperationalSessionId,
        expectedVersion: 1,
      },
      'agenda-operational-drift-add-0001',
    );
    expect(response.status).toBe(404);
    expect(
      await client.db.query.participantAgendas.findFirst({
        where: and(
          eq(schema.participantAgendas.eventId, eventId),
          eq(schema.participantAgendas.userId, driftUserId),
        ),
      }),
    ).toBeUndefined();
  });

  it('rejects a new saved item at the bounded agenda limit without making reads fail', async () => {
    const cappedSessionIds = Array.from({ length: 512 }, () =>
      crypto.randomUUID(),
    );
    await client.db.insert(schema.participantAgendas).values({
      eventId,
      userId: driftUserId,
    });
    await client.db.insert(schema.programSessions).values(
      cappedSessionIds.map((id, index) => ({
        id,
        eventId,
        dayId,
        roomId: null,
        slug: `agenda-cap-${index}-${id}`,
        title: `Agenda cap ${index}`,
        type: 'other' as const,
        startsAt: new Date('2026-09-19T08:00:00Z'),
        endsAt: new Date('2026-09-19T09:00:00Z'),
        status: 'archived' as const,
        capacityMode: 'none' as const,
        capacity: null,
        waitlistMode: 'disabled' as const,
        sortOrder: index,
      })),
    );
    await client.db.insert(schema.agendaItems).values(
      cappedSessionIds.map((sessionId) => ({
        eventId,
        userId: driftUserId,
        sessionId,
        source: 'manual' as const,
      })),
    );

    const response = await mutate(
      driftUserId,
      { action: 'add', sessionId: savedSessionId, expectedVersion: 1 },
      'agenda-item-cap-add-0001',
    );
    expect(response.status).toBe(422);
    const [savedCount] = await client.db
      .select({ value: count() })
      .from(schema.agendaItems)
      .where(
        and(
          eq(schema.agendaItems.eventId, eventId),
          eq(schema.agendaItems.userId, driftUserId),
        ),
      );
    expect(savedCount?.value).toBe(512);

    const read = await readParticipantAgenda(
      readRequest(),
      dependencies(driftUserId),
    );
    expect(read.status).toBe(200);
    expect(
      participantAgendaResponseSchema.parse(await read.json()),
    ).toMatchObject({ version: 1, items: [] });
  });

  it('rejects a cross-origin mutation before creating participant state', async () => {
    const response = await mutate(
      isolationUserId,
      { action: 'add', sessionId: savedSessionId, expectedVersion: 1 },
      'agenda-cross-origin-0001',
      'https://attacker.example',
    );
    expect(response.status).toBe(403);
    const root = await client.db.query.participantAgendas.findFirst({
      where: and(
        eq(schema.participantAgendas.eventId, eventId),
        eq(schema.participantAgendas.userId, isolationUserId),
      ),
    });
    expect(root).toBeUndefined();
  });
});
