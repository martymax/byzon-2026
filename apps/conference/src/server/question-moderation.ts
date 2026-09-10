import { schema, writeAuditLog } from '@byzon/database';
import { questionModerationRequestSchema } from '@byzon/domain/contracts';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { getRequestId, problemResponse } from './api/problem';
import { questionPrivateHeaders } from './moderator-sessions';
import {
  loadQuestionActor,
  loadQuestionSession,
  lockQuestionAccess,
  questionFailure,
  requireQuestionManagement,
} from './question-runtime';
import type { QuestionsDependencies } from './questions';

export async function moderateQuestion(
  request: Request,
  sessionId: string,
  deps: QuestionsDependencies,
) {
  const requestId = getRequestId(request.headers);
  try {
    if (
      request.method !== 'POST' ||
      request.headers.get('origin') !== deps.allowedOrigin ||
      !z.string().uuid().safeParse(sessionId).success ||
      new URL(request.url).search ||
      request.headers.get('content-type')?.split(';')[0]?.trim() !==
        'application/json'
    )
      questionFailure('VALIDATION_FAILED', 422, 'Neplatný požadavek.');
    const actor = await loadQuestionActor(request, deps, deps.db, true);
    requireQuestionManagement(actor, sessionId);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 8192)
      questionFailure('VALIDATION_FAILED', 422, 'Požadavek je příliš velký.');
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      questionFailure('VALIDATION_FAILED', 422, 'Neplatný JSON.');
    }
    const parsed = questionModerationRequestSchema.safeParse(json);
    if (!parsed.success)
      questionFailure(
        'VALIDATION_FAILED',
        422,
        'Vyberte platné dotazy a akci.',
      );
    const input = parsed.data;
    const result = await executeIdempotentMutation(
      deps.db,
      {
        eventId: actor.eventId,
        actorId: actor.userId,
        scope: `questions.moderate.${sessionId}`,
        key: readIdempotencyKey(request.headers),
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: raw,
        }),
        ttlMs: 86400000,
        now: deps.now?.() ?? new Date(),
      },
      async (tx) => {
        await lockQuestionAccess(tx, actor.eventId, actor.userId, sessionId);
        const current = await loadQuestionActor(request, deps, tx, true);
        requireQuestionManagement(current, sessionId);
        const now = deps.now?.() ?? new Date();
        const session = await loadQuestionSession(
          tx,
          actor.eventId,
          sessionId,
          now,
        );
        if (session.record.questionMode !== 'moderated_follow_up')
          questionFailure(
            'QUESTIONS_UNSUPPORTED',
            409,
            'Tento blok nepodporuje dotazy.',
          );
        // Serialize group changes, including merges into an already merged group.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`question-moderation:${actor.eventId}:${sessionId}`}, 0))`,
        );
        const roots =
          input.action === 'merge'
            ? [input.questionId, input.sourceId]
            : [input.questionId];
        const rows = await tx
          .select()
          .from(schema.questions)
          .where(
            and(
              eq(schema.questions.eventId, actor.eventId),
              eq(schema.questions.sessionId, sessionId),
              or(
                inArray(schema.questions.id, roots),
                inArray(schema.questions.mergedIntoId, roots),
              ),
            ),
          )
          .orderBy(asc(schema.questions.id))
          .for('update');
        const target = rows.find((row) => row.id === input.questionId);
        if (!target || target.deletedAt)
          questionFailure(
            'QUESTION_NOT_FOUND',
            404,
            'Dotaz byl smazán nebo není dostupný.',
          );
        if (
          target.mergedIntoId ||
          target.moderationVersion !== input.expectedVersion
        )
          questionFailure(
            'QUESTION_MODERATION_CONFLICT',
            409,
            'Dotaz mezitím někdo změnil. Obnovte dotazy a zopakujte akci.',
          );
        let answeredAt = target.answeredAt;
        if (input.action === 'merge') {
          const source = rows.find((row) => row.id === input.sourceId);
          if (!source || source.deletedAt)
            questionFailure(
              'QUESTION_NOT_FOUND',
              404,
              'Slučovaný dotaz není dostupný.',
            );
          if (
            source.mergedIntoId ||
            source.moderationVersion !== input.sourceVersion
          )
            questionFailure(
              'QUESTION_MODERATION_CONFLICT',
              409,
              'Slučovaný dotaz se změnil. Obnovte dotazy a zopakujte akci.',
            );
          answeredAt =
            target.answeredAt && source.answeredAt ? target.answeredAt : null;
          await tx
            .update(schema.questions)
            .set({ mergedIntoId: target.id })
            .where(
              and(
                eq(schema.questions.eventId, actor.eventId),
                eq(schema.questions.sessionId, sessionId),
                or(
                  eq(schema.questions.id, source.id),
                  eq(schema.questions.mergedIntoId, source.id),
                ),
              ),
            );
        } else if (input.action === 'answer')
          answeredAt = input.answered ? now : null;
        await tx
          .update(schema.questions)
          .set({
            answeredAt,
            ...(input.action === 'delete' ? { deletedAt: now } : {}),
            moderationVersion: sql`${schema.questions.moderationVersion} + 1`,
          })
          .where(
            inArray(
              schema.questions.id,
              rows.map((row) => row.id),
            ),
          );
        await writeAuditLog(
          tx,
          {
            eventId: actor.eventId,
            actorId: actor.userId,
            actorType: 'user',
            action: `question.moderation.${input.action}`,
            targetType: 'question',
            targetId: target.id,
            requestId,
            after: {
              questionIds: roots,
              version: target.moderationVersion + 1,
              answered: Boolean(answeredAt),
            },
          },
          { occurredAt: now },
        );
        return {
          status: 200,
          body: { questionId: target.id },
          resultReference: target.id,
        };
      },
    );
    return Response.json(result.body, {
      status: result.status,
      headers: {
        ...questionPrivateHeaders,
        'idempotency-replayed': String(result.replayed),
      },
    });
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(questionPrivateHeaders).forEach(([key, value]) =>
      response.headers.set(key, value),
    );
    return response;
  }
}
