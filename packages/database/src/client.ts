import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema/index.js';

export interface DatabasePoolOptions {
  connectionString: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  applicationName: string;
  onUnexpectedError: (error: Error) => void;
}

export type Database = NodePgDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export interface DatabaseClient {
  db: Database;
  pool: Pool;
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

export type TransactionOptions = Parameters<Database['transaction']>[1];

const toPoolConfig = (options: DatabasePoolOptions): PoolConfig => ({
  connectionString: options.connectionString,
  max: options.max,
  idleTimeoutMillis: options.idleTimeoutMillis,
  connectionTimeoutMillis: options.connectionTimeoutMillis,
  application_name: options.applicationName,
  allowExitOnIdle: false,
});

export const createDatabaseClient = (
  options: DatabasePoolOptions,
): DatabaseClient => {
  const pool = new Pool(toPoolConfig(options));
  pool.on('error', options.onUnexpectedError);
  const db = drizzle({ client: pool, schema });

  return {
    db,
    pool,
    ping: async () => {
      await db.execute(sql`select 1`);
    },
    close: () => pool.end(),
  };
};

export const withTransaction = async <T>(
  db: Database,
  callback: (transaction: DatabaseTransaction) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> =>
  options ? db.transaction(callback, options) : db.transaction(callback);

export const acquireTransactionLock = async (
  transaction: DatabaseTransaction,
  lockKey: string,
): Promise<void> => {
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );
};
