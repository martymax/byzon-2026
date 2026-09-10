import { createHash } from 'node:crypto';
import { createDatabaseClient, schema } from '@byzon/database';
import { adminParticipantDeleteResponseSchema } from '@byzon/domain/contracts/support';
import { and, eq, getTableName, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { handleAdminParticipantDelete } from './admin-support';
import { deleteParticipantData } from './participant-deletion';
import { loadEventPolicy } from './policy';
import { dispatchSupportedOutboxOnce } from '../../../worker/src/outbox';
import {
  handleAdminAnnouncementPreview,
  handleAdminAnnouncementSend,
} from './admin-announcements';

const integration = process.env.TEST_DATABASE_URL
  ? describe.sequential
  : describe.skip;
const origin = 'http://localhost:3000';
const now = new Date('2026-09-02T08:00:00Z');
const uuid = () => crypto.randomUUID();

integration('permanent participant deletion', () => {
  const client = createDatabaseClient({
    connectionString: process.env.TEST_DATABASE_URL!,
    max: 6,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'byzon-participant-deletion-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = uuid();
  const otherEventId = uuid();
  const adminId = uuid();
  const dayId = uuid();
  const eventSlug = `delete-${eventId}`;

  const makeParticipant = async () => {
    const id = uuid();
    const email = `${id}@example.invalid`;
    await client.db
      .insert(schema.users)
      .values({ id, email, name: 'Test Participant', emailVerified: true });
    await client.db
      .insert(schema.eventMemberships)
      .values({ eventId, userId: id });
    await client.db
      .insert(schema.eventRoles)
      .values({ id: uuid(), eventId, userId: id, role: 'participant' });
    await client.db.insert(schema.participantProfiles).values({
      eventId,
      userId: id,
      firstName: 'Test',
      lastName: 'Participant',
      contactEmail: email,
    });
    return { id, email };
  };
  const makeTicket = async (
    holderUserId: string,
    overrides: Partial<typeof schema.tickets.$inferInsert> = {},
  ) => {
    const id = uuid();
    await client.db.insert(schema.tickets).values({
      id,
      eventId,
      holderUserId,
      status: 'activated',
      claimedAt: now,
      codeHmac: createHash('sha256').update(id).digest('hex'),
      codeSuffix: 'TEST1234',
      ...overrides,
    });
    return id;
  };
  const dependencies = (actorId: string | null = adminId) => ({
    db: client.db,
    allowedOrigin: origin,
    currentEventSlug: eventSlug,
    now: () => now,
    getSession: vi.fn(async () => (actorId ? { user: { id: actorId } } : null)),
  });
  const request = (
    id: string,
    key = uuid(),
    body: unknown = {
      participantId: id,
      expectedProfileVersion: 1,
      confirm: true,
    },
  ) =>
    new Request(`${origin}/api/v1/admin/events/${eventId}/participants/${id}`, {
      method: 'DELETE',
      headers: {
        origin,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    });
  const remove = (id: string, key = uuid()) =>
    handleAdminParticipantDelete(request(id, key), eventId, id, dependencies());
  const profileExists = async (id: string) =>
    !!(await client.db.query.participantProfiles.findFirst({
      where: and(
        eq(schema.participantProfiles.eventId, eventId),
        eq(schema.participantProfiles.userId, id),
      ),
    }));

  beforeAll(async () => {
    await client.db.insert(schema.events).values(
      [eventId, otherEventId].map((id) => ({
        id,
        slug: id === eventId ? eventSlug : `delete-other-${id}`,
        name: 'Deletion test',
        startsAt: new Date('2026-09-18T06:00:00Z'),
        endsAt: new Date('2026-09-19T17:00:00Z'),
        timezone: 'Europe/Prague',
        status: 'live' as const,
      })),
    );
    await client.db.insert(schema.users).values({
      id: adminId,
      name: 'Admin',
      email: `${adminId}@example.invalid`,
    });
    await client.db
      .insert(schema.eventMemberships)
      .values({ eventId, userId: adminId });
    await client.db.insert(schema.eventRoles).values({
      id: uuid(),
      eventId,
      userId: adminId,
      role: 'organizer_admin',
    });
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Friday',
      sortOrder: 0,
    });
  });

  afterAll(async () => {
    // Publications are immutable; like the agenda integration suite, fixtures
    // use unique IDs and live only in the disposable test database.
    await client.close();
  });

  it('removes all owned relational data and snapshots while preserving other people, shared orders and program content', async () => {
    const participant = await makeParticipant();
    const other = await makeParticipant();
    const firstTicket = await makeTicket(participant.id, {
      externalId: `external-${participant.id}`,
      orderExternalId: 'shared-order',
    });
    const secondTicket = await makeTicket(participant.id, {
      status: 'blocked',
    });
    const otherTicket = await makeTicket(other.id, {
      transferredFromTicketId: firstTicket,
      orderExternalId: 'shared-order',
    });
    const sessionId = uuid();
    await client.db.insert(schema.programSessions).values({
      id: sessionId,
      eventId,
      dayId,
      slug: sessionId,
      title: 'Shared workshop',
      type: 'workshop',
      startsAt: new Date('2026-09-18T10:00:00Z'),
      endsAt: new Date('2026-09-18T11:00:00Z'),
      status: 'published',
      sortOrder: 0,
    });
    await client.db.insert(schema.participantAgendas).values([
      { eventId, userId: participant.id },
      { eventId, userId: other.id },
    ]);
    await client.db.insert(schema.agendaItems).values([
      { eventId, userId: participant.id, sessionId },
      { eventId, userId: other.id, sessionId },
    ]);
    const reservationId = uuid();
    await client.db.insert(schema.reservations).values([
      {
        id: reservationId,
        eventId,
        userId: participant.id,
        sessionId,
        source: 'participant',
      },
      {
        id: uuid(),
        eventId,
        userId: participant.id,
        sessionId,
        source: 'participant',
        status: 'cancelled',
        cancelledAt: now,
      },
      {
        id: uuid(),
        eventId,
        userId: other.id,
        sessionId,
        source: 'participant',
      },
    ]);
    await client.db.insert(schema.waitlistEntries).values({
      id: uuid(),
      eventId,
      userId: participant.id,
      sessionId,
      positionSequence: 1,
    });
    await client.db.insert(schema.questions).values([
      {
        id: uuid(),
        eventId,
        sessionId,
        authorUserId: participant.id,
        text: 'Private question',
      },
      {
        id: uuid(),
        eventId,
        sessionId,
        authorUserId: other.id,
        text: 'Keep question',
      },
    ]);
    await client.db.insert(schema.ratings).values({
      id: uuid(),
      eventId,
      userId: participant.id,
      targetType: 'event',
      score: 5,
      comment: 'Private rating',
    });
    const documentId = uuid();
    await client.db.insert(schema.legalDocuments).values({
      id: documentId,
      eventId,
      type: 'terms',
      version: '1',
      title: 'Terms',
      publishedAt: now,
    });
    await client.db.insert(schema.consentRecords).values({
      id: uuid(),
      eventId,
      userId: participant.id,
      legalDocumentId: documentId,
      decision: 'accepted',
      source: 'onboarding',
      requestId: uuid(),
    });
    await client.db.insert(schema.privacyRequests).values({
      id: uuid(),
      eventId,
      userId: participant.id,
      kind: 'data_deletion',
    });
    const previewId = uuid();
    const announcementId = uuid();
    await client.db.insert(schema.announcementPreviews).values({
      id: previewId,
      eventId,
      draft: {},
      recipientUserIds: [participant.id, other.id],
      recipientCount: 2,
      createdBy: adminId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60000),
      sentAnnouncementId: announcementId,
    });
    await client.db.insert(schema.announcements).values({
      id: announcementId,
      eventId,
      previewId,
      title: 'Shared announcement',
      summary: 'Keep',
      bodyText: 'Keep this shared message',
      audienceKind: 'event',
      createdBy: adminId,
    });
    await client.db.insert(schema.announcementRecipients).values([
      { eventId, announcementId, userId: participant.id },
      { eventId, announcementId, userId: other.id },
    ]);
    const stationId = uuid();
    const deviceId = uuid();
    await client.db
      .insert(schema.checkinStations)
      .values({ id: stationId, eventId, name: 'Reception' });
    await client.db
      .insert(schema.operatorDevices)
      .values({ id: deviceId, eventId, stationId, label: 'Test scanner' });
    await client.db.insert(schema.checkIns).values({
      id: uuid(),
      eventId,
      ticketId: firstTicket,
      holderUserId: participant.id,
      stationId,
      deviceId,
      checkedInBy: adminId,
    });
    await client.db.insert(schema.checkinLookups).values({
      id: uuid(),
      eventId,
      ticketId: secondTicket,
      operatorUserId: adminId,
      deviceId,
      outcome: 'found',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60000),
    });
    await client.db.insert(schema.ticketEvents).values({
      id: uuid(),
      eventId,
      ticketId: firstTicket,
      actorType: 'user',
      actorId: participant.id,
      toStatus: 'activated',
      requestId: uuid(),
    });
    const batchId = uuid();
    await client.db.insert(schema.ticketImportBatches).values({
      id: batchId,
      eventId,
      source: 'simpleshop_api',
      sourceFilename: 'test',
      fileSha256: createHash('sha256').update(batchId).digest('hex'),
      status: 'applied',
      rowCount: 2,
      createdBy: adminId,
    });
    for (const [index, person] of [participant, other].entries()) {
      await client.db.insert(schema.ticketSourceParticipants).values({
        id: uuid(),
        eventId,
        userId: person.id,
        externalId: `external-${person.id}`,
        orderExternalId: 'shared-order',
        sourceStatus: 'paid',
        importBatchId: batchId,
      });
      await client.db.insert(schema.ticketImportRows).values({
        id: uuid(),
        eventId,
        batchId,
        externalId: `external-${person.id}`,
        orderExternalId: 'shared-order',
        rowNumber: index + 1,
      });
      await client.db.insert(schema.emailDeliveries).values({
        id: uuid(),
        eventId,
        userId: person.id,
        deduplicationKey: `email-${person.id}`,
        payload: { to: person.email },
        rendered: {
          to: person.email,
          subject: 'Test',
          html: 'Test',
          text: 'Test',
        },
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60000),
      });
      await client.db.insert(schema.outboxEvents).values({
        id: uuid(),
        eventId,
        type: 'test.notification',
        aggregateType: 'participant',
        aggregateId: person.id,
        payload: { userId: person.id },
        deduplicationKey: person.id,
      });
      await client.db.insert(schema.sessions).values({
        id: uuid(),
        userId: person.id,
        token: uuid(),
        expiresAt: new Date(now.getTime() + 60000),
      });
      await client.db.insert(schema.accounts).values({
        id: uuid(),
        userId: person.id,
        accountId: person.id,
        providerId: 'test',
      });
      await client.db.insert(schema.verifications).values({
        id: uuid(),
        identifier: person.id,
        value: JSON.stringify({ email: person.email }),
        expiresAt: new Date(now.getTime() + 60000),
      });
    }
    await client.db.insert(schema.idempotencyKeys).values({
      id: uuid(),
      eventId,
      actorId: adminId,
      scope: 'participant.profile',
      key: uuid(),
      requestHash: 'a'.repeat(64),
      responseStatus: 200,
      responseBody: {
        detail: {
          participantId: participant.id,
          contactEmail: participant.email,
        },
      },
      expiresAt: new Date(now.getTime() + 60000),
    });
    const oldAuditId = uuid();
    await client.db.insert(schema.auditLogs).values({
      id: oldAuditId,
      eventId,
      actorId: adminId,
      actorType: 'user',
      action: 'reservation.admin_cancelled',
      targetType: 'reservation',
      targetId: reservationId,
      requestId: uuid(),
      before: { private: participant.email },
    });
    const exportId = uuid();
    await client.db.insert(schema.operationalExportRequests).values({
      id: exportId,
      eventId,
      requestedBy: adminId,
      report: 'audit_log',
      format: 'json',
      reason: 'Test export',
      state: 'ready',
      content: participant.email,
      contentType: 'application/json',
      checksumSha256: 'a'.repeat(64),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60000),
    });

    const response = await remove(participant.id);
    expect(await response.clone().json()).toMatchObject({
      accountDeleted: true,
      membershipRetained: false,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = adminParticipantDeleteResponseSchema.parse(
      await response.json(),
    );
    expect(body.outcome).toBe('deleted');
    expect(await profileExists(participant.id)).toBe(false);
    expect(
      await client.db.query.users.findFirst({
        where: eq(schema.users.id, participant.id),
      }),
    ).toBeUndefined();
    for (const table of [
      schema.reservations,
      schema.waitlistEntries,
      schema.participantAgendas,
      schema.agendaItems,
      schema.ratings,
      schema.consentRecords,
      schema.privacyRequests,
      schema.announcementRecipients,
      schema.ticketSourceParticipants,
      schema.emailDeliveries,
      schema.sessions,
      schema.accounts,
    ]) {
      expect(
        await client.db
          .select()
          .from(table)
          .where(eq(table.userId, participant.id)),
        getTableName(table),
      ).toEqual([]);
    }
    expect(
      await client.db.query.tickets.findMany({
        where: inArray(schema.tickets.id, [firstTicket, secondTicket]),
      }),
    ).toEqual([]);
    expect(
      await client.db.query.checkIns.findMany({
        where: eq(schema.checkIns.holderUserId, participant.id),
      }),
    ).toEqual([]);
    expect(
      await client.db.query.checkinLookups.findMany({
        where: inArray(schema.checkinLookups.ticketId, [
          firstTicket,
          secondTicket,
        ]),
      }),
    ).toEqual([]);
    expect(
      await client.db.query.ticketEvents.findMany({
        where: eq(schema.ticketEvents.ticketId, firstTicket),
      }),
    ).toEqual([]);
    expect(
      await client.db.query.questions.findMany({
        where: eq(schema.questions.authorUserId, participant.id),
      }),
    ).toEqual([]);
    expect(
      await client.db.query.ticketImportRows.findMany({
        where: eq(
          schema.ticketImportRows.externalId,
          `external-${participant.id}`,
        ),
      }),
    ).toEqual([]);
    expect(
      await client.db.query.outboxEvents.findMany({
        where: eq(schema.outboxEvents.aggregateId, participant.id),
      }),
    ).toEqual([]);
    expect(
      await client.db.query.idempotencyKeys.findMany({
        where: and(
          eq(schema.idempotencyKeys.eventId, eventId),
          eq(schema.idempotencyKeys.scope, 'participant.profile'),
        ),
      }),
    ).toEqual([]);
    expect(
      await client.db.query.verifications.findMany({
        where: eq(schema.verifications.identifier, participant.id),
      }),
    ).toEqual([]);
    expect(
      await client.db.query.auditLogs.findFirst({
        where: eq(schema.auditLogs.id, oldAuditId),
      }),
    ).toMatchObject({
      targetId: null,
      before: null,
      after: { participantDeleted: true },
    });
    expect(
      await client.db.query.operationalExportRequests.findFirst({
        where: eq(schema.operationalExportRequests.id, exportId),
      }),
    ).toMatchObject({ state: 'expired', content: null });
    expect(
      await client.db.query.announcementPreviews.findFirst({
        where: eq(schema.announcementPreviews.id, previewId),
      }),
    ).toMatchObject({
      recipientUserIds: [other.id],
      recipientCount: 1,
      version: 2,
    });
    expect(
      await client.db.query.announcements.findFirst({
        where: eq(schema.announcements.id, announcementId),
      }),
    ).toBeDefined();
    expect(
      await client.db.query.programSessions.findFirst({
        where: eq(schema.programSessions.id, sessionId),
      }),
    ).toBeDefined();
    expect(
      await client.db.query.tickets.findFirst({
        where: eq(schema.tickets.id, otherTicket),
      }),
    ).toMatchObject({ holderUserId: other.id, transferredFromTicketId: null });
    expect(await profileExists(other.id)).toBe(true);
    expect(
      await client.db.query.emailDeliveries.findFirst({
        where: eq(schema.emailDeliveries.userId, other.id),
      }),
    ).toBeDefined();
    expect(
      await client.db.query.ticketImportRows.findFirst({
        where: eq(schema.ticketImportRows.externalId, `external-${other.id}`),
      }),
    ).toBeDefined();
    expect(
      await client.db.query.sessions.findFirst({
        where: eq(schema.sessions.userId, other.id),
      }),
    ).toBeDefined();
  });

  it('preserves the account and participation in another event', async () => {
    const participant = await makeParticipant();
    await client.db
      .insert(schema.eventMemberships)
      .values({ eventId: otherEventId, userId: participant.id });
    await client.db.insert(schema.eventRoles).values({
      id: uuid(),
      eventId: otherEventId,
      userId: participant.id,
      role: 'participant',
    });
    await client.db.insert(schema.participantProfiles).values({
      eventId: otherEventId,
      userId: participant.id,
      firstName: 'Other',
      lastName: 'Event',
      contactEmail: participant.email,
    });
    const personalAuditId = uuid();
    const teamAuditId = uuid();
    await client.db.insert(schema.auditLogs).values([
      {
        id: personalAuditId,
        eventId,
        actorId: participant.id,
        actorType: 'user',
        action: 'reservation.created',
        targetType: 'program_session',
        targetId: uuid(),
        requestId: uuid(),
      },
      {
        id: teamAuditId,
        eventId,
        actorId: participant.id,
        actorType: 'user',
        action: 'settings.update',
        targetType: 'event',
        targetId: eventId,
        requestId: uuid(),
      },
    ]);
    const teamReceiptId = uuid();
    const personalReceiptId = uuid();
    await client.db.insert(schema.idempotencyKeys).values([
      {
        id: teamReceiptId,
        eventId,
        actorId: participant.id,
        scope: 'announcement.send',
        key: uuid(),
        requestHash: 'a'.repeat(64),
        responseStatus: 201,
        responseBody: { eventId },
        expiresAt: new Date(now.getTime() + 60000),
      },
      {
        id: personalReceiptId,
        eventId,
        actorId: participant.id,
        scope: 'participant.agenda-action',
        key: uuid(),
        requestHash: 'a'.repeat(64),
        responseStatus: 200,
        responseBody: { eventId },
        expiresAt: new Date(now.getTime() + 60000),
      },
    ]);
    const response = await remove(participant.id);
    expect(await response.json()).toMatchObject({
      accountDeleted: false,
      membershipRetained: false,
    });
    expect(await profileExists(participant.id)).toBe(false);
    expect(
      await client.db.query.auditLogs.findFirst({
        where: eq(schema.auditLogs.id, personalAuditId),
      }),
    ).toMatchObject({ actorId: null, targetId: null });
    expect(
      await client.db.query.auditLogs.findFirst({
        where: eq(schema.auditLogs.id, teamAuditId),
      }),
    ).toMatchObject({ actorId: participant.id, targetId: eventId });
    expect(
      await client.db.query.idempotencyKeys.findFirst({
        where: eq(schema.idempotencyKeys.id, teamReceiptId),
      }),
    ).toBeDefined();
    expect(
      await client.db.query.idempotencyKeys.findFirst({
        where: eq(schema.idempotencyKeys.id, personalReceiptId),
      }),
    ).toBeUndefined();

    expect(
      await client.db.query.participantProfiles.findFirst({
        where: and(
          eq(schema.participantProfiles.eventId, otherEventId),
          eq(schema.participantProfiles.userId, participant.id),
        ),
      }),
    ).toBeDefined();
    expect(
      await loadEventPolicy(client.db, { userId: participant.id }, eventId),
    ).toBeNull();
    expect(
      (
        await loadEventPolicy(
          client.db,
          { userId: participant.id },
          otherEventId,
        )
      )?.roles,
    ).toEqual(['participant']);
  });

  it('releases a reserved place and promotes only the next eligible waiter', async () => {
    const participant = await makeParticipant();
    const first = await makeParticipant();
    const second = await makeParticipant();
    const sessionId = uuid();
    const startsAt = '2026-09-18T13:00:00.000Z';
    const endsAt = '2026-09-18T14:00:00.000Z';
    await client.db.insert(schema.programSessions).values({
      id: sessionId,
      eventId,
      dayId,
      slug: sessionId,
      title: 'One place',
      type: 'workshop',
      status: 'published',
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      sortOrder: 1,
      capacityMode: 'reservation',
      capacity: 1,
      waitlistMode: 'auto_confirm',
    });
    await client.db.insert(schema.contentPublications).values({
      id: uuid(),
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
              title: 'Friday',
              sortOrder: 0,
            },
          ],
          rooms: [],
          sessions: [
            {
              id: sessionId,
              dayId,
              roomId: null,
              slug: sessionId,
              title: 'One place',
              summary: null,
              description: null,
              type: 'workshop',
              status: 'published',
              startsAt,
              endsAt,
              sortOrder: 1,
              capacityMode: 'reservation',
              capacity: 1,
              reservationOpensAt: null,
              reservationClosesAt: startsAt,
            },
          ],
        },
      },
    });
    await client.db.insert(schema.reservations).values({
      id: uuid(),
      eventId,
      sessionId,
      userId: participant.id,
      source: 'participant',
    });
    for (const [position, person] of [participant, first, second].entries()) {
      await client.db.insert(schema.waitlistEntries).values({
        id: uuid(),
        eventId,
        sessionId,
        userId: person.id,
        positionSequence: position + 1,
      });
    }
    expect((await remove(participant.id)).status).toBe(200);
    const reservations = await client.db.query.reservations.findMany({
      where: eq(schema.reservations.sessionId, sessionId),
    });
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      userId: first.id,
      status: 'confirmed',
      source: 'waitlist_auto',
    });
    expect(
      await client.db.query.waitlistEntries.findMany({
        where: eq(schema.waitlistEntries.sessionId, sessionId),
        orderBy: schema.waitlistEntries.positionSequence,
      }),
    ).toMatchObject([
      { userId: first.id, status: 'promoted' },
      { userId: second.id, status: 'waiting' },
    ]);
    expect(
      await client.db.query.emailDeliveries.findFirst({
        where: eq(schema.emailDeliveries.userId, first.id),
      }),
    ).toBeDefined();
  });

  it('preserves a speaker role and public speaker profile while removing participant data', async () => {
    const participant = await makeParticipant();
    await client.db
      .insert(schema.eventRoles)
      .values({ id: uuid(), eventId, userId: participant.id, role: 'speaker' });
    const speakerId = uuid();
    await client.db.insert(schema.speakerProfiles).values({
      id: speakerId,
      eventId,
      userId: participant.id,
      slug: speakerId,
      firstName: 'Public',
      lastName: 'Speaker',
      sortOrder: 0,
    });
    expect(await (await remove(participant.id)).json()).toMatchObject({
      accountDeleted: false,
      membershipRetained: true,
    });
    expect(await profileExists(participant.id)).toBe(false);
    expect(
      (await loadEventPolicy(client.db, { userId: participant.id }, eventId))
        ?.roles,
    ).toEqual(['speaker']);
    expect(
      await client.db.query.speakerProfiles.findFirst({
        where: eq(schema.speakerProfiles.id, speakerId),
      }),
    ).toBeDefined();
  });

  it.each([true, false])(
    'cleans private answers and their receipts while preserving other answers (active speaker: %s)',
    async (activeSpeaker) => {
      const author = await makeParticipant();
      const other = await makeParticipant();
      const speaker = await makeParticipant();
      const speakerId = uuid();
      const sessionId = uuid();
      const questionIds = [uuid(), uuid()];
      const answerIds = [uuid(), uuid()];
      await client.db.insert(schema.eventRoles).values({
        id: uuid(),
        eventId,
        userId: speaker.id,
        role: 'speaker',
        revokedAt: activeSpeaker ? null : now,
      });
      await client.db.insert(schema.speakerProfiles).values({
        id: speakerId,
        eventId,
        userId: speaker.id,
        slug: speakerId,
        firstName: 'Public',
        lastName: 'Speaker',
        sortOrder: 0,
      });
      await client.db.insert(schema.programSessions).values({
        id: sessionId,
        eventId,
        dayId,
        slug: sessionId,
        title: 'Private follow-up',
        type: 'talk',
        status: 'published',
        sortOrder: 0,
        startsAt: new Date('2026-09-18T10:00:00Z'),
        endsAt: new Date('2026-09-18T11:00:00Z'),
      });
      for (const [index, person] of [author, other].entries()) {
        await client.db.insert(schema.questions).values({
          id: questionIds[index]!,
          eventId,
          sessionId,
          authorUserId: person.id,
          text: `Private question ${index}`,
        });
        await client.db.insert(schema.questionAnswers).values({
          id: answerIds[index]!,
          eventId,
          sessionId,
          questionId: questionIds[index]!,
          speakerProfileId: speakerId,
          answeredByUserId: speaker.id,
          speakerName: 'Public Speaker',
          text: `Private answer ${index}`,
        });
        await client.db.insert(schema.idempotencyKeys).values({
          id: uuid(),
          eventId,
          actorId: speaker.id,
          scope: `question.answer.put.${questionIds[index]}`,
          key: uuid(),
          requestHash: 'a'.repeat(64),
          responseStatus: 201,
          responseBody: { answerId: answerIds[index], version: 1 },
          resultReference: answerIds[index],
          expiresAt: new Date(now.getTime() + 60000),
        });
      }
      const auditId = uuid();
      await client.db.insert(schema.auditLogs).values({
        id: auditId,
        eventId,
        actorId: speaker.id,
        actorType: 'user',
        action: 'question.answer.published',
        targetType: 'question_answer',
        targetId: answerIds[0],
        requestId: uuid(),
        after: { version: 1 },
      });
      expect((await remove(author.id)).status).toBe(200);
      expect(
        await client.db.query.questionAnswers.findMany({
          where: inArray(schema.questionAnswers.id, answerIds),
        }),
      ).toMatchObject([{ id: answerIds[1], text: 'Private answer 1' }]);
      expect(
        await client.db.query.idempotencyKeys.findMany({
          where: inArray(schema.idempotencyKeys.resultReference, answerIds),
        }),
      ).toMatchObject([{ resultReference: answerIds[1] }]);
      expect(
        await client.db.query.auditLogs.findFirst({
          where: eq(schema.auditLogs.id, auditId),
        }),
      ).toMatchObject({ targetId: null, after: { participantDeleted: true } });

      expect(await (await remove(speaker.id)).json()).toMatchObject({
        accountDeleted: false,
        membershipRetained: true,
      });
      expect(await profileExists(speaker.id)).toBe(false);
      expect(
        await client.db.query.questionAnswers.findFirst({
          where: eq(schema.questionAnswers.id, answerIds[1]!),
        }),
      ).toMatchObject({
        answeredByUserId: speaker.id,
        text: 'Private answer 1',
      });
      expect(
        await client.db.query.eventMemberships.findFirst({
          where: and(
            eq(schema.eventMemberships.eventId, eventId),
            eq(schema.eventMemberships.userId, speaker.id),
          ),
        }),
      ).toMatchObject({ status: activeSpeaker ? 'active' : 'revoked' });
    },
  );

  it('retains historical operational ownership without leaving participant access', async () => {
    const participant = await makeParticipant();
    const batchId = uuid();
    await client.db.insert(schema.ticketImportBatches).values({
      id: batchId,
      eventId,
      source: 'test',
      sourceFilename: 'shared import',
      fileSha256: createHash('sha256').update(batchId).digest('hex'),
      createdBy: participant.id,
    });
    expect(await (await remove(participant.id)).json()).toMatchObject({
      accountDeleted: false,
      membershipRetained: true,
    });
    expect(
      await client.db.query.eventMemberships.findFirst({
        where: and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, participant.id),
        ),
      }),
    ).toMatchObject({ status: 'revoked' });
    expect(
      await loadEventPolicy(client.db, { userId: participant.id }, eventId),
    ).toBeNull();
    expect(
      await client.db.query.ticketImportBatches.findFirst({
        where: eq(schema.ticketImportBatches.id, batchId),
      }),
    ).toBeDefined();
  });

  it('leaves no recipient snapshot or delivery when announcement creation races deletion', async () => {
    const participant = await makeParticipant();
    await client.db
      .insert(schema.eventFeatures)
      .values({ eventId, announcementsEnabled: true })
      .onConflictDoNothing();
    const previewRequest = () =>
      new Request(
        `${origin}/api/v1/admin/events/${eventId}/announcements/preview`,
        {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({
            draft: {
              title: 'Shared announcement',
              bodyText: 'Informace pro účastníky.',
              severity: 'critical',
              audience: { kind: 'event' },
            },
          }),
        },
      );
    const [deletion, preview] = await Promise.all([
      remove(participant.id),
      handleAdminAnnouncementPreview(previewRequest(), eventId, dependencies()),
    ]);
    expect(deletion.status).toBe(200);
    expect(preview.status).toBe(201);
    const body = await preview.json();
    const stored = await client.db.query.announcementPreviews.findFirst({
      where: eq(schema.announcementPreviews.id, body.previewId),
    });
    expect(stored!.recipientUserIds).not.toContain(participant.id);
    expect(stored!.recipientCount).toBe(stored!.recipientUserIds.length);

    const recipient = await makeParticipant();
    const secondPreview = await (
      await handleAdminAnnouncementPreview(
        previewRequest(),
        eventId,
        dependencies(),
      )
    ).json();
    const sendRequest = new Request(
      `${origin}/api/v1/admin/events/${eventId}/announcements/send`,
      {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'idempotency-key': uuid(),
        },
        body: JSON.stringify({
          previewId: secondPreview.previewId,
          previewVersion: secondPreview.previewVersion,
          reason: 'Provozní informace',
        }),
      },
    );
    const [removed, sent] = await Promise.all([
      remove(recipient.id),
      handleAdminAnnouncementSend(sendRequest, eventId, dependencies()),
    ]);
    expect(removed.status).toBe(200);
    expect([200, 201, 409]).toContain(sent.status);
    if (sent.status === 409)
      expect(await sent.json()).toMatchObject({
        code: 'ANNOUNCEMENT_PREVIEW_STALE',
      });
    expect(
      await client.db.query.announcementRecipients.findMany({
        where: eq(schema.announcementRecipients.userId, recipient.id),
      }),
    ).toEqual([]);
    expect(
      await client.db.query.emailDeliveries.findMany({
        where: eq(schema.emailDeliveries.userId, recipient.id),
      }),
    ).toEqual([]);
  });

  it('cannot restore an unredacted audit export during concurrent deletion', async () => {
    const participant = await makeParticipant();
    const exportId = uuid();
    await client.db.insert(schema.auditLogs).values({
      id: uuid(),
      eventId,
      actorId: adminId,
      actorType: 'user',
      action: 'participant.profile_updated',
      targetType: 'participant_profile',
      targetId: participant.id,
      requestId: uuid(),
      reason: 'Test update',
    });
    await client.db.insert(schema.operationalExportRequests).values({
      id: exportId,
      eventId,
      requestedBy: adminId,
      report: 'audit_log',
      format: 'json',
      reason: 'Test export',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60000),
    });
    await client.db.insert(schema.outboxEvents).values({
      id: uuid(),
      eventId,
      type: 'export.requested',
      aggregateType: 'operational_export',
      aggregateId: exportId,
      payload: { exportId, report: 'audit_log' },
      deduplicationKey: exportId,
      availableAt: now,
      createdAt: now,
    });
    const [removed, dispatch] = await Promise.all([
      remove(participant.id),
      dispatchSupportedOutboxOnce(client.db, now),
    ]);
    expect(removed.status).toBe(200);
    expect(dispatch).toBe('delivered');
    const exported = await client.db.query.operationalExportRequests.findFirst({
      where: eq(schema.operationalExportRequests.id, exportId),
    });
    expect(['expired', 'ready']).toContain(exported!.state);
    expect(exported!.content ?? '').not.toContain(participant.id);
    expect(exported!.content ?? '').not.toContain(participant.email);
  });

  it('detaches optional historical references while preserving shared records', async () => {
    const participant = await makeParticipant();
    const other = await makeParticipant();
    const ticketId = await makeTicket(other.id);
    const ticketEventId = uuid();
    await client.db.insert(schema.ticketEvents).values({
      id: ticketEventId,
      eventId,
      ticketId,
      actorType: 'user',
      actorId: participant.id,
      toStatus: 'activated',
      requestId: uuid(),
    });
    await client.db
      .update(schema.eventFeatures)
      .set({ updatedBy: participant.id })
      .where(eq(schema.eventFeatures.eventId, eventId));
    await client.db
      .insert(schema.eventOperationalSettings)
      .values({ eventId, updatedBy: participant.id });
    await client.db
      .update(schema.eventRoles)
      .set({ grantedBy: participant.id })
      .where(
        and(
          eq(schema.eventRoles.eventId, eventId),
          eq(schema.eventRoles.userId, other.id),
        ),
      );
    const assetId = uuid();
    const speakerId = uuid();
    await client.db.insert(schema.assets).values({
      id: assetId,
      eventId,
      ownerUserId: participant.id,
      bucketKey: assetId,
      purpose: 'speaker_photo',
      originalFilename: 'photo.png',
    });
    await client.db.insert(schema.speakerProfiles).values({
      id: speakerId,
      eventId,
      userId: participant.id,
      slug: speakerId,
      firstName: 'Public',
      lastName: 'Speaker',
      sortOrder: 0,
    });
    expect(await (await remove(participant.id)).json()).toMatchObject({
      accountDeleted: true,
      membershipRetained: false,
    });
    expect(
      await client.db.query.ticketEvents.findFirst({
        where: eq(schema.ticketEvents.id, ticketEventId),
      }),
    ).toMatchObject({ ticketId, actorId: null });
    expect(
      await client.db.query.eventFeatures.findFirst({
        where: eq(schema.eventFeatures.eventId, eventId),
      }),
    ).toMatchObject({ updatedBy: null });
    expect(
      await client.db.query.eventOperationalSettings.findFirst({
        where: eq(schema.eventOperationalSettings.eventId, eventId),
      }),
    ).toMatchObject({ updatedBy: null });
    expect(
      await client.db.query.eventRoles.findFirst({
        where: and(
          eq(schema.eventRoles.eventId, eventId),
          eq(schema.eventRoles.userId, other.id),
        ),
      }),
    ).toMatchObject({ grantedBy: null });
    expect(
      await client.db.query.assets.findFirst({
        where: eq(schema.assets.id, assetId),
      }),
    ).toMatchObject({ ownerUserId: null });
    expect(
      await client.db.query.speakerProfiles.findFirst({
        where: eq(schema.speakerProfiles.id, speakerId),
      }),
    ).toMatchObject({ userId: null, firstName: 'Public' });
    expect(await profileExists(other.id)).toBe(true);
  });

  it('requires permission, same origin, matching identity and explicit confirmation', async () => {
    const participant = await makeParticipant();
    expect(
      (
        await handleAdminParticipantDelete(
          request(participant.id),
          eventId,
          participant.id,
          dependencies(null),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handleAdminParticipantDelete(
          request(participant.id),
          eventId,
          participant.id,
          dependencies(participant.id),
        )
      ).status,
    ).toBe(403);
    const wrongOrigin = request(participant.id);
    wrongOrigin.headers.set('origin', 'https://elsewhere.invalid');
    expect(
      (
        await handleAdminParticipantDelete(
          wrongOrigin,
          eventId,
          participant.id,
          dependencies(),
        )
      ).status,
    ).toBe(403);
    for (const body of [
      {
        participantId: participant.id,
        expectedProfileVersion: 1,
        confirm: false,
      },
      { participantId: uuid(), expectedProfileVersion: 1, confirm: true },
    ]) {
      expect(
        (
          await handleAdminParticipantDelete(
            request(participant.id, uuid(), body),
            eventId,
            participant.id,
            dependencies(),
          )
        ).status,
      ).toBe(422);
    }
    const missingKey = request(participant.id);
    missingKey.headers.delete('idempotency-key');
    expect(
      (
        await handleAdminParticipantDelete(
          missingKey,
          eventId,
          participant.id,
          dependencies(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleAdminParticipantDelete(
          request(participant.id),
          otherEventId,
          participant.id,
          dependencies(),
        )
      ).status,
    ).toBe(403);
    expect(await profileExists(participant.id)).toBe(true);
  });

  it('rejects stale versions and archived events without partial deletion', async () => {
    const participant = await makeParticipant();
    const stale = await handleAdminParticipantDelete(
      request(participant.id, uuid(), {
        participantId: participant.id,
        expectedProfileVersion: 2,
        confirm: true,
      }),
      eventId,
      participant.id,
      dependencies(),
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'STALE_VERSION' });
    await client.db
      .update(schema.events)
      .set({ status: 'archived' })
      .where(eq(schema.events.id, eventId));
    try {
      expect((await remove(participant.id)).status).toBe(409);
    } finally {
      await client.db
        .update(schema.events)
        .set({ status: 'live' })
        .where(eq(schema.events.id, eventId));
    }
    expect(await profileExists(participant.id)).toBe(true);
  });

  it('replays concurrent retries exactly once and rejects key reuse', async () => {
    const participant = await makeParticipant();
    const key = uuid();
    const responses = await Promise.all([
      remove(participant.id, key),
      remove(participant.id, key),
    ]);
    const bodies = await Promise.all(
      responses.map((response) => response.json()),
    );
    expect(bodies.map((body) => body.outcome).sort()).toEqual([
      'already_applied',
      'deleted',
    ]);
    expect(bodies[0].audit).toEqual(bodies[1].audit);
    const reused = await handleAdminParticipantDelete(
      request(participant.id, key, {
        participantId: participant.id,
        expectedProfileVersion: 2,
        confirm: true,
      }),
      eventId,
      participant.id,
      dependencies(),
    );
    expect(reused.status).toBe(409);
    expect((await remove(participant.id)).status).toBe(404);
  });

  it('rolls the entire deletion back if a later database operation fails', async () => {
    const participant = await makeParticipant();
    const ticketId = await makeTicket(participant.id);
    let cleanupCompleted = false;
    await expect(
      client.db.transaction(async (tx) => {
        await deleteParticipantData(tx, {
          eventId,
          participantId: participant.id,
          expectedProfileVersion: 1,
          now,
          requestId: uuid(),
        });
        cleanupCompleted = true;
        await tx.execute(sql`select 1 / 0`);
      }),
    ).rejects.toThrow();
    expect(cleanupCompleted).toBe(true);
    expect(await profileExists(participant.id)).toBe(true);
    expect(
      await client.db.query.tickets.findFirst({
        where: eq(schema.tickets.id, ticketId),
      }),
    ).toBeDefined();
    expect(
      (await loadEventPolicy(client.db, { userId: participant.id }, eventId))
        ?.roles,
    ).toEqual(['participant']);
  });
});
