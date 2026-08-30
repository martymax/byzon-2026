import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
} from '@byzon/database';
import {
  adminAnnouncementDraftSchema,
  adminAnnouncementPreviewRequestSchema,
  adminAnnouncementPreviewResponseSchema,
  adminAnnouncementSendRequestSchema,
  adminAnnouncementSendResponseSchema,
  type AdminAnnouncementDraft,
} from '@byzon/domain/contracts';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const PREVIEW_TTL_MS = 10 * 60_000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const uuidSchema = z.string().uuid();

interface AdminAnnouncementIdentity {
  user: { id: string };
}

export interface AdminAnnouncementDependencies {
  db: Database;
  allowedOrigin: string;
  getSession(headers: Headers): Promise<AdminAnnouncementIdentity | null>;
  now?: () => Date;
}

const apiProblem = (
  status: number,
  code: string,
  title: string,
  detail: string,
  extra?: Record<string, unknown>,
) => new ApiProblemError({ status, code, title, detail, ...extra });

const privateHeaders = (requestId: string) => ({
  'cache-control': 'private, no-store',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const parseJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Invalid request',
      'The request must contain valid JSON.',
    );
  }
};

const requireAdmin = async (
  request: Request,
  eventId: string,
  dependencies: AdminAnnouncementDependencies,
): Promise<string> => {
  if (!uuidSchema.safeParse(eventId).success) {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The event is unavailable.',
    );
  }
  const identity = await dependencies.getSession(request.headers);
  if (!identity) {
    throw apiProblem(
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
      'announcement:send',
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The event is unavailable.',
    );
  }
  const feature = await dependencies.db.query.eventFeatures.findFirst({
    columns: { announcementsEnabled: true },
    where: eq(schema.eventFeatures.eventId, eventId),
  });
  if (!feature?.announcementsEnabled) {
    throw apiProblem(
      409,
      'ANNOUNCEMENTS_DISABLED',
      'Announcements disabled',
      'Announcements are disabled for this event.',
    );
  }
  return identity.user.id;
};

const activeParticipantIds = async (db: Database, eventId: string) => {
  const rows = await db
    .select({ userId: schema.eventRoles.userId })
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
        inArray(schema.eventRoles.role, ['participant', 'speaker']),
        isNull(schema.eventRoles.revokedAt),
      ),
    );
  return [...new Set(rows.map(({ userId }) => userId))].sort();
};

const audienceSnapshot = async (
  db: Database,
  eventId: string,
  draft: AdminAnnouncementDraft,
): Promise<{ recipientIds: string[]; sessionTitle: string | null }> => {
  const activeIds = await activeParticipantIds(db, eventId);
  if (draft.audience.kind === 'event') {
    return { recipientIds: activeIds, sessionTitle: null };
  }
  const session = await db.query.programSessions.findFirst({
    columns: { title: true },
    where: and(
      eq(schema.programSessions.eventId, eventId),
      eq(schema.programSessions.id, draft.audience.sessionId),
      inArray(schema.programSessions.status, ['draft', 'published']),
    ),
  });
  if (!session) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Invalid audience',
      'The session audience is unavailable.',
    );
  }
  const [agenda, reservations, waitlist] = await Promise.all([
    db
      .select({ userId: schema.agendaItems.userId })
      .from(schema.agendaItems)
      .where(
        and(
          eq(schema.agendaItems.eventId, eventId),
          eq(schema.agendaItems.sessionId, draft.audience.sessionId),
        ),
      ),
    db
      .select({ userId: schema.reservations.userId })
      .from(schema.reservations)
      .where(
        and(
          eq(schema.reservations.eventId, eventId),
          eq(schema.reservations.sessionId, draft.audience.sessionId),
          eq(schema.reservations.status, 'confirmed'),
        ),
      ),
    db
      .select({ userId: schema.waitlistEntries.userId })
      .from(schema.waitlistEntries)
      .where(
        and(
          eq(schema.waitlistEntries.eventId, eventId),
          eq(schema.waitlistEntries.sessionId, draft.audience.sessionId),
          eq(schema.waitlistEntries.status, 'waiting'),
        ),
      ),
  ]);
  const affected = new Set(
    [...agenda, ...reservations, ...waitlist].map(({ userId }) => userId),
  );
  return {
    recipientIds: activeIds.filter((userId) => affected.has(userId)),
    sessionTitle: session.title,
  };
};

const maskedReference = (userId: string) =>
  `Účastník •${userId.replaceAll('-', '').slice(-4)}`;

export const handleAdminAnnouncementPreview = async (
  request: Request,
  eventId: string,
  dependencies: AdminAnnouncementDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'POST') {
      throw apiProblem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    if (request.headers.get('origin') !== dependencies.allowedOrigin) {
      throw apiProblem(
        403,
        'EVENT_ACCESS_DENIED',
        'Event access denied',
        'The request origin is not allowed.',
      );
    }
    const actorId = await requireAdmin(request, eventId, dependencies);
    const body = adminAnnouncementPreviewRequestSchema.safeParse(
      await parseJson(request),
    );
    if (!body.success) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Invalid announcement',
        'The announcement draft is invalid.',
      );
    }
    const audience = await audienceSnapshot(
      dependencies.db,
      eventId,
      body.data.draft,
    );
    if (audience.recipientIds.length === 0) {
      throw apiProblem(
        409,
        'ANNOUNCEMENT_EMPTY_AUDIENCE',
        'Empty audience',
        'The immutable audience would contain no recipients.',
      );
    }
    const now = dependencies.now?.() ?? new Date();
    const previewId = generateUuidV7();
    const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
    await dependencies.db.insert(schema.announcementPreviews).values({
      id: previewId,
      eventId,
      version: 1,
      draft: body.data.draft,
      recipientUserIds: audience.recipientIds,
      recipientCount: audience.recipientIds.length,
      createdBy: actorId,
      createdAt: now,
      expiresAt,
    });
    const response = adminAnnouncementPreviewResponseSchema.parse({
      eventId,
      previewId,
      previewVersion: 1,
      draft: body.data.draft,
      audience: {
        recipientCount: audience.recipientIds.length,
        excludedCount: 0,
        sample: audience.recipientIds.slice(0, 5).map((userId) => ({
          participantReference: maskedReference(userId),
        })),
      },
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    return Response.json(response, {
      status: 201,
      headers: privateHeaders(requestId),
    });
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};

export const handleAdminAnnouncementSend = async (
  request: Request,
  eventId: string,
  dependencies: AdminAnnouncementDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'POST') {
      throw apiProblem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    if (request.headers.get('origin') !== dependencies.allowedOrigin) {
      throw apiProblem(
        403,
        'EVENT_ACCESS_DENIED',
        'Event access denied',
        'The request origin is not allowed.',
      );
    }
    const actorId = await requireAdmin(request, eventId, dependencies);
    const bodyText = await request.text();
    let raw: unknown;
    try {
      raw = JSON.parse(bodyText);
    } catch {
      raw = null;
    }
    const body = adminAnnouncementSendRequestSchema.safeParse(raw);
    if (!body.success) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Invalid send request',
        'The immutable preview and reason are required.',
      );
    }
    const key = readIdempotencyKey(request.headers);
    const now = dependencies.now?.() ?? new Date();
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'announcement.send',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: bodyText,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now,
      },
      async (transaction) => {
        await acquireTransactionLock(
          transaction,
          `announcement-preview:${eventId}:${body.data.previewId}`,
        );
        const preview = await transaction.query.announcementPreviews.findFirst({
          where: and(
            eq(schema.announcementPreviews.eventId, eventId),
            eq(schema.announcementPreviews.id, body.data.previewId),
          ),
        });
        if (!preview || preview.version !== body.data.previewVersion) {
          throw apiProblem(
            409,
            'ANNOUNCEMENT_PREVIEW_STALE',
            'Announcement preview stale',
            'Create a new immutable preview.',
            { currentPreviewVersion: preview?.version ?? 1 },
          );
        }
        if (preview.expiresAt <= now) {
          throw apiProblem(
            409,
            'ANNOUNCEMENT_PREVIEW_EXPIRED',
            'Announcement preview expired',
            'Create a new immutable preview.',
          );
        }
        const draft = adminAnnouncementDraftSchema.parse(preview.draft);
        if (
          preview.recipientCount < 1 ||
          preview.recipientUserIds.length !== preview.recipientCount
        ) {
          throw apiProblem(
            409,
            'ANNOUNCEMENT_EMPTY_AUDIENCE',
            'Empty audience',
            'The immutable audience is unavailable.',
          );
        }
        if (preview.sentAnnouncementId) {
          const priorAudit = await transaction.query.auditLogs.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.auditLogs.eventId, eventId),
              eq(schema.auditLogs.targetId, preview.sentAnnouncementId),
              eq(schema.auditLogs.action, 'announcement.send'),
            ),
            orderBy: [desc(schema.auditLogs.createdAt)],
          });
          if (!priorAudit) {
            throw apiProblem(
              500,
              'INTERNAL_ERROR',
              'Announcement audit unavailable',
              'The existing announcement receipt could not be verified.',
            );
          }
          const response = adminAnnouncementSendResponseSchema.parse({
            eventId,
            announcementId: preview.sentAnnouncementId,
            previewId: preview.id,
            previewVersion: preview.version,
            outcome: 'already_sent',
            recipientCount: preview.recipientCount,
            sentAt: now.toISOString(),
            audit: { auditId: priorAudit.id },
          });
          return { status: 200, body: response };
        }
        let sessionTitle: string | null = null;
        if (draft.audience.kind === 'session') {
          sessionTitle =
            (
              await transaction.query.programSessions.findFirst({
                columns: { title: true },
                where: and(
                  eq(schema.programSessions.eventId, eventId),
                  eq(schema.programSessions.id, draft.audience.sessionId),
                ),
              })
            )?.title ?? null;
          if (!sessionTitle) {
            throw apiProblem(
              409,
              'ANNOUNCEMENT_PREVIEW_STALE',
              'Announcement preview stale',
              'The target session is unavailable.',
              { currentPreviewVersion: preview.version + 1 },
            );
          }
        }
        const announcementId = generateUuidV7();
        const summary = draft.bodyText
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 512);
        await transaction.insert(schema.announcements).values({
          id: announcementId,
          eventId,
          previewId: preview.id,
          title: draft.title,
          summary,
          bodyText: draft.bodyText,
          severity: 'critical',
          audienceKind: draft.audience.kind,
          sessionId:
            draft.audience.kind === 'session' ? draft.audience.sessionId : null,
          sessionTitle,
          createdBy: actorId,
          publishedAt: now,
        });
        await transaction.insert(schema.announcementRecipients).values(
          preview.recipientUserIds.map((userId) => ({
            eventId,
            announcementId,
            userId,
            createdAt: now,
          })),
        );
        await transaction
          .update(schema.announcementPreviews)
          .set({ sentAnnouncementId: announcementId })
          .where(eq(schema.announcementPreviews.id, preview.id));
        const auditId = await writeAuditLog(transaction, {
          eventId,
          actorId,
          actorType: 'user',
          action: 'announcement.send',
          targetType: 'announcement',
          targetId: announcementId,
          requestId,
          reason: body.data.reason,
          after: {
            severity: 'critical',
            audienceKind: draft.audience.kind,
            recipientCount: preview.recipientCount,
          },
        });
        const response = adminAnnouncementSendResponseSchema.parse({
          eventId,
          announcementId,
          previewId: preview.id,
          previewVersion: preview.version,
          outcome: 'sent',
          recipientCount: preview.recipientCount,
          sentAt: now.toISOString(),
          audit: { auditId },
        });
        return { status: 201, body: response, resultReference: announcementId };
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
