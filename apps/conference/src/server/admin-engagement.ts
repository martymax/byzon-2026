import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  adminEngagementMutationRequestSchema,
  adminEngagementMutationResponseSchema,
  adminEngagementOverviewSchema,
  type AdminEngagementFeatures,
  type AdminEngagementOverview,
} from '@byzon/domain/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { requireWritableAdminEvent } from './admin-event-writability';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuidSchema = z.string().uuid();
const MAX_BODY_BYTES = 16_384;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const defaultFeatures: AdminEngagementFeatures = {
  networkingEnabled: false,
  questionsEnabled: false,
  ratingsEnabled: false,
};

type EngagementPermission =
  | 'event:settings:manage'
  | 'participant:operational:read'
  | 'program:manage'
  | 'role:manage';

export interface AdminEngagementDependencies {
  db: Database;
  allowedOrigin: string;
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  now?: () => Date;
  generateId?: () => string;
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
  permissions: readonly EngagementPermission[],
  dependencies: AdminEngagementDependencies,
): Promise<string> => {
  if (!uuidSchema.safeParse(eventId).success) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Engagement settings are unavailable.',
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
  try {
    for (const permission of permissions) {
      await requireEventPermission(
        dependencies.db,
        { userId: identity.user.id },
        eventId,
        permission,
      );
    }
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Engagement settings are unavailable.',
    );
  }
  return identity.user.id;
};

export const maskModeratorContact = (email: string): string => {
  const at = email.lastIndexOf('@');
  return at > 0
    ? `${email.slice(0, 1)}***@${email.slice(at + 1)}`
    : 'x***@invalid.example';
};

const currentFeatures = (
  row:
    | Pick<
        typeof schema.eventFeatures.$inferSelect,
        'networkingEnabled' | 'questionsEnabled' | 'ratingsEnabled'
      >
    | undefined,
): AdminEngagementFeatures =>
  row
    ? {
        networkingEnabled: row.networkingEnabled,
        questionsEnabled: row.questionsEnabled,
        ratingsEnabled: row.ratingsEnabled,
      }
    : defaultFeatures;

const loadOverview = async (
  db: Database | DatabaseTransaction,
  eventId: string,
): Promise<AdminEngagementOverview> => {
  const [settings, version, featureRow, sessions, candidates, roles] =
    await Promise.all([
      db.query.eventOperationalSettings.findFirst({
        columns: { version: true },
        where: eq(schema.eventOperationalSettings.eventId, eventId),
      }),
      db.query.eventAdminVersions.findFirst({
        columns: { assignmentsVersion: true },
        where: eq(schema.eventAdminVersions.eventId, eventId),
      }),
      db.query.eventFeatures.findFirst({
        columns: {
          networkingEnabled: true,
          questionsEnabled: true,
          ratingsEnabled: true,
        },
        where: eq(schema.eventFeatures.eventId, eventId),
      }),
      db.query.programSessions.findMany({
        columns: {
          id: true,
          questionsEnabled: true,
          startsAt: true,
          status: true,
          title: true,
          version: true,
        },
        where: eq(schema.programSessions.eventId, eventId),
        orderBy: [asc(schema.programSessions.startsAt)],
        limit: 300,
      }),
      db
        .select({
          userId: schema.eventMemberships.userId,
          displayName: schema.users.name,
          email: schema.users.email,
        })
        .from(schema.eventMemberships)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.eventMemberships.userId),
        )
        .where(
          and(
            eq(schema.eventMemberships.eventId, eventId),
            eq(schema.eventMemberships.status, 'active'),
          ),
        )
        .orderBy(asc(schema.users.name))
        .limit(2_000),
      db
        .select({
          assignmentId: schema.eventRoles.id,
          userId: schema.eventRoles.userId,
          scope: schema.eventRoles.scope,
          displayName: schema.users.name,
          email: schema.users.email,
        })
        .from(schema.eventRoles)
        .innerJoin(schema.users, eq(schema.users.id, schema.eventRoles.userId))
        .where(
          and(
            eq(schema.eventRoles.eventId, eventId),
            eq(schema.eventRoles.role, 'moderator'),
            isNull(schema.eventRoles.revokedAt),
          ),
        ),
    ]);

  return adminEngagementOverviewSchema.parse({
    eventId,
    settingsVersion: settings?.version ?? 1,
    assignmentsVersion: version?.assignmentsVersion ?? 1,
    features: currentFeatures(featureRow),
    sessions: sessions.map((session) => ({
      sessionId: session.id,
      title: session.title,
      startsAt: session.startsAt.toISOString(),
      status: session.status,
      questionsEnabled: session.questionsEnabled,
      version: session.version,
      moderators: roles
        .filter(({ scope }) => scope.sessionIds?.includes(session.id))
        .map((role) => ({
          assignmentId: role.assignmentId,
          userId: role.userId,
          displayName: role.displayName,
          maskedContact: maskModeratorContact(role.email),
        })),
    })),
    moderatorCandidates: candidates.map((candidate) => ({
      userId: candidate.userId,
      displayName: candidate.displayName,
      maskedContact: maskModeratorContact(candidate.email),
    })),
  });
};

const ensureVersionRows = async (
  transaction: DatabaseTransaction,
  eventId: string,
): Promise<void> => {
  await transaction
    .insert(schema.eventOperationalSettings)
    .values({ eventId })
    .onConflictDoNothing();
  await transaction
    .insert(schema.eventAdminVersions)
    .values({ eventId })
    .onConflictDoNothing();
};

const updateFeatures = async (
  transaction: DatabaseTransaction,
  input: Extract<
    z.infer<typeof adminEngagementMutationRequestSchema>,
    { action: 'update_features' }
  >,
  context: {
    actorId: string;
    eventId: string;
    requestId: string;
    changedAt: Date;
  },
) => {
  await acquireTransactionLock(
    transaction,
    `admin-settings:${context.eventId}`,
  );
  await ensureVersionRows(transaction, context.eventId);
  const settings = await transaction.query.eventOperationalSettings.findFirst({
    where: eq(schema.eventOperationalSettings.eventId, context.eventId),
  });
  if (!settings) {
    throw problem(
      404,
      'ADMIN_RESOURCE_NOT_FOUND',
      'Settings not found',
      'Engagement settings are unavailable.',
    );
  }
  if (settings.version !== input.expectedSettingsVersion) {
    throw problem(
      409,
      'STALE_VERSION',
      'Settings changed',
      'Reload the latest engagement settings.',
      { currentVersion: settings.version },
    );
  }
  const beforeRow = await transaction.query.eventFeatures.findFirst({
    columns: {
      networkingEnabled: true,
      questionsEnabled: true,
      ratingsEnabled: true,
    },
    where: eq(schema.eventFeatures.eventId, context.eventId),
  });
  const before = currentFeatures(beforeRow);
  await transaction
    .insert(schema.eventFeatures)
    .values({
      eventId: context.eventId,
      ...input.features,
      updatedAt: context.changedAt,
      updatedBy: context.actorId,
    })
    .onConflictDoUpdate({
      target: schema.eventFeatures.eventId,
      set: {
        ...input.features,
        updatedAt: context.changedAt,
        updatedBy: context.actorId,
      },
    });
  const settingsRows = await transaction
    .update(schema.eventOperationalSettings)
    .set({
      updatedAt: context.changedAt,
      updatedBy: context.actorId,
      version: sql`${schema.eventOperationalSettings.version} + 1`,
    })
    .where(
      and(
        eq(schema.eventOperationalSettings.eventId, context.eventId),
        eq(
          schema.eventOperationalSettings.version,
          input.expectedSettingsVersion,
        ),
      ),
    )
    .returning({ version: schema.eventOperationalSettings.version });
  if (!settingsRows[0]) {
    throw problem(
      409,
      'STALE_VERSION',
      'Settings changed',
      'Reload the latest engagement settings.',
      { currentVersion: settings.version },
    );
  }
  const auditId = await writeAuditLog(transaction, {
    eventId: context.eventId,
    actorId: context.actorId,
    actorType: 'user',
    action: 'settings.engagement.update',
    targetType: 'event_features',
    targetId: context.eventId,
    requestId: context.requestId,
    reason: input.reason,
    before,
    after: input.features,
  });
  return adminEngagementMutationResponseSchema.parse({
    action: input.action,
    eventId: context.eventId,
    outcome: 'updated',
    settingsVersion: settingsRows[0].version,
    features: input.features,
    changedAt: context.changedAt.toISOString(),
    audit: { auditId },
  });
};

const updateSessionQuestions = async (
  transaction: DatabaseTransaction,
  input: Extract<
    z.infer<typeof adminEngagementMutationRequestSchema>,
    { action: 'set_session_questions' }
  >,
  context: {
    actorId: string;
    eventId: string;
    requestId: string;
    changedAt: Date;
  },
) => {
  await acquireTransactionLock(
    transaction,
    `admin-session-engagement:${context.eventId}:${input.sessionId}`,
  );
  const current = await transaction.query.programSessions.findFirst({
    columns: { id: true, questionsEnabled: true, version: true },
    where: and(
      eq(schema.programSessions.eventId, context.eventId),
      eq(schema.programSessions.id, input.sessionId),
    ),
  });
  if (!current) {
    throw problem(
      404,
      'ADMIN_RESOURCE_NOT_FOUND',
      'Session not found',
      'The selected session is unavailable.',
    );
  }
  if (current.version !== input.expectedSessionVersion) {
    throw problem(
      409,
      'STALE_VERSION',
      'Session changed',
      'Reload the latest session settings.',
      { currentVersion: current.version },
    );
  }
  const rows = await transaction
    .update(schema.programSessions)
    .set({
      questionsEnabled: input.enabled,
      updatedAt: context.changedAt,
      version: sql`${schema.programSessions.version} + 1`,
    })
    .where(
      and(
        eq(schema.programSessions.eventId, context.eventId),
        eq(schema.programSessions.id, input.sessionId),
        eq(schema.programSessions.version, input.expectedSessionVersion),
      ),
    )
    .returning({ version: schema.programSessions.version });
  if (!rows[0]) {
    throw problem(
      409,
      'STALE_VERSION',
      'Session changed',
      'Reload the latest session settings.',
      { currentVersion: current.version },
    );
  }
  const auditId = await writeAuditLog(transaction, {
    eventId: context.eventId,
    actorId: context.actorId,
    actorType: 'user',
    action: 'settings.session-questions.update',
    targetType: 'session',
    targetId: input.sessionId,
    requestId: context.requestId,
    reason: input.reason,
    before: { questionsEnabled: current.questionsEnabled },
    after: { questionsEnabled: input.enabled, version: rows[0].version },
  });
  return adminEngagementMutationResponseSchema.parse({
    action: input.action,
    eventId: context.eventId,
    outcome: 'updated',
    session: {
      sessionId: input.sessionId,
      questionsEnabled: input.enabled,
      version: rows[0].version,
    },
    changedAt: context.changedAt.toISOString(),
    audit: { auditId },
  });
};

const updateModerator = async (
  transaction: DatabaseTransaction,
  input: Extract<
    z.infer<typeof adminEngagementMutationRequestSchema>,
    { action: 'assign_moderator' | 'remove_moderator' }
  >,
  context: {
    actorId: string;
    eventId: string;
    requestId: string;
    changedAt: Date;
    generateId: () => string;
  },
) => {
  await acquireTransactionLock(transaction, `admin-roles:${context.eventId}`);
  await ensureVersionRows(transaction, context.eventId);
  const version = await transaction.query.eventAdminVersions.findFirst({
    where: eq(schema.eventAdminVersions.eventId, context.eventId),
  });
  const currentVersion = version?.assignmentsVersion ?? 1;
  if (currentVersion !== input.expectedAssignmentsVersion) {
    throw problem(
      409,
      'STALE_VERSION',
      'Moderator assignments changed',
      'Reload the latest moderator assignments.',
      { currentVersion },
    );
  }
  const selectedSession = await transaction.query.programSessions.findFirst({
    columns: { id: true, questionsEnabled: true, status: true },
    where: and(
      eq(schema.programSessions.eventId, context.eventId),
      eq(schema.programSessions.id, input.sessionId),
    ),
  });
  if (!selectedSession) {
    throw problem(
      404,
      'ADMIN_RESOURCE_NOT_FOUND',
      'Session not found',
      'The selected session is unavailable.',
    );
  }
  const candidate = await transaction.query.users.findFirst({
    columns: { name: true, email: true },
    where: eq(schema.users.id, input.userId),
  });
  if (!candidate) {
    throw problem(
      404,
      'ADMIN_RESOURCE_NOT_FOUND',
      'Participant not found',
      'The selected moderator is unavailable.',
    );
  }
  if (input.action === 'assign_moderator') {
    const activeMembership = await transaction.query.eventMemberships.findFirst(
      {
        columns: { userId: true },
        where: and(
          eq(schema.eventMemberships.eventId, context.eventId),
          eq(schema.eventMemberships.userId, input.userId),
          eq(schema.eventMemberships.status, 'active'),
        ),
      },
    );
    if (!activeMembership) {
      throw problem(
        404,
        'ADMIN_RESOURCE_NOT_FOUND',
        'Participant not found',
        'The selected moderator must have an active event membership.',
      );
    }
    const feature = await transaction.query.eventFeatures.findFirst({
      columns: { questionsEnabled: true },
      where: eq(schema.eventFeatures.eventId, context.eventId),
    });
    if (
      !feature?.questionsEnabled ||
      !selectedSession.questionsEnabled ||
      selectedSession.status === 'cancelled' ||
      selectedSession.status === 'archived'
    ) {
      throw problem(
        409,
        'ADMIN_INVALID_TRANSITION',
        'Questions are not active',
        'Enable event and session questions before assigning a moderator.',
      );
    }
  }
  const existing = await transaction.query.eventRoles.findFirst({
    where: and(
      eq(schema.eventRoles.eventId, context.eventId),
      eq(schema.eventRoles.userId, input.userId),
      eq(schema.eventRoles.role, 'moderator'),
      isNull(schema.eventRoles.revokedAt),
    ),
  });
  const beforeSessionIds = existing?.scope.sessionIds ?? [];
  const sessionIds = new Set(beforeSessionIds);
  const alreadyApplied =
    input.action === 'assign_moderator'
      ? sessionIds.has(input.sessionId)
      : !sessionIds.has(input.sessionId);
  if (input.action === 'assign_moderator') sessionIds.add(input.sessionId);
  else sessionIds.delete(input.sessionId);

  if (!alreadyApplied) {
    if (input.action === 'assign_moderator') {
      if (existing) {
        await transaction
          .update(schema.eventRoles)
          .set({ scope: { sessionIds: [...sessionIds] } })
          .where(eq(schema.eventRoles.id, existing.id));
      } else {
        await transaction.insert(schema.eventRoles).values({
          id: context.generateId(),
          eventId: context.eventId,
          userId: input.userId,
          role: 'moderator',
          scope: { sessionIds: [...sessionIds] },
          grantedBy: context.actorId,
          grantedAt: context.changedAt,
        });
      }
    } else if (existing && sessionIds.size === 0) {
      await transaction
        .update(schema.eventRoles)
        .set({ revokedAt: context.changedAt })
        .where(eq(schema.eventRoles.id, existing.id));
    } else if (existing) {
      await transaction
        .update(schema.eventRoles)
        .set({ scope: { sessionIds: [...sessionIds] } })
        .where(eq(schema.eventRoles.id, existing.id));
    }
    const versionRows = await transaction
      .update(schema.eventAdminVersions)
      .set({
        assignmentsVersion: sql`${schema.eventAdminVersions.assignmentsVersion} + 1`,
        updatedAt: context.changedAt,
      })
      .where(
        and(
          eq(schema.eventAdminVersions.eventId, context.eventId),
          eq(
            schema.eventAdminVersions.assignmentsVersion,
            input.expectedAssignmentsVersion,
          ),
        ),
      )
      .returning({
        assignmentsVersion: schema.eventAdminVersions.assignmentsVersion,
      });
    if (!versionRows[0]) {
      throw problem(
        409,
        'STALE_VERSION',
        'Moderator assignments changed',
        'Reload the latest moderator assignments.',
        { currentVersion },
      );
    }
  }
  const resultingVersion = currentVersion + (alreadyApplied ? 0 : 1);
  const auditId = await writeAuditLog(transaction, {
    eventId: context.eventId,
    actorId: context.actorId,
    actorType: 'user',
    action: `role.moderator.${input.action === 'assign_moderator' ? 'assign' : 'remove'}`,
    targetType: 'session_moderator',
    targetId: `${input.sessionId}:${input.userId}`,
    requestId: context.requestId,
    reason: input.reason,
    before: { sessionIds: beforeSessionIds },
    after: {
      sessionIds: [...sessionIds],
      assignmentsVersion: resultingVersion,
    },
  });
  return adminEngagementMutationResponseSchema.parse({
    action: input.action,
    eventId: context.eventId,
    outcome: alreadyApplied ? 'already_applied' : 'updated',
    assignmentsVersion: resultingVersion,
    assignment:
      input.action === 'assign_moderator'
        ? {
            sessionId: input.sessionId,
            userId: input.userId,
            displayName: candidate.name,
            maskedContact: maskModeratorContact(candidate.email),
          }
        : null,
    changedAt: context.changedAt.toISOString(),
    audit: { auditId },
  });
};

export const handleAdminEngagement = async (
  request: Request,
  eventId: string,
  dependencies: AdminEngagementDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method === 'GET') {
      await authorize(
        request,
        eventId,
        [
          'event:settings:manage',
          'participant:operational:read',
          'program:manage',
          'role:manage',
        ],
        dependencies,
      );
      return Response.json(await loadOverview(dependencies.db, eventId), {
        headers: privateHeaders(requestId),
      });
    }
    if (request.method !== 'POST') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    if (request.headers.get('origin') !== dependencies.allowedOrigin) {
      throw problem(
        403,
        'EVENT_ACCESS_DENIED',
        'Event access denied',
        'The request origin is not allowed.',
      );
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid engagement action',
        'The request body is too large.',
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      raw = null;
    }
    const parsed = adminEngagementMutationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid engagement action',
        'The engagement settings update is invalid.',
      );
    }
    const permissions: readonly EngagementPermission[] =
      parsed.data.action === 'update_features'
        ? ['event:settings:manage']
        : parsed.data.action === 'set_session_questions'
          ? ['program:manage']
          : ['role:manage', 'participant:operational:read'];
    const actorId = await authorize(
      request,
      eventId,
      permissions,
      dependencies,
    );
    await requireWritableAdminEvent(dependencies.db, eventId);
    const changedAt = dependencies.now?.() ?? new Date();
    const key = readIdempotencyKey(request.headers);
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'admin.engagement',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: rawBody,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: changedAt,
        ...(dependencies.generateId
          ? { generateId: dependencies.generateId }
          : {}),
      },
      async (transaction) => {
        const context = {
          actorId,
          eventId,
          requestId,
          changedAt,
        };
        const body =
          parsed.data.action === 'update_features'
            ? await updateFeatures(transaction, parsed.data, context)
            : parsed.data.action === 'set_session_questions'
              ? await updateSessionQuestions(transaction, parsed.data, context)
              : await updateModerator(transaction, parsed.data, {
                  ...context,
                  generateId: dependencies.generateId ?? generateUuidV7,
                });
        return { status: 200, body };
      },
    );
    return Response.json(result.body, {
      status: result.status,
      headers: {
        ...privateHeaders(requestId),
        'idempotency-replayed': String(result.replayed),
      },
    });
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};
