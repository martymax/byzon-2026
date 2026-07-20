import { and, eq, isNull } from 'drizzle-orm';
import { schema, type Database } from '@byzon/database';
import {
  hasEventPermission,
  type EventPermission,
  type EventRole,
  type PermissionContext,
} from '@byzon/domain';

export interface EventActor {
  userId: string;
}

export interface EventPolicy {
  actor: EventActor;
  eventId: string;
  roles: readonly EventRole[];
  allows: (permission: EventPermission, context?: PermissionContext) => boolean;
}

export class EventAccessDeniedError extends Error {
  constructor() {
    super('Event access denied');
    this.name = 'EventAccessDeniedError';
  }
}

export const loadEventPolicy = async (
  db: Database,
  actor: EventActor,
  eventId: string,
): Promise<EventPolicy | null> => {
  const membership = await db.query.eventMemberships.findFirst({
    columns: { userId: true },
    where: and(
      eq(schema.eventMemberships.eventId, eventId),
      eq(schema.eventMemberships.userId, actor.userId),
      eq(schema.eventMemberships.status, 'active'),
    ),
  });

  if (!membership) return null;

  const rows = await db
    .select({ role: schema.eventRoles.role })
    .from(schema.eventRoles)
    .where(
      and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.userId, actor.userId),
        isNull(schema.eventRoles.revokedAt),
      ),
    );
  const roles = rows.map(({ role }) => role);

  return {
    actor,
    eventId,
    roles,
    allows: (permission, context) =>
      hasEventPermission(roles, permission, context),
  };
};

export const requireEventPermission = async (
  db: Database,
  actor: EventActor,
  eventId: string,
  permission: EventPermission,
  context?: PermissionContext,
): Promise<EventPolicy> => {
  const policy = await loadEventPolicy(db, actor, eventId);
  if (!policy?.allows(permission, context)) {
    throw new EventAccessDeniedError();
  }
  return policy;
};
