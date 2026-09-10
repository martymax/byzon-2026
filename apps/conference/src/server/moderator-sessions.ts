import { schema } from '@byzon/database';
import {
  questionSessionListSchema,
  type QuestionSessionList,
} from '@byzon/domain/contracts';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import {
  loadQuestionActor,
  loadQuestionSession,
  questionFailure,
} from './question-runtime';
import type { QuestionsDependencies } from './questions';
export const questionPrivateHeaders = {
  'cache-control': 'private, no-store',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
};
export async function readModeratorSessions(
  request: Request,
  dependencies: QuestionsDependencies,
) {
  try {
    const actor = await loadQuestionActor(
      request,
      dependencies,
      dependencies.db,
      true,
    );
    const assignments = actor.roles.filter((r) => r.role === 'moderator');
    const admin = actor.roles.some((role) => role.role === 'organizer_admin');
    if (!admin && !assignments.length)
      questionFailure(
        'QUESTION_ACCESS_DENIED',
        403,
        'Moderování není přiřazeno.',
      );
    const ids = admin
      ? (
          await dependencies.db.query.programSessions.findMany({
            columns: { id: true },
            where: and(
              eq(schema.programSessions.eventId, actor.eventId),
              eq(schema.programSessions.questionMode, 'moderated_follow_up'),
            ),
          })
        ).map((row) => row.id)
      : [...new Set(assignments.flatMap((r) => r.scope.sessionIds ?? []))];
    const now = dependencies.now?.() ?? new Date();
    const sessions: QuestionSessionList['sessions'] = [];
    for (const id of ids) {
      const row = await dependencies.db.query.programSessions.findFirst({
        where: and(
          eq(schema.programSessions.eventId, actor.eventId),
          eq(schema.programSessions.id, id),
          eq(schema.programSessions.questionMode, 'moderated_follow_up'),
          eq(schema.programSessions.status, 'published'),
        ),
      });
      if (!row) continue;
      let loaded;
      try {
        loaded = await loadQuestionSession(
          dependencies.db,
          actor.eventId,
          id,
          now,
        );
      } catch (error) {
        if (error instanceof ApiProblemError && error.status === 404) continue;
        throw error;
      }
      const [count] = await dependencies.db
        .select({ value: sql<number>`count(*)::integer` })
        .from(schema.questions)
        .where(
          and(
            eq(schema.questions.eventId, actor.eventId),
            eq(schema.questions.sessionId, id),
            isNull(schema.questions.deletedAt),
            isNull(schema.questions.mergedIntoId),
          ),
        );
      sessions.push({
        ...loaded.context.session,
        state: loaded.context.state,
        questionCount: count?.value ?? 0,
        unansweredCount: 0,
      });
    }
    sessions.sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
    );
    return Response.json(
      questionSessionListSchema.parse({
        eventId: actor.eventId,
        serverTime: now.toISOString(),
        sessions,
      }),
      { headers: questionPrivateHeaders },
    );
  } catch (error) {
    const response = problemResponse(error, getRequestId(request.headers));
    Object.entries(questionPrivateHeaders).forEach(([key, value]) =>
      response.headers.set(key, value),
    );
    return response;
  }
}
