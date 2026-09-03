import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  adminTeamInvitationRequestSchema,
  adminTeamInvitationResponseSchema,
  adminTeamMemberListResponseSchema,
  adminTeamMemberMutationRequestSchema,
  adminTeamMemberMutationResponseSchema,
  type AdminTeamAccess,
  type AdminTeamMember,
  type AdminTeamRole,
} from '@byzon/domain/contracts';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuidSchema = z.string().uuid();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const TEAM_ROLES: readonly AdminTeamRole[] = [
  'organizer_admin',
  'checkin_operator',
  'moderator',
  'room_operator',
];

type TeamDb = Database | DatabaseTransaction;

export interface AdminTeamMembersDependencies {
  db: Database;
  allowedOrigin: string;
  currentEventSlug?: string;
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  now?: () => Date;
  sendTeamInvitation?: (input: {
    email: string;
    recipientName: string;
  }) => Promise<void>;
}

const privateHeaders = (requestId: string) => ({
  'cache-control': 'private, no-store',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const problem = (
  status: number,
  code: string,
  title: string,
  detail: string,
  extra?: Record<string, unknown>,
) => new ApiProblemError({ status, code, title, detail, ...extra });

const authorize = async (
  request: Request,
  eventId: string,
  dependencies: AdminTeamMembersDependencies,
) => {
  if (!uuidSchema.safeParse(eventId).success) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The team administration is unavailable.',
    );
  }
  const identity = await dependencies.getSession(request.headers);
  if (!identity) {
    throw problem(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
      'A valid session is required.',
    );
  }
  const event = await dependencies.db.query.events.findFirst({
    columns: { status: true },
    where: and(
      eq(schema.events.id, eventId),
      eq(
        schema.events.slug,
        dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
      ),
    ),
  });
  if (!event) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The team administration is unavailable.',
    );
  }
  try {
    await requireEventPermission(
      dependencies.db,
      { userId: identity.user.id },
      eventId,
      'role:manage',
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The team administration is unavailable.',
    );
  }
  return {
    actorId: identity.user.id,
    eventStatus: event.status,
  };
};

const requireSameOrigin = (
  request: Request,
  dependencies: AdminTeamMembersDependencies,
) => {
  if (request.headers.get('origin') !== dependencies.allowedOrigin) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The request origin is not allowed.',
    );
  }
};

const parseBody = async (
  request: Request,
): Promise<{
  raw: unknown;
  rawBody: string;
}> => {
  const rawBody = await request.text();
  try {
    return { raw: JSON.parse(rawBody) as unknown, rawBody };
  } catch {
    return { raw: null, rawBody };
  }
};

const toDateTime = (value: Date | string | null): string | null =>
  value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();

const loadTeamRows = async (db: TeamDb, eventId: string) =>
  db
    .select({
      memberId: schema.users.id,
      displayName: schema.users.name,
      email: schema.users.email,
      emailVerified: schema.users.emailVerified,
      role: schema.eventRoles.role,
      lastInvitationSentAt: sql<Date | string | null>`(
        select max(
          coalesce(
            nullif(${schema.auditLogs.after} ->> 'sentAt', '')::timestamptz,
            ${schema.auditLogs.createdAt}
          )
        )
        from ${schema.auditLogs}
        where ${schema.auditLogs.eventId} = ${eventId}
          and ${schema.auditLogs.action} = 'team.invitation_sent'
          and ${schema.auditLogs.targetId} = cast(${schema.users.id} as text)
      )`,
    })
    .from(schema.eventMemberships)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.eventMemberships.userId),
    )
    .innerJoin(
      schema.eventRoles,
      and(
        eq(schema.eventRoles.eventId, schema.eventMemberships.eventId),
        eq(schema.eventRoles.userId, schema.eventMemberships.userId),
        isNull(schema.eventRoles.revokedAt),
        inArray(schema.eventRoles.role, TEAM_ROLES),
      ),
    )
    .where(
      and(
        eq(schema.eventMemberships.eventId, eventId),
        eq(schema.eventMemberships.status, 'active'),
      ),
    )
    .orderBy(asc(schema.users.name), asc(schema.users.email));

const groupTeamMembers = (
  rows: Awaited<ReturnType<typeof loadTeamRows>>,
  actorId: string,
): AdminTeamMember[] => {
  const members = new Map<string, AdminTeamMember>();
  rows.forEach((row) => {
    if (!TEAM_ROLES.includes(row.role as AdminTeamRole)) return;
    const existing = members.get(row.memberId);
    const role = row.role as AdminTeamRole;
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      return;
    }
    const lastSentAt = toDateTime(row.lastInvitationSentAt);
    members.set(row.memberId, {
      memberId: row.memberId,
      displayName: row.displayName,
      email: row.email.toLowerCase(),
      emailVerified: row.emailVerified,
      isCurrentActor: row.memberId === actorId,
      roles: [role],
      invitation: {
        status: row.emailVerified
          ? 'accepted'
          : lastSentAt
            ? 'sent'
            : 'not_sent',
        lastSentAt,
      },
    });
  });
  return [...members.values()];
};

const ensureTeamVersion = async (db: TeamDb, eventId: string) => {
  await db
    .insert(schema.eventAdminVersions)
    .values({ eventId })
    .onConflictDoNothing();
  const row = await db.query.eventAdminVersions.findFirst({
    columns: { assignmentsVersion: true },
    where: eq(schema.eventAdminVersions.eventId, eventId),
  });
  return row?.assignmentsVersion ?? 1;
};

const loadMember = async (
  db: TeamDb,
  eventId: string,
  memberId: string,
  actorId: string,
) => {
  const members = groupTeamMembers(await loadTeamRows(db, eventId), actorId);
  return members.find((member) => member.memberId === memberId) ?? null;
};

const validateScope = async (
  db: TeamDb,
  eventId: string,
  access: Exclude<AdminTeamAccess, { role: 'organizer_admin' }>,
) => {
  const { role, scope } = access;
  if (role === 'checkin_operator' && scope.kind === 'station') {
    const station = await db.query.checkinStations.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.checkinStations.eventId, eventId),
        eq(schema.checkinStations.id, scope.stationId),
      ),
    });
    if (station) return { stationIds: [scope.stationId] };
  }
  if (
    (role === 'moderator' || role === 'room_operator') &&
    scope.kind === 'session'
  ) {
    const session = await db.query.programSessions.findFirst({
      columns: { questionsEnabled: true },
      where: and(
        eq(schema.programSessions.eventId, eventId),
        eq(schema.programSessions.id, scope.sessionId),
      ),
    });
    if (session && role === 'room_operator') {
      return { sessionIds: [scope.sessionId] };
    }
    if (session?.questionsEnabled && role === 'moderator') {
      const features = await db.query.eventFeatures.findFirst({
        columns: { questionsEnabled: true },
        where: eq(schema.eventFeatures.eventId, eventId),
      });
      if (features?.questionsEnabled) return { sessionIds: [scope.sessionId] };
    }
  }
  if (role === 'room_operator' && scope.kind === 'room') {
    const room = await db.query.rooms.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.rooms.eventId, eventId),
        eq(schema.rooms.id, scope.roomId),
        ne(schema.rooms.status, 'archived'),
      ),
    });
    if (room) return { roomIds: [scope.roomId] };
  }
  throw problem(
    409,
    'ADMIN_INVALID_TRANSITION',
    'Invalid team access scope',
    'The selected scope is not compatible with the team role.',
  );
};

const getActiveMemberRoles = async (
  db: TeamDb,
  eventId: string,
  memberId: string,
) =>
  db
    .select({ id: schema.eventRoles.id, role: schema.eventRoles.role })
    .from(schema.eventRoles)
    .innerJoin(
      schema.eventMemberships,
      and(
        eq(schema.eventMemberships.eventId, schema.eventRoles.eventId),
        eq(schema.eventMemberships.userId, schema.eventRoles.userId),
        eq(schema.eventMemberships.status, 'active'),
      ),
    )
    .where(
      and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.userId, memberId),
        inArray(schema.eventRoles.role, TEAM_ROLES),
        isNull(schema.eventRoles.revokedAt),
      ),
    );

const ensureNotLastAdministrator = async (
  db: TeamDb,
  eventId: string,
  memberId: string,
) => {
  const administrators = await db
    .select({ memberId: schema.eventRoles.userId })
    .from(schema.eventRoles)
    .innerJoin(
      schema.eventMemberships,
      and(
        eq(schema.eventMemberships.eventId, schema.eventRoles.eventId),
        eq(schema.eventMemberships.userId, schema.eventRoles.userId),
        eq(schema.eventMemberships.status, 'active'),
      ),
    )
    .where(
      and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.role, 'organizer_admin'),
        isNull(schema.eventRoles.revokedAt),
      ),
    );
  if (
    administrators.some(({ memberId: id }) => id === memberId) &&
    administrators.length <= 1
  ) {
    throw problem(
      409,
      'LAST_ADMINISTRATOR_GUARD',
      'Last administrator protected',
      'Assign another administrator before removing this access.',
    );
  }
};

const readResponse = (requestId: string, body: unknown) =>
  Response.json(body, { headers: privateHeaders(requestId) });

export const handleAdminTeamMemberList = async (
  request: Request,
  eventId: string,
  dependencies: AdminTeamMembersDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'GET') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    const { actorId } = await authorize(request, eventId, dependencies);
    const [teamVersion, rows] = await Promise.all([
      ensureTeamVersion(dependencies.db, eventId),
      loadTeamRows(dependencies.db, eventId),
    ]);
    const members = groupTeamMembers(rows, actorId);
    return readResponse(
      requestId,
      adminTeamMemberListResponseSchema.parse({
        eventId,
        teamVersion,
        generatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
        members,
        summary: {
          total: members.length,
          administrators: members.filter(({ roles }) =>
            roles.includes('organizer_admin'),
          ).length,
          awaitingInvitation: members.filter(
            ({ invitation }) => invitation.status !== 'accepted',
          ).length,
        },
      }),
    );
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};

export const handleAdminTeamMemberMutation = async (
  request: Request,
  eventId: string,
  dependencies: AdminTeamMembersDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'POST') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    requireSameOrigin(request, dependencies);
    const { actorId, eventStatus } = await authorize(
      request,
      eventId,
      dependencies,
    );
    if (eventStatus === 'archived') {
      throw problem(
        409,
        'ADMIN_INVALID_TRANSITION',
        'Team change unavailable',
        'Archived events are read-only.',
      );
    }
    const { raw, rawBody } = await parseBody(request);
    const parsed = adminTeamMemberMutationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid team member action',
        'Check the member details, access and reason.',
      );
    }
    if (eventStatus === 'ended' && parsed.data.action === 'add') {
      throw problem(
        409,
        'ADMIN_INVALID_TRANSITION',
        'Team change unavailable',
        'New members cannot be added after the event ends.',
      );
    }
    await ensureTeamVersion(dependencies.db, eventId);
    const changedAt = dependencies.now?.() ?? new Date();
    const key = readIdempotencyKey(request.headers);
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'admin.team-member',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: rawBody,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: changedAt,
      },
      async (transaction) => {
        await acquireTransactionLock(transaction, `admin-team:${eventId}`);
        const currentVersion = await ensureTeamVersion(transaction, eventId);
        if (currentVersion !== parsed.data.expectedVersion) {
          throw problem(
            409,
            'STALE_VERSION',
            'Team changed',
            'Reload the team before applying this change.',
            { currentVersion },
          );
        }

        let memberId: string;
        let outcome: 'added' | 'updated' | 'removed';
        let before: Record<string, unknown> | undefined;
        let after: Record<string, unknown>;

        if (parsed.data.action === 'add') {
          const email = parsed.data.email.toLowerCase();
          await acquireTransactionLock(
            transaction,
            `admin-team-email:${email}`,
          );
          let user = await transaction.query.users.findFirst({
            where: sql<boolean>`lower(${schema.users.email}) = ${email}`,
          });
          if (!user) {
            memberId = generateUuidV7();
            await transaction.insert(schema.users).values({
              id: memberId,
              name: parsed.data.displayName.trim(),
              email,
              emailVerified: false,
              createdAt: changedAt,
              updatedAt: changedAt,
            });
            user = await transaction.query.users.findFirst({
              where: eq(schema.users.id, memberId),
            });
          }
          if (!user) throw new Error('Created team identity is unavailable.');
          memberId = user.id;
          const existingRoles = await getActiveMemberRoles(
            transaction,
            eventId,
            memberId,
          );
          if (existingRoles.length > 0) {
            throw problem(
              409,
              'ADMIN_INVALID_TRANSITION',
              'Team member already exists',
              'Edit the existing member instead of adding a duplicate.',
            );
          }
          const membership = await transaction.query.eventMemberships.findFirst(
            {
              where: and(
                eq(schema.eventMemberships.eventId, eventId),
                eq(schema.eventMemberships.userId, memberId),
              ),
            },
          );
          if (membership) {
            await transaction
              .update(schema.eventMemberships)
              .set({
                status: 'active',
                activatedAt: changedAt,
                revokedAt: null,
                revocationReason: null,
                offlineRevocationEpoch: crypto.randomUUID(),
              })
              .where(
                and(
                  eq(schema.eventMemberships.eventId, eventId),
                  eq(schema.eventMemberships.userId, memberId),
                ),
              );
          } else {
            await transaction.insert(schema.eventMemberships).values({
              eventId,
              userId: memberId,
              status: 'active',
              activatedAt: changedAt,
            });
          }
          const scope =
            parsed.data.access.role === 'organizer_admin'
              ? {}
              : await validateScope(transaction, eventId, parsed.data.access);
          await transaction.insert(schema.eventRoles).values({
            id: generateUuidV7(),
            eventId,
            userId: memberId,
            role: parsed.data.access.role,
            scope,
            grantedBy: actorId,
            grantedAt: changedAt,
          });
          outcome = 'added';
          after = {
            membershipStatus: 'active',
            roles: [parsed.data.access.role],
          };
        } else {
          memberId = parsed.data.memberId;
          const target = await loadMember(
            transaction,
            eventId,
            memberId,
            actorId,
          );
          if (!target) {
            throw problem(
              404,
              'ADMIN_RESOURCE_NOT_FOUND',
              'Team member not found',
              'The team member is no longer available.',
            );
          }
          before = {
            administrator: target.roles.includes('organizer_admin'),
            roleCount: target.roles.length,
          };
          if (parsed.data.action === 'remove') {
            if (memberId === actorId) {
              throw problem(
                409,
                'SELF_LOCKOUT_GUARD',
                'Self-removal protected',
                'Another administrator must remove your team access.',
              );
            }
            await ensureNotLastAdministrator(transaction, eventId, memberId);
            await transaction
              .update(schema.eventRoles)
              .set({ revokedAt: changedAt })
              .where(
                and(
                  eq(schema.eventRoles.eventId, eventId),
                  eq(schema.eventRoles.userId, memberId),
                  inArray(schema.eventRoles.role, TEAM_ROLES),
                  isNull(schema.eventRoles.revokedAt),
                ),
              );
            const remainingRoles = await transaction.query.eventRoles.findMany({
              columns: { role: true },
              where: and(
                eq(schema.eventRoles.eventId, eventId),
                eq(schema.eventRoles.userId, memberId),
                isNull(schema.eventRoles.revokedAt),
              ),
            });
            const membershipStatus =
              remainingRoles.length > 0 ? 'active' : 'revoked';
            if (membershipStatus === 'revoked') {
              await transaction
                .update(schema.eventMemberships)
                .set({
                  status: 'revoked',
                  revokedAt: changedAt,
                  revocationReason: parsed.data.reason,
                  offlineRevocationEpoch: crypto.randomUUID(),
                })
                .where(
                  and(
                    eq(schema.eventMemberships.eventId, eventId),
                    eq(schema.eventMemberships.userId, memberId),
                  ),
                );
              await transaction
                .delete(schema.sessions)
                .where(eq(schema.sessions.userId, memberId));
            }
            outcome = 'removed';
            after = {
              membershipStatus,
              roleCount: remainingRoles.length,
            };
          } else {
            const wasAdministrator = target.roles.includes('organizer_admin');
            if (wasAdministrator && !parsed.data.administrator) {
              if (memberId === actorId) {
                throw problem(
                  409,
                  'SELF_LOCKOUT_GUARD',
                  'Self-lockout protected',
                  'Another administrator must remove your administrator access.',
                );
              }
              await ensureNotLastAdministrator(transaction, eventId, memberId);
              if (target.roles.length === 1) {
                throw problem(
                  409,
                  'ADMIN_INVALID_TRANSITION',
                  'Member needs another role',
                  'Assign a scoped operational role before removing administrator access.',
                );
              }
              await transaction
                .update(schema.eventRoles)
                .set({ revokedAt: changedAt })
                .where(
                  and(
                    eq(schema.eventRoles.eventId, eventId),
                    eq(schema.eventRoles.userId, memberId),
                    eq(schema.eventRoles.role, 'organizer_admin'),
                    isNull(schema.eventRoles.revokedAt),
                  ),
                );
            }
            if (!wasAdministrator && parsed.data.administrator) {
              await transaction.insert(schema.eventRoles).values({
                id: generateUuidV7(),
                eventId,
                userId: memberId,
                role: 'organizer_admin',
                scope: {},
                grantedBy: actorId,
                grantedAt: changedAt,
              });
            }
            const email = parsed.data.email.toLowerCase();
            const duplicate = await transaction.query.users.findFirst({
              columns: { id: true },
              where: and(
                sql<boolean>`lower(${schema.users.email}) = ${email}`,
                ne(schema.users.id, memberId),
              ),
            });
            if (duplicate) {
              throw problem(
                409,
                'ADMIN_INVALID_TRANSITION',
                'Email already used',
                'Another account already uses this email address.',
              );
            }
            const emailChanged = target.email !== email;
            await transaction
              .update(schema.users)
              .set({
                name: parsed.data.displayName.trim(),
                email,
                ...(emailChanged ? { emailVerified: false } : {}),
                updatedAt: changedAt,
              })
              .where(eq(schema.users.id, memberId));
            if (emailChanged) {
              await transaction
                .delete(schema.sessions)
                .where(eq(schema.sessions.userId, memberId));
            }
            outcome = 'updated';
            after = {
              administrator: parsed.data.administrator,
              emailVerificationReset: emailChanged,
            };
          }
        }

        await transaction
          .update(schema.eventAdminVersions)
          .set({
            assignmentsVersion: sql`${schema.eventAdminVersions.assignmentsVersion} + 1`,
            updatedAt: changedAt,
          })
          .where(eq(schema.eventAdminVersions.eventId, eventId));
        const nextVersion = currentVersion + 1;
        const auditAction =
          outcome === 'added'
            ? 'team.member_added'
            : outcome === 'updated'
              ? 'team.member_updated'
              : 'team.member_removed';
        const auditId = await writeAuditLog(transaction, {
          eventId,
          actorId,
          actorType: 'user',
          action: auditAction,
          targetType: 'event_membership',
          targetId: memberId,
          requestId,
          reason: parsed.data.reason,
          ...(before ? { before } : {}),
          after: { ...after, version: nextVersion },
        });
        const member =
          outcome === 'removed'
            ? null
            : await loadMember(transaction, eventId, memberId, actorId);
        return {
          status: 200,
          body: adminTeamMemberMutationResponseSchema.parse({
            eventId,
            outcome,
            teamVersion: nextVersion,
            member,
            changedAt: changedAt.toISOString(),
            audit: { auditId },
          }),
        };
      },
    );
    return Response.json(
      adminTeamMemberMutationResponseSchema.parse({
        ...result.body,
        outcome: result.replayed ? 'already_applied' : result.body.outcome,
      }),
      {
        status: result.status,
        headers: {
          ...privateHeaders(requestId),
          'idempotency-replayed': String(result.replayed),
        },
      },
    );
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};

export const handleAdminTeamInvitation = async (
  request: Request,
  eventId: string,
  memberId: string,
  dependencies: AdminTeamMembersDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'POST') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    requireSameOrigin(request, dependencies);
    const { actorId, eventStatus } = await authorize(
      request,
      eventId,
      dependencies,
    );
    const { raw, rawBody } = await parseBody(request);
    const parsed = adminTeamInvitationRequestSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.memberId !== memberId ||
      !uuidSchema.safeParse(memberId).success
    ) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid team invitation',
        'The team invitation is invalid.',
      );
    }
    if (eventStatus === 'archived' || !dependencies.sendTeamInvitation) {
      throw problem(
        eventStatus === 'archived' ? 409 : 503,
        eventStatus === 'archived'
          ? 'ADMIN_INVALID_TRANSITION'
          : 'INVITATION_DELIVERY_UNAVAILABLE',
        'Invitation unavailable',
        'The invitation cannot be delivered right now.',
      );
    }
    const sentAt = dependencies.now?.() ?? new Date();
    const key = readIdempotencyKey(request.headers);
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'admin.team-invitation',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: rawBody,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: sentAt,
      },
      async (transaction) => {
        await acquireTransactionLock(
          transaction,
          `admin-team-invitation:${eventId}:${memberId}`,
        );
        const member = await loadMember(
          transaction,
          eventId,
          memberId,
          actorId,
        );
        if (!member) {
          throw problem(
            404,
            'ADMIN_RESOURCE_NOT_FOUND',
            'Team member not found',
            'Only an active team member can receive an invitation.',
          );
        }
        try {
          await dependencies.sendTeamInvitation!({
            email: member.email,
            recipientName: member.displayName,
          });
        } catch {
          throw problem(
            503,
            'INVITATION_DELIVERY_UNAVAILABLE',
            'Invitation delivery unavailable',
            'The invitation could not be delivered. Try again later.',
          );
        }
        const auditId = await writeAuditLog(transaction, {
          eventId,
          actorId,
          actorType: 'user',
          action: 'team.invitation_sent',
          targetType: 'event_membership',
          targetId: memberId,
          requestId,
          reason: 'Pozvánka členovi týmu odeslána z administrace.',
          before: { invitationStatus: member.invitation.status },
          after: {
            invitationStatus: member.emailVerified ? 'accepted' : 'sent',
            sentAt: sentAt.toISOString(),
          },
        });
        return {
          status: 200,
          body: adminTeamInvitationResponseSchema.parse({
            eventId,
            memberId,
            outcome: 'sent',
            sentAt: sentAt.toISOString(),
            invitation: {
              status: member.emailVerified ? 'accepted' : 'sent',
              lastSentAt: sentAt.toISOString(),
            },
            audit: { auditId },
          }),
        };
      },
    );
    return Response.json(
      adminTeamInvitationResponseSchema.parse({
        ...result.body,
        outcome: result.replayed ? 'already_sent' : result.body.outcome,
      }),
      {
        status: result.status,
        headers: {
          ...privateHeaders(requestId),
          'idempotency-replayed': String(result.replayed),
        },
      },
    );
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};
