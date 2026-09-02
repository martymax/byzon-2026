import { createDatabaseClient, schema } from '@byzon/database';
import {
  ticketImportApplyProblemSchema,
  ticketImportApplyResponseSchema,
  ticketImportPreviewResponseSchema,
} from '@byzon/domain/contracts/ticket-import';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SimpleShopTicketSourceSnapshot } from './simpleshop-ticket-source';
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

  const preview = async () => {
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
        sourceAdapter: { fetchPreviewSource: vi.fn(async () => snapshot) },
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
        excluded: 1,
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

  it('returns unchanged rows on the next immutable preview and rejects unauthorized apply', async () => {
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
    expect(response.status).toBe(200);
    expect(
      ticketImportApplyResponseSchema.parse(await response.json()),
    ).toMatchObject({
      outcome: 'applied',
      result: { created: 0, statusChanged: 0, unchanged: 2 },
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
});
