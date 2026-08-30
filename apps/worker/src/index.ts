import pino from 'pino';
import { readWorkerEnv } from '@byzon/config';
import { createDatabaseClient } from '@byzon/database';
import { createRedisConnection } from '@byzon/redis';

import { dispatchSupportedOutboxOnce } from './outbox.js';

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

const REDIS_ERROR_LOG_INTERVAL_MS = 60_000;
let lastRedisErrorLogAt = 0;
let redisWasUnavailable = false;

const reportRedisError = (error: unknown): void => {
  redisWasUnavailable = true;
  const now = Date.now();
  if (now - lastRedisErrorLogAt < REDIS_ERROR_LOG_INTERVAL_MS) return;
  lastRedisErrorLogAt = now;
  logger.warn(
    { errorName: error instanceof Error ? error.name : 'UnknownError' },
    'Redis connection error',
  );
};

const reportRedisReady = (): void => {
  if (!redisWasUnavailable) return;
  redisWasUnavailable = false;
  lastRedisErrorLogAt = 0;
  logger.info('Redis connection recovered');
};

const redis = createRedisConnection({
  config: {
    url: env.REDIS_URL,
    family: env.REDIS_FAMILY,
    connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
    commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
  },
  connectionName: 'byzon-worker',
  role: 'bullmq-worker',
  onError: reportRedisError,
  onReady: reportRedisReady,
});

const [, redisPingMs] = await Promise.all([database.ping(), redis.ping()]);

logger.info(
  {
    dependencies: { database: 'ready', redis: 'ready' },
    metrics: { redisPingMs },
  },
  'Worker skeleton started',
);

let dispatchRunning = false;
const dispatch = async (): Promise<void> => {
  if (dispatchRunning) return;
  dispatchRunning = true;
  try {
    const outcome = await dispatchSupportedOutboxOnce(database.db);
    if (outcome === 'failed') {
      logger.error({ outcome }, 'Outbox event moved to dead letter state');
    }
  } catch (error) {
    logger.warn(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'Outbox dispatch iteration failed',
    );
  } finally {
    dispatchRunning = false;
  }
};
await dispatch();
const dispatchTimer = setInterval(() => void dispatch(), 1_000);
await new Promise<void>((resolve) => {
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Worker skeleton stopped');
    resolve();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
});
clearInterval(dispatchTimer);
await Promise.all([redis.close(), database.close()]);
