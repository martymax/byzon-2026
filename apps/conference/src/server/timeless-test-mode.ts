import { createHash } from 'node:crypto';
import {
  schema,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import { and, eq, isNull } from 'drizzle-orm';

export const TIMELESS_TEST_COOKIE = 'byzon.timeless-test';
type Db = Database | DatabaseTransaction;

const cookie = (headers: Headers, name: string) =>
  headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

// Bind the preference to this event, account and actual browser login. This
// digest grants no access: each request still checks live membership and role.
export function timelessTestCookieValue(
  headers: Headers,
  eventId: string,
  userId: string,
) {
  const token =
    cookie(headers, '__Secure-better-auth.session_token') ??
    cookie(headers, 'better-auth.session_token');
  return token
    ? createHash('sha256')
        .update(`${eventId}\0${userId}\0${token}`)
        .digest('hex')
    : null;
}

export async function canUseTimelessTestMode(
  db: Db,
  eventId: string,
  userId: string,
) {
  const [membership, role] = await Promise.all([
    db.query.eventMemberships.findFirst({
      columns: { status: true },
      where: and(
        eq(schema.eventMemberships.eventId, eventId),
        eq(schema.eventMemberships.userId, userId),
      ),
    }),
    db.query.eventRoles.findFirst({
      columns: { role: true },
      where: and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.userId, userId),
        eq(schema.eventRoles.role, 'organizer_admin'),
        isNull(schema.eventRoles.revokedAt),
      ),
    }),
  ]);
  return membership?.status === 'active' && Boolean(role);
}

export async function isTimelessTestMode(
  db: Db,
  headers: Headers,
  eventId: string,
  userId: string,
) {
  const preference = cookie(headers, TIMELESS_TEST_COOKIE);
  if (
    !preference ||
    preference !== timelessTestCookieValue(headers, eventId, userId)
  )
    return false;
  return canUseTimelessTestMode(db, eventId, userId);
}
