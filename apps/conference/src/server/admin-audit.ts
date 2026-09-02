import { schema, type Database } from '@byzon/database';
import {
  adminAuditActionSchema,
  adminAuditQuerySchema,
  adminAuditResponseSchema,
  type AdminAuditAction,
  type AdminAuditActor,
  type AdminAuditCategory,
  type AdminAuditOutcome,
} from '@byzon/domain/contracts';
import { and, desc, eq, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuidSchema = z.string().uuid();

export interface AdminAuditDependencies {
  db: Database;
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
}

const privateHeaders = (requestId: string) => ({
  'cache-control': 'private, no-store',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const actionCategories = {
  update_settings: 'settings',
  cancel_reservation: 'reservation',
  'support.block': 'support',
  'support.reactivate': 'support',
  'support.resend': 'support',
  'participant.invitation_sent': 'support',
  'participant.profile_updated': 'support',
  'ticket_import.preview_created': 'import',
  'ticket_import.applied': 'import',
  'announcement.send': 'announcement',
  'role.grant': 'role',
  'role.revoke': 'role',
  'role.moderator.assign': 'role',
  'role.moderator.remove': 'role',
  'team.member_added': 'role',
  'team.member_updated': 'role',
  'team.member_removed': 'role',
  'team.invitation_sent': 'role',
  'reservation.admin_cancelled': 'reservation',
  'session.capacity_updated': 'reservation',
  'waitlist.auto_cancelled': 'reservation',
  'waitlist.auto_promoted': 'reservation',
  'settings.update': 'settings',
  'settings.engagement.update': 'settings',
  'settings.session-questions.update': 'settings',
  'export.queued': 'export',
  'export.download': 'export',
} satisfies Readonly<Record<AdminAuditAction, AdminAuditCategory>>;

const categoryFor = (action: AdminAuditAction): AdminAuditCategory =>
  actionCategories[action];

const actionsForCategory = (category?: AdminAuditCategory) =>
  adminAuditActionSchema.options.filter(
    (action) => category === undefined || categoryFor(action) === category,
  );

const categoryCondition = (category?: AdminAuditCategory) =>
  inArray(schema.auditLogs.action, actionsForCategory(category));

const actorCondition = (actor?: AdminAuditActor) => {
  if (actor === 'system') return eq(schema.auditLogs.actorType, 'system');
  if (actor === 'user') return ne(schema.auditLogs.actorType, 'system');
  return undefined;
};

const outcomeFor = (action: AdminAuditAction): AdminAuditOutcome =>
  action === 'export.queued' ? 'queued' : 'succeeded';

const outcomeCondition = (outcome?: AdminAuditOutcome) => {
  if (outcome === 'queued') return eq(schema.auditLogs.action, 'export.queued');
  if (outcome === 'succeeded')
    return ne(schema.auditLogs.action, 'export.queued');
  if (outcome === 'rejected') return sql<boolean>`false`;
  return undefined;
};

const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id }),
    'utf8',
  ).toString('base64url');

const decodeCursor = (value: string) => {
  try {
    return z
      .strictObject({
        createdAt: z.string().datetime({ offset: true }),
        id: z.string().uuid(),
      })
      .parse(
        JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown,
      );
  } catch {
    throw new ApiProblemError({
      status: 422,
      code: 'VALIDATION_FAILED',
      title: 'Invalid cursor',
      detail: 'The audit cursor is invalid.',
    });
  }
};

export const handleAdminAudit = async (
  request: Request,
  eventId: string,
  dependencies: AdminAuditDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'GET') {
      throw new ApiProblemError({
        status: 405,
        code: 'METHOD_NOT_ALLOWED',
        title: 'Method not allowed',
        detail: 'The method is not supported.',
      });
    }
    if (!uuidSchema.safeParse(eventId).success) {
      throw new ApiProblemError({
        status: 403,
        code: 'EVENT_ACCESS_DENIED',
        title: 'Event access denied',
        detail: 'The audit is unavailable.',
      });
    }
    const identity = await dependencies.getSession(request.headers);
    if (!identity) {
      throw new ApiProblemError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Authentication required',
        detail: 'A valid session is required.',
      });
    }
    try {
      await requireEventPermission(
        dependencies.db,
        { userId: identity.user.id },
        eventId,
        'audit:read',
      );
    } catch (error) {
      if (!(error instanceof EventAccessDeniedError)) throw error;
      throw new ApiProblemError({
        status: 403,
        code: 'EVENT_ACCESS_DENIED',
        title: 'Event access denied',
        detail: 'The audit is unavailable.',
      });
    }
    const url = new URL(request.url);
    const limitValue = url.searchParams.get('limit');
    const query = adminAuditQuerySchema.safeParse({
      ...(url.searchParams.get('category')
        ? { category: url.searchParams.get('category') }
        : {}),
      ...(url.searchParams.get('action')
        ? { action: url.searchParams.get('action') }
        : {}),
      ...(url.searchParams.get('actor')
        ? { actor: url.searchParams.get('actor') }
        : {}),
      ...(url.searchParams.get('outcome')
        ? { outcome: url.searchParams.get('outcome') }
        : {}),
      ...(url.searchParams.get('requestId')
        ? { requestId: url.searchParams.get('requestId') }
        : {}),
      ...(url.searchParams.get('from')
        ? { from: url.searchParams.get('from') }
        : {}),
      ...(url.searchParams.get('to') ? { to: url.searchParams.get('to') } : {}),
      ...(url.searchParams.get('cursor')
        ? { cursor: url.searchParams.get('cursor') }
        : {}),
      ...(limitValue ? { limit: Number(limitValue) } : {}),
    });
    if (!query.success) {
      throw new ApiProblemError({
        status: 422,
        code: 'VALIDATION_FAILED',
        title: 'Invalid audit query',
        detail: 'The audit filters are invalid.',
      });
    }
    const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : null;
    const cursorCondition = cursor
      ? or(
          lt(schema.auditLogs.createdAt, new Date(cursor.createdAt)),
          and(
            eq(schema.auditLogs.createdAt, new Date(cursor.createdAt)),
            lt(schema.auditLogs.id, cursor.id),
          ),
        )
      : undefined;
    const limit = query.data.limit ?? 50;
    const rows = await dependencies.db
      .select({
        id: schema.auditLogs.id,
        action: schema.auditLogs.action,
        targetType: schema.auditLogs.targetType,
        targetId: schema.auditLogs.targetId,
        actorType: schema.auditLogs.actorType,
        reason: schema.auditLogs.reason,
        afterVersion: sql<unknown>`${schema.auditLogs.after} -> 'version'`,
        createdAt: schema.auditLogs.createdAt,
      })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, eventId),
          categoryCondition(query.data.category),
          query.data.action
            ? eq(schema.auditLogs.action, query.data.action)
            : undefined,
          actorCondition(query.data.actor),
          outcomeCondition(query.data.outcome),
          query.data.requestId
            ? eq(schema.auditLogs.requestId, query.data.requestId)
            : undefined,
          query.data.from
            ? gte(schema.auditLogs.createdAt, new Date(query.data.from))
            : undefined,
          query.data.to
            ? lte(schema.auditLogs.createdAt, new Date(query.data.to))
            : undefined,
          cursorCondition,
        ),
      )
      .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page.at(-1);
    const body = adminAuditResponseSchema.parse({
      eventId,
      items: page.map((row) => {
        const action = adminAuditActionSchema.parse(row.action);
        const version =
          typeof row.afterVersion === 'number' &&
          Number.isInteger(row.afterVersion) &&
          row.afterVersion > 0
            ? row.afterVersion
            : null;
        return {
          auditId: row.id,
          eventId,
          actorLabel:
            row.actorType === 'system' ? 'Systém BYZON' : 'Oprávněný uživatel',
          category: categoryFor(action),
          action,
          targetReference: row.targetId ?? row.targetType,
          reason: row.reason ?? 'Důvod je součástí řízené systémové operace.',
          outcome: outcomeFor(action),
          createdAt: row.createdAt.toISOString(),
          resultingVersion: version,
          redacted: true,
        };
      }),
      pageInfo: {
        hasMore,
        nextCursor:
          hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      },
    });
    return Response.json(body, { headers: privateHeaders(requestId) });
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};
