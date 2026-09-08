import { and, eq } from 'drizzle-orm';
import type { Database } from './client.js';
import * as schema from './schema/index.js';

export interface ProgramReadinessReport {
  eventId: string;
  ready: boolean;
  counts: { questions: number; coaching: number; networking: number };
  findings: Array<{ code: string; sessionId?: string }>;
}

/** Operational metadata only: never include account emails or question/answer text. */
export async function inspectProgramReadiness(
  db: Database,
  eventId: string,
): Promise<ProgramReadinessReport> {
  const [sessions, links, profiles, rooms] = await Promise.all([
    db.query.programSessions.findMany({
      where: eq(schema.programSessions.eventId, eventId),
    }),
    db.query.sessionSpeakers.findMany({
      where: eq(schema.sessionSpeakers.eventId, eventId),
    }),
    db.query.speakerProfiles.findMany({
      columns: { id: true, userId: true },
      where: eq(schema.speakerProfiles.eventId, eventId),
    }),
    db.query.rooms.findMany({
      columns: { id: true, slug: true },
      where: eq(schema.rooms.eventId, eventId),
    }),
  ]);
  const findings: ProgramReadinessReport['findings'] = [];
  const active = sessions.filter(
    (session) =>
      session.status !== 'archived' && session.status !== 'cancelled',
  );
  const questions = active.filter(
    (session) => session.questionMode === 'moderated_follow_up',
  );
  const coaching = active.filter((session) => session.type === 'coaching');
  const networking = active.filter((session) => session.type === 'networking');
  if (questions.length !== 17)
    findings.push({ code: 'question_whitelist_count' });
  if (coaching.length !== 26) findings.push({ code: 'coach_slot_count' });
  if (networking.length !== 1)
    findings.push({ code: 'canonical_networking_count' });
  for (const session of active) {
    const hostActivity = ['mastermind', 'workshop', 'networking'].includes(
      session.type,
    );
    if (
      !hostActivity &&
      session.type !== 'coaching' &&
      session.questionMode !== 'moderated_follow_up'
    )
      continue;
    if (!session.roomId)
      findings.push({ code: 'room_missing', sessionId: session.id });
    if (hostActivity || session.type === 'coaching') {
      if (
        session.capacityMode !== 'reservation' ||
        !session.capacity ||
        session.capacity <= 0
      )
        findings.push({
          code: 'positive_capacity_required',
          sessionId: session.id,
        });
    }
    if (
      session.type === 'coaching' &&
      !rooms.some(
        (room) =>
          room.id === session.roomId &&
          ['koucovaci-zona-radim', 'koucovaci-zona-stana'].includes(room.slug),
      )
    )
      findings.push({ code: 'coach_room_invalid', sessionId: session.id });
    if (hostActivity || session.questionMode === 'moderated_follow_up') {
      const speakerLinks = links.filter(
        (link) => link.sessionId === session.id,
      );
      if (!speakerLinks.length)
        findings.push({ code: 'speaker_link_missing', sessionId: session.id });
      if (
        speakerLinks.some(
          (link) =>
            !profiles.some(
              (profile) =>
                profile.id === link.speakerProfileId && profile.userId,
            ),
        )
      )
        findings.push({
          code: 'speaker_account_unlinked',
          sessionId: session.id,
        });
    }
  }
  const mastermind = active.filter((session) =>
    [
      'predsali-clarion-mastermind-cast-1-9301100',
      'predsali-clarion-mastermind-cast-2-11151245',
    ].includes(session.slug),
  );
  if (
    mastermind.length !== 2 ||
    mastermind.some(
      (session) =>
        session.reservationGroupId !== null ||
        session.reservationClosesAt?.getTime() !== session.startsAt.getTime(),
    )
  )
    findings.push({ code: 'saturday_mastermind_group_invalid' });
  for (const session of networking) {
    if (
      !rooms.some(
        (room) =>
          room.id === session.roomId && room.slug === 'leadership-stage',
      )
    )
      findings.push({
        code: 'canonical_networking_room_invalid',
        sessionId: session.id,
      });
  }
  // Baseline checks are separate from public speaker profiles.
  for (const profile of profiles.filter((profile) => profile.userId)) {
    const [membership, participant, role] = await Promise.all([
      db.query.eventMemberships.findFirst({
        where: and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, profile.userId!),
        ),
      }),
      db.query.participantProfiles.findFirst({
        columns: { userId: true },
        where: and(
          eq(schema.participantProfiles.eventId, eventId),
          eq(schema.participantProfiles.userId, profile.userId!),
        ),
      }),
      db.query.eventRoles.findMany({
        columns: { role: true, revokedAt: true },
        where: and(
          eq(schema.eventRoles.eventId, eventId),
          eq(schema.eventRoles.userId, profile.userId!),
        ),
      }),
    ]);
    if (
      membership?.status !== 'active' ||
      !participant ||
      !role.some((item) => item.role === 'participant' && !item.revokedAt)
    )
      findings.push({ code: 'speaker_participant_baseline_missing' });
  }
  return {
    eventId,
    ready: findings.length === 0,
    counts: {
      questions: questions.length,
      coaching: coaching.length,
      networking: networking.length,
    },
    findings,
  };
}
