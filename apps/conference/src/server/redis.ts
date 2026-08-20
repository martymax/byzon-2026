import { readConferenceEnv } from '@byzon/config';
import { createRedisConnection, RedisRateLimitStore } from '@byzon/redis';

import type { AtomicRateLimitStore } from './api/rate-limit';
import { logger } from './logger';

const env = readConferenceEnv(process.env);
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

export const redisConnection = createRedisConnection({
  config: {
    url: env.REDIS_URL,
    family: env.REDIS_FAMILY,
    connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
    commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
  },
  connectionName: 'byzon-conference',
  role: 'web',
  onError: reportRedisError,
  onReady: reportRedisReady,
});

export const rateLimitStore: AtomicRateLimitStore = new RedisRateLimitStore(
  redisConnection,
);
