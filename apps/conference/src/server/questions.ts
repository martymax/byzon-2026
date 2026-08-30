import { generateUuidV7, schema, type Database } from '@byzon/database';
import {
  moderatorQuestionFeedQuerySchema,
  moderatorQuestionFeedSchema,
  questionSubmitRequestSchema,
  questionSubmitResponseSchema,
  ratingStatusQuerySchema,
  ratingStatusResponseSchema,
  ratingSubmitRequestSchema,
  ratingSubmitResponseSchema,
} from '@byzon/domain/contracts';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { rateLimitHeaders } from './api/rate-limit';
import { CURRENT_EVENT_SLUG } from './current-event';
import type { QuestionsRateLimiter } from './questions-rate-limit';

const MAX_BODY_BYTES = 8_192;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const uuidSchema = z.string().uuid();

interface QuestionIdentity {
  user: { id: string };
}

export interface QuestionsDependencies {
  db: Database;
  allowedOrigin: string;
  getSession(headers: Headers): Promise<QuestionIdentity | null>;
  currentEventSlug?: string;
  now?: () => Date;
  generateId?: () => string;
  rateLimit?: QuestionsRateLimiter;
}

const privateHeaders = (
  requestId: string,
  extra: Record<string, string> = {},
): HeadersInit => ({
  'cache-control': 'private, no-store',
  'content-type': 'application/json',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
  ...extra,
});

const apiProblem = (
  status: number,
  code: string,
  title: string,
  detail: string,
): ApiProblemError => new ApiProblemError({ status, code, title, detail });

const respondProblem = (error: unknown, requestId: string): Response => {
  const response = problemResponse(error, requestId);
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('vary', 'Authorization, Cookie');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
};

const readJson = async (request: Request) => {
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim() !==
    'application/json'
  ) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Validation failed',
      'JSON is required.',
    );
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Validation failed',
      'The body is too large.',
    );
  }
  try {
    return { raw, value: JSON.parse(raw) as unknown };
  } catch {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Validation failed',
      'The body is invalid.',
    );
  }
};

const loadEventActor = async (
  request: Request,
  dependencies: QuestionsDependencies,
) => {
  const identity = await dependencies.getSession(request.headers);
  if (!identity || !uuidSchema.safeParse(identity.user.id).success) {
    throw apiProblem(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
      'A valid session is required.',
    );
  }
  const event = await dependencies.db.query.events.findFirst({
    columns: { endsAt: true, id: true, status: true },
    where: eq(
      schema.events.slug,
      dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
    ),
  });
  if (!event || event.status === 'draft' || event.status === 'archived') {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The interaction is unavailable.',
    );
  }
  const membership = await dependencies.db.query.eventMemberships.findFirst({
    columns: { status: true },
    where: and(
      eq(schema.eventMemberships.eventId, event.id),
      eq(schema.eventMemberships.userId, identity.user.id),
    ),
  });
  if (membership?.status !== 'active') {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The interaction is unavailable.',
    );
  }
  return { endsAt: event.endsAt, eventId: event.id, userId: identity.user.id };
};

const requireQuestionSession = async (
  dependencies: QuestionsDependencies,
  eventId: string,
  sessionId: string,
) => {
  const [feature, session] = await Promise.all([
    dependencies.db.query.eventFeatures.findFirst({
      columns: { questionsEnabled: true },
      where: eq(schema.eventFeatures.eventId, eventId),
    }),
    dependencies.db.query.programSessions.findFirst({
      columns: { id: true, questionsEnabled: true, status: true },
      where: and(
        eq(schema.programSessions.eventId, eventId),
        eq(schema.programSessions.id, sessionId),
      ),
    }),
  ]);
  if (!feature?.questionsEnabled) {
    throw apiProblem(
      409,
      'QUESTIONS_DISABLED',
      'Questions disabled',
      'Questions are not enabled for this event.',
    );
  }
  if (!session || session.status !== 'published' || !session.questionsEnabled) {
    throw apiProblem(
      404,
      'SESSION_NOT_FOUND',
      'Session not found',
      'Questions are unavailable for this session.',
    );
  }
  return session;
};

const requireParticipantRole = async (
  dependencies: QuestionsDependencies,
  eventId: string,
  userId: string,
) => {
  const role = await dependencies.db.query.eventRoles.findFirst({
    columns: { role: true },
    where: and(
      eq(schema.eventRoles.eventId, eventId),
      eq(schema.eventRoles.userId, userId),
      isNull(schema.eventRoles.revokedAt),
      eq(schema.eventRoles.role, 'participant'),
    ),
  });
  if (!role) {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Question submission is unavailable.',
    );
  }
};

export const submitQuestion = async (
  request: Request,
  sessionId: string,
  dependencies: QuestionsDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (
      request.method !== 'POST' ||
      request.headers.get('origin') !== dependencies.allowedOrigin ||
      !uuidSchema.safeParse(sessionId).success ||
      new URL(request.url).search.length > 0
    ) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The question request is invalid.',
      );
    }
    const actor = await loadEventActor(request, dependencies);
    await requireParticipantRole(dependencies, actor.eventId, actor.userId);
    await requireQuestionSession(dependencies, actor.eventId, sessionId);
    const decision = await dependencies.rateLimit?.(actor.userId, sessionId);
    const json = await readJson(request);
    const parsed = questionSubmitRequestSchema.safeParse(json.value);
    if (!parsed.success) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The question text is invalid.',
      );
    }
    const key = readIdempotencyKey(request.headers);
    const now = dependencies.now?.() ?? new Date();
    const generateId = dependencies.generateId ?? generateUuidV7;
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId: actor.eventId,
        actorId: actor.userId,
        scope: `questions.submit.${sessionId}`,
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: json.raw,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now,
        generateId,
      },
      async (transaction) => {
        const questionId = generateId();
        await transaction.insert(schema.questions).values({
          id: questionId,
          eventId: actor.eventId,
          sessionId,
          authorUserId: actor.userId,
          text: parsed.data.text,
          createdAt: now,
        });
        return {
          status: 201,
          body: questionSubmitResponseSchema.parse({
            questionId,
            sessionId,
            submittedAt: now.toISOString(),
          }),
          resultReference: questionId,
        };
      },
    );
    return Response.json(result.body, {
      status: result.status,
      headers: privateHeaders(requestId, {
        ...(decision ? rateLimitHeaders(decision) : {}),
        'idempotency-replayed': result.replayed ? 'true' : 'false',
      }),
    });
  } catch (error) {
    return respondProblem(error, requestId);
  }
};

const requireAssignedModerator = async (
  dependencies: QuestionsDependencies,
  eventId: string,
  userId: string,
  sessionId: string,
) => {
  const roles = await dependencies.db.query.eventRoles.findMany({
    columns: { role: true, scope: true },
    where: and(
      eq(schema.eventRoles.eventId, eventId),
      eq(schema.eventRoles.userId, userId),
      eq(schema.eventRoles.role, 'moderator'),
      isNull(schema.eventRoles.revokedAt),
    ),
  });
  if (!roles.some(({ scope }) => scope.sessionIds?.includes(sessionId))) {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The moderator feed is unavailable.',
    );
  }
};

export const readModeratorQuestions = async (
  request: Request,
  sessionId: string,
  dependencies: QuestionsDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (
      request.method !== 'GET' ||
      !uuidSchema.safeParse(sessionId).success ||
      request.headers.has('idempotency-key')
    ) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The moderator request is invalid.',
      );
    }
    const actor = await loadEventActor(request, dependencies);
    await requireQuestionSession(dependencies, actor.eventId, sessionId);
    await requireAssignedModerator(
      dependencies,
      actor.eventId,
      actor.userId,
      sessionId,
    );
    const url = new URL(request.url);
    const known = new Set(['after', 'cursor', 'limit']);
    if ([...url.searchParams.keys()].some((key) => !known.has(key))) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'Unknown moderator filter.',
      );
    }
    const query = moderatorQuestionFeedQuerySchema.safeParse({
      ...(url.searchParams.get('after')
        ? { after: url.searchParams.get('after') }
        : {}),
      ...(url.searchParams.get('cursor')
        ? { cursor: url.searchParams.get('cursor') }
        : {}),
      ...(url.searchParams.get('limit')
        ? { limit: Number(url.searchParams.get('limit')) }
        : {}),
    });
    if (!query.success) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The moderator filters are invalid.',
      );
    }
    const limit = query.data.limit ?? 100;
    const after = query.data.after ? new Date(query.data.after) : null;
    const rows = await dependencies.db
      .select()
      .from(schema.questions)
      .where(
        and(
          eq(schema.questions.eventId, actor.eventId),
          eq(schema.questions.sessionId, sessionId),
          after
            ? or(
                gt(schema.questions.createdAt, after),
                query.data.cursor
                  ? and(
                      eq(schema.questions.createdAt, after),
                      gt(schema.questions.id, query.data.cursor),
                    )
                  : undefined,
              )
            : undefined,
        ),
      )
      .orderBy(asc(schema.questions.createdAt), asc(schema.questions.id))
      .limit(limit);
    const now = dependencies.now?.() ?? new Date();
    const body = moderatorQuestionFeedSchema.parse({
      eventId: actor.eventId,
      sessionId,
      serverTime: now.toISOString(),
      items: rows.map((row) => ({
        questionId: row.id,
        text: row.text,
        submittedAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.at(-1)?.id ?? null,
      pollAfterMs: 5_000,
    });
    return Response.json(body, { headers: privateHeaders(requestId) });
  } catch (error) {
    return respondProblem(error, requestId);
  }
};

const requireRatingsFeature = async (
  dependencies: QuestionsDependencies,
  eventId: string,
) => {
  const feature = await dependencies.db.query.eventFeatures.findFirst({
    columns: { ratingsEnabled: true },
    where: eq(schema.eventFeatures.eventId, eventId),
  });
  if (!feature?.ratingsEnabled) {
    throw apiProblem(
      409,
      'RATINGS_DISABLED',
      'Ratings disabled',
      'Ratings are not enabled for this event.',
    );
  }
};

export const handleRatings = async (
  request: Request,
  dependencies: QuestionsDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    const actor = await loadEventActor(request, dependencies);
    await requireParticipantRole(dependencies, actor.eventId, actor.userId);
    await requireRatingsFeature(dependencies, actor.eventId);
    const now = dependencies.now?.() ?? new Date();
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const known = new Set(['targetType', 'sessionId']);
      if ([...url.searchParams.keys()].some((key) => !known.has(key))) {
        throw apiProblem(
          422,
          'VALIDATION_FAILED',
          'Validation failed',
          'Unknown rating filter.',
        );
      }
      const query = ratingStatusQuerySchema.safeParse({
        targetType: url.searchParams.get('targetType'),
        ...(url.searchParams.get('sessionId')
          ? { sessionId: url.searchParams.get('sessionId') }
          : {}),
      });
      if (!query.success) {
        throw apiProblem(
          422,
          'VALIDATION_FAILED',
          'Validation failed',
          'The rating target is invalid.',
        );
      }
      if (query.data.targetType === 'event' && actor.endsAt > now) {
        throw apiProblem(
          404,
          'SESSION_NOT_FOUND',
          'Rating target not found',
          'The event rating becomes available after the event ends.',
        );
      }
      const sessionId =
        query.data.targetType === 'session' ? query.data.sessionId : null;
      if (sessionId) {
        const session = await dependencies.db.query.programSessions.findFirst({
          columns: { endsAt: true, status: true },
          where: and(
            eq(schema.programSessions.eventId, actor.eventId),
            eq(schema.programSessions.id, sessionId),
          ),
        });
        if (
          !session ||
          session.status !== 'published' ||
          session.endsAt > now
        ) {
          throw apiProblem(
            404,
            'SESSION_NOT_FOUND',
            'Rating target not found',
            'The session rating is unavailable.',
          );
        }
      }
      const existing = await dependencies.db.query.ratings.findFirst({
        columns: { id: true },
        where: and(
          eq(schema.ratings.eventId, actor.eventId),
          eq(schema.ratings.userId, actor.userId),
          eq(schema.ratings.targetType, query.data.targetType),
          sessionId
            ? eq(schema.ratings.sessionId, sessionId)
            : isNull(schema.ratings.sessionId),
        ),
      });
      return Response.json(
        ratingStatusResponseSchema.parse({
          eventId: actor.eventId,
          targetType: query.data.targetType,
          sessionId,
          completed: Boolean(existing),
        }),
        { headers: privateHeaders(requestId) },
      );
    }
    if (
      request.method !== 'POST' ||
      request.headers.get('origin') !== dependencies.allowedOrigin ||
      new URL(request.url).search.length > 0
    ) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The rating request is invalid.',
      );
    }
    const json = await readJson(request);
    const parsed = ratingSubmitRequestSchema.safeParse(json.value);
    if (!parsed.success) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The rating is invalid.',
      );
    }
    const sessionId =
      parsed.data.targetType === 'session' ? parsed.data.sessionId : null;
    if (parsed.data.targetType === 'event' && actor.endsAt > now) {
      throw apiProblem(
        404,
        'SESSION_NOT_FOUND',
        'Rating target not found',
        'The event rating becomes available after the event ends.',
      );
    }
    if (sessionId) {
      const session = await dependencies.db.query.programSessions.findFirst({
        columns: { id: true, endsAt: true, status: true },
        where: and(
          eq(schema.programSessions.eventId, actor.eventId),
          eq(schema.programSessions.id, sessionId),
        ),
      });
      if (!session || session.status !== 'published' || session.endsAt > now) {
        throw apiProblem(
          404,
          'SESSION_NOT_FOUND',
          'Session not found',
          'The rating target is unavailable.',
        );
      }
    }
    const key = readIdempotencyKey(request.headers);
    const generateId = dependencies.generateId ?? generateUuidV7;
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId: actor.eventId,
        actorId: actor.userId,
        scope: `ratings.submit.${parsed.data.targetType}.${sessionId ?? actor.eventId}`,
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: json.raw,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now,
        generateId,
      },
      async (transaction) => {
        const ratingId = generateId();
        const inserted = await transaction
          .insert(schema.ratings)
          .values({
            id: ratingId,
            eventId: actor.eventId,
            sessionId,
            userId: actor.userId,
            targetType: parsed.data.targetType,
            score: parsed.data.score,
            comment: parsed.data.comment,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: schema.ratings.id });
        if (inserted.length === 0) {
          throw apiProblem(
            409,
            'RATING_ALREADY_COMPLETED',
            'Rating already completed',
            'This rating was already submitted.',
          );
        }
        return {
          status: 201,
          body: ratingSubmitResponseSchema.parse({
            ratingId,
            eventId: actor.eventId,
            targetType: parsed.data.targetType,
            sessionId,
            completed: true,
            submittedAt: now.toISOString(),
          }),
          resultReference: ratingId,
        };
      },
    );
    return Response.json(result.body, {
      status: result.status,
      headers: privateHeaders(requestId, {
        'idempotency-replayed': result.replayed ? 'true' : 'false',
      }),
    });
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505'
    ) {
      return respondProblem(
        apiProblem(
          409,
          'RATING_ALREADY_COMPLETED',
          'Rating already completed',
          'This rating was already submitted.',
        ),
        requestId,
      );
    }
    return respondProblem(error, requestId);
  }
};
