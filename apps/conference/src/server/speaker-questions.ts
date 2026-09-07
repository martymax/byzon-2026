import { generateUuidV7, schema, writeAuditLog } from '@byzon/database';
import {
  questionAnswerEditSchema,
  questionAnswerPublishSchema,
  questionAnswerSchema,
  questionSessionListSchema,
  speakerQuestionFeedSchema,
  speakerQuestionQuerySchema,
  type QuestionSessionList,
} from '@byzon/domain/contracts';
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import {
  loadQuestionActor,
  loadQuestionSession,
  lockQuestionAccess,
  questionFailure,
  type QuestionDb,
} from './question-runtime';
import { questionPrivateHeaders } from './moderator-sessions';
import type { QuestionsDependencies } from './questions';
const answerDto = (row: typeof schema.questionAnswers.$inferSelect) =>
  questionAnswerSchema.parse({
    id: row.id,
    text: row.text,
    speakerName: row.speakerName,
    publishedAt: row.publishedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  });
async function speakerActor(
  request: Request,
  deps: QuestionsDependencies,
  db: QuestionDb = deps.db,
) {
  const actor = await loadQuestionActor(request, deps, db);
  if (!actor.roles.some((r) => r.role === 'speaker'))
    questionFailure(
      'QUESTION_ACCESS_DENIED',
      403,
      'Řečnický přístup není přiřazen.',
    );
  const features = await db.query.eventFeatures.findFirst({
    where: eq(schema.eventFeatures.eventId, actor.eventId),
  });
  if (
    !features?.questionFollowUpsEnabled ||
    !['live', 'ended'].includes(actor.eventStatus)
  )
    questionFailure(
      'QUESTION_FOLLOW_UPS_DISABLED',
      409,
      'Písemné odpovědi jsou nyní vypnuté.',
    );
  const profile = await db.query.speakerProfiles.findFirst({
    where: and(
      eq(schema.speakerProfiles.eventId, actor.eventId),
      eq(schema.speakerProfiles.userId, actor.userId),
    ),
  });
  if (!profile)
    questionFailure(
      'QUESTION_ACCESS_DENIED',
      403,
      'Profil řečníka není propojen s účtem.',
    );
  return { ...actor, profile };
}
async function speakerSession(
  db: QuestionDb,
  actor: Awaited<ReturnType<typeof speakerActor>>,
  sessionId: string,
  now: Date,
) {
  const link = await db.query.sessionSpeakers.findFirst({
    where: and(
      eq(schema.sessionSpeakers.eventId, actor.eventId),
      eq(schema.sessionSpeakers.sessionId, sessionId),
      eq(schema.sessionSpeakers.speakerProfileId, actor.profile.id),
    ),
  });
  if (!link)
    questionFailure(
      'QUESTION_ACCESS_DENIED',
      403,
      'Tato přednáška vám není přiřazena.',
    );
  const session = await loadQuestionSession(db, actor.eventId, sessionId, now);
  if (session.record.questionMode !== 'moderated_follow_up')
    questionFailure(
      'QUESTIONS_UNSUPPORTED',
      409,
      'Tento blok nepodporuje dotazy.',
    );
  if (now < session.record.endsAt)
    questionFailure(
      'QUESTIONS_NOT_OPEN',
      409,
      'Dotazy řečníkům zpřístupníme po skončení přednášky.',
    );
  return session;
}
const errorResponse = (request: Request, error: unknown) => {
  const response = problemResponse(error, getRequestId(request.headers));
  Object.entries(questionPrivateHeaders).forEach(([key, value]) =>
    response.headers.set(key, value),
  );
  return response;
};
export async function readSpeakerSessions(
  request: Request,
  deps: QuestionsDependencies,
) {
  try {
    const actor = await speakerActor(request, deps),
      now = deps.now?.() ?? new Date();
    const links = await deps.db.query.sessionSpeakers.findMany({
      where: and(
        eq(schema.sessionSpeakers.eventId, actor.eventId),
        eq(schema.sessionSpeakers.speakerProfileId, actor.profile.id),
      ),
    });
    const sessions: QuestionSessionList['sessions'] = [];
    for (const link of links) {
      let session;
      try {
        session = await speakerSession(deps.db, actor, link.sessionId, now);
      } catch (e) {
        if (e instanceof ApiProblemError && [404, 409].includes(e.status))
          continue;
        throw e;
      }
      const [counts] = await deps.db
        .select({
          total: sql<number>`count(*)::integer`,
          unanswered: sql<number>`count(*) filter (where ${schema.questionAnswers.id} is null)::integer`,
        })
        .from(schema.questions)
        .leftJoin(
          schema.questionAnswers,
          eq(schema.questionAnswers.questionId, schema.questions.id),
        )
        .where(
          and(
            eq(schema.questions.eventId, actor.eventId),
            eq(schema.questions.sessionId, link.sessionId),
          ),
        );
      sessions.push({
        ...session.context.session,
        state: session.context.state,
        questionCount: counts?.total ?? 0,
        unansweredCount: counts?.unanswered ?? 0,
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
  } catch (e) {
    return errorResponse(request, e);
  }
}
export async function readSpeakerQuestions(
  request: Request,
  sessionId: string,
  deps: QuestionsDependencies,
) {
  try {
    if (!z.string().uuid().safeParse(sessionId).success)
      questionFailure('VALIDATION_FAILED', 422, 'Neplatná přednáška.');
    const actor = await speakerActor(request, deps),
      now = deps.now?.() ?? new Date();
    const session = await speakerSession(deps.db, actor, sessionId, now);
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = speakerQuestionQuerySchema.safeParse({
      ...params,
      ...(params.limit ? { limit: Number(params.limit) } : {}),
    });
    if (!parsed.success)
      questionFailure('VALIDATION_FAILED', 422, 'Neplatné stránkování.');
    const query = parsed.data,
      limit = query.limit ?? 100,
      after = query.after ? new Date(query.after) : null;
    // Deliberately do not select or join participant identity in the speaker feed.
    const rows = await deps.db
      .select({
        questionId: schema.questions.id,
        text: schema.questions.text,
        createdAt: schema.questions.createdAt,
        answer: schema.questionAnswers,
      })
      .from(schema.questions)
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
          eq(schema.questions.sessionId, sessionId),
          query.status === 'answered'
            ? isNotNull(schema.questionAnswers.id)
            : query.status === 'all'
              ? undefined
              : isNull(schema.questionAnswers.id),
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
      speakerQuestionFeedSchema.parse({
        eventId: actor.eventId,
        session: session.context.session,
        serverTime: now.toISOString(),
        items: rows.map((r) => ({
          questionId: r.questionId,
          text: r.text,
          submittedAt: r.createdAt.toISOString(),
          answer: r.answer ? answerDto(r.answer) : null,
          canEdit: r.answer?.answeredByUserId === actor.userId,
        })),
        nextCursor: rows.length === limit ? rows.at(-1)!.questionId : null,
      }),
      { headers: questionPrivateHeaders },
    );
  } catch (e) {
    return errorResponse(request, e);
  }
}
export async function writeQuestionAnswer(
  request: Request,
  questionId: string,
  deps: QuestionsDependencies,
) {
  try {
    if (
      !['PUT', 'PATCH'].includes(request.method) ||
      request.headers.get('origin') !== deps.allowedOrigin ||
      request.headers.get('content-type')?.split(';')[0] !==
        'application/json' ||
      new URL(request.url).search ||
      !z.string().uuid().safeParse(questionId).success
    )
      questionFailure('VALIDATION_FAILED', 422, 'Neplatný požadavek.');
    const actor = await speakerActor(request, deps);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 20000)
      questionFailure('VALIDATION_FAILED', 422, 'Odpověď je příliš dlouhá.');
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      questionFailure('VALIDATION_FAILED', 422, 'Neplatný JSON.');
    }
    const parsed = (
      request.method === 'PUT'
        ? questionAnswerPublishSchema
        : questionAnswerEditSchema
    ).safeParse(json);
    if (!parsed.success)
      questionFailure(
        'VALIDATION_FAILED',
        422,
        'Odpověď musí mít 1–4000 znaků a platnou verzi.',
      );
    const question = await deps.db.query.questions.findFirst({
      columns: { sessionId: true },
      where: and(
        eq(schema.questions.eventId, actor.eventId),
        eq(schema.questions.id, questionId),
      ),
    });
    if (!question)
      questionFailure('QUESTION_NOT_FOUND', 404, 'Dotaz nebyl nalezen.');
    await speakerSession(
      deps.db,
      actor,
      question.sessionId,
      deps.now?.() ?? new Date(),
    );
    const result = await executeIdempotentMutation(
      deps.db,
      {
        eventId: actor.eventId,
        actorId: actor.userId,
        scope: `question.answer.${request.method.toLowerCase()}.${questionId}`,
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
        await lockQuestionAccess(
          tx,
          actor.eventId,
          actor.userId,
          question.sessionId,
        );
        await tx.execute(
          sql`select id from speaker_profiles where event_id=${actor.eventId} and user_id=${actor.userId} for share`,
        );
        await tx.execute(
          sql`select session_id from session_speakers where event_id=${actor.eventId} and session_id=${question.sessionId} for share`,
        );
        const current = await speakerActor(request, deps, tx),
          now = deps.now?.() ?? new Date();
        await speakerSession(tx, current, question.sessionId, now);
        await tx.execute(
          sql`select id from questions where event_id=${actor.eventId} and id=${questionId} for update`,
        );
        const existing = await tx.query.questionAnswers.findFirst({
          where: and(
            eq(schema.questionAnswers.eventId, actor.eventId),
            eq(schema.questionAnswers.questionId, questionId),
          ),
        });
        let answer;
        if (request.method === 'PUT') {
          if (existing)
            questionFailure(
              'QUESTION_ANSWER_CONFLICT',
              409,
              'Na dotaz už odpověděl řečník. Načtěte aktuální odpověď.',
            );
          [answer] = await tx
            .insert(schema.questionAnswers)
            .values({
              id: generateUuidV7(),
              eventId: actor.eventId,
              sessionId: question.sessionId,
              questionId,
              speakerProfileId: current.profile.id,
              answeredByUserId: actor.userId,
              speakerName:
                `${current.profile.firstName} ${current.profile.lastName}`
                  .replace(
                    /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g,
                    '',
                  )
                  .trim() || 'Řečník',
              text: parsed.data.text,
              publishedAt: now,
              updatedAt: now,
              version: 1,
            })
            .returning();
        } else {
          if (!existing)
            questionFailure(
              'QUESTION_NOT_FOUND',
              404,
              'Odpověď nebyla nalezena.',
            );
          if (existing.answeredByUserId !== actor.userId)
            questionFailure(
              'QUESTION_ACCESS_DENIED',
              403,
              'Upravit lze jen vlastní odpověď.',
            );
          if (existing.version !== parsed.data.expectedVersion)
            questionFailure(
              'QUESTION_ANSWER_CONFLICT',
              409,
              'Odpověď se změnila v jiném okně. Načtěte aktuální verzi.',
            );
          [answer] = await tx
            .update(schema.questionAnswers)
            .set({
              text: parsed.data.text,
              updatedAt: now,
              version: existing.version + 1,
            })
            .where(eq(schema.questionAnswers.id, existing.id))
            .returning();
        }
        if (!answer) throw new Error('Answer mutation failed');
        await writeAuditLog(
          tx,
          {
            eventId: actor.eventId,
            actorId: actor.userId,
            actorType: 'user',
            action:
              request.method === 'PUT'
                ? 'question.answer.published'
                : 'question.answer.edited',
            targetType: 'question_answer',
            targetId: answer.id,
            requestId: getRequestId(request.headers),
            after: { version: answer.version },
          },
          { occurredAt: now },
        );
        // The idempotency ledger stores metadata only, never private answer text.
        return {
          status: request.method === 'PUT' ? 201 : 200,
          body: { answerId: answer.id, version: answer.version },
          resultReference: answer.id,
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
  } catch (e) {
    return errorResponse(request, e);
  }
}
