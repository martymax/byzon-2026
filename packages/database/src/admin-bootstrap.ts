import { and, eq, isNull, sql } from 'drizzle-orm';

import { writeAuditLog } from './audit.js';
import {
  acquireTransactionLock,
  type Database,
  withTransaction,
} from './client.js';
import { generateUuidV7 } from './ids.js';
import * as schema from './schema/index.js';

export type AdminBootstrapErrorCode =
  | 'EVENT_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'MEMBERSHIP_NOT_ACTIVE'
  | 'USER_NOT_FOUND';

export class AdminBootstrapError extends Error {
  readonly code: AdminBootstrapErrorCode;

  constructor(code: AdminBootstrapErrorCode, message: string) {
    super(message);
    this.name = 'AdminBootstrapError';
    this.code = code;
  }
}

export interface OrganizerAdminBootstrapInput {
  eventSlug: string;
  userEmail: string;
}

interface OrganizerAdminBootstrapResultBase {
  eventId: string;
  roleId: string;
  userId: string;
}

export type OrganizerAdminBootstrapResult =
  | (OrganizerAdminBootstrapResultBase & {
      requestId: null;
      status: 'already_granted';
    })
  | (OrganizerAdminBootstrapResultBase & {
      requestId: string;
      status: 'granted';
    });

const normalizeRequired = (value: string): string => value.trim();

export const bootstrapOrganizerAdmin = async (
  db: Database,
  input: OrganizerAdminBootstrapInput,
): Promise<OrganizerAdminBootstrapResult> => {
  const eventSlug = normalizeRequired(input.eventSlug);
  const userEmail = normalizeRequired(input.userEmail).toLowerCase();
  if (!eventSlug || !userEmail) {
    throw new AdminBootstrapError(
      'INVALID_INPUT',
      'Both event slug and user email are required.',
    );
  }

  return withTransaction(db, async (transaction) => {
    const [event] = await transaction
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.slug, eventSlug))
      .limit(1);
    if (!event) {
      throw new AdminBootstrapError(
        'EVENT_NOT_FOUND',
        'The requested event does not exist.',
      );
    }

    const userRows = await transaction
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = ${userEmail}`)
      .limit(2);
    if (userRows.length !== 1) {
      throw new AdminBootstrapError(
        'USER_NOT_FOUND',
        'Exactly one existing Better Auth user is required.',
      );
    }
    const user = userRows[0]!;

    await acquireTransactionLock(
      transaction,
      `organizer-admin-bootstrap:${event.id}:${user.id}`,
    );

    const [membership] = await transaction
      .select({ status: schema.eventMemberships.status })
      .from(schema.eventMemberships)
      .where(
        and(
          eq(schema.eventMemberships.eventId, event.id),
          eq(schema.eventMemberships.userId, user.id),
        ),
      )
      .limit(1);
    if (membership && membership.status !== 'active') {
      throw new AdminBootstrapError(
        'MEMBERSHIP_NOT_ACTIVE',
        'A suspended or revoked membership cannot be bootstrapped.',
      );
    }

    const [activeRole] = await transaction
      .select({ id: schema.eventRoles.id })
      .from(schema.eventRoles)
      .where(
        and(
          eq(schema.eventRoles.eventId, event.id),
          eq(schema.eventRoles.userId, user.id),
          eq(schema.eventRoles.role, 'organizer_admin'),
          isNull(schema.eventRoles.revokedAt),
        ),
      )
      .limit(1);
    if (activeRole && membership) {
      return {
        eventId: event.id,
        requestId: null,
        roleId: activeRole.id,
        status: 'already_granted',
        userId: user.id,
      };
    }

    if (!membership) {
      await transaction.insert(schema.eventMemberships).values({
        eventId: event.id,
        userId: user.id,
        status: 'active',
        activatedAt: new Date(),
      });
    }

    const requestId = generateUuidV7();
    const roleId = activeRole?.id ?? generateUuidV7();
    if (!activeRole) {
      await transaction.insert(schema.eventRoles).values({
        id: roleId,
        eventId: event.id,
        userId: user.id,
        role: 'organizer_admin',
        scope: {},
      });
    }
    await writeAuditLog(transaction, {
      eventId: event.id,
      actorId: null,
      actorType: 'bootstrap_cli',
      action: 'organizer_admin.bootstrap_completed',
      targetType: 'user',
      targetId: user.id,
      requestId,
      reason: 'explicit organizer admin bootstrap',
      before: {
        membershipStatus: membership?.status ?? 'absent',
        role: activeRole ? 'organizer_admin' : 'absent',
      },
      after: {
        membershipStatus: 'active',
        role: 'organizer_admin',
      },
    });

    return {
      eventId: event.id,
      requestId,
      roleId,
      status: 'granted',
      userId: user.id,
    };
  });
};
