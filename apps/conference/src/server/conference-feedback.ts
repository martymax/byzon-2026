import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  conferenceFeedbackPatchSchema,
  conferenceFeedbackResponseSchema,
  conferenceFeedbackRoleSchema,
  feedbackAdminOverviewSchema,
  feedbackFilterSchema,
  feedbackSendRequestSchema,
  feedbackSendResponseSchema,
  type ConferenceFeedbackRole,
  type FeedbackAdminOverview,
  type FeedbackQuestionReport,
  type FeedbackRecipient,
} from '@byzon/domain/contracts';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  authorizeInvitationAccess,
  type InvitationDependencies,
} from './admin-invitations';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { loadEventSurveyProgram } from './event-survey';
import { CURRENT_EVENT_SLUG } from './current-event';
import { EventAccessDeniedError } from './policy';
// Shared metadata keeps visibility, validation and reporting aligned with the questionnaire.
import { CONFERENCE_FEEDBACK_QUESTIONS } from '../lib/conference-feedback';

type DB = Database | DatabaseTransaction;
type Feedback = typeof schema.conferenceFeedbackResponses.$inferSelect;
type FeedbackQuestion = {
  id: string;
  label: string;
  type: 'choice' | 'text';
  options?: readonly { value: string; label: string }[];
  roles?: readonly ConferenceFeedbackRole[];
  maxLength?: number;
  when?: readonly [string, string];
};
export interface FeedbackDependencies extends InvitationDependencies {
  allowedOrigin: string;
  tokenSecret: string;
  now?: () => Date;
  rateLimit?: (digest: string) => Promise<void>;
}
const invalid = (detail: string, status = 422) =>
  new ApiProblemError({
    status,
    code: 'VALIDATION_FAILED',
    title: 'Hodnocení není dostupné',
    detail,
  });
const unavailable = () =>
  invalid('Tento odkaz na hodnocení není platný nebo už není dostupný.', 404);
const responseHeaders = (requestId: string) => ({
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
  vary: 'Authorization, Cookie',
});
export const hashFeedbackToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');
/** Domain-separated capability: this token has no authentication/session semantics. */
export const createFeedbackToken = (
  secret: string,
  row: Pick<Feedback, 'id' | 'eventId' | 'userId'>,
) => {
  if (Buffer.byteLength(secret) < 32)
    throw new TypeError('Feedback token secret is too short');
  return createHmac('sha256', secret)
    .update(
      `byzon:conference-feedback:v1:${row.eventId}:${row.userId}:${row.id}`,
    )
    .digest('base64url');
};
const feedbackScope = (eventId: string, userId: string) =>
  and(
    eq(schema.conferenceFeedbackResponses.eventId, eventId),
    eq(schema.conferenceFeedbackResponses.userId, userId),
  );

export function legacyFeedbackAnswers(
  rating: Pick<
    typeof schema.ratings.$inferSelect,
    'score' | 'comment' | 'survey'
  >,
): Record<string, string> {
  const answers: Record<string, string> = { score: String(rating.score) };
  if (rating.comment) answers.comment = rating.comment;
  const survey = rating.survey ?? {};
  for (const question of questionList()) {
    const value = survey[question.id];
    if (typeof value === 'boolean') answers[question.id] = value ? 'yes' : 'no';
    else if (typeof value === 'number' || typeof value === 'string')
      answers[question.id] = String(value);
    else if (
      value === null &&
      question.options?.some((option) => option.value === 'skip')
    )
      answers[question.id] = 'skip';
  }
  if (Array.isArray(survey.sessions))
    for (const raw of survey.sessions) {
      const parsed = z
        .object({
          sessionId: z.string().uuid(),
          score: z.number().int().min(1).max(4).nullable(),
        })
        .safeParse(raw);
      if (parsed.success && parsed.data.score !== null)
        answers[`session:${parsed.data.sessionId}`] = String(parsed.data.score);
    }
  return answers;
}

export async function ensureConferenceFeedbackResponse(
  db: DB,
  eventId: string,
  userId: string,
  secret: string,
) {
  let row = await db.query.conferenceFeedbackResponses.findFirst({
    where: feedbackScope(eventId, userId),
  });
  if (!row) {
    const id = generateUuidV7();
    const token = createFeedbackToken(secret, { id, eventId, userId });
    const legacy = await db.query.ratings.findFirst({
      where: and(
        eq(schema.ratings.eventId, eventId),
        eq(schema.ratings.userId, userId),
        eq(schema.ratings.targetType, 'event'),
      ),
    });
    await db
      .insert(schema.conferenceFeedbackResponses)
      .values({
        id,
        eventId,
        userId,
        tokenHash: hashFeedbackToken(token),
        ...(legacy
          ? {
              answers: legacyFeedbackAnswers(legacy),
              currentStep: 'future',
              startedAt: legacy.createdAt,
              completedAt: legacy.createdAt,
            }
          : {}),
      })
      .onConflictDoNothing({
        target: [
          schema.conferenceFeedbackResponses.eventId,
          schema.conferenceFeedbackResponses.userId,
        ],
      });
    row = await db.query.conferenceFeedbackResponses.findFirst({
      where: feedbackScope(eventId, userId),
    });
  }
  if (!row) throw new Error('Feedback response creation failed');
  const token = createFeedbackToken(secret, row);
  const tokenHash = hashFeedbackToken(token);
  if (row.tokenHash !== tokenHash) {
    // Rotating the signing secret deliberately revokes earlier capabilities.
    await db
      .update(schema.conferenceFeedbackResponses)
      .set({ tokenHash })
      .where(eq(schema.conferenceFeedbackResponses.id, row.id));
    row = { ...row, tokenHash };
  }
  return { response: row, token };
}

const candidateQuery = (db: DB, eventId: string, userId?: string) =>
  db
    .select({
      userId: schema.participantProfiles.userId,
      firstName: schema.participantProfiles.firstName,
      lastName: schema.participantProfiles.lastName,
      email: schema.participantProfiles.contactEmail,
      emailEnabled: schema.participantProfiles.ratingEmailsEnabled,
      suggestedRole: sql<ConferenceFeedbackRole>`case
    when exists (select 1 from ${schema.eventRoles} r where r.event_id = ${eventId} and r.user_id = ${schema.participantProfiles.userId} and r.role = 'speaker' and r.revoked_at is null) or exists (select 1 from ${schema.speakerProfiles} s where s.event_id = ${eventId} and s.user_id = ${schema.participantProfiles.userId}) then 'speaker'
    when exists (select 1 from ${schema.eventRoles} r where r.event_id = ${eventId} and r.user_id = ${schema.participantProfiles.userId} and r.role = 'moderator' and r.revoked_at is null) then 'moderator'
    when exists (select 1 from ${schema.partners} p where p.event_id = ${eventId} and lower(trim(p.name)) = lower(trim(${schema.participantProfiles.company})) and length(trim(p.name)) > 0) then 'partner'
    else 'attendee' end`,
    })
    .from(schema.participantProfiles)
    .innerJoin(
      schema.eventMemberships,
      and(
        eq(schema.eventMemberships.eventId, schema.participantProfiles.eventId),
        eq(schema.eventMemberships.userId, schema.participantProfiles.userId),
      ),
    )
    .where(
      and(
        eq(schema.participantProfiles.eventId, eventId),
        eq(schema.eventMemberships.status, 'active'),
        userId ? eq(schema.participantProfiles.userId, userId) : undefined,
        sql`exists (select 1 from ${schema.eventRoles} er where er.event_id = ${eventId} and er.user_id = ${schema.participantProfiles.userId} and er.role in ('participant','speaker','moderator') and er.revoked_at is null)`,
        sql`not exists (select 1 from ${schema.privacyRequests} pr where pr.event_id = ${eventId} and pr.user_id = ${schema.participantProfiles.userId} and pr.status in ('pending','completed'))`,
      ),
    );

const questionList = (): readonly FeedbackQuestion[] =>
  CONFERENCE_FEEDBACK_QUESTIONS;
const effectiveRole = (
  answers: Record<string, string>,
  fallback: ConferenceFeedbackRole,
): ConferenceFeedbackRole => {
  const parsed = conferenceFeedbackRoleSchema.safeParse(
    answers.participantRole,
  );
  return parsed.success ? parsed.data : fallback;
};
const visibleQuestion = (
  question: FeedbackQuestion,
  role: ConferenceFeedbackRole,
  answers: Record<string, string>,
) =>
  (!question.roles || question.roles.includes(role)) &&
  (!question.when || answers[question.when[0]] === question.when[1]);
export function visibleFeedbackAnswers(
  answers: Record<string, string>,
  role: ConferenceFeedbackRole,
  sessionTypes: ReadonlyMap<string, string> = new Map(),
) {
  return Object.fromEntries(
    Object.entries(answers).filter(
      ([key]) =>
        (key.startsWith('session:') &&
          (!['workshop', 'mastermind'].includes(
            sessionTypes.get(key.slice(8)) ?? '',
          ) ||
            answers.workshopsAttended === 'yes')) ||
        questionList().some(
          (question) =>
            question.id === key && visibleQuestion(question, role, answers),
        ),
    ),
  );
}
export function validateFeedbackAnswers(
  answers: Record<string, string>,
  sessionIds: ReadonlySet<string>,
) {
  for (const [key, value] of Object.entries(answers)) {
    if (key.startsWith('session:')) {
      if (
        !sessionIds.has(key.slice(8)) ||
        !['', '1', '2', '3', '4', 'skip'].includes(value)
      )
        throw invalid('Vyberte hodnocení programu z nabídky.');
      continue;
    }
    const question = questionList().find((item) => item.id === key);
    if (
      !question ||
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype'
    )
      throw invalid('Tato otázka není součástí hodnocení.');
    if (value === '') continue; // Empty values clear an answer.
    if (
      question.type === 'choice' &&
      !question.options?.some((option) => option.value === value)
    )
      throw invalid('Vyberte jednu z nabízených odpovědí.');
    if (value.length > (question.maxLength ?? 2000))
      throw invalid('Odpověď je příliš dlouhá.');
  }
}

async function feedbackContext(
  db: DB,
  token: string,
  eventSlug: string,
  now: Date,
  secret: string,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
  const row = await db.query.conferenceFeedbackResponses.findFirst({
    where: eq(
      schema.conferenceFeedbackResponses.tokenHash,
      hashFeedbackToken(token),
    ),
  });
  if (
    !row ||
    !timingSafeEqual(
      Buffer.from(token),
      Buffer.from(createFeedbackToken(secret, row)),
    )
  )
    throw unavailable();
  const event = await db.query.events.findFirst({
    where: and(
      eq(schema.events.id, row.eventId),
      eq(schema.events.slug, eventSlug),
    ),
  });
  if (
    !event ||
    ['draft', 'archived'].includes(event.status) ||
    (event.operationalDataAnonymizesAt &&
      event.operationalDataAnonymizesAt <= now)
  )
    throw unavailable();
  const candidates = await candidateQuery(db, row.eventId, row.userId);
  const candidate = candidates.find((item) => item.userId === row.userId);
  if (!candidate) throw unavailable();
  return { row, event, candidate };
}

export async function handleConferenceFeedback(
  request: Request,
  token: string,
  deps: FeedbackDependencies,
): Promise<Response> {
  const requestId = getRequestId(request.headers);
  const headers = responseHeaders(requestId);
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
    await deps.rateLimit?.(hashFeedbackToken(token));
    const now = deps.now?.() ?? new Date();
    const context = await feedbackContext(
      deps.db,
      token,
      deps.currentEventSlug ?? CURRENT_EVENT_SLUG,
      now,
      deps.tokenSecret,
    );
    const program = await loadEventSurveyProgram(
      deps.db,
      context.row.eventId,
      now,
    );
    let row = context.row;
    if (request.method !== 'GET') {
      if (request.headers.get('origin') !== deps.allowedOrigin)
        throw invalid('Požadavek musí přijít z této aplikace.', 403);
      const raw = await request.text();
      if (raw.length > 520_000) throw invalid('Hodnocení je příliš dlouhé.');
      let body: unknown;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        throw invalid('Hodnocení se nepodařilo přečíst.');
      }
      const parsed = conferenceFeedbackPatchSchema.safeParse(body);
      if (!parsed.success) throw invalid('Zkontrolujte vyplněné odpovědi.');
      validateFeedbackAnswers(
        parsed.data.answers ?? {},
        new Set(program?.sessions.map((item) => item.id)),
      );
      row = await deps.db.transaction(async (tx) => {
        // Serializes merges, including simultaneous saves from different browsers.
        const [locked] = await tx
          .select()
          .from(schema.conferenceFeedbackResponses)
          .where(eq(schema.conferenceFeedbackResponses.id, row.id))
          .for('update');
        if (!locked) throw unavailable();
        const merged = { ...locked.answers, ...parsed.data.answers };
        const answers = Object.fromEntries(
          Object.entries(merged).filter(([, value]) => value !== ''),
        );
        if (
          request.method === 'POST' &&
          !conferenceFeedbackRoleSchema.safeParse(answers.participantRole)
            .success
        )
          throw invalid('Vyberte prosím svou roli na konferenci.');
        const [updated] = await tx
          .update(schema.conferenceFeedbackResponses)
          .set({
            answers,
            currentStep: parsed.data.currentStep ?? locked.currentStep,
            startedAt:
              locked.startedAt ?? (Object.keys(answers).length ? now : null),
            completedAt:
              request.method === 'POST'
                ? (locked.completedAt ?? now)
                : locked.completedAt,
            updatedAt: now,
          })
          .where(eq(schema.conferenceFeedbackResponses.id, locked.id))
          .returning();
        if (!updated) throw unavailable();
        return updated;
      });
    }
    const data = {
      answers: visibleFeedbackAnswers(
        row.answers,
        effectiveRole(row.answers, context.candidate.suggestedRole),
        new Map(program?.sessions.map((session) => [session.id, session.type])),
      ),
      currentStep: row.currentStep,
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      suggestedRole: context.candidate.suggestedRole,
      firstName: context.candidate.firstName,
      eventName: context.event.name,
      program,
    };
    return Response.json(conferenceFeedbackResponseSchema.parse({ data }), {
      headers,
    });
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(headers).forEach(([key, value]) =>
      response.headers.set(key, value),
    );
    return response;
  }
}

export function aggregateFeedbackQuestions(
  rows: {
    answers: Record<string, string>;
    role: ConferenceFeedbackRole;
    status: FeedbackRecipient['status'];
  }[],
  questions: readonly FeedbackQuestion[] = questionList(),
): FeedbackQuestionReport[] {
  return questions.map((question) => {
    const eligible = rows.filter((row) =>
      visibleQuestion(question, row.role, row.answers),
    );
    const answered = eligible.filter(
      (row) => !!row.answers[question.id]?.trim(),
    );
    const values = answered.map((row) => row.answers[question.id]!);
    const scores =
      question.type === 'choice'
        ? values
            .filter(
              (value) =>
                /^[1-5]$/.test(value) &&
                question.options?.some((option) => option.value === value),
            )
            .map(Number)
        : [];
    return {
      id: question.id,
      label: question.label,
      type: question.type,
      eligible: eligible.length,
      answered: answered.length,
      notApplicable: values.filter((value) =>
        [
          'skip',
          'not_applicable',
          'not_attended',
          'not_used',
          'not_noticed',
          'cannot_judge',
        ].includes(value),
      ).length,
      average: scores.length
        ? Math.round(
            (scores.reduce((a, b) => a + b, 0) / scores.length) * 100,
          ) / 100
        : null,
      options: (question.options ?? []).map((option) => ({
        ...option,
        count: values.filter((value) => value === option.value).length,
      })),
      comments:
        question.type === 'text'
          ? answered.map((row) => ({
              value: row.answers[question.id]!,
              role: row.role,
              status: row.status,
            }))
          : [],
    };
  });
}

const buildOverview = async (
  db: Database,
  eventId: string,
  filters: z.infer<typeof feedbackFilterSchema>,
  now: Date,
): Promise<{
  data: FeedbackAdminOverview;
  answers: Map<string, Record<string, string>>;
}> => {
  const [event, candidates, responses, deliveries, program, legacyRatings] =
    await Promise.all([
      db.query.events.findFirst({ where: eq(schema.events.id, eventId) }),
      candidateQuery(db, eventId).orderBy(
        asc(schema.participantProfiles.lastName),
        asc(schema.participantProfiles.firstName),
      ),
      db
        .select()
        .from(schema.conferenceFeedbackResponses)
        .where(eq(schema.conferenceFeedbackResponses.eventId, eventId)),
      db
        .select({
          userId: schema.emailDeliveries.userId,
          status: schema.emailDeliveries.status,
          lastError: schema.emailDeliveries.lastError,
        })
        .from(schema.emailDeliveries)
        .where(
          and(
            eq(schema.emailDeliveries.eventId, eventId),
            sql`${schema.emailDeliveries.payload}->>'kind' = 'conference_feedback'`,
          ),
        )
        .orderBy(desc(schema.emailDeliveries.createdAt)),
      loadEventSurveyProgram(db, eventId, now),
      db
        .select()
        .from(schema.ratings)
        .where(
          and(
            eq(schema.ratings.eventId, eventId),
            eq(schema.ratings.targetType, 'event'),
          ),
        ),
    ]);
  if (!event) throw unavailable();
  const byUser = new Map(responses.map((row) => [row.userId, row]));
  const legacyByUser = new Map(legacyRatings.map((row) => [row.userId, row]));
  const mailByUser = new Map<string, (typeof deliveries)[number]>();
  for (const delivery of deliveries)
    if (!mailByUser.has(delivery.userId))
      mailByUser.set(delivery.userId, delivery);
  const answers = new Map<string, Record<string, string>>();
  const recipients = candidates
    .map((candidate): FeedbackRecipient => {
      const legacy = legacyByUser.get(candidate.userId);
      const row =
        byUser.get(candidate.userId) ??
        (legacy
          ? {
              answers: legacyFeedbackAnswers(legacy),
              startedAt: legacy.createdAt,
              completedAt: legacy.createdAt,
              invitedAt: null,
              remindedAt: null,
            }
          : undefined);
      const role = effectiveRole(row?.answers ?? {}, candidate.suggestedRole);
      answers.set(
        candidate.userId,
        visibleFeedbackAnswers(row?.answers ?? {}, role),
      );
      const mail = mailByUser.get(candidate.userId);
      return {
        id: candidate.userId,
        name: `${candidate.firstName} ${candidate.lastName}`.trim(),
        email: candidate.email,
        emailEnabled: candidate.emailEnabled,
        suggestedRole: candidate.suggestedRole,
        role,
        status: row?.completedAt
          ? 'completed'
          : row?.startedAt
            ? 'in_progress'
            : 'not_started',
        invitedAt: row?.invitedAt?.toISOString() ?? null,
        remindedAt: row?.remindedAt?.toISOString() ?? null,
        mailStatus: mail
          ? mail.lastError && mail.status === 'delivered'
            ? 'skipped'
            : mail.status
          : 'not_sent',
      };
    })
    .filter(
      (row) =>
        (filters.role === 'all' || row.role === filters.role) &&
        (filters.status === 'all' || row.status === filters.status),
    );
  const rows = recipients.map((row) => ({
    answers: answers.get(row.id)!,
    role: row.role,
    status: row.status,
  }));
  const historicalSessionIds = new Set(
    rows.flatMap((row) =>
      Object.keys(row.answers)
        .filter((key) => key.startsWith('session:'))
        .map((key) => key.slice(8)),
    ),
  );
  const currentSessions = program?.sessions ?? [];
  const missingSessionIds = [...historicalSessionIds].filter(
    (id) => !currentSessions.some((session) => session.id === id),
  );
  const historicalSessions = missingSessionIds.length
    ? await db
        .select({
          id: schema.programSessions.id,
          title: schema.programSessions.title,
          type: schema.programSessions.type,
        })
        .from(schema.programSessions)
        .where(
          and(
            eq(schema.programSessions.eventId, eventId),
            inArray(schema.programSessions.id, missingSessionIds),
          ),
        )
    : [];
  const sessions = [
    ...currentSessions,
    ...missingSessionIds.map((id) => ({
      id,
      title:
        historicalSessions.find((session) => session.id === id)?.title ??
        `Program – ${id}`,
      type:
        historicalSessions.find((session) => session.id === id)?.type ?? 'talk',
    })),
  ];
  const sessionQuestions: FeedbackQuestion[] = sessions.map((session) => ({
    id: `session:${session.id}`,
    label: session.title,
    type: 'choice',
    ...(['workshop', 'mastermind'].includes(session.type)
      ? { when: ['workshopsAttended', 'yes'] as const }
      : {}),
    options: [
      { value: '4', label: 'Velmi dobré' },
      { value: '3', label: 'Spíše dobré' },
      { value: '2', label: 'Spíše špatné' },
      { value: '1', label: 'Velmi špatné' },
      { value: 'skip', label: 'Nezúčastnil/a jsem se' },
    ],
  }));
  for (const row of rows)
    for (const question of sessionQuestions) {
      if (!visibleQuestion(question, row.role, row.answers))
        delete row.answers[question.id];
    }
  return {
    answers,
    data: {
      eventId,
      eventName: event.name,
      updatedAt: now.toISOString(),
      recipients,
      summary: {
        total: recipients.length,
        invited: recipients.filter((row) => row.invitedAt).length,
        started: recipients.filter((row) => row.status !== 'not_started')
          .length,
        completed: recipients.filter((row) => row.status === 'completed')
          .length,
        inProgress: recipients.filter((row) => row.status === 'in_progress')
          .length,
        notStarted: recipients.filter((row) => row.status === 'not_started')
          .length,
        optedOut: recipients.filter((row) => !row.emailEnabled).length,
      },
      questions: aggregateFeedbackQuestions(rows, [
        ...questionList(),
        ...sessionQuestions,
      ]),
      roles: conferenceFeedbackRoleSchema.options.map((role) => {
        const matching = recipients.filter((row) => row.role === role);
        return {
          role,
          total: matching.length,
          started: matching.filter((row) => row.status !== 'not_started')
            .length,
          completed: matching.filter((row) => row.status === 'completed')
            .length,
        };
      }),
    },
  };
};

/** Quote all cells and neutralize spreadsheet formulas, including leading whitespace/control prefixes. */
export const feedbackCsvCell = (value: unknown): string => {
  let text = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};

export async function handleAdminConferenceFeedback(
  request: Request,
  eventId: string,
  deps: FeedbackDependencies,
  action: 'overview' | 'export' | 'send' = 'overview',
): Promise<Response> {
  const requestId = getRequestId(request.headers);
  const headers = responseHeaders(requestId);
  try {
    const { actorId, event } = await authorizeInvitationAccess(
      request,
      eventId,
      deps,
    );
    if (action === 'send' || action === 'export') {
      await deps.rateLimit?.(
        hashFeedbackToken(`admin-feedback:${action}:${eventId}:${actorId}`),
      );
    }
    const now = deps.now?.() ?? new Date();
    if (action === 'send') {
      if (request.headers.get('origin') !== deps.allowedOrigin)
        throw invalid('Požadavek musí přijít z této aplikace.', 403);
      if (!['activation_open', 'live', 'ended'].includes(event.status))
        throw invalid('Této akci nyní nelze rozeslat hodnocení.', 409);
      const raw = await request.text();
      if (raw.length > 220_000)
        throw invalid('Vyberte nejvýše 5 000 příjemců.');
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw invalid('Neplatný výběr příjemců.');
      }
      const parsed = feedbackSendRequestSchema.safeParse(body);
      if (!parsed.success)
        throw invalid('Vyberte 1 až 5 000 různých příjemců.');
      const result = await executeIdempotentMutation(
        deps.db,
        {
          eventId,
          actorId,
          scope: 'feedback.send',
          key: readIdempotencyKey(request.headers),
          requestHash: hashIdempotencyRequest({
            method: 'POST',
            path: new URL(request.url).pathname,
            body: raw,
          }),
          ttlMs: 7 * 24 * 60 * 60_000,
        },
        async (tx) => {
          await acquireTransactionLock(
            tx,
            `conference-feedback-send:${eventId}`,
          );
          const fullEvent = await tx.query.events.findFirst({
            where: eq(schema.events.id, eventId),
          });
          if (
            !fullEvent ||
            (fullEvent.operationalDataAnonymizesAt &&
              fullEvent.operationalDataAnonymizesAt <= now)
          )
            throw invalid('Hodnocení už nelze rozesílat.', 409);
          const candidates = await candidateQuery(tx, eventId);
          const selected = new Set(parsed.data.participantIds);
          const eligible = candidates.filter(
            (row) => selected.has(row.userId) && row.emailEnabled,
          );
          const existingResponses = await tx
            .select()
            .from(schema.conferenceFeedbackResponses)
            .where(eq(schema.conferenceFeedbackResponses.eventId, eventId));
          const legacyRatings = await tx
            .select()
            .from(schema.ratings)
            .where(
              and(
                eq(schema.ratings.eventId, eventId),
                eq(schema.ratings.targetType, 'event'),
              ),
            );
          const existingDeliveries = await tx
            .select()
            .from(schema.emailDeliveries)
            .where(
              and(
                eq(schema.emailDeliveries.eventId, eventId),
                sql`${schema.emailDeliveries.payload}->>'kind' = 'conference_feedback'`,
              ),
            );
          const existingUsers = new Set(
            existingResponses.map((row) => row.userId),
          );
          const legacyByUser = new Map(
            legacyRatings.map((row) => [row.userId, row]),
          );
          const newResponses = eligible
            .filter((candidate) => !existingUsers.has(candidate.userId))
            .map((candidate) => {
              const row = {
                id: generateUuidV7(),
                eventId,
                userId: candidate.userId,
              };
              const legacy = legacyByUser.get(candidate.userId);
              return {
                ...row,
                tokenHash: hashFeedbackToken(
                  createFeedbackToken(deps.tokenSecret, row),
                ),
                ...(legacy
                  ? {
                      answers: legacyFeedbackAnswers(legacy),
                      currentStep: 'future',
                      startedAt: legacy.createdAt,
                      completedAt: legacy.createdAt,
                    }
                  : {}),
              };
            });
          // Bound parameters and round trips for large audience selections. A concurrent
          // authenticated open may already have created the same participant response.
          for (let offset = 0; offset < newResponses.length; offset += 500) {
            await tx
              .insert(schema.conferenceFeedbackResponses)
              .values(newResponses.slice(offset, offset + 500))
              .onConflictDoNothing({
                target: [
                  schema.conferenceFeedbackResponses.eventId,
                  schema.conferenceFeedbackResponses.userId,
                ],
              });
          }
          const responses = newResponses.length
            ? await tx
                .select()
                .from(schema.conferenceFeedbackResponses)
                .where(eq(schema.conferenceFeedbackResponses.eventId, eventId))
            : existingResponses;
          const responseByUser = new Map(
            responses.map((row) => [row.userId, row]),
          );
          const deduplicationKey = `conference_feedback:${parsed.data.kind}:v1`;
          const previousByUser = new Map(
            existingDeliveries
              .filter((row) => row.deduplicationKey === deduplicationKey)
              .map((row) => [row.userId, row]),
          );
          const activeUsers = new Set(
            existingDeliveries
              .filter((row) => ['pending', 'processing'].includes(row.status))
              .map((row) => row.userId),
          );
          const queuedIds: string[] = [];
          const newDeliveries: (typeof schema.emailDeliveries.$inferInsert)[] =
            [];
          const batchId = generateUuidV7();
          for (const candidate of eligible) {
            const response = responseByUser.get(candidate.userId)!;
            const previous = previousByUser.get(candidate.userId);
            if (
              response.completedAt ||
              activeUsers.has(candidate.userId) ||
              (parsed.data.kind === 'invitation' && response.remindedAt) ||
              (previous?.status !== 'failed' &&
                (parsed.data.kind === 'invitation'
                  ? response.invitedAt
                  : !response.invitedAt || response.remindedAt))
            )
              continue;
            const token = createFeedbackToken(deps.tokenSecret, response);
            const tokenHash = hashFeedbackToken(token);
            if (response.tokenHash !== tokenHash)
              await tx
                .update(schema.conferenceFeedbackResponses)
                .set({ tokenHash })
                .where(eq(schema.conferenceFeedbackResponses.id, response.id));
            const payload = {
              kind: 'conference_feedback',
              eventName: fullEvent.name,
              timezone: fullEvent.timezone,
              feedbackId: response.id,
              feedbackUrl: `${deps.allowedOrigin}/hodnoceni/${token}`,
              reminder: parsed.data.kind === 'reminder',
            };
            const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
            if (previous?.status === 'failed') {
              await tx
                .update(schema.emailDeliveries)
                .set({
                  // A manual resend is a fresh delivery. The archived request and
                  // provider key from the failed attempt must remain immutable,
                  // especially if the recipient changed their email address.
                  id: generateUuidV7(),
                  createdAt: now,
                  payload,
                  status: 'pending',
                  attempts: 0,
                  availableAt: now,
                  expiresAt,
                  rendered: null,
                  leaseToken: null,
                  lastError: null,
                  deliveredAt: null,
                })
                .where(eq(schema.emailDeliveries.id, previous.id));
            } else {
              newDeliveries.push({
                id: generateUuidV7(),
                eventId,
                userId: candidate.userId,
                deduplicationKey,
                payload,
                createdAt: now,
                availableAt: now,
                expiresAt,
              });
            }
            queuedIds.push(response.id);
          }
          for (let offset = 0; offset < newDeliveries.length; offset += 500)
            await tx
              .insert(schema.emailDeliveries)
              .values(newDeliveries.slice(offset, offset + 500));
          if (queuedIds.length)
            await tx
              .update(schema.conferenceFeedbackResponses)
              .set(
                parsed.data.kind === 'invitation'
                  ? {
                      invitedAt: sql`coalesce(${schema.conferenceFeedbackResponses.invitedAt}, ${now})`,
                    }
                  : {
                      remindedAt: sql`coalesce(${schema.conferenceFeedbackResponses.remindedAt}, ${now})`,
                    },
              )
              .where(inArray(schema.conferenceFeedbackResponses.id, queuedIds));
          const queued = queuedIds.length;
          await writeAuditLog(tx, {
            eventId,
            actorId,
            actorType: 'user',
            action: 'feedback.batch_queued',
            targetType: 'feedback_batch',
            targetId: batchId,
            requestId,
            after: {
              kind: parsed.data.kind,
              queued,
              skipped: selected.size - queued,
            },
          });
          return {
            status: 202,
            body: feedbackSendResponseSchema.parse({
              data: { queued, skipped: selected.size - queued, batchId },
            }),
            resultReference: batchId,
          };
        },
      );
      return Response.json(result.body, { status: result.status, headers });
    }
    const parsed = feedbackFilterSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) throw invalid('Neplatný filtr hodnocení.');
    const { data, answers } = await buildOverview(
      deps.db,
      eventId,
      parsed.data,
      now,
    );
    if (action === 'export') {
      const columns = [
        'ID účastníka',
        'Role',
        'Stav',
        ...data.questions.map((question) => question.label),
      ];
      const rows = data.recipients.map((recipient) => [
        recipient.id,
        recipient.role,
        recipient.status,
        ...data.questions.map(
          (question) => answers.get(recipient.id)?.[question.id] ?? '',
        ),
      ]);
      await deps.db.transaction((tx) =>
        writeAuditLog(tx, {
          eventId,
          actorId,
          actorType: 'user',
          action: 'feedback.exported',
          targetType: 'event',
          targetId: eventId,
          requestId,
          after: { count: rows.length, ...parsed.data },
        }),
      );
      return new Response(
        `\uFEFF${[columns, ...rows].map((row) => row.map(feedbackCsvCell).join(';')).join('\r\n')}\r\n`,
        {
          headers: {
            ...headers,
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="byzon-hodnoceni.csv"',
          },
        },
      );
    }
    return Response.json(feedbackAdminOverviewSchema.parse({ data }), {
      headers,
    });
  } catch (error) {
    const response = problemResponse(
      error instanceof EventAccessDeniedError
        ? invalid('Pro hodnocení nemáte oprávnění.', 403)
        : error,
      requestId,
    );
    Object.entries(headers).forEach(([key, value]) =>
      response.headers.set(key, value),
    );
    return response;
  }
}
