import { and, eq, isNull } from 'drizzle-orm';

import { schema, type Database } from '@byzon/database';

import { CURRENT_EVENT_SLUG } from './current-event';

export type PostLoginDestination = '/admin' | '/app';

export const resolvePostLoginDestination = async (
  db: Database,
  userId: string,
): Promise<PostLoginDestination> => {
  const event = await db.query.events.findFirst({
    columns: { id: true },
    where: eq(schema.events.slug, CURRENT_EVENT_SLUG),
  });
  if (!event) return '/app';

  const [membership, organizerRole] = await Promise.all([
    db.query.eventMemberships.findFirst({
      columns: { userId: true },
      where: and(
        eq(schema.eventMemberships.eventId, event.id),
        eq(schema.eventMemberships.userId, userId),
        eq(schema.eventMemberships.status, 'active'),
      ),
    }),
    db.query.eventRoles.findFirst({
      columns: { userId: true },
      where: and(
        eq(schema.eventRoles.eventId, event.id),
        eq(schema.eventRoles.userId, userId),
        eq(schema.eventRoles.role, 'organizer_admin'),
        isNull(schema.eventRoles.revokedAt),
      ),
    }),
  ]);

  return membership && organizerRole ? '/admin' : '/app';
};
