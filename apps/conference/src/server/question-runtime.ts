import {
  schema,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  publishedProgramSnapshotSchema,
  questionContextSchema,
  type QuestionContext,
} from '@byzon/domain/contracts';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { ApiProblemError } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import type { QuestionsDependencies } from './questions';
export type QuestionDb = Database | DatabaseTransaction;
export function questionFailure(
  code: string,
  status: number,
  detail: string,
): never {
  throw new ApiProblemError({
    code,
    status,
    title: 'Dotazy nejsou dostupné',
    detail,
  });
}
export async function loadQuestionActor(
  request: Request,
  dependencies: QuestionsDependencies,
  db: QuestionDb = dependencies.db,
) {
  const identity = await dependencies.getSession(request.headers);
  if (!identity)
    questionFailure(
      'AUTHENTICATION_REQUIRED',
      401,
      'Přihlaste se do účastnické aplikace.',
    );
  const event = await db.query.events.findFirst({
    where: eq(
      schema.events.slug,
      dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
    ),
  });
  if (!event || event.status === 'draft' || event.status === 'archived')
    questionFailure('EVENT_ACCESS_DENIED', 403, 'Event není dostupný.');
  const [membership, profile, roles] = await Promise.all([
    db.query.eventMemberships.findFirst({
      columns: { status: true },
      where: and(
        eq(schema.eventMemberships.eventId, event.id),
        eq(schema.eventMemberships.userId, identity.user.id),
      ),
    }),
    db.query.participantProfiles.findFirst({
      columns: { userId: true },
      where: and(
        eq(schema.participantProfiles.eventId, event.id),
        eq(schema.participantProfiles.userId, identity.user.id),
      ),
    }),
    db.query.eventRoles.findMany({
      columns: { role: true, scope: true },
      where: and(
        eq(schema.eventRoles.eventId, event.id),
        eq(schema.eventRoles.userId, identity.user.id),
        isNull(schema.eventRoles.revokedAt),
      ),
    }),
  ]);
  if (
    membership?.status !== 'active' ||
    !profile ||
    !roles.some((role) => role.role === 'participant')
  )
    questionFailure(
      'EVENT_ACCESS_DENIED',
      403,
      'Je nutný aktivní účastnický účet.',
    );
  return {
    eventId: event.id,
    userId: identity.user.id,
    eventStatus: event.status,
    roles,
  };
}
export async function loadQuestionSession(
  db: QuestionDb,
  eventId: string,
  sessionId: string,
  now: Date,
): Promise<{
  context: QuestionContext;
  record: typeof schema.programSessions.$inferSelect;
  followUpsEnabled: boolean;
}> {
  const [record, feature, publication] = await Promise.all([
    db.query.programSessions.findFirst({
      where: and(
        eq(schema.programSessions.eventId, eventId),
        eq(schema.programSessions.id, sessionId),
      ),
    }),
    db.query.eventFeatures.findFirst({
      columns: { questionsEnabled: true, questionFollowUpsEnabled: true },
      where: eq(schema.eventFeatures.eventId, eventId),
    }),
    db.query.contentPublications.findFirst({
      columns: { snapshot: true },
      where: eq(schema.contentPublications.eventId, eventId),
      orderBy: [desc(schema.contentPublications.version)],
    }),
  ]);
  const snapshot = publishedProgramSnapshotSchema.safeParse(
    publication?.snapshot,
  );
  const published = snapshot.success
    ? snapshot.data.program.sessions.find(
        (session) => session.id === sessionId && session.status !== 'cancelled',
      )
    : undefined;
  if (!record || record.status !== 'published' || !published)
    questionFailure(
      'SESSION_NOT_FOUND',
      404,
      'Publikovaná přednáška nebyla nalezena.',
    );
  const state: QuestionContext['state'] =
    record.questionMode !== 'moderated_follow_up'
      ? 'unsupported'
      : !feature?.questionsEnabled || !record.questionsEnabled
        ? 'disabled'
        : now < record.startsAt
          ? 'scheduled'
          : now >= record.endsAt
            ? 'closed'
            : 'open';
  const roomName = snapshot.success
    ? (snapshot.data.program.rooms.find((room) => room.id === published.roomId)
        ?.name ?? null)
    : null;
  return {
    record,
    followUpsEnabled: feature?.questionFollowUpsEnabled ?? false,
    context: questionContextSchema.parse({
      eventId,
      serverTime: now.toISOString(),
      session: {
        id: record.id,
        title: published.title,
        startsAt: record.startsAt.toISOString(),
        endsAt: record.endsAt.toISOString(),
        roomName,
      },
      state,
      canSubmit: state === 'open',
      canReadOwn: true,
    }),
  };
}
export function requireQuestionCollection(context: QuestionContext) {
  if (context.state === 'unsupported')
    questionFailure(
      'QUESTIONS_UNSUPPORTED',
      409,
      'Tento blok nepodporuje dotazy.',
    );
  if (context.state === 'disabled')
    questionFailure('QUESTIONS_DISABLED', 409, 'Sběr dotazů je vypnutý.');
  if (context.state === 'scheduled')
    questionFailure(
      'QUESTIONS_NOT_OPEN',
      409,
      'Dotazy se otevřou na začátku přednášky.',
    );
  if (context.state === 'closed')
    questionFailure(
      'QUESTIONS_CLOSED',
      409,
      'Přednáška skončila. Nové dotazy už nelze odeslat.',
    );
}
export async function lockQuestionAccess(
  tx: DatabaseTransaction,
  eventId: string,
  userId: string,
  sessionId: string,
) {
  await tx.execute(sql`select id from events where id=${eventId} for share`);
  await tx.execute(
    sql`select user_id from participant_profiles where event_id=${eventId} and user_id=${userId} for share`,
  );
  await tx.execute(
    sql`select event_id from event_memberships where event_id=${eventId} and user_id=${userId} for share`,
  );
  await tx.execute(
    sql`select id from event_roles where event_id=${eventId} and user_id=${userId} and revoked_at is null for share`,
  );
  await tx.execute(
    sql`select id from sessions where event_id=${eventId} and id=${sessionId} for share`,
  );
  await tx.execute(
    sql`select event_id from event_features where event_id=${eventId} for share`,
  );
}
