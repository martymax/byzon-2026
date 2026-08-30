import { schema, type Database } from '@byzon/database';
import {
  announcementInboxQuerySchema,
  participantAnnouncementDetailResponseSchema,
  participantAnnouncementInboxResponseSchema,
  participantAnnouncementReadResponseSchema,
} from '@byzon/domain/contracts';
import { and, count, desc, eq, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import { loadEventPolicy } from './policy';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const uuidSchema = z.string().uuid();

interface AnnouncementIdentity {
  user: { id: string };
}

export interface ParticipantAnnouncementDependencies {
  db: Database;
  getSession(headers: Headers): Promise<AnnouncementIdentity | null>;
  currentEventSlug?: string;
  now?: () => Date;
}

export type ParticipantAnnouncementAction =
  'inbox' | { detailId: string } | { readId: string };

const apiProblem = (
  status: number,
  code: string,
  title: string,
  detail: string,
) => new ApiProblemError({ status, code, title, detail });

const privateHeaders = (requestId: string) => ({
  'cache-control': 'private, no-store',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const authorize = async (
  request: Request,
  dependencies: ParticipantAnnouncementDependencies,
) => {
  const identity = await dependencies.getSession(request.headers);
  const userId = uuidSchema.safeParse(identity?.user.id);
  if (!identity || !userId.success) {
    throw apiProblem(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
      'A valid participant session is required.',
    );
  }
  const now = dependencies.now?.() ?? new Date();
  const event = await dependencies.db.query.events.findFirst({
    columns: { id: true, operationalDataAnonymizesAt: true },
    where: and(
      eq(
        schema.events.slug,
        dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
      ),
      or(
        eq(schema.events.status, 'activation_open'),
        eq(schema.events.status, 'live'),
        eq(schema.events.status, 'ended'),
      ),
    ),
  });
  if (
    !event ||
    (event.operationalDataAnonymizesAt &&
      event.operationalDataAnonymizesAt <= now)
  ) {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Announcements are unavailable for this account.',
    );
  }
  const [policy, feature] = await Promise.all([
    loadEventPolicy(dependencies.db, { userId: userId.data }, event.id),
    dependencies.db.query.eventFeatures.findFirst({
      columns: { announcementsEnabled: true },
      where: eq(schema.eventFeatures.eventId, event.id),
    }),
  ]);
  if (
    !policy?.allows('announcement:own:read', { announcementRecipient: true })
  ) {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Announcements are unavailable for this account.',
    );
  }
  if (!feature?.announcementsEnabled) {
    throw apiProblem(
      409,
      'ANNOUNCEMENTS_DISABLED',
      'Announcements disabled',
      'Announcements are disabled for this event.',
    );
  }
  return { eventId: event.id, userId: userId.data, now };
};

interface CursorValue {
  publishedAt: string;
  id: string;
}

const encodeCursor = (value: CursorValue): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const decodeCursor = (value: string): CursorValue => {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    ) as unknown;
    return z
      .strictObject({
        publishedAt: z.string().datetime({ offset: true }),
        id: z.string().uuid(),
      })
      .parse(parsed);
  } catch {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Invalid cursor',
      'The announcement cursor is invalid.',
    );
  }
};

const contextFor = (row: {
  audienceKind: 'event' | 'session';
  sessionId: string | null;
  sessionTitle: string | null;
}) =>
  row.audienceKind === 'event'
    ? ({ kind: 'event' } as const)
    : ({
        kind: 'session',
        session: { id: row.sessionId!, title: row.sessionTitle! },
      } as const);

const loadAnnouncement = async (
  dependencies: ParticipantAnnouncementDependencies,
  eventId: string,
  userId: string,
  announcementId: string,
) => {
  const rows = await dependencies.db
    .select({
      id: schema.announcements.id,
      title: schema.announcements.title,
      summary: schema.announcements.summary,
      bodyText: schema.announcements.bodyText,
      severity: schema.announcements.severity,
      audienceKind: schema.announcements.audienceKind,
      sessionId: schema.announcements.sessionId,
      sessionTitle: schema.announcements.sessionTitle,
      publishedAt: schema.announcements.publishedAt,
      readAt: schema.announcementRecipients.readAt,
    })
    .from(schema.announcementRecipients)
    .innerJoin(
      schema.announcements,
      and(
        eq(schema.announcements.eventId, schema.announcementRecipients.eventId),
        eq(
          schema.announcements.id,
          schema.announcementRecipients.announcementId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.announcementRecipients.eventId, eventId),
        eq(schema.announcementRecipients.userId, userId),
        eq(schema.announcementRecipients.announcementId, announcementId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

export const handleParticipantAnnouncement = async (
  request: Request,
  action: ParticipantAnnouncementAction,
  dependencies: ParticipantAnnouncementDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    const expectedMethod =
      typeof action === 'object' && 'readId' in action ? 'POST' : 'GET';
    if (request.method !== expectedMethod) {
      throw apiProblem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    const authorized = await authorize(request, dependencies);

    if (action === 'inbox') {
      const url = new URL(request.url);
      const limitValue = url.searchParams.get('limit');
      const query = announcementInboxQuerySchema.safeParse({
        filter: url.searchParams.get('filter') ?? 'all',
        ...(url.searchParams.get('cursor')
          ? { cursor: url.searchParams.get('cursor') }
          : {}),
        ...(limitValue ? { limit: Number(limitValue) } : {}),
      });
      if (!query.success) {
        throw apiProblem(
          422,
          'VALIDATION_FAILED',
          'Invalid inbox query',
          'The announcement inbox query is invalid.',
        );
      }
      const limit = query.data.limit ?? 20;
      const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : null;
      const cursorCondition = cursor
        ? or(
            lt(schema.announcements.publishedAt, new Date(cursor.publishedAt)),
            and(
              eq(
                schema.announcements.publishedAt,
                new Date(cursor.publishedAt),
              ),
              lt(schema.announcements.id, cursor.id),
            ),
          )
        : undefined;
      const rows = await dependencies.db
        .select({
          id: schema.announcements.id,
          title: schema.announcements.title,
          summary: schema.announcements.summary,
          severity: schema.announcements.severity,
          audienceKind: schema.announcements.audienceKind,
          sessionId: schema.announcements.sessionId,
          sessionTitle: schema.announcements.sessionTitle,
          publishedAt: schema.announcements.publishedAt,
          readAt: schema.announcementRecipients.readAt,
        })
        .from(schema.announcementRecipients)
        .innerJoin(
          schema.announcements,
          and(
            eq(
              schema.announcements.eventId,
              schema.announcementRecipients.eventId,
            ),
            eq(
              schema.announcements.id,
              schema.announcementRecipients.announcementId,
            ),
          ),
        )
        .where(
          and(
            eq(schema.announcementRecipients.eventId, authorized.eventId),
            eq(schema.announcementRecipients.userId, authorized.userId),
            query.data.filter === 'unread'
              ? isNull(schema.announcementRecipients.readAt)
              : undefined,
            cursorCondition,
          ),
        )
        .orderBy(
          desc(schema.announcements.publishedAt),
          desc(schema.announcements.id),
        )
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      const hasMore = rows.length > limit;
      const unread = await dependencies.db
        .select({ count: count() })
        .from(schema.announcementRecipients)
        .where(
          and(
            eq(schema.announcementRecipients.eventId, authorized.eventId),
            eq(schema.announcementRecipients.userId, authorized.userId),
            isNull(schema.announcementRecipients.readAt),
          ),
        );
      const body = participantAnnouncementInboxResponseSchema.parse({
        eventId: authorized.eventId,
        items: page.map((row) => ({
          id: row.id,
          title: row.title,
          summary: row.summary,
          severity: row.severity,
          publishedAt: row.publishedAt.toISOString(),
          readAt: row.readAt?.toISOString() ?? null,
          context: contextFor(row),
        })),
        pageInfo: {
          hasMore,
          nextCursor:
            hasMore && last
              ? encodeCursor({
                  publishedAt: last.publishedAt.toISOString(),
                  id: last.id,
                })
              : null,
        },
        unreadCount: Math.min(999, unread[0]?.count ?? 0),
      });
      return Response.json(body, { headers: privateHeaders(requestId) });
    }

    const announcementId =
      'detailId' in action ? action.detailId : action.readId;
    if (!uuidSchema.safeParse(announcementId).success) {
      throw apiProblem(
        404,
        'ANNOUNCEMENT_NOT_FOUND',
        'Announcement not found',
        'The announcement is unavailable.',
      );
    }
    const row = await loadAnnouncement(
      dependencies,
      authorized.eventId,
      authorized.userId,
      announcementId,
    );
    if (!row) {
      throw apiProblem(
        404,
        'ANNOUNCEMENT_NOT_FOUND',
        'Announcement not found',
        'The announcement is unavailable.',
      );
    }

    if ('detailId' in action) {
      const body = participantAnnouncementDetailResponseSchema.parse({
        eventId: authorized.eventId,
        announcement: {
          id: row.id,
          title: row.title,
          summary: row.summary,
          bodyText: row.bodyText,
          severity: row.severity,
          publishedAt: row.publishedAt.toISOString(),
          readAt: row.readAt?.toISOString() ?? null,
          context: contextFor(row),
        },
      });
      return Response.json(body, { headers: privateHeaders(requestId) });
    }

    const key = readIdempotencyKey(request.headers);
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId: authorized.eventId,
        actorId: authorized.userId,
        scope: 'announcement.read',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: '',
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: authorized.now,
      },
      async (transaction) => {
        await transaction
          .update(schema.announcementRecipients)
          .set({ readAt: authorized.now })
          .where(
            and(
              eq(schema.announcementRecipients.eventId, authorized.eventId),
              eq(schema.announcementRecipients.userId, authorized.userId),
              eq(schema.announcementRecipients.announcementId, announcementId),
              isNull(schema.announcementRecipients.readAt),
            ),
          );
        const unread = await transaction
          .select({ count: count() })
          .from(schema.announcementRecipients)
          .where(
            and(
              eq(schema.announcementRecipients.eventId, authorized.eventId),
              eq(schema.announcementRecipients.userId, authorized.userId),
              isNull(schema.announcementRecipients.readAt),
            ),
          );
        return {
          status: 200,
          body: participantAnnouncementReadResponseSchema.parse({
            eventId: authorized.eventId,
            announcementId,
            state: 'read',
            readAt: (row.readAt ?? authorized.now).toISOString(),
            unreadCount: Math.min(999, unread[0]?.count ?? 0),
          }),
        };
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
