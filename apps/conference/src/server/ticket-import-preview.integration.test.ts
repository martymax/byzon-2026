import { createDatabaseClient, schema } from '@byzon/database';
import { ticketImportPreviewResponseSchema } from '@byzon/domain/contracts/ticket-import';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { SimpleShopTicketSourceSnapshot } from './simpleshop-ticket-source';
import {
  createDatabaseTicketImportPreviewStore,
  previewSimpleShopTickets,
} from './ticket-import-preview';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const appOrigin = 'http://localhost:3000';

integration('P4-02 SimpleShop preview persistence integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-simpleshop-preview-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const eventSlug = `simpleshop-preview-${eventId}`;
  const adminId = crypto.randomUUID();
  const existingTicketId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const fixedNow = new Date('2026-08-30T18:00:00.000Z');
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
        externalId: '9100001',
        orderExternalId: '9200001',
        sourceStatus: 'paid',
        quantity: 1,
        contactName: 'Existing Participant',
        contactEmail: 'existing@example.test',
        contactCompany: 'Example s.r.o.',
        contactPosition: 'CEO',
        contactPhone: '+420777111222',
        identitySource: 'named_participant',
      },
      {
        sourceRowNumber: 3,
        externalId: '9100002',
        orderExternalId: '9200002',
        sourceStatus: 'paid',
        quantity: 1,
        contactName: 'Single Ticket Buyer',
        contactEmail: 'buyer@example.test',
        contactCompany: null,
        contactPosition: null,
        contactPhone: null,
        identitySource: 'single_paid_ticket_buyer',
      },
      {
        sourceRowNumber: 4,
        externalId: '9100003',
        orderExternalId: '9200003',
        sourceStatus: 'unpaid',
        quantity: 1,
        contactName: 'Unpaid Buyer',
        contactEmail: 'unpaid@example.test',
        contactCompany: null,
        contactPosition: null,
        contactPhone: null,
        identitySource: 'manual_review',
      },
    ],
    snapshotDigest: 'a'.repeat(64),
  };

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: eventSlug,
      name: 'SimpleShop preview integration event',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T16:00:00Z'),
      timezone: 'Europe/Prague',
      status: 'live',
    });
    await client.db.insert(schema.users).values({
      id: adminId,
      name: 'SimpleShop preview admin',
      email: `simpleshop-preview-${adminId}@example.invalid`,
    });
    await client.db.insert(schema.eventMemberships).values({
      eventId,
      userId: adminId,
      status: 'active',
    });
    await client.db.insert(schema.eventRoles).values({
      id: crypto.randomUUID(),
      eventId,
      userId: adminId,
      role: 'organizer_admin',
    });
    await client.db.insert(schema.tickets).values({
      id: existingTicketId,
      eventId,
      externalId: '9100001',
      orderExternalId: '9200001',
      codeHmac: 'b'.repeat(64),
      codeSuffix: 'SAFE01',
      status: 'cancelled',
    });
  });

  afterAll(async () => client.close());

  it('persists only a sanitized preview and leaves tickets unchanged', async () => {
    const response = await previewSimpleShopTickets(
      new Request(
        `${appOrigin}/api/v1/admin/events/${eventId}/ticket-imports/preview`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: appOrigin,
            'x-request-id': requestId,
          },
          body: JSON.stringify({ source: 'simpleshop' }),
        },
      ),
      eventId,
      {
        allowedOrigin: appOrigin,
        getSession: vi.fn(async () => ({ user: { id: adminId } })),
        sourceAdapter: {
          fetchPreviewSource: vi.fn(async () => snapshot),
        },
        store: createDatabaseTicketImportPreviewStore(client.db, {
          currentEventSlug: eventSlug,
        }),
        now: () => fixedNow,
      },
    );

    expect(response.status).toBe(200);
    const body = ticketImportPreviewResponseSchema.parse(await response.json());
    expect(body.rows[0]).toMatchObject({
      contactName: 'Existing Participant',
      contactEmail: 'existing@example.test',
    });
    expect(body.summary).toEqual({
      total: 3,
      new: 1,
      unchanged: 0,
      statusChanged: 0,
      conflict: 1,
      unknown: 1,
    });

    const batch = await client.db.query.ticketImportBatches.findFirst({
      where: and(
        eq(schema.ticketImportBatches.eventId, eventId),
        eq(schema.ticketImportBatches.id, body.previewId),
      ),
    });
    expect(batch).toMatchObject({
      source: 'simpleshop_api',
      status: 'validated',
      rowCount: 3,
      mapping: {
        paid: 'active',
        unpaid: 'unapproved',
        cancelled: 'unapproved',
        refunded: 'not_observed',
        unknown: 'unapproved',
      },
    });

    const rows = await client.db.query.ticketImportRows.findMany({
      where: and(
        eq(schema.ticketImportRows.eventId, eventId),
        eq(schema.ticketImportRows.batchId, body.previewId),
      ),
    });
    expect(rows).toHaveLength(3);
    expect(
      rows.every(({ codeHmac, codeSuffix }) => !codeHmac && !codeSuffix),
    ).toBe(true);
    expect(rows.map(({ sourceStatus }) => sourceStatus).sort()).toEqual([
      'paid',
      'paid',
      'unpaid',
    ]);

    const ticketCounts = await client.db
      .select({ value: count() })
      .from(schema.tickets)
      .where(eq(schema.tickets.eventId, eventId));
    expect(ticketCounts).toEqual([{ value: 1 }]);
    expect(
      await client.db.query.tickets.findFirst({
        where: eq(schema.tickets.id, existingTicketId),
      }),
    ).toMatchObject({
      status: 'cancelled',
      codeHmac: 'b'.repeat(64),
      codeSuffix: 'SAFE01',
    });

    const audit = await client.db.query.auditLogs.findFirst({
      where: and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.targetId, body.previewId),
        eq(schema.auditLogs.action, 'ticket_import.preview_created'),
      ),
    });
    expect(audit?.after).toMatchObject({
      source: 'simpleshop_api',
      productId: 143_958,
      applyAvailable: false,
    });
    expect(JSON.stringify({ batch, rows, audit })).not.toContain('SAFE01');
    expect(JSON.stringify({ batch, rows, audit })).not.toContain(
      'existing@example.test',
    );
  });
});
