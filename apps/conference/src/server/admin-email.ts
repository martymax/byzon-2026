import { schema, type Database } from '@byzon/database';
import {
  adminEmailQuerySchema,
  adminEmailListSchema,
  adminEmailDetailSchema,
} from '@byzon/domain/contracts';
import { and, desc, eq, ilike, isNotNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const cursorSchema = z.strictObject({
  sentAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});
const summaryColumns = {
  id: schema.emailMessages.id,
  eventId: schema.emailMessages.eventId,
  kind: schema.emailMessages.kind,
  recipient: schema.emailMessages.recipient,
  subject: schema.emailMessages.subject,
  sentAt: schema.emailMessages.sentAt,
  contentAvailable: sql<boolean>`${schema.emailMessages.html} is not null or ${schema.emailMessages.text} is not null`,
};
const invalid = () =>
  new ApiProblemError({
    status: 422,
    code: 'VALIDATION_FAILED',
    title: 'Invalid email query',
    detail: 'The email filters are invalid.',
  });

export const handleAdminEmail = async (
  request: Request,
  eventId: string,
  dependencies: {
    db: Database;
    getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  },
  messageId?: string,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  const headers = {
    'cache-control': 'private, no-store',
    vary: 'Authorization, Cookie',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  };
  try {
    if (request.method !== 'GET')
      throw new ApiProblemError({
        status: 405,
        code: 'METHOD_NOT_ALLOWED',
        title: 'Method not allowed',
        detail: 'Only GET is supported.',
      });
    const session = await dependencies.getSession(request.headers);
    if (!session)
      throw new ApiProblemError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Authentication required',
        detail: 'A valid session is required.',
      });
    try {
      if (!z.uuid().safeParse(eventId).success)
        throw new EventAccessDeniedError();
      await requireEventPermission(
        dependencies.db,
        { userId: session.user.id },
        eventId,
        'audit:read',
      );
    } catch (error) {
      if (!(error instanceof EventAccessDeniedError)) throw error;
      throw new ApiProblemError({
        status: 403,
        code: 'EVENT_ACCESS_DENIED',
        title: 'Event access denied',
        detail: 'Email history is unavailable.',
      });
    }
    const db = dependencies.db;
    const visible = and(
      eq(schema.emailMessages.eventId, eventId),
      isNotNull(schema.emailMessages.sentAt),
    );
    if (messageId !== undefined) {
      if (!z.uuid().safeParse(messageId).success) throw invalid();
      const [row] = await db
        .select({
          ...summaryColumns,
          sender: schema.emailMessages.sender,
          html: schema.emailMessages.html,
          text: schema.emailMessages.text,
        })
        .from(schema.emailMessages)
        .where(and(visible, eq(schema.emailMessages.id, messageId)))
        .limit(1);
      if (!row)
        throw new ApiProblemError({
          status: 404,
          code: 'ADMIN_RESOURCE_NOT_FOUND',
          title: 'Email not found',
          detail: 'The email is unavailable.',
        });
      return Response.json(
        adminEmailDetailSchema.parse({
          ...row,
          sentAt: row.sentAt!.toISOString(),
          authLinkRedacted:
            [
              'sign-in',
              'account-activation',
              'participant-invitation',
              'team-invitation',
            ].includes(row.kind) && row.contentAvailable,
        }),
        { headers },
      );
    }
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = adminEmailQuerySchema.safeParse({
      ...params,
      ...(params.limit !== undefined ? { limit: Number(params.limit) } : {}),
    });
    if (!parsed.success) throw invalid();
    const query = parsed.data;
    let cursor: z.infer<typeof cursorSchema> | null = null;
    if (query.cursor) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        );
      } catch {
        throw invalid();
      }
    }
    const pattern = query.search
      ? `%${query.search.replace(/[\\%_]/g, '\\$&')}%`
      : undefined;
    const filter = and(
      visible,
      query.kind ? eq(schema.emailMessages.kind, query.kind) : undefined,
      pattern
        ? or(
            ilike(schema.emailMessages.recipient, pattern),
            ilike(schema.emailMessages.subject, pattern),
          )
        : undefined,
    );
    const limit = query.limit ?? 25;
    const [rows, [count]] = await Promise.all([
      db
        .select(summaryColumns)
        .from(schema.emailMessages)
        .where(
          and(
            filter,
            cursor
              ? or(
                  lt(schema.emailMessages.sentAt, new Date(cursor.sentAt)),
                  and(
                    eq(schema.emailMessages.sentAt, new Date(cursor.sentAt)),
                    lt(schema.emailMessages.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(
          desc(schema.emailMessages.sentAt),
          desc(schema.emailMessages.id),
        )
        .limit(limit + 1),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.emailMessages)
        .where(filter),
    ]);
    const items = rows
      .slice(0, limit)
      .map((row) => ({ ...row, sentAt: row.sentAt!.toISOString() }));
    const last = items.at(-1);
    return Response.json(
      adminEmailListSchema.parse({
        eventId,
        items,
        total: count?.total ?? 0,
        nextCursor:
          rows.length > limit && last
            ? Buffer.from(
                JSON.stringify({ sentAt: last.sentAt, id: last.id }),
              ).toString('base64url')
            : null,
      }),
      { headers },
    );
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(headers).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};
