import { schema, type Database } from '@byzon/database';
import {
  adminAuditQuerySchema,
  adminAuditResponseSchema,
  type AdminAuditCategory,
} from '@byzon/domain/contracts';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
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

const categoryFor = (action: string): AdminAuditCategory | null => {
  if (/^(support|ticket)\./.test(action)) return 'support';
  if (/^import\./.test(action)) return 'import';
  if (/^announcement\./.test(action)) return 'announcement';
  if (/^role\./.test(action)) return 'role';
  if (/^(reservation|session\.capacity|waitlist)\./.test(action))
    return 'reservation';
  if (/^settings\./.test(action)) return 'settings';
  if (/^export\./.test(action)) return 'export';
  return null;
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
    const rows = await dependencies.db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, eventId),
          query.data.action
            ? eq(schema.auditLogs.action, query.data.action)
            : undefined,
          query.data.requestId
            ? eq(schema.auditLogs.requestId, query.data.requestId)
            : undefined,
          query.data.from
            ? gte(schema.auditLogs.createdAt, new Date(query.data.from))
            : undefined,
          query.data.to
            ? lte(schema.auditLogs.createdAt, new Date(query.data.to))
            : undefined,
        ),
      )
      .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
      .limit(500);
    const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : null;
    const filtered = rows.filter((row) => {
      const category = categoryFor(row.action);
      if (
        !category ||
        (query.data.category && category !== query.data.category)
      ) {
        return false;
      }
      if (!cursor) return true;
      const createdAt = row.createdAt.toISOString();
      return (
        createdAt < cursor.createdAt ||
        (createdAt === cursor.createdAt && row.id < cursor.id)
      );
    });
    const limit = query.data.limit ?? 50;
    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const last = page.at(-1);
    const body = adminAuditResponseSchema.parse({
      eventId,
      items: page.map((row) => {
        const version =
          row.after &&
          typeof row.after.version === 'number' &&
          Number.isInteger(row.after.version) &&
          row.after.version > 0
            ? row.after.version
            : null;
        return {
          auditId: row.id,
          eventId,
          actorLabel:
            row.actorType === 'system' ? 'Systém BYZON' : 'Oprávněný uživatel',
          category: categoryFor(row.action)!,
          action: row.action,
          targetReference: row.targetId ?? row.targetType,
          reason: row.reason ?? 'Důvod je součástí řízené systémové operace.',
          outcome: row.action.startsWith('export.') ? 'queued' : 'succeeded',
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
