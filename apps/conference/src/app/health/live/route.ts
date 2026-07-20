import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const requestId = (await headers()).get('x-request-id');
  return Response.json(
    { status: 'ok', service: 'conference', requestId },
    { headers: { 'cache-control': 'no-store' } },
  );
}
