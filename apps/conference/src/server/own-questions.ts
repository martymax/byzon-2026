import { schema } from '@byzon/database';
import {
  ownQuestionsQuerySchema,
  ownQuestionsSchema,
} from '@byzon/domain/contracts';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { getRequestId, problemResponse } from './api/problem';
import {
  loadQuestionActor,
  loadQuestionSession,
  questionFailure,
} from './question-runtime';
import type { QuestionsDependencies } from './questions';
const headers = {
  'cache-control': 'private, no-store',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
};
export async function readQuestionContext(
  request: Request,
  sessionId: string,
  dependencies: QuestionsDependencies,
) {
  try {
    if (
      request.method !== 'GET' ||
      !z.string().uuid().safeParse(sessionId).success
    )
      questionFailure('VALIDATION_FAILED', 422, 'Neplatná session.');
    const actor = await loadQuestionActor(
      request,
      dependencies,
      dependencies.db,
      true,
    );
    const result = await loadQuestionSession(
      dependencies.db,
      actor.eventId,
      sessionId,
      dependencies.now?.() ?? new Date(),
    );
    return Response.json(result.context, { headers });
  } catch (error) {
    const response = problemResponse(error, getRequestId(request.headers));
    Object.entries(headers).forEach(([key, value]) =>
      response.headers.set(key, value),
    );
    return response;
  }
}
export async function readOwnQuestions(
  request: Request,
  dependencies: QuestionsDependencies,
) {
  try {
    if (request.method !== 'GET')
      questionFailure('VALIDATION_FAILED', 422, 'Neplatný požadavek.');
    const actor = await loadQuestionActor(request, dependencies);
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = ownQuestionsQuerySchema.safeParse({
      ...params,
      ...(params.limit ? { limit: Number(params.limit) } : {}),
    });
    if (!parsed.success)
      questionFailure('VALIDATION_FAILED', 422, 'Neplatné stránkování.');
    const query = parsed.data,
      limit = query.limit ?? 100;
    const after = query.after ? new Date(query.after) : null;
    const rows = await dependencies.db
      .select({
        questionId: schema.questions.id,
        sessionId: schema.questions.sessionId,
        sessionTitle: schema.programSessions.title,
        text: schema.questions.text,
        answeredAt: schema.questions.answeredAt,
        createdAt: schema.questions.createdAt,
        answer: schema.questionAnswers,
      })
      .from(schema.questions)
      .innerJoin(
        schema.programSessions,
        and(
          eq(schema.programSessions.eventId, schema.questions.eventId),
          eq(schema.programSessions.id, schema.questions.sessionId),
        ),
      )
      .leftJoin(
        schema.questionAnswers,
        and(
          eq(schema.questionAnswers.eventId, schema.questions.eventId),
          eq(schema.questionAnswers.questionId, schema.questions.id),
        ),
      )
      .where(
        and(
          eq(schema.questions.eventId, actor.eventId),
          eq(schema.questions.authorUserId, actor.userId),
          isNull(schema.questions.deletedAt),
          query.sessionId
            ? eq(schema.questions.sessionId, query.sessionId)
            : undefined,
          after
            ? or(
                gt(schema.questions.createdAt, after),
                and(
                  eq(schema.questions.createdAt, after),
                  gt(schema.questions.id, query.cursor!),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(schema.questions.createdAt), asc(schema.questions.id))
      .limit(limit);
    return Response.json(
      ownQuestionsSchema.parse({
        eventId: actor.eventId,
        serverTime: (dependencies.now?.() ?? new Date()).toISOString(),
        items: rows.map((row) => ({
          questionId: row.questionId,
          sessionId: row.sessionId,
          sessionTitle: row.sessionTitle,
          text: row.text,
          answeredAt: row.answeredAt?.toISOString() ?? null,
          submittedAt: row.createdAt.toISOString(),
          answer: row.answer
            ? {
                id: row.answer.id,
                text: row.answer.text,
                speakerName: row.answer.speakerName,
                publishedAt: row.answer.publishedAt.toISOString(),
                updatedAt: row.answer.updatedAt.toISOString(),
                version: row.answer.version,
              }
            : null,
        })),
        nextCursor: rows.length === limit ? rows.at(-1)!.questionId : null,
      }),
      { headers },
    );
  } catch (error) {
    const response = problemResponse(error, getRequestId(request.headers));
    Object.entries(headers).forEach(([key, value]) =>
      response.headers.set(key, value),
    );
    return response;
  }
}
