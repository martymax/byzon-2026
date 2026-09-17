import { createDatabaseClient, schema } from '@byzon/database';
import {
  ticketImportApplyProblemSchema,
  ticketImportApplyResponseSchema,
  ticketImportPreviewResponseSchema,
} from '@byzon/domain/contracts/ticket-import';
import {
  adminParticipantDetailSchema,
  adminParticipantInviteResponseSchema,
  adminParticipantListResponseSchema,
} from '@byzon/domain/contracts/support';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createSimpleShopTicketSourceAdapter,
  type SimpleShopTicketSourceSnapshot,
} from './simpleshop-ticket-source';
import {
  simpleShopGroupCsv,
  simpleShopGroupEmails,
  simpleShopGroupProduct,
} from '../test/server/simpleshop-group-fixture';
import {
  handleAdminParticipantDetail,
  handleAdminParticipantInvite,
  handleAdminParticipantList,
} from './admin-support';
import { applySimpleShopTicketImport } from './ticket-import-apply';
import {
  createDatabaseTicketImportPreviewStore,
  previewSimpleShopTickets,
} from './ticket-import-preview';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const appOrigin = 'http://localhost:3000';

integration('P4-03 SimpleShop participant apply integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 4,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-simpleshop-apply-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const eventSlug = `simpleshop-apply-${eventId}`;
  const adminId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const fixedNow = new Date('2026-09-02T10:00:00.000Z');
  const snapshot: SimpleShopTicketSourceSnapshot = {
    source: {
      kind: 'simpleshop_api',
      productId: 143_958,
      formKey: '0MnNQ',
      strict: true,
      pageCount: 1,
      sourceRows: 3,
      ticketRows: 3,
      ignoredSummaryRows: 0,
      multipleQuantitySummaryRows: 0,
      observedStatuses: {
        paid: 2,
        unpaid: 1,
        cancelled: 0,
        refunded: 0,
        unknown: 0,
      },
      codeShape: {
        count: 3,
        minByteLength: 6,
        maxByteLength: 6,
        characterClasses: ['digit', 'upper_ascii'],
      },
    },
    records: [
      {
        sourceRowNumber: 2,
        externalId: '9300001',
        orderExternalId: '9400001',
        sourceStatus: 'paid',
        quantity: 1,
        orderTicketCount: 1,
        orderTicketPosition: 1,
        purchasedOn: '2026-08-21',
        discountCoupon: null,
        contactName: 'Nová účastnice',
        contactEmail: 'nova-ucastnice@example.test',
        contactCompany: 'Example s.r.o.',
        contactPosition: 'CEO',
        contactPhone: null,
        identitySource: 'named_participant',
      },
      {
        sourceRowNumber: 3,
        externalId: '9300002',
        orderExternalId: '9400002',
        sourceStatus: 'paid',
        quantity: 1,
        orderTicketCount: 1,
        orderTicketPosition: 1,
        purchasedOn: '2026-08-22',
        discountCoupon: null,
        contactName: 'Jediný kupující',
        contactEmail: 'jediny-kupujici@example.test',
        contactCompany: null,
        contactPosition: null,
        contactPhone: null,
        identitySource: 'single_paid_ticket_buyer',
      },
      {
        sourceRowNumber: 4,
        externalId: '9300003',
        orderExternalId: '9400003',
        sourceStatus: 'unpaid',
        quantity: 1,
        orderTicketCount: 1,
        orderTicketPosition: 1,
        purchasedOn: '2026-08-23',
        discountCoupon: null,
        contactName: 'Nezaplacený kontakt',
        contactEmail: 'nezaplaceno@example.test',
        contactCompany: null,
        contactPosition: null,
        contactPhone: null,
        identitySource: 'manual_review',
      },
    ],
    snapshotDigest: 'c'.repeat(64),
  };

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: eventSlug,
      name: 'SimpleShop apply integration event',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T16:00:00Z'),
      timezone: 'Europe/Prague',
      status: 'activation_open',
    });
    await client.db.insert(schema.users).values([
      {
        id: adminId,
        name: 'SimpleShop apply admin',
        email: `simpleshop-apply-${adminId}@example.invalid`,
      },
      {
        id: participantId,
        name: 'Unauthorized participant',
        email: `simpleshop-participant-${participantId}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values([
      { eventId, userId: adminId, status: 'active' },
      { eventId, userId: participantId, status: 'active' },
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
    ]);
  });

  afterAll(async () => client.close());

  const preview = async (currentSnapshot = snapshot) => {
    const response = await previewSimpleShopTickets(
      new Request(
        `${appOrigin}/api/v1/admin/events/${eventId}/ticket-imports/preview`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: appOrigin,
            'x-request-id': crypto.randomUUID(),
          },
          body: JSON.stringify({ source: 'simpleshop' }),
        },
      ),
      eventId,
      {
        allowedOrigin: appOrigin,
        getSession: vi.fn(async () => ({ user: { id: adminId } })),
        sourceAdapter: {
          fetchPreviewSource: vi.fn(async () => currentSnapshot),
        },
        store: createDatabaseTicketImportPreviewStore(client.db, {
          currentEventSlug: eventSlug,
        }),
        now: () => fixedNow,
      },
    );
    expect(response.status).toBe(200);
    return ticketImportPreviewResponseSchema.parse(await response.json());
  };

  const applyRequest = (
    body: object,
    key: string,
    actorId = adminId,
    now = fixedNow,
    currentSnapshot = snapshot,
  ) =>
    applySimpleShopTicketImport(
      new Request(
        `${appOrigin}/api/v1/admin/events/${eventId}/ticket-imports/apply`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': key,
            origin: appOrigin,
            'x-request-id': crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
      ),
      eventId,
      {
        db: client.db,
        allowedOrigin: appOrigin,
        currentEventSlug: eventSlug,
        getSession: vi.fn(async () => ({ user: { id: actorId } })),
        sourceAdapter: {
          fetchPreviewSource: vi.fn(async () => currentSnapshot),
        },
        now: () => now,
      },
    );

  it('atomically creates eligible identities and memberships without credentials or email', async () => {
    const snapshotPreview = await preview();
    expect(snapshotPreview.summary).toEqual({
      total: 3,
      new: 2,
      unchanged: 0,
      statusChanged: 0,
      excluded: 1,
      conflict: 0,
      unknown: 0,
    });
    const body = {
      eventId,
      previewId: snapshotPreview.previewId,
      previewVersion: snapshotPreview.previewVersion,
      expectedImpact: snapshotPreview.summary,
      selectedRowIds: snapshotPreview.rows
        .filter(({ status }) => status === 'new')
        .map(({ rowId }) => rowId),
      reason: 'Potvrzený import dvou uhrazených účastníků.',
    };
    const response = await applyRequest(body, 'simpleshop-apply-clean-0001');
    expect(response.status).toBe(200);
    const applied = ticketImportApplyResponseSchema.parse(
      await response.json(),
    );
    expect(applied).toMatchObject({
      eventId,
      previewId: snapshotPreview.previewId,
      outcome: 'applied',
      result: { created: 2, statusChanged: 0, unchanged: 0 },
    });

    const imported = await client.db.query.ticketSourceParticipants.findMany({
      where: eq(schema.ticketSourceParticipants.eventId, eventId),
    });
    expect(imported).toHaveLength(2);
    expect(imported.map(({ externalId }) => externalId).sort()).toEqual([
      '9300001',
      '9300002',
    ]);
    const importedUsers = await client.db
      .select({ email: schema.users.email })
      .from(schema.users)
      .innerJoin(
        schema.eventMemberships,
        and(
          eq(schema.eventMemberships.userId, schema.users.id),
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.status, 'active'),
        ),
      );
    expect(importedUsers.map(({ email }) => email)).toEqual(
      expect.arrayContaining([
        'nova-ucastnice@example.test',
        'jediny-kupujici@example.test',
      ]),
    );
    const importedProfiles = await client.db.query.participantProfiles.findMany(
      {
        where: eq(schema.participantProfiles.eventId, eventId),
      },
    );
    expect(importedProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          firstName: 'Nová',
          lastName: 'účastnice',
          contactEmail: 'nova-ucastnice@example.test',
          company: 'Example s.r.o.',
          jobTitle: 'CEO',
        }),
        expect.objectContaining({
          firstName: 'Jediný',
          lastName: 'kupující',
          contactEmail: 'jediny-kupujici@example.test',
        }),
      ]),
    );
    const participantListResponse = await handleAdminParticipantList(
      new Request(
        `${appOrigin}/api/v1/admin/events/${eventId}/participants/list`,
        {
          method: 'POST',
          headers: { origin: appOrigin, 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      ),
      eventId,
      {
        db: client.db,
        allowedOrigin: appOrigin,
        currentEventSlug: eventSlug,
        getSession: vi.fn(async () => ({ user: { id: adminId } })),
      },
    );
    expect(participantListResponse.status).toBe(200);
    const participantList = adminParticipantListResponseSchema.parse(
      await participantListResponse.json(),
    );
    expect(participantList.items).toHaveLength(2);
    expect(participantList.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contactEmail: 'nova-ucastnice@example.test',
          ticketState: 'active',
          invitation: { status: 'not_sent', lastSentAt: null },
          availableActions: [],
        }),
      ]),
    );
    const invitedParticipant = participantList.items.find(
      ({ contactEmail }) => contactEmail === 'nova-ucastnice@example.test',
    )!;
    const sendParticipantInvitation = vi.fn(async () => undefined);
    const invitationResponse = await handleAdminParticipantInvite(
      new Request(
        `${appOrigin}/api/v1/admin/events/${eventId}/participants/${invitedParticipant.participantId}/invite`,
        {
          method: 'POST',
          headers: {
            origin: appOrigin,
            'content-type': 'application/json',
            'idempotency-key': 'simpleshop-participant-invite-0001',
          },
          body: JSON.stringify({
            participantId: invitedParticipant.participantId,
          }),
        },
      ),
      eventId,
      invitedParticipant.participantId,
      {
        db: client.db,
        allowedOrigin: appOrigin,
        currentEventSlug: eventSlug,
        getSession: vi.fn(async () => ({ user: { id: adminId } })),
        now: () => fixedNow,
        sendParticipantInvitation,
      },
    );
    expect(invitationResponse.status).toBe(200);
    expect(
      adminParticipantInviteResponseSchema.parse(
        await invitationResponse.json(),
      ),
    ).toMatchObject({
      participantId: invitedParticipant.participantId,
      invitation: { status: 'sent', lastSentAt: fixedNow.toISOString() },
    });
    expect(sendParticipantInvitation).toHaveBeenCalledWith({
      email: 'nova-ucastnice@example.test',
      recipientName: 'Nová účastnice',
    });
    const detailResponse = await handleAdminParticipantDetail(
      new Request(
        `${appOrigin}/api/v1/admin/events/${eventId}/participants/${invitedParticipant.participantId}`,
      ),
      eventId,
      invitedParticipant.participantId,
      {
        db: client.db,
        allowedOrigin: appOrigin,
        currentEventSlug: eventSlug,
        getSession: vi.fn(async () => ({ user: { id: adminId } })),
      },
    );
    expect(detailResponse.status).toBe(200);
    expect(
      adminParticipantDetailSchema.parse(await detailResponse.json()),
    ).toMatchObject({
      contactEmail: 'nova-ucastnice@example.test',
      ticket: { source: 'simpleshop', state: 'active', claimedAt: null },
      invitation: { status: 'sent' },
    });
    const ticketCount = await client.db
      .select({ value: count() })
      .from(schema.tickets)
      .where(eq(schema.tickets.eventId, eventId));
    expect(ticketCount[0]?.value).toBe(0);
    const persistedRows = await client.db.query.ticketImportRows.findMany({
      where: eq(schema.ticketImportRows.batchId, snapshotPreview.previewId),
    });
    expect(
      persistedRows.every(
        ({ codeHmac, codeSuffix }) => codeHmac === null && codeSuffix === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(persistedRows)).not.toContain('@example.test');
    const audit = await client.db.query.auditLogs.findFirst({
      where: and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.action, 'ticket_import.applied'),
        eq(schema.auditLogs.targetId, snapshotPreview.previewId),
      ),
    });
    expect(audit).toMatchObject({
      id: applied.audit.auditId,
      reason: body.reason,
      after: expect.objectContaining({
        created: 2,
        selectedCount: 2,
        selectedRowIds: body.selectedRowIds,
        skipped: 1,
        emailSent: false,
        ticketCredentialCreated: false,
      }),
    });
    expect(JSON.stringify(audit)).not.toContain('@example.test');

    const replay = await applyRequest(body, 'simpleshop-apply-clean-0001');
    expect(replay.status).toBe(200);
    expect(
      ticketImportApplyResponseSchema.parse(await replay.json()),
    ).toMatchObject({ outcome: 'already_applied', audit: applied.audit });
    const auditCount = await client.db
      .select({ value: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, eventId),
          eq(schema.auditLogs.action, 'ticket_import.applied'),
          eq(schema.auditLogs.targetId, snapshotPreview.previewId),
        ),
      );
    expect(auditCount[0]?.value).toBe(1);
  });

  it('returns unchanged rows on the next immutable preview and refuses to re-import them', async () => {
    const nextPreview = await preview();
    expect(nextPreview.summary).toMatchObject({
      new: 0,
      unchanged: 2,
      excluded: 1,
      conflict: 0,
      unknown: 0,
    });
    const body = {
      eventId,
      previewId: nextPreview.previewId,
      previewVersion: nextPreview.previewVersion,
      expectedImpact: nextPreview.summary,
      selectedRowIds: [nextPreview.rows[0]!.rowId],
      reason: 'Kontrolní opakování beze změny.',
    };
    const denied = await applyRequest(
      body,
      'simpleshop-apply-denied-0001',
      participantId,
    );
    expect(denied.status).toBe(403);
    expect(ticketImportApplyProblemSchema.parse(await denied.json()).code).toBe(
      'EVENT_ACCESS_DENIED',
    );

    const response = await applyRequest(body, 'simpleshop-apply-repeat-0001');
    expect(response.status).toBe(409);
    expect(
      ticketImportApplyProblemSchema.parse(await response.json()),
    ).toMatchObject({
      code: 'IMPORT_PREVIEW_BLOCKED',
    });
  });

  it('rejects an expired preview without any participant writes', async () => {
    const stalePreview = await preview();
    const response = await applyRequest(
      {
        eventId,
        previewId: stalePreview.previewId,
        previewVersion: stalePreview.previewVersion,
        expectedImpact: stalePreview.summary,
        selectedRowIds: [stalePreview.rows[0]!.rowId],
        reason: 'Tento preview je záměrně po expiraci.',
      },
      'simpleshop-apply-stale-0001',
      adminId,
      new Date(fixedNow.getTime() + 21 * 60_000),
    );
    expect(response.status).toBe(409);
    expect(
      ticketImportApplyProblemSchema.parse(await response.json()),
    ).toMatchObject({
      code: 'IMPORT_PREVIEW_STALE',
      currentPreviewVersion: 1,
    });
  });

  it('rejects a source identity change after the immutable preview', async () => {
    const stalePreview = await preview();
    const changedSnapshot: SimpleShopTicketSourceSnapshot = {
      ...snapshot,
      records: snapshot.records.map((record, index) =>
        index === 0
          ? { ...record, contactEmail: 'changed@example.test' }
          : record,
      ),
      snapshotDigest: 'd'.repeat(64),
    };
    const response = await applyRequest(
      {
        eventId,
        previewId: stalePreview.previewId,
        previewVersion: stalePreview.previewVersion,
        expectedImpact: stalePreview.summary,
        selectedRowIds: [stalePreview.rows[0]!.rowId],
        reason: 'Zdroj se po náhledu změnil.',
      },
      'simpleshop-apply-source-stale-0001',
      adminId,
      fixedNow,
      changedSnapshot,
    );

    expect(response.status).toBe(409);
    expect(
      ticketImportApplyProblemSchema.parse(await response.json()),
    ).toMatchObject({
      code: 'IMPORT_PREVIEW_STALE',
      currentPreviewVersion: 1,
    });
  });

  it('imports all five named group participants, blocks shared emails and is idempotent', async () => {
    const groupSnapshot = (emails = simpleShopGroupEmails) =>
      createSimpleShopTicketSourceAdapter({
        email: 'api@example.test',
        apiKey: 'synthetic-key',
        fetch: async (input) =>
          new Response(
            JSON.stringify(
              new URL(String(input)).pathname === '/2.0/product/143958/'
                ? simpleShopGroupProduct
                : { csv: simpleShopGroupCsv(emails) },
            ),
            { headers: { 'content-type': 'application/json' } },
          ),
      }).fetchPreviewSource();
    const shared = await groupSnapshot([
      simpleShopGroupEmails[0]!,
      simpleShopGroupEmails[0]!,
      ...simpleShopGroupEmails.slice(2),
    ]);
    const sharedPreview = await preview(shared);
    expect(sharedPreview.summary).toMatchObject({ new: 4, conflict: 1 });
    const bodyFor = (value: typeof sharedPreview) => ({
      eventId,
      previewId: value.previewId,
      previewVersion: value.previewVersion,
      expectedImpact: value.summary,
      selectedRowIds: value.rows.map((row) => row.rowId),
      reason: 'Import všech pěti účastníků jedné hromadné objednávky.',
    });
    const blocked = await applyRequest(
      bodyFor(sharedPreview),
      'simpleshop-group-shared-0001',
      adminId,
      fixedNow,
      shared,
    );
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({
      code: 'IMPORT_PREVIEW_BLOCKED',
    });
    const importedGroup = () =>
      client.db.query.ticketSourceParticipants.findMany({
        where: and(
          eq(schema.ticketSourceParticipants.eventId, eventId),
          eq(schema.ticketSourceParticipants.orderExternalId, '9500001'),
        ),
      });
    expect(await importedGroup()).toHaveLength(0);

    const valid = await groupSnapshot();
    const validPreview = await preview(valid);
    expect(validPreview.summary).toMatchObject({
      total: 5,
      new: 5,
      conflict: 0,
    });
    const body = bodyFor(validPreview);
    const response = await applyRequest(
      body,
      'simpleshop-group-five-0001',
      adminId,
      fixedNow,
      valid,
    );
    expect(response.status).toBe(200);
    const applied = await response.json();
    expect(applied).toMatchObject({
      result: { created: 5, statusChanged: 0, unchanged: 0 },
    });
    const imported = await importedGroup();
    expect(imported).toHaveLength(5);
    expect(new Set(imported.map((row) => row.userId)).size).toBe(5);
    for (const [index, email] of simpleShopGroupEmails.entries()) {
      const user = await client.db.query.users.findFirst({
        where: eq(schema.users.email, email),
      });
      expect(user).toMatchObject({
        name: `Účastník ${index + 1} Skupiny`,
        email,
      });
      expect(imported).toContainEqual(
        expect.objectContaining({
          userId: user!.id,
          externalId: String(9_500_010 + index),
        }),
      );
      const profile = await client.db.query.participantProfiles.findFirst({
        where: and(
          eq(schema.participantProfiles.eventId, eventId),
          eq(schema.participantProfiles.userId, user!.id),
        ),
      });
      expect(profile).toMatchObject({
        contactEmail: email,
        company: `Firma ${index + 1}`,
        jobTitle: `Pozice ${index + 1}`,
        phone: `+42077711122${index + 1}`,
      });
      const membership = await client.db.query.eventMemberships.findFirst({
        where: and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, user!.id),
        ),
      });
      expect(membership?.status).toBe('active');
    }
    const replay = await applyRequest(
      body,
      'simpleshop-group-five-0001',
      adminId,
      fixedNow,
      valid,
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      ...applied,
      outcome: 'already_applied',
    });
    expect(await importedGroup()).toHaveLength(5);
    expect((await preview(valid)).summary).toMatchObject({
      total: 5,
      new: 0,
      unchanged: 5,
      conflict: 0,
    });
  });

  it('repairs historical group assignments after contact correction and preserves the original account and reservation', async () => {
    const emails = Array.from(
      { length: 5 },
      (_, i) => `history-${i}-${eventId}@example.test`,
    );
    const corrected = await createSimpleShopTicketSourceAdapter({
      email: 'api@example.test',
      apiKey: 'synthetic-key',
      fetch: async (input) =>
        new Response(
          JSON.stringify(
            new URL(String(input)).pathname === '/2.0/product/143958/'
              ? simpleShopGroupProduct
              : { csv: simpleShopGroupCsv(emails, '9600001', 9_600_010) },
          ),
          { headers: { 'content-type': 'application/json' } },
        ),
    }).fetchPreviewSource();
    const originalUserId = crypto.randomUUID();
    const originalBatchId = crypto.randomUUID();
    await client.db.insert(schema.users).values({
      id: originalUserId,
      email: emails[0]!,
      name: 'Původní účastník',
      emailVerified: true,
    });
    await client.db
      .insert(schema.eventMemberships)
      .values({ eventId, userId: originalUserId, status: 'active' });
    await client.db.insert(schema.eventRoles).values({
      id: crypto.randomUUID(),
      eventId,
      userId: originalUserId,
      role: 'participant',
    });
    await client.db.insert(schema.participantProfiles).values({
      eventId,
      userId: originalUserId,
      firstName: 'Původní',
      lastName: 'Účastník',
      contactEmail: emails[0]!,
      company: 'Ručně upravená firma',
      bio: 'Vlastní profil',
      onboardingCompletedAt: fixedNow,
    });
    await client.db.insert(schema.ticketImportBatches).values({
      id: originalBatchId,
      eventId,
      source: 'simpleshop_api',
      sourceFilename: 'historical-group',
      fileSha256: 'e'.repeat(64),
      status: 'applied',
      rowCount: 5,
      createdBy: adminId,
      appliedAt: fixedNow,
    });
    await client.db.insert(schema.ticketSourceParticipants).values(
      corrected.records.map((record) => ({
        id: crypto.randomUUID(),
        eventId,
        externalId: record.externalId,
        orderExternalId: record.orderExternalId,
        userId: originalUserId,
        sourceStatus: 'paid',
        importBatchId: originalBatchId,
      })),
    );
    const dayId = crypto.randomUUID(),
      sessionId = crypto.randomUUID(),
      reservationId = crypto.randomUUID();
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Pátek',
      sortOrder: 0,
    });
    await client.db.insert(schema.programSessions).values({
      id: sessionId,
      eventId,
      dayId,
      slug: 'historical-reservation',
      title: 'Původní rezervace',
      startsAt: new Date('2026-09-18T09:00:00Z'),
      endsAt: new Date('2026-09-18T10:00:00Z'),
      sortOrder: 0,
    });
    await client.db.insert(schema.reservations).values({
      id: reservationId,
      eventId,
      sessionId,
      userId: originalUserId,
      source: 'participant',
    });
    const originalUser = await client.db.query.users.findFirst({
      where: eq(schema.users.id, originalUserId),
    });
    const originalProfile = await client.db.query.participantProfiles.findFirst(
      {
        where: and(
          eq(schema.participantProfiles.eventId, eventId),
          eq(schema.participantProfiles.userId, originalUserId),
        ),
      },
    );
    const originalReservation = await client.db.query.reservations.findFirst({
      where: eq(schema.reservations.id, reservationId),
    });
    const bodyFor = (p: Awaited<ReturnType<typeof preview>>) => ({
      eventId,
      previewId: p.previewId,
      previewVersion: p.previewVersion,
      expectedImpact: p.summary,
      selectedRowIds: p.rows
        .filter((row) => row.status === 'new')
        .map((row) => row.rowId),
      reason: 'Doplnění vlastních e-mailů historicky sloučené skupiny.',
    });
    const stale = await preview(corrected);
    expect(stale.summary).toMatchObject({
      total: 5,
      new: 4,
      unchanged: 1,
      conflict: 0,
    });
    expect(
      stale.rows
        .filter((row) => row.status === 'new')
        .map((row) => row.identityRepair),
    ).toEqual(
      Array.from({ length: 4 }, () => ({ previousContactEmail: emails[0] })),
    );
    const saved = await client.db.query.ticketImportBatches.findFirst({
      where: eq(schema.ticketImportBatches.id, stale.previewId),
    });
    expect(
      Object.keys(saved!.mapping).filter((key) =>
        key.startsWith('identity_repair:'),
      ),
    ).toHaveLength(4);
    expect(JSON.stringify(saved!.mapping)).not.toContain(emails[0]);
    await client.db
      .update(schema.ticketSourceParticipants)
      .set({ version: 2 })
      .where(
        and(
          eq(schema.ticketSourceParticipants.eventId, eventId),
          eq(schema.ticketSourceParticipants.externalId, '9600011'),
        ),
      );
    const staleResult = await applyRequest(
      bodyFor(stale),
      'historical-stale-reference',
      adminId,
      fixedNow,
      corrected,
    );
    expect(staleResult.status).toBe(409);
    expect(await staleResult.json()).toMatchObject({
      code: 'IMPORT_PREVIEW_STALE',
    });
    const emailStale = await preview(corrected);
    await client.db
      .update(schema.users)
      .set({ email: `changed-${eventId}@example.test` })
      .where(eq(schema.users.id, originalUserId));
    const emailStaleResult = await applyRequest(
      bodyFor(emailStale),
      'historical-stale-email',
      adminId,
      fixedNow,
      corrected,
    );
    expect(emailStaleResult.status).toBe(409);
    expect(await emailStaleResult.json()).toMatchObject({
      code: 'IMPORT_PREVIEW_STALE',
    });
    await client.db
      .update(schema.users)
      .set({ email: emails[0]! })
      .where(eq(schema.users.id, originalUserId));
    expect(
      await client.db.query.users.findFirst({
        where: eq(schema.users.email, emails[1]!),
      }),
    ).toBeUndefined();

    const ready = await preview(corrected);
    const response = await applyRequest(
      bodyFor(ready),
      'historical-repair-group',
      adminId,
      fixedNow,
      corrected,
    );
    expect(response.status).toBe(200);
    const applied = await response.json();
    expect(applied).toMatchObject({
      result: { created: 4, statusChanged: 0, unchanged: 0 },
    });
    const refs = await client.db.query.ticketSourceParticipants.findMany({
      where: and(
        eq(schema.ticketSourceParticipants.eventId, eventId),
        eq(schema.ticketSourceParticipants.orderExternalId, '9600001'),
      ),
    });
    expect(refs).toHaveLength(5);
    expect(new Set(refs.map((row) => row.userId)).size).toBe(5);
    for (const [index, email] of emails.entries()) {
      const user = await client.db.query.users.findFirst({
        where: eq(schema.users.email, email),
      });
      expect(refs).toContainEqual(
        expect.objectContaining({
          externalId: String(9_600_010 + index),
          userId: user!.id,
        }),
      );
      const profile = await client.db.query.participantProfiles.findFirst({
        where: and(
          eq(schema.participantProfiles.eventId, eventId),
          eq(schema.participantProfiles.userId, user!.id),
        ),
      });
      expect(profile?.contactEmail).toBe(email);
    }
    expect(
      await client.db.query.users.findFirst({
        where: eq(schema.users.id, originalUserId),
      }),
    ).toEqual(originalUser);
    expect(
      await client.db.query.participantProfiles.findFirst({
        where: and(
          eq(schema.participantProfiles.eventId, eventId),
          eq(schema.participantProfiles.userId, originalUserId),
        ),
      }),
    ).toEqual(originalProfile);
    expect(
      await client.db.query.reservations.findFirst({
        where: eq(schema.reservations.id, reservationId),
      }),
    ).toEqual(originalReservation);
    const audit = await client.db.query.auditLogs.findMany({
      where: and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.action, 'ticket_import.participant_reassigned'),
      ),
    });
    expect(audit).toHaveLength(4);
    expect(audit.every((row) => row.before?.userId === originalUserId)).toBe(
      true,
    );
    const replay = await applyRequest(
      bodyFor(ready),
      'historical-repair-group',
      adminId,
      fixedNow,
      corrected,
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      ...applied,
      outcome: 'already_applied',
    });
    const again = await preview(corrected);
    expect(again.summary).toMatchObject({ new: 0, unchanged: 5, conflict: 0 });
    expect(again.rows.every((row) => !row.identityRepair)).toBe(true);
  });
  it('imports a known group contact, completes remaining identity, links an existing account and preserves the mapping', async () => {
    const group: SimpleShopTicketSourceSnapshot = {
      ...snapshot,
      snapshotDigest: 'd'.repeat(64),
      records: snapshot.records.map((record, index) => ({
        ...record,
        externalId: `970001${index}`,
        orderExternalId: '9800010',
        orderTicketCount: 3,
        orderTicketPosition: index + 1,
        contactEmail: 'known-group-contact@example.test',
        identitySource: index === 0 ? 'group_ticket_contact' : 'manual_review',
      })),
    };
    const first = await preview(group);
    expect(first.summary).toMatchObject({ new: 1, conflict: 1, excluded: 1 });
    const bodyFor = (value: typeof first, rowIndex: number) => ({
      eventId,
      previewId: value.previewId,
      previewVersion: value.previewVersion,
      expectedImpact: value.summary,
      selectedRowIds: [value.rows[rowIndex]!.rowId],
      reason: 'Doplnění účastníků skupinové objednávky.',
    });
    expect(
      (
        await applyRequest(
          bodyFor(first, 0),
          'group-completion-first',
          adminId,
          fixedNow,
          group,
        )
      ).status,
    ).toBe(200);
    const second = await preview(group);
    expect(second.rows[0]!.status).toBe('unchanged');
    expect(second.rows[1]!.status).toBe('conflict');
    expect(
      (
        await applyRequest(
          bodyFor(second, 1),
          'group-completion-missing',
          adminId,
          fixedNow,
          group,
        )
      ).status,
    ).toBe(409);
    const details = {
      rowId: second.rows[1]!.rowId,
      contactName: 'Doplněný účastník',
      contactEmail: 'known-group-contact@example.test',
      contactCompany: null,
      contactPosition: null,
      contactPhone: null,
    };
    expect(
      (
        await applyRequest(
          { ...bodyFor(second, 1), participantDetails: [details] },
          'group-completion-duplicate',
          adminId,
          fixedNow,
          group,
        )
      ).status,
    ).toBe(409);
    const body = {
      ...bodyFor(second, 1),
      participantDetails: [
        {
          ...details,
          contactEmail: `simpleshop-participant-${participantId}@example.invalid`,
        },
      ],
    };
    const applied = await applyRequest(
      body,
      'group-completion-success',
      adminId,
      fixedNow,
      group,
    );
    expect(applied.status).toBe(200);
    const reference = await client.db.query.ticketSourceParticipants.findFirst({
      where: and(
        eq(schema.ticketSourceParticipants.eventId, eventId),
        eq(schema.ticketSourceParticipants.externalId, '9700011'),
      ),
    });
    expect(reference?.userId).toBe(participantId);
    expect(
      (
        await applyRequest(
          body,
          'group-completion-success',
          adminId,
          fixedNow,
          group,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await applyRequest(
          {
            ...body,
            participantDetails: [
              {
                ...body.participantDetails[0]!,
                contactEmail: 'changed@example.test',
              },
            ],
          },
          'group-completion-changed-replay',
          adminId,
          fixedNow,
          group,
        )
      ).status,
    ).toBe(409);
    const third = await preview(group);
    expect(third.summary).toMatchObject({
      unchanged: 2,
      conflict: 0,
      excluded: 1,
    });
    expect(third.rows[1]).toMatchObject({
      identitySource: 'imported_participant',
      contactEmail: body.participantDetails[0]!.contactEmail,
    });
    expect(
      (
        await applyRequest(
          {
            ...bodyFor(third, 2),
            participantDetails: [{ ...details, rowId: third.rows[2]!.rowId }],
          },
          'group-completion-unpaid',
          adminId,
          fixedNow,
          group,
        )
      ).status,
    ).toBe(409);
  });
});
