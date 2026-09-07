import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Database } from '@byzon/database';

import type { ParticipantSessionContext } from '@/lib/participant-session-context';
import { CURRENT_EVENT_SLUG } from './current-event';

// Navigation context only. Every protected endpoint still authorizes its request.
export const resolveParticipantSessionContext = async (
  db: Database,
  userId: string | undefined,
): Promise<ParticipantSessionContext | null> => {
  if (!userId) return null;
  const event = await db.query.events.findFirst({
    columns: { id: true },
    where: eq(schema.events.slug, CURRENT_EVENT_SLUG),
  });
  if (!event) return null;
  const membership = await db.query.eventMemberships.findFirst({
    columns: { userId: true },
    where: and(
      eq(schema.eventMemberships.eventId, event.id),
      eq(schema.eventMemberships.userId, userId),
      eq(schema.eventMemberships.status, 'active'),
    ),
  });
  if (!membership) return null;
  const roles = await db.query.eventRoles.findMany({
    columns: { role: true },
    where: and(
      eq(schema.eventRoles.eventId, event.id),
      eq(schema.eventRoles.userId, userId),
      isNull(schema.eventRoles.revokedAt),
    ),
  });
  return {
    isAdmin: roles.some(({ role }) => role === 'organizer_admin'),
    isParticipant: roles.some(({ role }) => role === 'participant'),
  };
};
