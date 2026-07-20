import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import {
  acquireTransactionLock,
  createDatabaseClient,
  withTransaction,
} from './client.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('database client integration', () => {
  it('commits, rolls back, and releases pooled clients', async () => {
    const client = createDatabaseClient({
      connectionString: databaseUrl!,
      max: 1,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 1_000,
      applicationName: 'byzon-integration-test',
      onUnexpectedError: vi.fn(),
    });

    await client.db.execute(
      sql`create temporary table transaction_probe (value integer)`,
    );
    await withTransaction(
      client.db,
      async (transaction) => {
        await acquireTransactionLock(transaction, 'integration-probe');
        await transaction.execute(
          sql`insert into transaction_probe values (1)`,
        );
      },
      { isolationLevel: 'serializable' },
    );

    await expect(
      withTransaction(client.db, async (transaction) => {
        await transaction.execute(
          sql`insert into transaction_probe values (2)`,
        );
        throw new Error('rollback probe');
      }),
    ).rejects.toThrow('rollback probe');

    const result = await client.db.execute<{ value: number }>(
      sql`select value from transaction_probe order by value`,
    );
    expect(result.rows).toEqual([{ value: 1 }]);
    await client.close();
    expect(client.pool.ended).toBe(true);
  });
});
