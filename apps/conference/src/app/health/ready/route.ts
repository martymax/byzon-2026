import { headers } from 'next/headers';
import { readConferenceEnv } from '@byzon/config';
import { database } from '@/server/database';

export const dynamic = 'force-dynamic';

export async function GET() {
  const requestId = (await headers()).get('x-request-id');
  const env = readConferenceEnv(process.env);
  try {
    await database.ping();
  } catch {
    return Response.json(
      {
        status: 'not_ready',
        service: 'conference',
        environment: env.APP_ENV,
        release: env.RELEASE_SHA,
        requestId,
        dependencies: { database: 'unavailable' },
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  return Response.json(
    {
      status: 'ready',
      service: 'conference',
      environment: env.APP_ENV,
      release: env.RELEASE_SHA,
      requestId,
      dependencies: { database: 'ready' },
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
