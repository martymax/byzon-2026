import { schema, type Database } from '@byzon/database';
import { hostCapabilitiesSchema } from '@byzon/domain/contracts';
import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';

export async function readHostCapabilities(
  request: Request,
  dependencies: {
    db: Database;
    getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
    currentEventSlug?: string;
    now?: () => Date;
  },
): Promise<Response> {
  const headers = {
    'cache-control': 'private, no-store',
    vary: 'Authorization, Cookie',
  };
  try {
    const identity = await dependencies.getSession(request.headers);
    if (!identity)
      throw new ApiProblemError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Přihlášení je nutné',
        detail: 'Přihlaste se do účastnické aplikace.',
      });
    const event = await dependencies.db.query.events.findFirst({
      columns: { id: true, status: true },
      where: and(
        eq(
          schema.events.slug,
          dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
        ),
        inArray(schema.events.status, ['activation_open', 'live', 'ended']),
      ),
    });
    const denied = () =>
      new ApiProblemError({
        status: 403,
        code: 'EVENT_ACCESS_DENIED',
        title: 'Přístup není dostupný',
        detail: 'Je nutný aktivní participant účet.',
      });
    if (!event) throw denied();
    const [membership, profile, roles, features] = await Promise.all([
      dependencies.db.query.eventMemberships.findFirst({
        columns: { status: true },
        where: and(
          eq(schema.eventMemberships.eventId, event.id),
          eq(schema.eventMemberships.userId, identity.user.id),
        ),
      }),
      dependencies.db.query.participantProfiles.findFirst({
        columns: { userId: true },
        where: and(
          eq(schema.participantProfiles.eventId, event.id),
          eq(schema.participantProfiles.userId, identity.user.id),
        ),
      }),
      dependencies.db.query.eventRoles.findMany({
        columns: { role: true, scope: true },
        where: and(
          eq(schema.eventRoles.eventId, event.id),
          eq(schema.eventRoles.userId, identity.user.id),
          isNull(schema.eventRoles.revokedAt),
        ),
      }),
      dependencies.db.query.eventFeatures.findFirst({
        columns: { questionFollowUpsEnabled: true },
        where: eq(schema.eventFeatures.eventId, event.id),
      }),
    ]);
    if (
      membership?.status !== 'active' ||
      !profile ||
      !roles.some((role) => role.role === 'participant')
    )
      throw denied();
    const supported = await dependencies.db.query.programSessions.findMany({
      columns: { id: true, endsAt: true },
      where: and(
        eq(schema.programSessions.eventId, event.id),
        eq(schema.programSessions.questionMode, 'moderated_follow_up'),
        eq(schema.programSessions.status, 'published'),
      ),
    });
    const assignments = roles
      .filter((role) => role.role === 'moderator')
      .flatMap((role) => role.scope.sessionIds ?? []);
    const speaker = roles.some((role) => role.role === 'speaker')
      ? await dependencies.db.query.speakerProfiles.findFirst({
          columns: { id: true },
          where: and(
            eq(schema.speakerProfiles.eventId, event.id),
            eq(schema.speakerProfiles.userId, identity.user.id),
          ),
        })
      : null;
    const links = speaker
      ? await dependencies.db.query.sessionSpeakers.findMany({
          columns: { sessionId: true },
          where: and(
            eq(schema.sessionSpeakers.eventId, event.id),
            eq(schema.sessionSpeakers.speakerProfileId, speaker.id),
          ),
        })
      : [];
    const ids = links
      .map((link) => link.sessionId)
      .filter((id) => supported.some((session) => session.id === id));
    const followUps =
      Boolean(features?.questionFollowUpsEnabled) &&
      ids.length > 0 &&
      ['live', 'ended'].includes(event.status);
    let pendingAnswerCount = 0;
    if (followUps) {
      const [count] = await dependencies.db
        .select({ value: sql<number>`count(*)::integer` })
        .from(schema.questions)
        .innerJoin(
          schema.programSessions,
          and(
            eq(schema.programSessions.id, schema.questions.sessionId),
            eq(schema.programSessions.eventId, schema.questions.eventId),
          ),
        )
        .leftJoin(
          schema.questionAnswers,
          eq(schema.questionAnswers.questionId, schema.questions.id),
        )
        .where(
          and(
            eq(schema.questions.eventId, event.id),
            isNull(schema.questions.deletedAt),
            inArray(schema.questions.sessionId, ids),
            lte(
              schema.programSessions.endsAt,
              dependencies.now?.() ?? new Date(),
            ),
            isNull(schema.questionAnswers.id),
          ),
        );
      pendingAnswerCount = count?.value ?? 0;
    }
    return Response.json(
      hostCapabilitiesSchema.parse({
        eventId: event.id,
        userId: identity.user.id,
        activities: roles.some(
          (role) =>
            role.role === 'room_operator' &&
            Boolean(
              role.scope.sessionIds?.length || role.scope.roomIds?.length,
            ),
        ),
        moderation: assignments.some((id) =>
          supported.some((session) => session.id === id),
        ),
        followUps,
        pendingAnswerCount,
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
