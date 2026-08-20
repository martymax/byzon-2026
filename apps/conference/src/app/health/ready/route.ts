import { headers } from 'next/headers';
import { readConferenceEnv } from '@byzon/config';
import { database } from '@/server/database';
import { logger } from '@/server/logger';
import { redisConnection } from '@/server/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  const requestId = (await headers()).get('x-request-id');
  const env = readConferenceEnv(process.env);
  const [databaseProbe, redisProbe] = await Promise.allSettled([
    database.ping(),
    redisConnection.ping(),
  ]);

  if (databaseProbe.status === 'rejected') {
    logger.warn(
      { err: databaseProbe.reason, requestId },
      'Database readiness check failed',
    );
  }
  const databaseReady = databaseProbe.status === 'fulfilled';
  const redisReady = redisProbe.status === 'fulfilled';
  const status = databaseReady
    ? redisReady
      ? 'ready'
      : 'degraded'
    : 'not_ready';

  return Response.json(
    {
      status,
      service: 'conference',
      environment: env.APP_ENV,
      release: env.RELEASE_SHA,
      requestId,
      dependencies: {
        database: databaseReady ? 'ready' : 'unavailable',
        redis: redisReady ? 'ready' : 'unavailable',
      },
      metrics: {
        redisPingMs: redisReady ? redisProbe.value : null,
      },
    },
    {
      status: databaseReady ? 200 : 503,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
