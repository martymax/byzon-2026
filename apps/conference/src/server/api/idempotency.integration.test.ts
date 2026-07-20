import { and, eq } from 'drizzle-orm';
import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
} from './idempotency';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('idempotency integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-idempotency-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7();
  const userId = generateUuidV7();

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: `idempotency-${eventId}`,
      name: 'Idempotency integration event',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T16:30:00Z'),
      timezone: 'Europe/Prague',
    });
    await client.db.insert(schema.users).values({
      id: userId,
      name: 'Idempotency integration user',
      email: `idempotency-${userId}@example.invalid`,
    });
  });

  beforeEach(async () => {
    await client.db
      .delete(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.eventId, eventId));
  });

  afterAll(async () => {
    await client.db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.close();
  });

  const input = (overrides: Record<string, unknown> = {}) => ({
    eventId,
    actorId: userId,
    scope: 'ticket.claim',
    key: 'claim-request-123456',
    requestHash: hashIdempotencyRequest({
      method: 'POST',
      path: `/api/v1/events/${eventId}/tickets/claim`,
      body: '{"code":"masked"}',
    }),
    ttlMs: 60_000,
    ...overrides,
  });

  it('executes concurrent retries once and replays the stored response', async () => {
    const resultReference = generateUuidV7();
    const operation = vi.fn(async () => ({
      status: 201,
      body: { state: 'activated', resultReference },
      resultReference,
    }));

    const results = await Promise.all([
      executeIdempotentMutation(client.db, input(), operation),
      executeIdempotentMutation(client.db, input(), operation),
    ]);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(results.map(({ replayed }) => replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0]!.body).toEqual(results[1]!.body);

    const rows = await client.db
      .select()
      .from(schema.idempotencyKeys)
      .where(
        and(
          eq(schema.idempotencyKeys.eventId, eventId),
          eq(schema.idempotencyKeys.actorId, userId),
          eq(schema.idempotencyKeys.scope, 'ticket.claim'),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      responseStatus: 201,
      resultReference,
      responseBody: { state: 'activated', resultReference },
    });
    expect(rows[0]!.key).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0]!.key).not.toBe('claim-request-123456');
  });

  it('rejects reuse with different request bytes', async () => {
    await executeIdempotentMutation(client.db, input(), async () => ({
      status: 200,
      body: { state: 'complete' },
    }));
    const reusedOperation = vi.fn();

    await expect(
      executeIdempotentMutation(
        client.db,
        input({ requestHash: 'a'.repeat(64) }),
        reusedOperation,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(reusedOperation).not.toHaveBeenCalled();
  });

  it('rolls back the key when the business operation fails', async () => {
    await expect(
      executeIdempotentMutation(client.db, input(), async () => {
        throw new Error('domain failure');
      }),
    ).rejects.toThrow('domain failure');

    const rows = await client.db
      .select({ id: schema.idempotencyKeys.id })
      .from(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.eventId, eventId));
    expect(rows).toEqual([]);
  });

  it('allows a new payload after the previous key expires', async () => {
    await executeIdempotentMutation(
      client.db,
      input({ now: new Date('2026-07-20T12:00:00Z'), ttlMs: 1_000 }),
      async () => ({ status: 200, body: { version: 1 } }),
    );

    await expect(
      executeIdempotentMutation(
        client.db,
        input({
          now: new Date('2026-07-20T12:00:02Z'),
          requestHash: 'b'.repeat(64),
          ttlMs: 1_000,
        }),
        async () => ({ status: 200, body: { version: 2 } }),
      ),
    ).resolves.toMatchObject({ replayed: false, body: { version: 2 } });
  });
});
