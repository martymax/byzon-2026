import { headers } from 'next/headers';
import { readConferenceEnv } from '@byzon/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const requestId = (await headers()).get('x-request-id');
  const env = readConferenceEnv(process.env);
  return Response.json(
    {
      status: 'ready',
      service: 'conference',
      environment: env.APP_ENV,
      release: env.RELEASE_SHA,
      requestId,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
