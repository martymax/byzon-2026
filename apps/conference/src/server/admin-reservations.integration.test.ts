import { createDatabaseClient, schema } from '@byzon/database';
import {
  adminContextResponseSchema,
  adminMutationProblemSchema,
  adminReadProblemSchema,
  adminReservationListResponseSchema,
  adminReservationMutationResponseSchema,
  adminSessionCapacityListResponseSchema,
  adminSessionCapacityMutationResponseSchema,
} from '@byzon/domain/contracts';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  mutateAdminReservation,
  mutateAdminSessionCapacity,
  readAdminContext,
  readAdminReservations,
  readAdminSessionCapacities,
  type AdminReservationDependencies,
} from './admin-reservations';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const appOrigin = 'http://localhost:3000';

integration('P5-05 admin reservation HTTP integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-admin-reservations-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const isolationEventId = crypto.randomUUID();
  const eventSlug = `admin-reservations-${eventId}`;
  const isolationEventSlug = `admin-reservations-${isolationEventId}`;
  const dayId = crypto.randomUUID();
  const isolationDayId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const emptySessionId = crypto.randomUUID();
  const networkingSessionId = crypto.randomUUID();
  const isolationSessionId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const secondParticipantId = crypto.randomUUID();
  const unrelatedUserId = crypto.randomUUID();
  const revokedAdminId = crypto.randomUUID();
  const isolationAdminId = crypto.randomUUID();
  const reservationId = crypto.randomUUID();
  const secondReservationId = crypto.randomUUID();
  const isolationReservationId = crypto.randomUUID();
  const fixedNow = new Date('2026-09-18T12:00:00.000Z');

  const dependencies = (
    userId: string | null,
    now: Date = fixedNow,
  ): AdminReservationDependencies => ({
    db: client.db,
    allowedOrigin: appOrigin,
    currentEventSlug: eventSlug,
    getSession: vi.fn(async () => (userId ? { user: { id: userId } } : null)),
    now: () => now,
  });
  const contextRequest = () =>
    new Request(`${appOrigin}/api/v1/admin/context`, {
      headers: { 'x-request-id': 'admin-context-request' },
    });
  const listRequest = (requestedEventId = eventId) =>
    new Request(
      `${appOrigin}/api/v1/admin/events/${requestedEventId}/reservations`,
      { headers: { 'x-request-id': 'admin-reservation-list-request' } },
    );
  const capacityListRequest = (requestedEventId = eventId) =>
    new Request(
      `${appOrigin}/api/v1/admin/events/${requestedEventId}/session-capacities`,
      { headers: { 'x-request-id': 'admin-session-capacity-list-request' } },
    );
  const mutationRequest = (
    body: unknown,
    key: string,
    origin = appOrigin,
    requestedEventId = eventId,
  ) =>
    new Request(
      `${appOrigin}/api/v1/admin/events/${requestedEventId}/reservations/actions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
          origin,
          'x-request-id': 'admin-reservation-mutation-request',
        },
        body: JSON.stringify(body),
      },
    );
  const capacityMutationRequest = (
    body: unknown,
    key: string,
    origin = appOrigin,
    requestedEventId = eventId,
  ) =>
    new Request(
      `${appOrigin}/api/v1/admin/events/${requestedEventId}/session-capacities/actions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': key,
          origin,
          'x-request-id': 'admin-session-capacity-mutation-request',
        },
        body: JSON.stringify(body),
      },
    );

  beforeAll(async () => {
    await client.db.insert(schema.events).values([
      {
        id: eventId,
        slug: eventSlug,
        name: 'Admin reservation integration event',
        startsAt: new Date('2026-09-18T06:00:00Z'),
        endsAt: new Date('2026-09-19T16:00:00Z'),
        timezone: 'Europe/Prague',
        status: 'live',
      },
      {
        id: isolationEventId,
        slug: isolationEventSlug,
        name: 'Isolated reservation event',
        startsAt: new Date('2026-10-01T06:00:00Z'),
        endsAt: new Date('2026-10-01T16:00:00Z'),
        timezone: 'Europe/Prague',
        status: 'live',
      },
    ]);
    const users = [
      adminId,
      participantId,
      secondParticipantId,
      unrelatedUserId,
      revokedAdminId,
      isolationAdminId,
    ];
    await client.db.insert(schema.users).values(
      users.map((id) => ({
        id,
        name: id === adminId ? 'Admin Byzon' : `User ${id}`,
        email: `admin-reservations-${id}@example.invalid`,
      })),
    );
    await client.db.insert(schema.eventMemberships).values([
      ...[
        adminId,
        participantId,
        secondParticipantId,
        unrelatedUserId,
        revokedAdminId,
      ].map((userId) => ({ eventId, userId, status: 'active' as const })),
      {
        eventId: isolationEventId,
        userId: isolationAdminId,
        status: 'active',
      },
      {
        eventId: isolationEventId,
        userId: participantId,
        status: 'active',
      },
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
      {
        id: crypto.randomUUID(),
        eventId,
        userId: secondParticipantId,
        role: 'participant',
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: revokedAdminId,
        role: 'organizer_admin',
        revokedAt: fixedNow,
      },
      {
        id: crypto.randomUUID(),
        eventId: isolationEventId,
        userId: isolationAdminId,
        role: 'organizer_admin',
      },
    ]);
    await client.db.insert(schema.eventDays).values([
      {
        id: dayId,
        eventId,
        localDate: '2026-09-18',
        title: 'Pátek',
        sortOrder: 0,
      },
      {
        id: isolationDayId,
        eventId: isolationEventId,
        localDate: '2026-10-01',
        title: 'Izolace',
        sortOrder: 0,
      },
    ]);
    await client.db.insert(schema.programSessions).values([
      {
        id: sessionId,
        eventId,
        dayId,
        slug: `admin-reservation-${sessionId}`,
        title: 'Admin workshop',
        type: 'workshop',
        startsAt: new Date('2026-09-18T10:00:00Z'),
        endsAt: new Date('2026-09-18T11:00:00Z'),
        status: 'draft',
        capacityMode: 'reservation',
        capacity: 2,
        sortOrder: 0,
      },
      {
        id: networkingSessionId,
        eventId,
        dayId,
        slug: `admin-networking-${networkingSessionId}`,
        title: 'Řízený networking bez kapacity',
        type: 'networking',
        startsAt: new Date('2026-09-18T12:00:00Z'),
        endsAt: new Date('2026-09-18T13:00:00Z'),
        status: 'draft',
        capacityMode: 'none',
        capacity: null,
        sortOrder: 1,
      },
      {
        id: emptySessionId,
        eventId,
        dayId,
        slug: `admin-empty-workshop-${emptySessionId}`,
        title: 'Workshop bez rezervací',
        type: 'workshop',
        startsAt: new Date('2026-09-18T13:00:00Z'),
        endsAt: new Date('2026-09-18T14:00:00Z'),
        status: 'draft',
        capacityMode: 'reservation',
        capacity: 7,
        sortOrder: 2,
      },
      {
        id: isolationSessionId,
        eventId: isolationEventId,
        dayId: isolationDayId,
        slug: `admin-isolation-${isolationSessionId}`,
        title: 'Cizí workshop',
        type: 'workshop',
        startsAt: new Date('2026-10-01T10:00:00Z'),
        endsAt: new Date('2026-10-01T11:00:00Z'),
        status: 'draft',
        capacityMode: 'reservation',
        capacity: 1,
        sortOrder: 0,
      },
    ]);
    await client.db.insert(schema.participantAgendas).values([
      { eventId, userId: participantId },
      { eventId, userId: secondParticipantId },
    ]);
    await client.db.insert(schema.agendaItems).values([
      { eventId, userId: participantId, sessionId, source: 'manual' },
      { eventId, userId: secondParticipantId, sessionId, source: 'manual' },
    ]);
    await client.db.insert(schema.reservations).values([
      {
        id: reservationId,
        eventId,
        sessionId,
        userId: participantId,
        status: 'confirmed',
        source: 'participant',
      },
      {
        id: secondReservationId,
        eventId,
        sessionId,
        userId: secondParticipantId,
        status: 'confirmed',
        source: 'participant',
      },
      {
        id: isolationReservationId,
        eventId: isolationEventId,
        sessionId: isolationSessionId,
        userId: participantId,
        status: 'confirmed',
        source: 'participant',
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('returns a private server-derived admin context and rejects non-admin identities', async () => {
    const anonymous = await readAdminContext(
      contextRequest(),
      dependencies(null),
    );
    expect(anonymous.status).toBe(401);
    expect(adminReadProblemSchema.parse(await anonymous.json()).code).toBe(
      'AUTHENTICATION_REQUIRED',
    );

    const participant = await readAdminContext(
      contextRequest(),
      dependencies(unrelatedUserId),
    );
    expect(participant.status).toBe(403);
    const revoked = await readAdminContext(
      contextRequest(),
      dependencies(revokedAdminId),
    );
    expect(revoked.status).toBe(403);

    const rateLimit = vi.fn(async () => ({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetAt: new Date(fixedNow.getTime() + 60_000),
      retryAfterSeconds: 60,
    }));
    const response = await readAdminContext(contextRequest(), {
      ...dependencies(adminId),
      rateLimit,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization, Cookie');
    expect(response.headers.get('ratelimit-remaining')).toBe('119');
    expect(rateLimit).toHaveBeenCalledWith('read', adminId);
    expect(
      adminContextResponseSchema.parse(await response.json()),
    ).toMatchObject({
      event: { id: eventId, phase: 'live', timezone: 'Europe/Prague' },
      actor: {
        displayLabel: 'Admin Byzon',
        roles: ['organizer_admin'],
        permissions: expect.arrayContaining([
          'reservation:any:read',
          'agenda:any:override',
          'program:manage',
        ]),
      },
    });
  });

  it('lists bounded reservation and capacity records on rollout-safe endpoints', async () => {
    const denied = await readAdminReservations(
      listRequest(),
      eventId,
      dependencies(participantId),
    );
    expect(denied.status).toBe(403);
    const capacityDenied = await readAdminSessionCapacities(
      capacityListRequest(),
      eventId,
      dependencies(participantId),
    );
    expect(capacityDenied.status).toBe(403);

    const response = await readAdminReservations(
      listRequest(),
      eventId,
      dependencies(adminId),
    );
    expect(response.status).toBe(200);
    const body = adminReservationListResponseSchema.parse(
      await response.json(),
    );
    expect(body).not.toHaveProperty('capacityItems');
    expect(body.eventId).toBe(eventId);
    expect(body.items).toHaveLength(2);
    expect(body.items.map(({ reservationId: id }) => id).sort()).toEqual(
      [reservationId, secondReservationId].sort(),
    );
    const capacityResponse = await readAdminSessionCapacities(
      capacityListRequest(),
      eventId,
      dependencies(adminId),
    );
    expect(capacityResponse.status).toBe(200);
    const capacityBody = adminSessionCapacityListResponseSchema.parse(
      await capacityResponse.json(),
    );
    expect(capacityBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId,
          capacity: 2,
          confirmedCount: 2,
        }),
        expect.objectContaining({
          sessionId: emptySessionId,
          capacity: 7,
          confirmedCount: 0,
        }),
        expect.objectContaining({
          sessionId: networkingSessionId,
          capacity: null,
          confirmedCount: 0,
        }),
      ]),
    );
    expect(capacityBody.items).toHaveLength(3);
    expect(body.items[0]).toMatchObject({
      state: 'reserved',
      capacity: 2,
      reservedCount: 2,
      version: 1,
      availableActions: ['capacity_override', 'cancel_reservation'],
    });
    expect(
      body.items.find(({ reservationId: id }) => id === reservationId)
        ?.participantReference,
    ).toBe(
      `Účastník •${participantId.replaceAll('-', '').slice(-4).toUpperCase()}`,
    );

    const crossEvent = await readAdminReservations(
      listRequest(isolationEventId),
      isolationEventId,
      dependencies(adminId),
    );
    expect(crossEvent.status).toBe(404);
    const crossEventCapacities = await readAdminSessionCapacities(
      capacityListRequest(isolationEventId),
      isolationEventId,
      dependencies(adminId),
    );
    expect(crossEventCapacities.status).toBe(404);
  });

  it('opens networking reservations only after an administrator sets capacity', async () => {
    const response = await mutateAdminSessionCapacity(
      capacityMutationRequest(
        {
          sessionId: networkingSessionId,
          capacity: 14,
          expectedVersion: 1,
          reason: 'Potvrzená provozní kapacita řízeného networkingu.',
        },
        'admin-networking-capacity-0001',
      ),
      eventId,
      dependencies(adminId),
    );
    expect(response.status).toBe(200);
    expect(
      adminSessionCapacityMutationResponseSchema.parse(await response.json()),
    ).toMatchObject({
      outcome: 'updated',
      record: {
        sessionId: networkingSessionId,
        sessionType: 'networking',
        capacity: 14,
        confirmedCount: 0,
        version: 2,
      },
    });
    const persisted = await client.db.query.programSessions.findFirst({
      columns: {
        capacity: true,
        capacityMode: true,
        waitlistMode: true,
        version: true,
      },
      where: eq(schema.programSessions.id, networkingSessionId),
    });
    expect(persisted).toEqual({
      capacity: 14,
      capacityMode: 'reservation',
      waitlistMode: 'auto_confirm',
      version: 2,
    });
  });

  it('edits session capacity before the first reservation exists', async () => {
    const response = await mutateAdminSessionCapacity(
      capacityMutationRequest(
        {
          sessionId: emptySessionId,
          capacity: 9,
          expectedVersion: 1,
          reason: 'Provozní nastavení kapacity workshopu před registrací.',
        },
        'admin-empty-session-capacity-0001',
      ),
      eventId,
      dependencies(adminId),
    );
    expect(response.status).toBe(200);
    const body = adminSessionCapacityMutationResponseSchema.parse(
      await response.json(),
    );
    expect(body).toMatchObject({
      outcome: 'updated',
      record: {
        sessionId: emptySessionId,
        capacity: 9,
        confirmedCount: 0,
        version: 2,
      },
    });
    const persisted = await client.db.query.programSessions.findFirst({
      columns: { capacity: true, version: true },
      where: eq(schema.programSessions.id, emptySessionId),
    });
    expect(persisted).toEqual({ capacity: 9, version: 2 });
  });

  it('guards capacity with the confirmed count and versions every same-session admin snapshot', async () => {
    const tooLarge = await mutateAdminSessionCapacity(
      capacityMutationRequest(
        {
          sessionId,
          capacity: 100_001,
          expectedVersion: 1,
          reason: 'Extrémní kapacita musí být odmítnutá kontraktem.',
        },
        'admin-capacity-too-large-0001',
      ),
      eventId,
      dependencies(adminId),
    );
    expect(tooLarge.status).toBe(422);
    expect(adminMutationProblemSchema.parse(await tooLarge.json()).code).toBe(
      'VALIDATION_FAILED',
    );

    const tooSmall = await mutateAdminSessionCapacity(
      capacityMutationRequest(
        {
          sessionId,
          capacity: 1,
          expectedVersion: 1,
          reason: 'Kapacita nesmí klesnout pod počet rezervací.',
        },
        'admin-capacity-too-small-0001',
      ),
      eventId,
      dependencies(adminId),
    );
    expect(tooSmall.status).toBe(409);
    expect(adminMutationProblemSchema.parse(await tooSmall.json()).code).toBe(
      'ADMIN_INVALID_TRANSITION',
    );

    const response = await mutateAdminSessionCapacity(
      capacityMutationRequest(
        {
          sessionId,
          capacity: 3,
          expectedVersion: 1,
          reason: 'Potvrzené navýšení kapacity workshopu na tři místa.',
        },
        'admin-capacity-override-0001',
      ),
      eventId,
      dependencies(adminId),
    );
    expect(response.status).toBe(200);
    const body = adminSessionCapacityMutationResponseSchema.parse(
      await response.json(),
    );
    expect(body).toMatchObject({
      outcome: 'updated',
      record: {
        sessionId,
        capacity: 3,
        confirmedCount: 2,
        version: 2,
      },
    });
    const session = await client.db.query.programSessions.findFirst({
      columns: { capacity: true, version: true },
      where: eq(schema.programSessions.id, sessionId),
    });
    expect(session).toEqual({ capacity: 3, version: 2 });
    const versions = await client.db.query.reservations.findMany({
      columns: { id: true, version: true },
      where: and(
        eq(schema.reservations.eventId, eventId),
        eq(schema.reservations.sessionId, sessionId),
      ),
    });
    expect(versions).toEqual(
      expect.arrayContaining([
        { id: reservationId, version: 2 },
        { id: secondReservationId, version: 2 },
      ]),
    );

    const stale = await mutateAdminReservation(
      mutationRequest(
        {
          action: 'cancel_reservation',
          reservationId: secondReservationId,
          expectedVersion: 1,
          reason: 'Záměrně zastaralý snapshot musí být odmítnut.',
        },
        'admin-reservation-stale-0001',
      ),
      eventId,
      dependencies(adminId),
    );
    expect(stale.status).toBe(409);
    expect(adminMutationProblemSchema.parse(await stale.json())).toMatchObject({
      code: 'STALE_VERSION',
      currentVersion: 2,
    });

    const legacyTooSmall = await mutateAdminReservation(
      mutationRequest(
        {
          action: 'capacity_override',
          reservationId: secondReservationId,
          expectedVersion: 2,
          capacity: 1,
          reason: 'Ani starý klient nesmí snížit kapacitu pod obsazenost.',
        },
        'admin-legacy-capacity-too-small-0001',
      ),
      eventId,
      dependencies(adminId),
    );
    expect(legacyTooSmall.status).toBe(409);
    expect(
      adminMutationProblemSchema.parse(await legacyTooSmall.json()).code,
    ).toBe('ADMIN_INVALID_TRANSITION');
  });

  it('cancels after the participant cutoff with reasoned audit and exact replay', async () => {
    const afterSessionStart = new Date('2026-09-18T12:30:00.000Z');
    const body = {
      action: 'cancel_reservation' as const,
      reservationId,
      expectedVersion: 2,
      reason: 'Účastník požádal organizátora o pozdní zrušení rezervace.',
    };
    const response = await mutateAdminReservation(
      mutationRequest(body, 'admin-reservation-cancel-0001'),
      eventId,
      dependencies(adminId, afterSessionStart),
    );
    expect(response.status).toBe(200);
    const cancelled = adminReservationMutationResponseSchema.parse(
      await response.json(),
    );
    expect(cancelled).toMatchObject({
      outcome: 'updated',
      changedAt: afterSessionStart.toISOString(),
      record: {
        reservationId,
        state: 'cancelled',
        capacity: 3,
        reservedCount: 1,
        version: 3,
        availableActions: [],
      },
    });
    const reservation = await client.db.query.reservations.findFirst({
      columns: { cancelledAt: true, status: true, version: true },
      where: eq(schema.reservations.id, reservationId),
    });
    expect(reservation).toEqual({
      status: 'cancelled',
      version: 3,
      cancelledAt: afterSessionStart,
    });
    const agenda = await client.db.query.participantAgendas.findFirst({
      columns: { version: true },
      where: and(
        eq(schema.participantAgendas.eventId, eventId),
        eq(schema.participantAgendas.userId, participantId),
      ),
    });
    expect(agenda?.version).toBe(2);
    const audit = await client.db.query.auditLogs.findFirst({
      columns: { id: true, action: true, reason: true },
      where: and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.actorId, adminId),
        eq(schema.auditLogs.targetId, reservationId),
        eq(schema.auditLogs.action, 'reservation.admin_cancelled'),
      ),
    });
    expect(audit).toMatchObject({
      id: cancelled.audit.auditId,
      action: 'reservation.admin_cancelled',
      reason: body.reason,
    });

    const replay = await mutateAdminReservation(
      mutationRequest(body, 'admin-reservation-cancel-0001'),
      eventId,
      dependencies(adminId, new Date('2026-09-18T13:00:00.000Z')),
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(
      adminReservationMutationResponseSchema.parse(await replay.json()),
    ).toEqual({ ...cancelled, outcome: 'already_applied' });
    const auditCount = await client.db
      .select({ value: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, eventId),
          eq(schema.auditLogs.actorId, adminId),
          eq(schema.auditLogs.targetId, reservationId),
          eq(schema.auditLogs.action, 'reservation.admin_cancelled'),
        ),
      );
    expect(auditCount[0]?.value).toBe(1);
  });

  it('rejects cross-origin, unauthorized, cross-event and reused-key mutations without touching targets', async () => {
    const requestBody = {
      action: 'cancel_reservation' as const,
      reservationId: secondReservationId,
      expectedVersion: 2,
      reason: 'Tento pokus nesmí projít bezpečnostní hranicí.',
    };
    const crossOrigin = await mutateAdminReservation(
      mutationRequest(
        requestBody,
        'admin-reservation-cross-origin-0001',
        'https://attacker.invalid',
      ),
      eventId,
      dependencies(adminId),
    );
    expect(crossOrigin.status).toBe(403);
    const unauthorized = await mutateAdminReservation(
      mutationRequest(requestBody, 'admin-reservation-denied-0001'),
      eventId,
      dependencies(participantId),
    );
    expect(unauthorized.status).toBe(403);
    const crossEvent = await mutateAdminReservation(
      mutationRequest(
        { ...requestBody, reservationId: isolationReservationId },
        'admin-reservation-cross-event-0001',
      ),
      eventId,
      dependencies(adminId),
    );
    expect(crossEvent.status).toBe(404);

    const reused = await mutateAdminReservation(
      mutationRequest(
        { ...requestBody, reservationId: secondReservationId },
        'admin-reservation-cancel-0001',
      ),
      eventId,
      dependencies(adminId),
    );
    expect(reused.status).toBe(409);
    expect(adminMutationProblemSchema.parse(await reused.json()).code).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
    const unchanged = await client.db.query.reservations.findFirst({
      columns: { status: true, version: true },
      where: eq(schema.reservations.id, secondReservationId),
    });
    expect(unchanged).toEqual({ status: 'confirmed', version: 2 });
  });

  it('keeps the legacy reservation-bound capacity action during the rollout window', async () => {
    const response = await mutateAdminReservation(
      mutationRequest(
        {
          action: 'capacity_override',
          reservationId: secondReservationId,
          expectedVersion: 2,
          capacity: 4,
          reason: 'Kompatibilní změna ze starší otevřené administrace.',
        },
        'admin-legacy-capacity-0001',
      ),
      eventId,
      dependencies(adminId),
    );
    expect(response.status).toBe(200);
    const body = adminReservationMutationResponseSchema.parse(
      await response.json(),
    );
    expect(body).toMatchObject({
      outcome: 'updated',
      record: {
        reservationId: secondReservationId,
        state: 'reserved',
        capacity: 4,
        reservedCount: 1,
        version: 3,
        availableActions: ['capacity_override', 'cancel_reservation'],
      },
    });
    const session = await client.db.query.programSessions.findFirst({
      columns: { capacity: true, version: true },
      where: eq(schema.programSessions.id, sessionId),
    });
    expect(session).toEqual({ capacity: 4, version: 3 });
    const reservation = await client.db.query.reservations.findFirst({
      columns: { status: true, version: true },
      where: eq(schema.reservations.id, secondReservationId),
    });
    expect(reservation).toEqual({ status: 'confirmed', version: 3 });
    const audit = await client.db.query.auditLogs.findFirst({
      columns: { action: true, targetId: true },
      where: eq(schema.auditLogs.id, body.audit.auditId),
    });
    expect(audit).toEqual({
      action: 'session.capacity_updated',
      targetId: sessionId,
    });
  });

  it('fails operational reservation reads closed after the retention cutoff', async () => {
    const cutoff = new Date('2026-09-18T12:00:00.000Z');
    await client.db
      .update(schema.events)
      .set({ operationalDataAnonymizesAt: cutoff })
      .where(eq(schema.events.id, eventId));
    try {
      const response = await readAdminReservations(
        listRequest(),
        eventId,
        dependencies(adminId, cutoff),
      );
      expect(response.status).toBe(403);
      expect(adminReadProblemSchema.parse(await response.json()).code).toBe(
        'EVENT_ACCESS_DENIED',
      );
      const capacityResponse = await readAdminSessionCapacities(
        capacityListRequest(),
        eventId,
        dependencies(adminId, cutoff),
      );
      expect(capacityResponse.status).toBe(403);
    } finally {
      await client.db
        .update(schema.events)
        .set({ operationalDataAnonymizesAt: null })
        .where(eq(schema.events.id, eventId));
    }
  });
});
