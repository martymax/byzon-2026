import pino from 'pino';
import { readWorkerEnv } from '@byzon/config';
import { createDatabaseClient } from '@byzon/database';

const env = readWorkerEnv(process.env);
const logger = pino({
  level: env.LOG_LEVEL,
  base: {
    service: 'worker',
    environment: env.APP_ENV,
    release: env.RELEASE_SHA,
  },
  redact: {
    paths: [
      '*.email',
      '*.phone',
      '*.token',
      '*.code',
      '*.password',
      '*.secret',
      '*.message',
      '*.profile',
    ],
    censor: '[REDACTED]',
  },
});

const database = createDatabaseClient({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: env.DATABASE_CONNECT_TIMEOUT_MS,
  applicationName: 'byzon-worker',
  onUnexpectedError: (error) =>
    logger.error({ err: error }, 'Unexpected idle PostgreSQL client error'),
});

await database.ping();

logger.info('Worker skeleton started');

const keepAlive = setInterval(() => undefined, 60_000);
await new Promise<void>((resolve) => {
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Worker skeleton stopped');
    resolve();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
});
clearInterval(keepAlive);
await database.close();
