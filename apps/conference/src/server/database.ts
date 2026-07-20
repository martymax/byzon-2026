import { createDatabaseClient } from '@byzon/database';
import { readConferenceEnv } from '@byzon/config';

import { logger } from './logger';

const env = readConferenceEnv(process.env);

export const database = createDatabaseClient({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
  applicationName: 'byzon-conference',
  onUnexpectedError: (error) =>
    logger.error({ err: error }, 'Unexpected idle PostgreSQL client error'),
});
