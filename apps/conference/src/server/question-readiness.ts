import { schema } from '@byzon/database';
import { and, eq, isNull } from 'drizzle-orm';
import { questionFailure, type QuestionDb } from './question-runtime';
export async function hasParticipantBaseline(
  db: QuestionDb,
  eventId: string,
  userId: string,
) {
  const [membership, profile, role] = await Promise.all([
    db.query.eventMemberships.findFirst({
      columns: { status: true },
      where: and(
        eq(schema.eventMemberships.eventId, eventId),
        eq(schema.eventMemberships.userId, userId),
      ),
    }),
    db.query.participantProfiles.findFirst({
      columns: { userId: true },
      where: and(
        eq(schema.participantProfiles.eventId, eventId),
        eq(schema.participantProfiles.userId, userId),
      ),
    }),
    db.query.eventRoles.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.userId, userId),
        eq(schema.eventRoles.role, 'participant'),
        isNull(schema.eventRoles.revokedAt),
      ),
    }),
  ]);
  return membership?.status === 'active' && Boolean(profile) && Boolean(role);
}
export async function requireModeratorBaseline(
  db: QuestionDb,
  eventId: string,
  userId: string,
) {
  if (!(await hasParticipantBaseline(db, eventId, userId)))
    questionFailure(
      'ADMIN_INVALID_TRANSITION',
      409,
      'Moderátor musí mít aktivní účastnický účet. Použijte nastavení programových spolupracovníků.',
    );
}
export async function questionReadiness(db: QuestionDb, eventId: string) {
  const [sessions, roles, profiles, links, rooms] = await Promise.all([
    db.query.programSessions.findMany({
      where: and(
        eq(schema.programSessions.eventId, eventId),
        eq(schema.programSessions.questionMode, 'moderated_follow_up'),
      ),
    }),
    db.query.eventRoles.findMany({
      where: and(
        eq(schema.eventRoles.eventId, eventId),
        isNull(schema.eventRoles.revokedAt),
      ),
    }),
    db.query.speakerProfiles.findMany({
      where: eq(schema.speakerProfiles.eventId, eventId),
    }),
    db.query.sessionSpeakers.findMany({
      where: eq(schema.sessionSpeakers.eventId, eventId),
    }),
    db.query.rooms.findMany({ where: eq(schema.rooms.eventId, eventId) }),
  ]);
  const userIds = [
    ...new Set([
      ...roles
        .filter((r) => r.role === 'moderator' || r.role === 'speaker')
        .map((r) => r.userId),
      ...profiles.flatMap((p) => (p.userId ? [p.userId] : [])),
    ]),
  ];
  const ready = new Set(
    (
      await Promise.all(
        userIds.map(async (id) =>
          (await hasParticipantBaseline(db, eventId, id)) ? id : null,
        ),
      )
    ).filter((id): id is string => id !== null),
  );
  return sessions.map((session) => {
    const speakers = links
      .filter((l) => l.sessionId === session.id)
      .map((l) => profiles.find((p) => p.id === l.speakerProfileId));
    const readySpeakers = speakers.filter(
      (p) =>
        p?.userId &&
        ready.has(p.userId) &&
        roles.some((r) => r.role === 'speaker' && r.userId === p.userId),
    ).length;
    return {
      sessionId: session.id,
      enabled: session.questionsEnabled,
      status: session.status,
      roomName: rooms.find((r) => r.id === session.roomId)?.name ?? null,
      endsAt: session.endsAt.toISOString(),
      moderatorReady: roles.some(
        (r) =>
          r.role === 'moderator' &&
          r.scope.sessionIds?.includes(session.id) &&
          ready.has(r.userId),
      ),
      speakerReady: speakers.length > 0 && readySpeakers === speakers.length,
      speakerCount: speakers.length,
      readySpeakerCount: readySpeakers,
    };
  });
}
export async function requireQuestionPreflight(
  db: QuestionDb,
  eventId: string,
  kind: 'collection' | 'followUps',
  sessionId?: string,
) {
  const rows = (await questionReadiness(db, eventId)).filter(
    (r) =>
      r.status === 'published' &&
      (sessionId
        ? r.sessionId === sessionId
        : kind === 'followUps' || r.enabled),
  );
  const missing = rows.filter((r) =>
    kind === 'collection' ? !r.moderatorReady : !r.speakerReady,
  );
  if (!rows.length || missing.length)
    questionFailure(
      'ADMIN_INVALID_TRANSITION',
      409,
      kind === 'collection'
        ? `Nelze zapnout sběr: ${missing.length || 1} přednášek nemá připraveného moderátora nebo není publikována. Podrobnosti jsou v přehledu přiřazení.`
        : `Nelze zapnout odpovědi: ${missing.length || 1} přednášek nemá propojené aktivní účty všech řečníků. Podrobnosti jsou v přehledu přiřazení.`,
    );
}
