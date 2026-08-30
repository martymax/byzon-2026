import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  adminExportRequestSchema,
  adminExportResponseSchema,
  adminRoleAssignmentMutationRequestSchema,
  adminRoleAssignmentMutationResponseSchema,
  type AdminAssignmentScope,
} from '@byzon/domain/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuidSchema = z.string().uuid();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;

export interface AdminRoleExportDependencies {
  db: Database;
  allowedOrigin: string;
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  now?: () => Date;
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
  permission: 'role:manage' | 'personal-data:operational:export',
  dependencies: AdminRoleExportDependencies,
) => {
  if (!uuidSchema.safeParse(eventId).success) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The administration action is unavailable.',
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
    await requireEventPermission(
      dependencies.db,
      { userId: identity.user.id },
      eventId,
      permission,
      permission === 'personal-data:operational:export'
        ? { auditedException: true }
        : undefined,
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The administration action is unavailable.',
    );
  }
  return identity.user.id;
};

const validateScope = async (
  db: Database | DatabaseTransaction,
  eventId: string,
  role: 'checkin_operator' | 'moderator' | 'room_operator',
  scope: AdminAssignmentScope,
) => {
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
      columns: { id: true, questionsEnabled: true },
      where: and(
        eq(schema.programSessions.eventId, eventId),
        eq(schema.programSessions.id, scope.sessionId),
      ),
    });
    if (session && role === 'room_operator') {
      return { sessionIds: [scope.sessionId] };
    }
    if (session?.questionsEnabled && role === 'moderator') {
      const feature = await db.query.eventFeatures.findFirst({
        columns: { questionsEnabled: true },
        where: eq(schema.eventFeatures.eventId, eventId),
      });
      if (feature?.questionsEnabled) {
        return { sessionIds: [scope.sessionId] };
      }
    }
  }
  throw problem(
    409,
    'ADMIN_INVALID_TRANSITION',
    'Invalid assignment scope',
    'Check-in operators require a station and moderators or activity leaders require a session.',
  );
};

export const handleAdminRoleAssignment = async (
  request: Request,
  eventId: string,
  dependencies: AdminRoleExportDependencies,
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
    if (request.headers.get('origin') !== dependencies.allowedOrigin) {
      throw problem(
        403,
        'EVENT_ACCESS_DENIED',
        'Event access denied',
        'The request origin is not allowed.',
      );
    }
    const actorId = await authorize(
      request,
      eventId,
      'role:manage',
      dependencies,
    );
    const rawBody = await request.text();
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      raw = null;
    }
    const parsed = adminRoleAssignmentMutationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid role action',
        'The role assignment is invalid.',
      );
    }
    await dependencies.db
      .insert(schema.eventAdminVersions)
      .values({ eventId })
      .onConflictDoNothing();
    const key = readIdempotencyKey(request.headers);
    const changedAt = dependencies.now?.() ?? new Date();
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'admin.role-assignment',
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
        await acquireTransactionLock(transaction, `admin-roles:${eventId}`);
        const version = await transaction.query.eventAdminVersions.findFirst({
          where: eq(schema.eventAdminVersions.eventId, eventId),
        });
        const currentVersion = version?.assignmentsVersion ?? 1;
        if (currentVersion !== parsed.data.expectedVersion) {
          throw problem(
            409,
            'STALE_VERSION',
            'Assignments changed',
            'Reload operator assignments.',
            { currentVersion },
          );
        }
        let assignment = null;
        let outcome: 'granted' | 'revoked';
        if (parsed.data.action === 'grant') {
          const membership = await transaction.query.eventMemberships.findFirst(
            {
              where: and(
                eq(schema.eventMemberships.eventId, eventId),
                eq(schema.eventMemberships.userId, parsed.data.operatorId),
                eq(schema.eventMemberships.status, 'active'),
              ),
            },
          );
          const operator = await transaction.query.users.findFirst({
            columns: { name: true },
            where: eq(schema.users.id, parsed.data.operatorId),
          });
          if (!membership || !operator) {
            throw problem(
              404,
              'ADMIN_RESOURCE_NOT_FOUND',
              'Operator not found',
              'The operator must have an active event membership.',
            );
          }
          const existing = await transaction.query.eventRoles.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.eventRoles.eventId, eventId),
              eq(schema.eventRoles.userId, parsed.data.operatorId),
              eq(schema.eventRoles.role, parsed.data.role),
              isNull(schema.eventRoles.revokedAt),
            ),
          });
          if (existing) {
            throw problem(
              409,
              'ADMIN_INVALID_TRANSITION',
              'Role already assigned',
              'Revoke the current role before assigning a new scope.',
            );
          }
          const scopeJson = await validateScope(
            transaction,
            eventId,
            parsed.data.role,
            parsed.data.scope,
          );
          const assignmentId = generateUuidV7();
          await transaction.insert(schema.eventRoles).values({
            id: assignmentId,
            eventId,
            userId: parsed.data.operatorId,
            role: parsed.data.role,
            scope: scopeJson,
            grantedBy: actorId,
            grantedAt: changedAt,
          });
          assignment = {
            assignmentId,
            eventId,
            operatorId: parsed.data.operatorId,
            operatorLabel: operator.name,
            role: parsed.data.role,
            scope: parsed.data.scope,
            state: 'active' as const,
            version: currentVersion + 1,
          };
          outcome = 'granted';
        } else {
          const existing = await transaction.query.eventRoles.findFirst({
            where: and(
              eq(schema.eventRoles.eventId, eventId),
              eq(schema.eventRoles.id, parsed.data.assignmentId),
              isNull(schema.eventRoles.revokedAt),
            ),
          });
          if (!existing || existing.role === 'organizer_admin') {
            throw problem(
              404,
              'ADMIN_RESOURCE_NOT_FOUND',
              'Assignment not found',
              'The scoped operator assignment is unavailable.',
            );
          }
          await transaction
            .update(schema.eventRoles)
            .set({ revokedAt: changedAt })
            .where(eq(schema.eventRoles.id, existing.id));
          outcome = 'revoked';
        }
        await transaction
          .update(schema.eventAdminVersions)
          .set({
            assignmentsVersion: sql`${schema.eventAdminVersions.assignmentsVersion} + 1`,
            updatedAt: changedAt,
          })
          .where(eq(schema.eventAdminVersions.eventId, eventId));
        const auditId = await writeAuditLog(transaction, {
          eventId,
          actorId,
          actorType: 'user',
          action: `role.${parsed.data.action}`,
          targetType: 'event_role',
          targetId:
            parsed.data.action === 'grant'
              ? assignment!.assignmentId
              : parsed.data.assignmentId,
          requestId,
          reason: parsed.data.reason,
          after: { outcome, version: currentVersion + 1 },
        });
        const response = adminRoleAssignmentMutationResponseSchema.parse({
          eventId,
          outcome,
          assignmentsVersion: currentVersion + 1,
          assignment,
          changedAt: changedAt.toISOString(),
          audit: { auditId },
        });
        return { status: 200, body: response };
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

export const handleAdminExport = async (
  request: Request,
  eventId: string,
  dependencies: AdminRoleExportDependencies,
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
    if (request.headers.get('origin') !== dependencies.allowedOrigin) {
      throw problem(
        403,
        'EVENT_ACCESS_DENIED',
        'Event access denied',
        'The request origin is not allowed.',
      );
    }
    const actorId = await authorize(
      request,
      eventId,
      'personal-data:operational:export',
      dependencies,
    );
    const rawBody = await request.text();
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      raw = null;
    }
    const parsed = adminExportRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid export request',
        'The export request is invalid.',
      );
    }
    const key = readIdempotencyKey(request.headers);
    const queuedAt = dependencies.now?.() ?? new Date();
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'admin.export',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: rawBody,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: queuedAt,
      },
      async (transaction) => {
        const exportId = generateUuidV7();
        await transaction.insert(schema.operationalExportRequests).values({
          id: exportId,
          eventId,
          requestedBy: actorId,
          report: parsed.data.report,
          format: parsed.data.format,
          rangeFrom: parsed.data.range
            ? new Date(parsed.data.range.from)
            : null,
          rangeTo: parsed.data.range ? new Date(parsed.data.range.to) : null,
          reason: parsed.data.reason,
          state: 'queued',
          expiresAt: new Date(queuedAt.getTime() + 24 * 60 * 60_000),
          createdAt: queuedAt,
          updatedAt: queuedAt,
        });
        await transaction.insert(schema.outboxEvents).values({
          id: generateUuidV7(),
          eventId,
          type: 'export.requested',
          aggregateType: 'operational_export',
          aggregateId: exportId,
          payload: { exportId, report: parsed.data.report },
          deduplicationKey: `export.requested:${exportId}`,
          status: 'pending',
          availableAt: queuedAt,
        });
        const auditId = await writeAuditLog(transaction, {
          eventId,
          actorId,
          actorType: 'user',
          action: 'export.queued',
          targetType: 'operational_export',
          targetId: exportId,
          requestId,
          reason: parsed.data.reason,
          after: {
            report: parsed.data.report,
            format: parsed.data.format,
            status: 'queued',
          },
        });
        const response = adminExportResponseSchema.parse({
          eventId,
          exportId,
          report: parsed.data.report,
          outcome: 'queued',
          state: 'queued',
          queuedAt: queuedAt.toISOString(),
          audit: { auditId },
        });
        return { status: 202, body: response, resultReference: exportId };
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
