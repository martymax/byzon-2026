import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, withTransaction } from './client.js';
import { generateUuidV7 } from './ids.js';
import * as schema from './schema/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('ticket schema integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-ticket-schema-integration-test',
    onUnexpectedError: vi.fn(),
  });
  let primaryEventId: string;
  let isolationEventId: string;

  beforeAll(async () => {
    const rows = await client.db
      .select({ id: schema.events.id, slug: schema.events.slug })
      .from(schema.events);
    primaryEventId = rows.find(({ slug }) => slug === 'byzon-2026')!.id;
    isolationEventId = rows.find(
      ({ slug }) => slug === 'byzon-isolation-test',
    )!.id;
  });

  afterAll(async () => client.close());

  it('rejects an activated ticket without an event member holder', async () => {
    await expect(
      withTransaction(client.db, async (transaction) => {
        await transaction.insert(schema.tickets).values({
          id: generateUuidV7(),
          eventId: primaryEventId,
          codeHmac: 'a'.repeat(64),
          codeSuffix: 'test',
          status: 'activated',
          claimedAt: new Date(),
        });
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'tickets_claim_state_check',
      }),
    });
  });

  it('rejects a cross-event import batch relationship', async () => {
    const rollback = new Error('rollback ticket import probe');
    await expect(
      withTransaction(client.db, async (transaction) => {
        const userId = generateUuidV7();
        const batchId = generateUuidV7();
        await transaction.insert(schema.users).values({
          id: userId,
          name: 'Ticket import test user',
          email: `${userId}@example.invalid`,
        });
        await transaction.insert(schema.eventMemberships).values({
          eventId: primaryEventId,
          userId,
        });
        await transaction.insert(schema.ticketImportBatches).values({
          id: batchId,
          eventId: primaryEventId,
          source: 'integration-test',
          sourceFilename: 'tickets.csv',
          fileSha256: 'b'.repeat(64),
          createdBy: userId,
        });
        await expect(
          transaction.insert(schema.ticketImportRows).values({
            id: generateUuidV7(),
            eventId: isolationEventId,
            batchId,
            rowNumber: 1,
          }),
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            constraint: 'ticket_import_rows_batch_event_fk',
          }),
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('rejects a history actor from another event', async () => {
    const rollback = new Error('rollback ticket history probe');
    await expect(
      withTransaction(client.db, async (transaction) => {
        const actorId = generateUuidV7();
        const ticketId = generateUuidV7();
        await transaction.insert(schema.users).values({
          id: actorId,
          name: 'Cross-event ticket actor',
          email: `${actorId}@example.invalid`,
        });
        await transaction.insert(schema.eventMemberships).values({
          eventId: isolationEventId,
          userId: actorId,
        });
        await transaction.insert(schema.tickets).values({
          id: ticketId,
          eventId: primaryEventId,
          codeHmac: 'c'.repeat(64),
          codeSuffix: 'test',
        });
        await expect(
          transaction.insert(schema.ticketEvents).values({
            id: generateUuidV7(),
            eventId: primaryEventId,
            ticketId,
            actorType: 'organizer_admin',
            actorId,
            toStatus: 'valid',
            requestId: generateUuidV7(),
          }),
        ).rejects.toMatchObject({
          cause: expect.objectContaining({
            constraint: 'ticket_events_actor_membership_event_fk',
          }),
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
