import { schema, type Database } from '@byzon/database';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CURRENT_EVENT_SLUG } from './current-event';
import {
  canUseTimelessTestMode,
  TIMELESS_TEST_COOKIE,
  timelessTestCookieValue,
} from './timeless-test-mode';

export async function updateTimelessTestMode(
  request: Request,
  dependencies: {
    db: Database;
    allowedOrigin: string;
    getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
    currentEventSlug?: string;
  },
) {
  const headers = {
    'cache-control': 'private, no-store',
    vary: 'Cookie',
    'x-content-type-options': 'nosniff',
  };
  const fail = (status: number) =>
    Response.json(
      { error: 'Testovací režim se nepodařilo změnit.' },
      { status, headers },
    );
  if (
    request.method !== 'POST' ||
    request.headers.get('origin') !== dependencies.allowedOrigin ||
    request.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
    new URL(request.url).search
  )
    return fail(400);
  const identity = await dependencies.getSession(request.headers);
  if (!identity) return fail(401);
  const event = await dependencies.db.query.events.findFirst({
    columns: { id: true, status: true },
    where: eq(
      schema.events.slug,
      dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
    ),
  });
  if (
    !event ||
    ['draft', 'archived'].includes(event.status) ||
    !(await canUseTimelessTestMode(dependencies.db, event.id, identity.user.id))
  )
    return fail(403);
  const raw = await request.text();
  if (raw.length > 128) return fail(400);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail(400);
  }
  const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(value);
  if (!parsed.success) return fail(400);
  const fingerprint = timelessTestCookieValue(
    request.headers,
    event.id,
    identity.user.id,
  );
  if (!fingerprint) return fail(401);
  return Response.json(
    { enabled: parsed.data.enabled },
    {
      headers: {
        ...headers,
        'set-cookie': `${TIMELESS_TEST_COOKIE}=${parsed.data.enabled ? fingerprint : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${parsed.data.enabled ? 28800 : 0}${new URL(dependencies.allowedOrigin).protocol === 'https:' ? '; Secure' : ''}`,
      },
    },
  );
}
