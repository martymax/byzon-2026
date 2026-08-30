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
  publishedProgramAgendaSnapshotSchema,
} from '@byzon/domain/contracts';
import { and, count, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  mutateParticipantAgenda,
  readParticipantAgenda,
  readParticipantAgendaCalendar,
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
  const endedReplayUserId = crypto.randomUUID();
  const publicationPolicyUserId = crypto.randomUUID();
  const canonicalFailureUserId = crypto.randomUUID();
  const projectedReservationUserId = crypto.randomUUID();
  const projectedWaitlistUserId = crypto.randomUUID();
  const cancelledPublicationUserId = crypto.randomUUID();
  const consistentReadUserId = crypto.randomUUID();
  const publicationReplayUserId = crypto.randomUUID();
  const participantCancelUserId = crypto.randomUUID();
  const participantCancelRaceUserId = crypto.randomUUID();
  const participantCancelCutoffUserId = crypto.randomUUID();
  const coachingContenderOneId = crypto.randomUUID();
  const coachingContenderTwoId = crypto.randomUUID();
  const contentMutationRaceUserId = crypto.randomUUID();
  const calendarUserId = crypto.randomUUID();
  const waitlistOwnerId = crypto.randomUUID();
  const waitlistFirstId = crypto.randomUUID();
  const waitlistSecondId = crypto.randomUUID();
  const savedSessionId = crypto.randomUUID();
  const conflictingSessionId = crypto.randomUUID();
  const reservedSessionId = crypto.randomUUID();
  const lastSeatSessionId = crypto.randomUUID();
  const closedSessionId = crypto.randomUUID();
  const networkingSessionId = crypto.randomUUID();
  const cancellationRaceSessionId = crypto.randomUUID();
  const cutoffRaceSessionId = crypto.randomUUID();
  const projectedSessionId = crypto.randomUUID();
  const publicationRaceSessionId = crypto.randomUUID();
  const cancelledPublicationSessionId = crypto.randomUUID();
  const archivedOperationalSessionId = crypto.randomUUID();
  const participantCancelSessionId = crypto.randomUUID();
  const coachingSessionId = crypto.randomUUID();
  const waitlistSessionId = crypto.randomUUID();
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
  const calendarRequest = (suffix = '') =>
    new Request(`${appOrigin}/api/v1/me/agenda.ics${suffix}`, {
      headers: { 'x-request-id': 'agenda-calendar-request' },
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
    type: 'coaching' | 'mastermind' | 'networking' | 'talk' | 'workshop',
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
      endedReplayUserId,
      publicationPolicyUserId,
      canonicalFailureUserId,
      projectedReservationUserId,
      projectedWaitlistUserId,
      cancelledPublicationUserId,
      consistentReadUserId,
      publicationReplayUserId,
      participantCancelUserId,
      participantCancelRaceUserId,
      participantCancelCutoffUserId,
      coachingContenderOneId,
      coachingContenderTwoId,
      contentMutationRaceUserId,
      calendarUserId,
      waitlistOwnerId,
      waitlistFirstId,
      waitlistSecondId,
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
        endedReplayUserId,
        publicationPolicyUserId,
        canonicalFailureUserId,
        projectedReservationUserId,
        projectedWaitlistUserId,
        cancelledPublicationUserId,
        consistentReadUserId,
        publicationReplayUserId,
        participantCancelUserId,
        participantCancelRaceUserId,
        participantCancelCutoffUserId,
        coachingContenderOneId,
        coachingContenderTwoId,
        contentMutationRaceUserId,
        calendarUserId,
        waitlistOwnerId,
        waitlistFirstId,
        waitlistSecondId,
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
        endedReplayUserId,
        publicationPolicyUserId,
        canonicalFailureUserId,
        projectedReservationUserId,
        projectedWaitlistUserId,
        cancelledPublicationUserId,
        consistentReadUserId,
        publicationReplayUserId,
        participantCancelUserId,
        participantCancelRaceUserId,
        participantCancelCutoffUserId,
        coachingContenderOneId,
        coachingContenderTwoId,
        contentMutationRaceUserId,
        calendarUserId,
        waitlistOwnerId,
        waitlistFirstId,
        waitlistSecondId,
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
        publicationPolicyUserId,
        canonicalFailureUserId,
        participantCancelUserId,
        participantCancelRaceUserId,
        participantCancelCutoffUserId,
        coachingContenderOneId,
        coachingContenderTwoId,
        contentMutationRaceUserId,
        waitlistOwnerId,
        waitlistFirstId,
        waitlistSecondId,
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
        waitlistMode: 'auto_confirm' as const,
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
        id: projectedSessionId,
        slug: `projected-${projectedSessionId}`,
        title: 'Předexistující rezervace a waitlist',
        startsAt: new Date('2026-09-18T16:00:00Z'),
        endsAt: new Date('2026-09-18T17:00:00Z'),
        type: 'workshop' as const,
        capacityMode: 'reservation' as const,
        capacity: 1,
      },
      {
        id: publicationRaceSessionId,
        slug: `publication-race-${publicationRaceSessionId}`,
        title: 'Bod publikovaný během čekání na agendu',
        startsAt: new Date('2026-09-18T17:30:00Z'),
        endsAt: new Date('2026-09-18T18:30:00Z'),
        type: 'talk' as const,
        capacityMode: 'none' as const,
        capacity: null,
      },
      {
        id: cancelledPublicationSessionId,
        slug: `cancelled-publication-${cancelledPublicationSessionId}`,
        title: 'Bod zrušený v publikaci',
        startsAt: new Date('2026-09-18T16:30:00Z'),
        endsAt: new Date('2026-09-18T17:30:00Z'),
        type: 'talk' as const,
        capacityMode: 'none' as const,
        capacity: null,
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
      {
        id: participantCancelSessionId,
        slug: `participant-cancel-${participantCancelSessionId}`,
        title: 'Rezervace se zrušením účastníkem',
        startsAt: new Date('2026-09-18T19:00:00Z'),
        endsAt: new Date('2026-09-18T20:00:00Z'),
        type: 'workshop' as const,
        capacityMode: 'reservation' as const,
        capacity: 3,
      },
      {
        id: coachingSessionId,
        slug: `coaching-${coachingSessionId}`,
        title: 'Koučink – Radim Roček',
        startsAt: new Date('2026-09-18T08:00:00Z'),
        endsAt: new Date('2026-09-18T08:30:00Z'),
        type: 'coaching' as const,
        capacityMode: 'reservation' as const,
        capacity: 1,
      },
      {
        id: waitlistSessionId,
        slug: `waitlist-${waitlistSessionId}`,
        title: 'Automatický FIFO pořadník',
        startsAt: new Date('2026-09-18T18:00:00Z'),
        endsAt: new Date('2026-09-18T19:00:00Z'),
        type: 'workshop' as const,
        capacityMode: 'reservation' as const,
        capacity: 1,
      },
    ];
    await client.db.insert(schema.programSessions).values(
      sessions.map((session, index) => ({
        ...session,
        eventId,
        dayId,
        roomId,
        status: 'status' in session ? session.status : ('draft' as const),
        waitlistMode:
          session.id === waitlistSessionId
            ? ('auto_confirm' as const)
            : ('disabled' as const),
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
            .filter(({ id }) => id !== publicationRaceSessionId)
            .map((session) => ({
              ...publishedSession(
                session.id,
                session.slug,
                session.title,
                session.startsAt.toISOString(),
                session.endsAt.toISOString(),
                session.type,
              ),
              capacityMode: session.capacityMode,
              capacity: session.capacity,
              reservationOpensAt: null,
              reservationClosesAt:
                session.capacityMode === 'reservation'
                  ? 'reservationClosesAt' in session
                    ? session.reservationClosesAt.toISOString()
                    : session.startsAt.toISOString()
                  : null,
              ...(session.id === cancelledPublicationSessionId
                ? { status: 'cancelled' as const }
                : {}),
            }))
            .map((session, index) => ({ ...session, sortOrder: index })),
        },
      },
      checksumSha256: 'a'.repeat(64),
      publishedBy: publisherId,
      publishedAt: new Date('2026-08-20T08:00:00Z'),
    });
    await client.db.insert(schema.reservations).values({
      id: crypto.randomUUID(),
      eventId,
      sessionId: projectedSessionId,
      userId: projectedReservationUserId,
      status: 'confirmed',
      source: 'participant',
      createdAt: fixedNow,
    });
    await client.db.insert(schema.waitlistEntries).values([
      {
        id: crypto.randomUUID(),
        eventId,
        sessionId: projectedSessionId,
        userId: projectedReservationUserId,
        status: 'cancelled',
        positionSequence: 1,
        createdAt: new Date(fixedNow.getTime() - 1_000),
        cancelledAt: fixedNow,
      },
      {
        id: crypto.randomUUID(),
        eventId,
        sessionId: projectedSessionId,
        userId: projectedWaitlistUserId,
        status: 'waiting',
        positionSequence: 2,
        createdAt: fixedNow,
      },
    ]);
    await client.db.insert(schema.participantAgendas).values([
      {
        eventId,
        userId: cancelledPublicationUserId,
      },
      {
        eventId,
        userId: calendarUserId,
      },
    ]);
    await client.db.insert(schema.agendaItems).values([
      {
        eventId,
        userId: cancelledPublicationUserId,
        sessionId: cancelledPublicationSessionId,
        source: 'manual',
      },
      {
        eventId,
        userId: calendarUserId,
        sessionId: savedSessionId,
        source: 'manual',
      },
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it('joins and leaves a stable FIFO waitlist and auto-promotes the first eligible participant', async () => {
    const addAndReturnVersion = async (userId: string, key: string) => {
      const added = await mutate(
        userId,
        { action: 'add', sessionId: waitlistSessionId, expectedVersion: 1 },
        key,
      );
      expect(added.status).toBe(200);
      return participantAgendaMutationResponseSchema.parse(await added.json())
        .version;
    };

    const ownerVersion = await addAndReturnVersion(
      waitlistOwnerId,
      'agenda-waitlist-owner-add-0001',
    );
    const reserved = await mutate(
      waitlistOwnerId,
      {
        action: 'reserve',
        sessionId: waitlistSessionId,
        expectedVersion: ownerVersion,
      },
      'agenda-waitlist-owner-reserve-0001',
    );
    expect(reserved.status).toBe(200);
    const reservedBody = participantAgendaMutationResponseSchema.parse(
      await reserved.json(),
    );
    expect(
      reservedBody.items.find(
        ({ session }) => session.id === waitlistSessionId,
      ),
    ).toMatchObject({ state: 'reserved' });

    const firstVersion = await addAndReturnVersion(
      waitlistFirstId,
      'agenda-waitlist-first-add-0001',
    );
    const secondVersion = await addAndReturnVersion(
      waitlistSecondId,
      'agenda-waitlist-second-add-0001',
    );
    const firstJoined = await mutate(
      waitlistFirstId,
      {
        action: 'join_waitlist',
        sessionId: waitlistSessionId,
        expectedVersion: firstVersion,
      },
      'agenda-waitlist-first-join-0001',
    );
    expect(firstJoined.status).toBe(200);
    expect(
      participantAgendaMutationResponseSchema
        .parse(await firstJoined.json())
        .items.find(({ session }) => session.id === waitlistSessionId),
    ).toMatchObject({
      state: 'waitlisted',
      waitlist: { state: 'waiting', position: 1, actionsAvailable: true },
    });
    const secondJoined = await mutate(
      waitlistSecondId,
      {
        action: 'join_waitlist',
        sessionId: waitlistSessionId,
        expectedVersion: secondVersion,
      },
      'agenda-waitlist-second-join-0001',
    );
    expect(secondJoined.status).toBe(200);
    const secondJoinedBody = participantAgendaMutationResponseSchema.parse(
      await secondJoined.json(),
    );
    expect(
      secondJoinedBody.items.find(
        ({ session }) => session.id === waitlistSessionId,
      ),
    ).toMatchObject({
      state: 'waitlisted',
      waitlist: { state: 'waiting', position: 2, actionsAvailable: true },
    });

    const cancelled = await mutate(
      waitlistOwnerId,
      {
        action: 'cancel',
        sessionId: waitlistSessionId,
        expectedVersion: reservedBody.version,
      },
      'agenda-waitlist-owner-cancel-0001',
    );
    expect(cancelled.status).toBe(200);
    const firstAfterPromotion = participantAgendaResponseSchema.parse(
      await (
        await readParticipantAgenda(
          readRequest(),
          dependencies(waitlistFirstId),
        )
      ).json(),
    );
    expect(
      firstAfterPromotion.items.find(
        ({ session }) => session.id === waitlistSessionId,
      ),
    ).toMatchObject({
      state: 'reserved',
      reservation: { cancellation: { state: 'available' } },
    });

    const secondAfterPromotion = participantAgendaResponseSchema.parse(
      await (
        await readParticipantAgenda(
          readRequest(),
          dependencies(waitlistSecondId),
        )
      ).json(),
    );
    expect(
      secondAfterPromotion.items.find(
        ({ session }) => session.id === waitlistSessionId,
      ),
    ).toMatchObject({
      state: 'waitlisted',
      waitlist: { state: 'waiting', position: 1, actionsAvailable: true },
    });
    const left = await mutate(
      waitlistSecondId,
      {
        action: 'leave_waitlist',
        sessionId: waitlistSessionId,
        expectedVersion: secondAfterPromotion.version,
      },
      'agenda-waitlist-second-leave-0001',
    );
    expect(left.status).toBe(200);
    expect(
      participantAgendaMutationResponseSchema
        .parse(await left.json())
        .items.find(({ session }) => session.id === waitlistSessionId),
    ).toMatchObject({ state: 'saved' });

    const waitingRows = await client.db
      .select({ userId: schema.waitlistEntries.userId })
      .from(schema.waitlistEntries)
      .where(
        and(
          eq(schema.waitlistEntries.eventId, eventId),
          eq(schema.waitlistEntries.sessionId, waitlistSessionId),
          eq(schema.waitlistEntries.status, 'waiting'),
        ),
      );
    expect(waitingRows).toEqual([]);
    const promotedReservation = await client.db.query.reservations.findFirst({
      columns: { source: true, userId: true },
      where: and(
        eq(schema.reservations.eventId, eventId),
        eq(schema.reservations.sessionId, waitlistSessionId),
        eq(schema.reservations.status, 'confirmed'),
      ),
    });
    expect(promotedReservation).toEqual({
      source: 'waitlist_auto',
      userId: waitlistFirstId,
    });
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

  it('serves only the authenticated owner agenda as a private RFC 5545 calendar', async () => {
    const anonymous = await readParticipantAgendaCalendar(
      calendarRequest(),
      dependencies(null),
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toBe('private, no-store');

    const crossEvent = await readParticipantAgendaCalendar(
      calendarRequest(),
      dependencies(isolationUserId),
    );
    expect(crossEvent.status).toBe(403);

    const query = await readParticipantAgendaCalendar(
      calendarRequest('?participant=other'),
      dependencies(calendarUserId),
    );
    expect(query.status).toBe(422);

    const otherOwner = await readParticipantAgendaCalendar(
      calendarRequest(),
      dependencies(primaryUserId),
    );
    expect(otherOwner.status).toBe(200);
    expect(await otherOwner.text()).not.toContain(
      `UID:${savedSessionId}@agenda.byzon.cz`,
    );

    const snapshot = await readParticipantAgenda(
      readRequest(),
      dependencies(calendarUserId),
    );
    expect(
      participantAgendaResponseSchema.parse(await snapshot.json())
        .calendarExport,
    ).toEqual({ state: 'available', href: '/api/v1/me/agenda.ics' });

    const response = await readParticipantAgendaCalendar(
      calendarRequest(),
      dependencies(calendarUserId),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('Authorization, Cookie');
    expect(response.headers.get('content-type')).toBe(
      'text/calendar; charset=utf-8',
    );
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="byzon-2026-moje-agenda.ics"',
    );
    const calendar = await response.text();
    expect(calendar).toContain('BEGIN:VCALENDAR\r\n');
    expect(calendar).toContain(
      `UID:${savedSessionId}@agenda.byzon.cz\r\nSEQUENCE:3`,
    );
    expect(calendar).toContain('DTSTART:20260918T080000Z');
    expect(calendar.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(calendar).not.toContain(calendarUserId);
    expect(calendar).not.toContain('@example.invalid');
    expect(calendar.endsWith('\r\n')).toBe(true);
  });

  it('reads the version and projected items under the participant mutation lock', async () => {
    let signalWriterLocked!: () => void;
    const writerLocked = new Promise<void>((resolve) => {
      signalWriterLocked = resolve;
    });
    let releaseWriter!: () => void;
    const writerRelease = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const write = withTransaction(client.db, async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `participant-agenda:${eventId}:${consistentReadUserId}`,
      );
      await transaction.insert(schema.participantAgendas).values({
        eventId,
        userId: consistentReadUserId,
        version: 2,
      });
      await transaction.insert(schema.agendaItems).values({
        eventId,
        userId: consistentReadUserId,
        sessionId: savedSessionId,
        source: 'manual',
        createdAt: new Date(fixedNow.getTime() + 1_000),
      });
      signalWriterLocked();
      await writerRelease;
    });
    await writerLocked;

    const snapshotNow = new Date(fixedNow.getTime() + 1_000);
    const authoritativeNow = vi
      .fn<() => Date>()
      .mockReturnValueOnce(fixedNow)
      .mockReturnValue(snapshotNow);
    const reading = readParticipantAgenda(readRequest(), {
      ...dependencies(consistentReadUserId),
      now: authoritativeNow,
    });
    const stateBeforeWriterCommit = await Promise.race([
      reading.then(() => 'settled' as const),
      new Promise<'blocked'>((resolve) => {
        setTimeout(() => resolve('blocked'), 100);
      }),
    ]);
    releaseWriter();
    await write;
    const response = await reading;

    expect(stateBeforeWriterCommit).toBe('blocked');
    expect(authoritativeNow).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
    expect(
      participantAgendaResponseSchema.parse(await response.json()),
    ).toMatchObject({
      version: 2,
      serverNow: snapshotNow.toISOString(),
      items: [{ state: 'saved', session: { id: savedSessionId } }],
    });
  });

  it('reloads the latest publication after acquiring the participant lock', async () => {
    let signalWriterLocked!: () => void;
    const writerLocked = new Promise<void>((resolve) => {
      signalWriterLocked = resolve;
    });
    let releaseWriter!: () => void;
    const writerRelease = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const write = withTransaction(client.db, async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `participant-agenda:${eventId}:${consistentReadUserId}`,
      );
      const publication = await transaction.query.contentPublications.findFirst(
        {
          columns: { snapshot: true, version: true },
          where: eq(schema.contentPublications.eventId, eventId),
          orderBy: [desc(schema.contentPublications.version)],
        },
      );
      const published = publishedProgramAgendaSnapshotSchema.parse(
        publication?.snapshot,
      );
      await transaction.insert(schema.contentPublications).values({
        id: crypto.randomUUID(),
        eventId,
        version: (publication?.version ?? 0) + 1,
        snapshot: {
          program: {
            ...published.program,
            sessions: [
              ...published.program.sessions,
              {
                ...publishedSession(
                  publicationRaceSessionId,
                  `publication-race-${publicationRaceSessionId}`,
                  'Bod publikovaný během čekání na agendu',
                  '2026-09-18T17:30:00.000Z',
                  '2026-09-18T18:30:00.000Z',
                  'talk',
                ),
                sortOrder: published.program.sessions.length,
              },
            ],
          },
        },
        checksumSha256: 'e'.repeat(64),
        publishedBy: publisherId,
        publishedAt: fixedNow,
      });
      await transaction
        .insert(schema.participantAgendas)
        .values({
          eventId,
          userId: consistentReadUserId,
          version: 3,
          updatedAt: fixedNow,
        })
        .onConflictDoUpdate({
          target: [
            schema.participantAgendas.eventId,
            schema.participantAgendas.userId,
          ],
          set: { version: 3, updatedAt: fixedNow },
        });
      await transaction
        .insert(schema.agendaItems)
        .values([
          {
            eventId,
            userId: consistentReadUserId,
            sessionId: savedSessionId,
            source: 'manual',
            createdAt: fixedNow,
          },
          {
            eventId,
            userId: consistentReadUserId,
            sessionId: publicationRaceSessionId,
            source: 'manual',
            createdAt: fixedNow,
          },
        ])
        .onConflictDoNothing();
      signalWriterLocked();
      await writerRelease;
    });
    await writerLocked;

    const reading = readParticipantAgenda(readRequest(), {
      ...dependencies(consistentReadUserId),
      now: () => new Date(fixedNow.getTime() + 1_000),
    });
    const stateBeforeWriterCommit = await Promise.race([
      reading.then(() => 'settled' as const),
      new Promise<'blocked'>((resolve) => {
        setTimeout(() => resolve('blocked'), 100);
      }),
    ]);
    releaseWriter();
    await write;
    const response = await reading;

    expect(stateBeforeWriterCommit).toBe('blocked');
    expect(response.status).toBe(200);
    expect(
      participantAgendaResponseSchema.parse(await response.json()),
    ).toMatchObject({
      version: 3,
      publicationVersion: 4,
      items: [
        { state: 'saved', session: { id: savedSessionId } },
        { state: 'saved', session: { id: publicationRaceSessionId } },
      ],
    });
  });

  it('rechecks the retention cutoff after acquiring the read lock', async () => {
    const retentionCutoff = new Date(fixedNow.getTime() + 500);
    const afterCutoff = new Date(fixedNow.getTime() + 1_000);
    await client.db
      .update(schema.events)
      .set({ operationalDataAnonymizesAt: retentionCutoff })
      .where(eq(schema.events.id, eventId));

    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseLock!: () => void;
    const lockRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holder = withTransaction(client.db, async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `participant-agenda:${eventId}:${consistentReadUserId}`,
      );
      signalLocked();
      await lockRelease;
    });
    await locked;

    try {
      const authoritativeNow = vi
        .fn<() => Date>()
        .mockReturnValueOnce(fixedNow)
        .mockReturnValue(afterCutoff);
      const reading = readParticipantAgenda(readRequest(), {
        ...dependencies(consistentReadUserId),
        now: authoritativeNow,
      });
      const stateBeforeRelease = await Promise.race([
        reading.then(() => 'settled' as const),
        new Promise<'blocked'>((resolve) => {
          setTimeout(() => resolve('blocked'), 100);
        }),
      ]);
      expect(stateBeforeRelease).toBe('blocked');
      releaseLock();
      await holder;

      const response = await reading;
      expect(authoritativeNow).toHaveBeenCalledTimes(2);
      expect(response.status).toBe(403);
      expect(
        participantAgendaProblemSchema.parse(await response.json()),
      ).toMatchObject({ code: 'EVENT_ACCESS_DENIED' });
    } finally {
      releaseLock();
      await holder;
      await client.db
        .update(schema.events)
        .set({ operationalDataAnonymizesAt: null })
        .where(eq(schema.events.id, eventId));
    }
  });

  it('rechecks the retention cutoff before writing participant state', async () => {
    const retentionCutoff = new Date(fixedNow.getTime() + 500);
    const afterCutoff = new Date(fixedNow.getTime() + 1_000);
    await client.db
      .update(schema.events)
      .set({ operationalDataAnonymizesAt: retentionCutoff })
      .where(eq(schema.events.id, eventId));

    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseLock!: () => void;
    const lockRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holder = withTransaction(client.db, async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `participant-agenda:${eventId}:${driftUserId}`,
      );
      signalLocked();
      await lockRelease;
    });
    await locked;

    try {
      const authoritativeNow = vi
        .fn<() => Date>()
        .mockReturnValueOnce(fixedNow)
        .mockReturnValue(afterCutoff);
      const mutation = mutateParticipantAgenda(
        mutationRequest(
          { action: 'add', sessionId: savedSessionId, expectedVersion: 1 },
          'agenda-retention-race-add-0001',
        ),
        { ...dependencies(driftUserId), now: authoritativeNow },
      );
      const stateBeforeRelease = await Promise.race([
        mutation.then(() => 'settled' as const),
        new Promise<'blocked'>((resolve) => {
          setTimeout(() => resolve('blocked'), 100);
        }),
      ]);
      expect(stateBeforeRelease).toBe('blocked');
      releaseLock();
      await holder;

      const response = await mutation;
      expect(authoritativeNow).toHaveBeenCalledTimes(2);
      expect(response.status).toBe(403);
      expect(
        participantAgendaProblemSchema.parse(await response.json()),
      ).toMatchObject({ code: 'EVENT_ACCESS_DENIED' });
      expect(
        await client.db.query.participantAgendas.findFirst({
          where: and(
            eq(schema.participantAgendas.eventId, eventId),
            eq(schema.participantAgendas.userId, driftUserId),
          ),
        }),
      ).toBeUndefined();
      expect(
        await client.db.query.idempotencyKeys.findFirst({
          where: and(
            eq(schema.idempotencyKeys.eventId, eventId),
            eq(schema.idempotencyKeys.actorId, driftUserId),
            eq(schema.idempotencyKeys.scope, 'participant.agenda-action'),
          ),
        }),
      ).toBeUndefined();
    } finally {
      releaseLock();
      await holder;
      await client.db
        .update(schema.events)
        .set({ operationalDataAnonymizesAt: null })
        .where(eq(schema.events.id, eventId));
    }
  });

  it('rechecks the event phase after acquiring the read lock', async () => {
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseLock!: () => void;
    const lockRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holder = withTransaction(client.db, async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `participant-agenda:${eventId}:${consistentReadUserId}`,
      );
      signalLocked();
      await lockRelease;
    });
    await locked;

    try {
      const reading = readParticipantAgenda(
        readRequest(),
        dependencies(consistentReadUserId),
      );
      const stateBeforeTransition = await Promise.race([
        reading.then(() => 'settled' as const),
        new Promise<'blocked'>((resolve) => {
          setTimeout(() => resolve('blocked'), 100);
        }),
      ]);
      expect(stateBeforeTransition).toBe('blocked');
      await client.db
        .update(schema.events)
        .set({ status: 'archived' })
        .where(eq(schema.events.id, eventId));
      releaseLock();
      await holder;

      const response = await reading;
      expect(response.status).toBe(403);
      expect(
        participantAgendaProblemSchema.parse(await response.json()),
      ).toMatchObject({ code: 'EVENT_ACCESS_DENIED' });
    } finally {
      releaseLock();
      await holder;
      await client.db
        .update(schema.events)
        .set({ status: 'live' })
        .where(eq(schema.events.id, eventId));
    }
  });

  it('rechecks the event phase before writing participant state', async () => {
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseLock!: () => void;
    const lockRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holder = withTransaction(client.db, async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `participant-agenda:${eventId}:${driftUserId}`,
      );
      signalLocked();
      await lockRelease;
    });
    await locked;

    try {
      const mutation = mutateParticipantAgenda(
        mutationRequest(
          { action: 'add', sessionId: savedSessionId, expectedVersion: 1 },
          'agenda-phase-race-add-0001',
        ),
        dependencies(driftUserId),
      );
      const stateBeforeTransition = await Promise.race([
        mutation.then(() => 'settled' as const),
        new Promise<'blocked'>((resolve) => {
          setTimeout(() => resolve('blocked'), 100);
        }),
      ]);
      expect(stateBeforeTransition).toBe('blocked');
      await client.db
        .update(schema.events)
        .set({ status: 'ended' })
        .where(eq(schema.events.id, eventId));
      releaseLock();
      await holder;

      const response = await mutation;
      expect(response.status).toBe(409);
      expect(
        participantAgendaMutationProblemSchema.parse(await response.json()),
      ).toMatchObject({ code: 'AGENDA_DISABLED' });
      expect(
        await client.db.query.participantAgendas.findFirst({
          where: and(
            eq(schema.participantAgendas.eventId, eventId),
            eq(schema.participantAgendas.userId, driftUserId),
          ),
        }),
      ).toBeUndefined();
      expect(
        await client.db.query.idempotencyKeys.findFirst({
          where: and(
            eq(schema.idempotencyKeys.eventId, eventId),
            eq(schema.idempotencyKeys.actorId, driftUserId),
            eq(schema.idempotencyKeys.scope, 'participant.agenda-action'),
          ),
        }),
      ).toBeUndefined();
    } finally {
      releaseLock();
      await holder;
      await client.db
        .update(schema.events)
        .set({ status: 'live' })
        .where(eq(schema.events.id, eventId));
    }
  });

  it('rechecks authorization after acquiring the read lock', async () => {
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseLock!: () => void;
    const lockRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holder = withTransaction(client.db, async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `participant-agenda:${eventId}:${consistentReadUserId}`,
      );
      signalLocked();
      await lockRelease;
    });
    await locked;

    try {
      const reading = readParticipantAgenda(
        readRequest(),
        dependencies(consistentReadUserId),
      );
      const stateBeforeRevocation = await Promise.race([
        reading.then(() => 'settled' as const),
        new Promise<'blocked'>((resolve) => {
          setTimeout(() => resolve('blocked'), 100);
        }),
      ]);
      expect(stateBeforeRevocation).toBe('blocked');
      await client.db
        .update(schema.eventMemberships)
        .set({ status: 'suspended' })
        .where(
          and(
            eq(schema.eventMemberships.eventId, eventId),
            eq(schema.eventMemberships.userId, consistentReadUserId),
          ),
        );
      releaseLock();
      await holder;

      const response = await reading;
      expect(response.status).toBe(403);
      expect(
        participantAgendaProblemSchema.parse(await response.json()),
      ).toMatchObject({ code: 'EVENT_ACCESS_DENIED' });
    } finally {
      releaseLock();
      await holder;
      await client.db
        .update(schema.eventMemberships)
        .set({ status: 'active' })
        .where(
          and(
            eq(schema.eventMemberships.eventId, eventId),
            eq(schema.eventMemberships.userId, consistentReadUserId),
          ),
        );
    }
  });

  it('rechecks authorization before writing participant state', async () => {
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseLock!: () => void;
    const lockRelease = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const holder = withTransaction(client.db, async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `participant-agenda:${eventId}:${driftUserId}`,
      );
      signalLocked();
      await lockRelease;
    });
    await locked;

    try {
      const mutation = mutateParticipantAgenda(
        mutationRequest(
          { action: 'add', sessionId: savedSessionId, expectedVersion: 1 },
          'agenda-authorization-race-add-0001',
        ),
        dependencies(driftUserId),
      );
      const stateBeforeRevocation = await Promise.race([
        mutation.then(() => 'settled' as const),
        new Promise<'blocked'>((resolve) => {
          setTimeout(() => resolve('blocked'), 100);
        }),
      ]);
      expect(stateBeforeRevocation).toBe('blocked');
      await client.db
        .update(schema.eventMemberships)
        .set({ status: 'suspended' })
        .where(
          and(
            eq(schema.eventMemberships.eventId, eventId),
            eq(schema.eventMemberships.userId, driftUserId),
          ),
        );
      releaseLock();
      await holder;

      const response = await mutation;
      expect(response.status).toBe(403);
      expect(
        participantAgendaMutationProblemSchema.parse(await response.json()),
      ).toMatchObject({ code: 'EVENT_ACCESS_DENIED' });
      expect(
        await client.db.query.participantAgendas.findFirst({
          where: and(
            eq(schema.participantAgendas.eventId, eventId),
            eq(schema.participantAgendas.userId, driftUserId),
          ),
        }),
      ).toBeUndefined();
      expect(
        await client.db.query.idempotencyKeys.findFirst({
          where: and(
            eq(schema.idempotencyKeys.eventId, eventId),
            eq(schema.idempotencyKeys.actorId, driftUserId),
            eq(schema.idempotencyKeys.scope, 'participant.agenda-action'),
          ),
        }),
      ).toBeUndefined();
    } finally {
      releaseLock();
      await holder;
      await client.db
        .update(schema.eventMemberships)
        .set({ status: 'active' })
        .where(
          and(
            eq(schema.eventMemberships.eventId, eventId),
            eq(schema.eventMemberships.userId, driftUserId),
          ),
        );
    }
  });

  it('allows removing a saved session cancelled in the latest publication', async () => {
    const before = await readParticipantAgenda(
      readRequest(),
      dependencies(cancelledPublicationUserId),
    );
    expect(before.status).toBe(200);
    expect(
      participantAgendaResponseSchema.parse(await before.json()),
    ).toMatchObject({
      version: 1,
      items: [
        {
          state: 'saved',
          session: { id: cancelledPublicationSessionId, status: 'cancelled' },
        },
      ],
    });

    const removed = await mutate(
      cancelledPublicationUserId,
      {
        action: 'remove',
        sessionId: cancelledPublicationSessionId,
        expectedVersion: 1,
      },
      'agenda-remove-publication-cancelled-0001',
    );
    expect(removed.status).toBe(200);
    expect(
      participantAgendaMutationResponseSchema.parse(await removed.json()),
    ).toMatchObject({
      version: 2,
      items: [],
      mutation: { action: 'remove', outcome: 'applied' },
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

    const calendarRateLimit = vi.fn(async () => ({
      allowed: true,
      limit: 120,
      remaining: 118,
      resetAt: new Date(fixedNow.getTime() + 60_000),
      retryAfterSeconds: 60,
    }));
    const calendar = await readParticipantAgendaCalendar(calendarRequest(), {
      ...dependencies(primaryUserId),
      rateLimit: calendarRateLimit,
    });
    expect(calendar.status).toBe(200);
    expect(calendar.headers.get('ratelimit-limit')).toBe('120');
    expect(calendar.headers.get('ratelimit-remaining')).toBe('118');
    expect(calendarRateLimit).toHaveBeenCalledWith('read', primaryUserId);

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

  it('treats existing reservation and waitlist projections as add no-ops', async () => {
    const cases = [
      {
        userId: projectedReservationUserId,
        state: 'reserved' as const,
        key: 'agenda-existing-reservation-add-0001',
      },
      {
        userId: projectedWaitlistUserId,
        state: 'waitlisted' as const,
        key: 'agenda-existing-waitlist-add-0001',
      },
    ];
    for (const scenario of cases) {
      const response = await mutate(
        scenario.userId,
        {
          action: 'add',
          sessionId: projectedSessionId,
          expectedVersion: 1,
        },
        scenario.key,
      );
      expect(response.status).toBe(200);
      expect(
        participantAgendaMutationResponseSchema.parse(await response.json()),
      ).toMatchObject({
        version: 1,
        items: [
          {
            state: scenario.state,
            session: { id: projectedSessionId },
            ...(scenario.state === 'waitlisted'
              ? { waitlist: { position: 1 } }
              : {}),
          },
        ],
        mutation: { action: 'add', outcome: 'already_applied' },
      });
    }

    await client.db
      .update(schema.reservations)
      .set({ status: 'cancelled', cancelledAt: fixedNow })
      .where(
        and(
          eq(schema.reservations.eventId, eventId),
          eq(schema.reservations.sessionId, projectedSessionId),
          eq(schema.reservations.userId, projectedReservationUserId),
        ),
      );
    const promotionPending = await readParticipantAgenda(
      readRequest(),
      dependencies(projectedWaitlistUserId),
    );
    expect(promotionPending.status).toBe(200);
    expect(
      participantAgendaResponseSchema.parse(await promotionPending.json()),
    ).toMatchObject({
      items: [
        {
          state: 'waitlisted',
          action: { state: 'available' },
          capacity: {
            remaining: 1,
            actorAvailability: { state: 'unavailable' },
          },
          waitlist: {
            state: 'waiting',
            position: 1,
            actionsAvailable: false,
          },
        },
      ],
    });

    const savedRows = await client.db
      .select({ value: count() })
      .from(schema.agendaItems)
      .where(
        and(
          eq(schema.agendaItems.eventId, eventId),
          eq(schema.agendaItems.sessionId, projectedSessionId),
        ),
      );
    expect(savedRows[0]?.value).toBe(0);
    const auditRows = await client.db
      .select({ value: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, eventId),
          eq(schema.auditLogs.action, 'agenda.add'),
          eq(schema.auditLogs.targetId, projectedSessionId),
        ),
      );
    expect(auditRows[0]?.value).toBe(0);
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
      calendarExport: {
        state: 'available',
        href: '/api/v1/me/agenda.ics',
      },
    });
    expect(
      reservedBody.items.find(
        ({ session }) => session.id === reservedSessionId,
      ),
    ).toMatchObject({
      state: 'reserved',
      reservation: {
        cancellation: { state: 'available' },
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
  });

  it('cancels before the session starts, audits once and supersedes an old replay after re-reservation', async () => {
    const added = await mutate(
      participantCancelUserId,
      {
        action: 'add',
        sessionId: participantCancelSessionId,
        expectedVersion: 1,
      },
      'agenda-participant-cancel-add-0001',
    );
    expect(added.status).toBe(200);
    const reserved = await mutate(
      participantCancelUserId,
      {
        action: 'reserve',
        sessionId: participantCancelSessionId,
        expectedVersion: 2,
      },
      'agenda-participant-cancel-reserve-0001',
    );
    expect(reserved.status).toBe(200);
    expect(
      participantAgendaMutationResponseSchema
        .parse(await reserved.json())
        .items.find(({ session }) => session.id === participantCancelSessionId),
    ).toMatchObject({
      state: 'reserved',
      reservation: { cancellation: { state: 'available' } },
    });

    const cancelBody = {
      action: 'cancel' as const,
      sessionId: participantCancelSessionId,
      expectedVersion: 3,
    };
    const cancelled = await mutate(
      participantCancelUserId,
      cancelBody,
      'agenda-participant-cancel-0001',
    );
    expect(cancelled.status).toBe(200);
    const cancelledBody = participantAgendaMutationResponseSchema.parse(
      await cancelled.json(),
    );
    expect(cancelledBody).toMatchObject({
      version: 4,
      mutation: { action: 'cancel', outcome: 'applied' },
      items: [
        {
          state: 'saved',
          session: { id: participantCancelSessionId },
        },
      ],
    });

    const replay = await mutate(
      participantCancelUserId,
      cancelBody,
      'agenda-participant-cancel-0001',
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(await replay.json()).toEqual(cancelledBody);

    const reReserved = await mutate(
      participantCancelUserId,
      {
        action: 'reserve',
        sessionId: participantCancelSessionId,
        expectedVersion: 4,
      },
      'agenda-participant-cancel-rereserve-0001',
    );
    expect(reReserved.status).toBe(200);
    const supersededReplay = await mutate(
      participantCancelUserId,
      cancelBody,
      'agenda-participant-cancel-0001',
    );
    expect(supersededReplay.status).toBe(200);
    expect(supersededReplay.headers.get('idempotency-replayed')).toBe('true');
    expect(
      participantAgendaMutationResponseSchema.parse(
        await supersededReplay.json(),
      ),
    ).toMatchObject({
      version: 5,
      mutation: { action: 'cancel', outcome: 'superseded' },
      items: [
        {
          state: 'reserved',
          session: { id: participantCancelSessionId },
        },
      ],
    });

    const cancellations = await client.db
      .select({ value: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, eventId),
          eq(schema.auditLogs.actorId, participantCancelUserId),
          eq(schema.auditLogs.action, 'reservation.cancelled'),
          eq(schema.auditLogs.targetId, participantCancelSessionId),
        ),
      );
    expect(cancellations[0]?.value).toBe(1);
  });

  it('serializes participant cancel with a concurrent reserve without restoring the released place', async () => {
    await mutate(
      participantCancelRaceUserId,
      {
        action: 'add',
        sessionId: participantCancelSessionId,
        expectedVersion: 1,
      },
      'agenda-participant-cancel-race-add-0001',
    );
    await mutate(
      participantCancelRaceUserId,
      {
        action: 'reserve',
        sessionId: participantCancelSessionId,
        expectedVersion: 2,
      },
      'agenda-participant-cancel-race-reserve-0001',
    );

    const [cancelled, concurrentReserve] = await Promise.all([
      mutate(
        participantCancelRaceUserId,
        {
          action: 'cancel',
          sessionId: participantCancelSessionId,
          expectedVersion: 3,
        },
        'agenda-participant-cancel-race-cancel-0001',
      ),
      mutate(
        participantCancelRaceUserId,
        {
          action: 'reserve',
          sessionId: participantCancelSessionId,
          expectedVersion: 3,
        },
        'agenda-participant-cancel-race-reserve-0002',
      ),
    ]);

    expect(cancelled.status).toBe(200);
    expect([200, 409]).toContain(concurrentReserve.status);
    const confirmed = await client.db
      .select({ value: count() })
      .from(schema.reservations)
      .where(
        and(
          eq(schema.reservations.eventId, eventId),
          eq(schema.reservations.userId, participantCancelRaceUserId),
          eq(schema.reservations.sessionId, participantCancelSessionId),
          eq(schema.reservations.status, 'confirmed'),
        ),
      );
    expect(confirmed[0]?.value).toBe(0);
  });

  it('keeps a participant reservation confirmed at and after the session-start cancellation cutoff', async () => {
    await mutate(
      participantCancelCutoffUserId,
      {
        action: 'add',
        sessionId: participantCancelSessionId,
        expectedVersion: 1,
      },
      'agenda-participant-cancel-cutoff-add-0001',
    );
    await mutate(
      participantCancelCutoffUserId,
      {
        action: 'reserve',
        sessionId: participantCancelSessionId,
        expectedVersion: 2,
      },
      'agenda-participant-cancel-cutoff-reserve-0001',
    );
    const afterStart = new Date('2026-09-18T19:00:00.000Z');
    const response = await mutateParticipantAgenda(
      mutationRequest(
        {
          action: 'cancel',
          sessionId: participantCancelSessionId,
          expectedVersion: 3,
        },
        'agenda-participant-cancel-cutoff-cancel-0001',
      ),
      {
        ...dependencies(participantCancelCutoffUserId),
        now: () => afterStart,
      },
    );

    expect(response.status).toBe(409);
    expect(
      participantAgendaMutationProblemSchema.parse(await response.json()),
    ).toMatchObject({
      code: 'RESERVATION_CLOSED',
      sessionId: participantCancelSessionId,
      agenda: {
        items: [
          {
            state: 'reserved',
            reservation: {
              cancellation: { state: 'unavailable', reason: 'closed' },
            },
          },
        ],
      },
    });
    const reservation = await client.db.query.reservations.findFirst({
      columns: { cancelledAt: true, status: true },
      where: and(
        eq(schema.reservations.eventId, eventId),
        eq(schema.reservations.userId, participantCancelCutoffUserId),
        eq(schema.reservations.sessionId, participantCancelSessionId),
        eq(schema.reservations.status, 'confirmed'),
      ),
    });
    expect(reservation).toEqual({ status: 'confirmed', cancelledAt: null });
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

  it('preserves an exact-key replay after the event ends', async () => {
    const body = {
      action: 'add' as const,
      sessionId: savedSessionId,
      expectedVersion: 1,
    };
    const key = 'agenda-replay-after-event-ended-0001';
    const added = await mutate(endedReplayUserId, body, key);
    expect(added.status).toBe(200);
    const addedBody = participantAgendaMutationResponseSchema.parse(
      await added.clone().json(),
    );

    await client.db
      .update(schema.events)
      .set({ status: 'ended' })
      .where(eq(schema.events.id, eventId));
    try {
      const replay = await mutate(endedReplayUserId, body, key);
      expect(replay.status).toBe(200);
      expect(replay.headers.get('idempotency-replayed')).toBe('true');
      expect(await replay.json()).toEqual(addedBody);
    } finally {
      await client.db
        .update(schema.events)
        .set({ status: 'live' })
        .where(eq(schema.events.id, eventId));
    }
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

  it('serializes a capacity-one coaching slot without disclosing its holder', async () => {
    const addResponses = await Promise.all([
      mutate(
        coachingContenderOneId,
        { action: 'add', sessionId: coachingSessionId, expectedVersion: 1 },
        'agenda-coaching-one-add-0001',
      ),
      mutate(
        coachingContenderTwoId,
        { action: 'add', sessionId: coachingSessionId, expectedVersion: 1 },
        'agenda-coaching-two-add-0001',
      ),
    ]);
    expect(addResponses.map(({ status }) => status)).toEqual([200, 200]);

    const responses = await Promise.all([
      mutate(
        coachingContenderOneId,
        { action: 'reserve', sessionId: coachingSessionId, expectedVersion: 2 },
        'agenda-coaching-one-reserve-0001',
      ),
      mutate(
        coachingContenderTwoId,
        { action: 'reserve', sessionId: coachingSessionId, expectedVersion: 2 },
        'agenda-coaching-two-reserve-0001',
      ),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);

    const winnerIndex = responses.findIndex(({ status }) => status === 200);
    const winnerId = [coachingContenderOneId, coachingContenderTwoId][
      winnerIndex
    ]!;
    const loser = responses.find(({ status }) => status === 409)!;
    const loserPayload = await loser.clone().json();
    expect(
      participantAgendaMutationProblemSchema.parse(loserPayload),
    ).toMatchObject({
      code: 'CAPACITY_FULL',
      sessionId: coachingSessionId,
      agenda: {
        items: [
          {
            session: { title: 'Koučink – Radim Roček' },
            state: 'saved',
            capacity: { capacity: 1, confirmed: 1, remaining: 0 },
          },
        ],
      },
    });
    expect(JSON.stringify(loserPayload)).not.toContain(winnerId);

    const reservations = await client.db.query.reservations.findMany({
      columns: { userId: true },
      where: and(
        eq(schema.reservations.eventId, eventId),
        eq(schema.reservations.sessionId, coachingSessionId),
        eq(schema.reservations.status, 'confirmed'),
      ),
    });
    expect(reservations).toEqual([{ userId: winnerId }]);
  });

  it('serializes add with content replacement and revalidates the operational session', async () => {
    let signalContentLocked!: () => void;
    const contentLocked = new Promise<void>((resolve) => {
      signalContentLocked = resolve;
    });
    let releaseContent!: () => void;
    const contentRelease = new Promise<void>((resolve) => {
      releaseContent = resolve;
    });
    const contentReplacement = withTransaction(
      client.db,
      async (transaction) => {
        await acquireTransactionLock(transaction, `content-publish:${eventId}`);
        await transaction
          .update(schema.programSessions)
          .set({ status: 'archived' })
          .where(eq(schema.programSessions.id, savedSessionId));
        signalContentLocked();
        await contentRelease;
      },
    );
    await contentLocked;

    const addition = mutate(
      contentMutationRaceUserId,
      { action: 'add', sessionId: savedSessionId, expectedVersion: 1 },
      'agenda-content-replacement-add-0001',
    );
    try {
      const stateBeforeContentCommit = await Promise.race([
        addition.then(() => 'settled' as const),
        new Promise<'blocked'>((resolve) => {
          setTimeout(() => resolve('blocked'), 100);
        }),
      ]);
      expect(stateBeforeContentCommit).toBe('blocked');
    } finally {
      releaseContent();
      await contentReplacement;
    }

    try {
      const response = await addition;
      expect(response.status).toBe(404);
      expect(
        participantAgendaMutationProblemSchema.parse(await response.json()),
      ).toMatchObject({ code: 'SESSION_NOT_FOUND' });
      const rows = await client.db.query.agendaItems.findMany({
        columns: { sessionId: true },
        where: and(
          eq(schema.agendaItems.eventId, eventId),
          eq(schema.agendaItems.userId, contentMutationRaceUserId),
          eq(schema.agendaItems.sessionId, savedSessionId),
        ),
      });
      expect(rows).toEqual([]);
    } finally {
      await client.db
        .update(schema.programSessions)
        .set({ status: 'draft' })
        .where(eq(schema.programSessions.id, savedSessionId));
    }
  });

  it('reclassifies a reservation failure against the post-rollback canonical snapshot', async () => {
    const added = await mutate(
      canonicalFailureUserId,
      {
        action: 'add',
        sessionId: lastSeatSessionId,
        expectedVersion: 1,
      },
      'agenda-canonical-failure-add-0001',
    );
    expect(added.status).toBe(200);

    let signalContentLocked!: () => void;
    const contentLocked = new Promise<void>((resolve) => {
      signalContentLocked = resolve;
    });
    let releaseContent!: () => void;
    const contentRelease = new Promise<void>((resolve) => {
      releaseContent = resolve;
    });
    const contentHolder = withTransaction(client.db, async (transaction) => {
      await acquireTransactionLock(transaction, `content-publish:${eventId}`);
      signalContentLocked();
      await contentRelease;
    });
    await contentLocked;

    const reservation = mutate(
      canonicalFailureUserId,
      {
        action: 'reserve',
        sessionId: lastSeatSessionId,
        expectedVersion: 2,
      },
      'agenda-canonical-failure-reserve-0001',
    );
    const stateBeforeContentRelease = await Promise.race([
      reservation.then(() => 'settled' as const),
      new Promise<'blocked'>((resolve) => {
        setTimeout(() => resolve('blocked'), 100);
      }),
    ]);
    expect(stateBeforeContentRelease).toBe('blocked');

    const cancellation = withTransaction(client.db, async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `participant-agenda:${eventId}:${canonicalFailureUserId}`,
      );
      await transaction
        .update(schema.programSessions)
        .set({ status: 'cancelled' })
        .where(eq(schema.programSessions.id, lastSeatSessionId));
    });
    const cancellationState = await Promise.race([
      cancellation.then(() => 'settled' as const),
      new Promise<'blocked'>((resolve) => {
        setTimeout(() => resolve('blocked'), 100);
      }),
    ]);
    expect(cancellationState).toBe('blocked');

    try {
      releaseContent();
      await contentHolder;
      await cancellation;
      const response = await reservation;
      expect(response.status).toBe(404);
      expect(
        participantAgendaMutationProblemSchema.parse(await response.json()),
      ).toMatchObject({ code: 'SESSION_NOT_FOUND' });
    } finally {
      releaseContent();
      await contentHolder;
      await cancellation;
      await client.db
        .update(schema.programSessions)
        .set({ status: 'draft' })
        .where(eq(schema.programSessions.id, lastSeatSessionId));
    }
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

    expect(authoritativeNow).toHaveBeenCalledTimes(3);
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

  it('keeps the published reservation cutoff across unpublished operational timing changes', async () => {
    const currentPublication =
      await client.db.query.contentPublications.findFirst({
        where: eq(schema.contentPublications.eventId, eventId),
        orderBy: [desc(schema.contentPublications.version)],
      });
    const currentProgram = publishedProgramAgendaSnapshotSchema.parse(
      currentPublication?.snapshot,
    ).program;
    await client.db.insert(schema.contentPublications).values({
      id: crypto.randomUUID(),
      eventId,
      version: currentPublication!.version + 1,
      snapshot: {
        program: {
          ...currentProgram,
          sessions: currentProgram.sessions.map((session) => {
            if (session.id !== cutoffRaceSessionId) return session;
            const legacySession = { ...session };
            delete legacySession.reservationClosesAt;
            delete legacySession.reservationOpensAt;
            return legacySession;
          }),
        },
      },
      reservationWindows: {
        [cutoffRaceSessionId]: {
          reservationOpensAt: null,
          reservationClosesAt: '2026-09-18T07:00:30.000Z',
        },
      },
      checksumSha256: 'f'.repeat(64),
      publishedBy: publisherId,
      publishedAt: new Date(fixedNow.getTime() + 500),
    });

    const added = await mutate(
      publicationPolicyUserId,
      {
        action: 'add',
        sessionId: cutoffRaceSessionId,
        expectedVersion: 1,
      },
      'agenda-publication-cutoff-add-0001',
    );
    expect(added.status).toBe(200);

    const unpublishedStartsAt = new Date('2026-09-18T17:00:00Z');
    const unpublishedEndsAt = new Date('2026-09-18T18:00:00Z');
    await client.db
      .update(schema.programSessions)
      .set({
        startsAt: unpublishedStartsAt,
        endsAt: unpublishedEndsAt,
        reservationClosesAt: unpublishedStartsAt,
      })
      .where(eq(schema.programSessions.id, cutoffRaceSessionId));

    const afterPublishedCutoff = new Date('2026-09-18T07:00:31.000Z');
    try {
      const read = await readParticipantAgenda(readRequest(), {
        ...dependencies(publicationPolicyUserId),
        now: () => afterPublishedCutoff,
      });
      expect(read.status).toBe(200);
      expect(
        participantAgendaResponseSchema.parse(await read.json()),
      ).toMatchObject({
        items: [
          {
            session: {
              id: cutoffRaceSessionId,
              startsAt: '2026-09-18T15:00:00.000Z',
            },
            action: { state: 'closed' },
          },
        ],
      });

      const reserved = await mutateParticipantAgenda(
        mutationRequest(
          {
            action: 'reserve',
            sessionId: cutoffRaceSessionId,
            expectedVersion: 2,
          },
          'agenda-publication-cutoff-reserve-0001',
        ),
        {
          ...dependencies(publicationPolicyUserId),
          now: () => afterPublishedCutoff,
        },
      );
      expect(reserved.status).toBe(409);
      expect(
        participantAgendaMutationProblemSchema.parse(await reserved.json()),
      ).toMatchObject({ code: 'RESERVATION_CLOSED' });
    } finally {
      await client.db
        .update(schema.programSessions)
        .set({
          startsAt: new Date('2026-09-18T15:00:00Z'),
          endsAt: new Date('2026-09-18T16:00:00Z'),
          reservationClosesAt: new Date('2026-09-18T07:00:30Z'),
        })
        .where(eq(schema.programSessions.id, cutoffRaceSessionId));
    }
  });

  it('returns canonical stale and closed problems and reserves configured networking', async () => {
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
    expect(networking.status).toBe(200);
    expect(
      participantAgendaMutationResponseSchema.parse(await networking.json()),
    ).toMatchObject({
      mutation: { action: 'reserve', outcome: 'applied' },
      items: expect.arrayContaining([
        expect.objectContaining({
          state: 'reserved',
          session: { id: networkingSessionId },
        }),
      ]),
    });
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

    await client.db
      .update(schema.programSessions)
      .set({ capacityMode: 'none', capacity: null })
      .where(eq(schema.programSessions.id, projectedSessionId));
    const waitlistDrift = await readParticipantAgenda(
      readRequest(),
      dependencies(projectedWaitlistUserId),
    );
    expect(waitlistDrift.status).toBe(200);
    expect(
      participantAgendaResponseSchema
        .parse(await waitlistDrift.json())
        .items.find(({ session }) => session.id === projectedSessionId),
    ).toMatchObject({
      state: 'waitlisted',
      action: { state: 'closed' },
      capacity: {
        mode: 'reservation',
        remaining: 0,
        actorAvailability: { state: 'unavailable' },
      },
      waitlist: { state: 'waiting', position: 1, actionsAvailable: false },
    });
    expect(onOperationalDrift).toHaveBeenCalledWith({
      code: 'active_waitlist_without_capacity',
      eventId,
      sessionId: projectedSessionId,
    });

    await client.db
      .update(schema.programSessions)
      .set({ status: 'cancelled' })
      .where(eq(schema.programSessions.id, reservedSessionId));
    const cancelled = await readParticipantAgenda(
      readRequest(),
      dependencies(primaryUserId),
    );
    expect(cancelled.status).toBe(200);
    expect(
      participantAgendaResponseSchema
        .parse(await cancelled.json())
        .items.find(({ session }) => session.id === reservedSessionId),
    ).toMatchObject({
      state: 'reserved',
      session: { status: 'cancelled' },
      action: { state: 'cancelled' },
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

  it('enforces the item limit across saved and reservation projections', async () => {
    const cappedSessionIds = Array.from({ length: 511 }, () =>
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
        startsAt: new Date('2026-09-18T18:00:00Z'),
        endsAt: new Date('2026-09-18T19:00:00Z'),
        status: 'draft' as const,
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
    await client.db.insert(schema.reservations).values({
      id: crypto.randomUUID(),
      eventId,
      sessionId: closedSessionId,
      userId: driftUserId,
      status: 'confirmed',
      source: 'participant',
      createdAt: fixedNow,
    });
    const currentPublication =
      await client.db.query.contentPublications.findFirst({
        columns: { snapshot: true, version: true },
        where: eq(schema.contentPublications.eventId, eventId),
        orderBy: [desc(schema.contentPublications.version)],
      });
    const currentPublishedProgram = publishedProgramAgendaSnapshotSchema.parse(
      currentPublication?.snapshot,
    );
    await client.db.insert(schema.contentPublications).values({
      id: crypto.randomUUID(),
      eventId,
      version: (currentPublication?.version ?? 0) + 1,
      snapshot: {
        program: {
          ...currentPublishedProgram.program,
          sessions: [
            ...currentPublishedProgram.program.sessions,
            ...cappedSessionIds.map((id, index) => ({
              id,
              dayId,
              roomId: null,
              slug: `agenda-cap-${index}-${id}`,
              title: `Agenda cap ${index}`,
              type: 'other' as const,
              status: 'published' as const,
              startsAt: '2026-09-18T18:00:00.000Z',
              endsAt: '2026-09-18T19:00:00.000Z',
              sortOrder:
                currentPublishedProgram.program.sessions.length + index,
            })),
          ],
        },
      },
      checksumSha256: 'd'.repeat(64),
      publishedBy: publisherId,
      publishedAt: new Date(fixedNow.getTime() + 1_000),
    });

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
    expect(savedCount?.value).toBe(511);

    const read = await readParticipantAgenda(
      readRequest(),
      dependencies(driftUserId),
    );
    expect(read.status).toBe(200);
    const readBody = participantAgendaResponseSchema.parse(await read.json());
    expect(readBody.version).toBe(1);
    expect(readBody.items).toHaveLength(512);
    expect(
      readBody.items.find(({ session }) => session.id === closedSessionId),
    ).toMatchObject({ state: 'reserved' });
  });

  it('replays a successful mutation after a newer publication removes its target', async () => {
    const body = {
      action: 'add' as const,
      sessionId: savedSessionId,
      expectedVersion: 1,
    };
    const key = 'agenda-replay-after-publication-0001';
    const added = await mutate(publicationReplayUserId, body, key);
    expect(added.status).toBe(200);

    const publication = await client.db.query.contentPublications.findFirst({
      columns: { snapshot: true, version: true },
      where: eq(schema.contentPublications.eventId, eventId),
      orderBy: [desc(schema.contentPublications.version)],
    });
    const published = publishedProgramAgendaSnapshotSchema.parse(
      publication?.snapshot,
    );
    await client.db.insert(schema.contentPublications).values({
      id: crypto.randomUUID(),
      eventId,
      version: (publication?.version ?? 0) + 1,
      snapshot: {
        program: {
          ...published.program,
          sessions: published.program.sessions.filter(
            ({ id }) => id !== savedSessionId,
          ),
        },
      },
      checksumSha256: 'b'.repeat(64),
      publishedBy: publisherId,
      publishedAt: new Date(fixedNow.getTime() + 2_000),
    });

    const replay = await mutate(publicationReplayUserId, body, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(
      participantAgendaMutationResponseSchema.parse(await replay.json()),
    ).toMatchObject({
      version: 2,
      publicationVersion: (publication?.version ?? 0) + 1,
      items: [],
      mutation: { action: 'add', outcome: 'superseded' },
      timeConflict: null,
    });

    const cleanup = await mutate(
      publicationReplayUserId,
      { action: 'remove', sessionId: savedSessionId, expectedVersion: 2 },
      'agenda-remove-after-publication-0001',
    );
    expect(cleanup.status).toBe(200);
    expect(
      participantAgendaMutationResponseSchema.parse(await cleanup.json()),
    ).toMatchObject({
      version: 3,
      items: [],
      mutation: { action: 'remove', outcome: 'applied' },
    });
    expect(
      await client.db.query.agendaItems.findFirst({
        where: and(
          eq(schema.agendaItems.eventId, eventId),
          eq(schema.agendaItems.userId, publicationReplayUserId),
          eq(schema.agendaItems.sessionId, savedSessionId),
        ),
      }),
    ).toBeUndefined();
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
