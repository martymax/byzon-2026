import { createHash } from 'node:crypto';
import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  programAccessMutationSchema,
  programAccessMutationResponseSchema,
  programAccessOptionsSchema,
  programAccessPreviewRequestSchema,
  programAccessPreviewSchema,
  programAccessSearchSchema,
  programAccessSearchResponseSchema,
  type ProgramAccessPerson,
  type ProgramAccessPreview,
  type ProgramAccessPreviewRequest,
} from '@byzon/domain/contracts';
import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  authorize,
  requireSameOrigin,
  type AdminRoleExportDependencies,
} from './admin-role-export';
import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';

type Db = Database | DatabaseTransaction;
function fail(
  detail: string,
  code = 'PROGRAM_ACCESS_PRECONDITION',
  status = 409,
): never {
  throw new ApiProblemError({
    status,
    code,
    title: 'Programový přístup nelze změnit',
    detail,
  });
}
const headers = {
  'cache-control': 'private, no-store',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
};
const safeName = (name: string) =>
  name
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g, '')
    .trim()
    .slice(0, 257) || 'Účastník';
const sorted = (values: readonly string[]) => [...new Set(values)].sort();

async function person(
  db: Db,
  eventId: string,
  userId: string,
): Promise<ProgramAccessPerson> {
  const [membership, user, profile, roles, source] = await Promise.all([
    db.query.eventMemberships.findFirst({
      where: and(
        eq(schema.eventMemberships.eventId, eventId),
        eq(schema.eventMemberships.userId, userId),
      ),
    }),
    db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
    db.query.participantProfiles.findFirst({
      columns: { userId: true },
      where: and(
        eq(schema.participantProfiles.eventId, eventId),
        eq(schema.participantProfiles.userId, userId),
      ),
    }),
    db.query.eventRoles.findMany({
      columns: { role: true },
      where: and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.userId, userId),
        isNull(schema.eventRoles.revokedAt),
      ),
    }),
    db.query.ticketSourceParticipants.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.ticketSourceParticipants.eventId, eventId),
        eq(schema.ticketSourceParticipants.userId, userId),
      ),
    }),
  ]);
  if (!membership || !user)
    fail(
      'Nejprve založte účastníka v /admin/ucastnici nebo jej importujte ze SimpleShopu.',
    );
  const sent = await db.query.auditLogs.findFirst({
    columns: { id: true },
    where: and(
      eq(schema.auditLogs.eventId, eventId),
      eq(schema.auditLogs.targetId, userId),
      inArray(schema.auditLogs.action, [
        'participant.invitation_sent',
        'participant.invitation.sent',
      ]),
    ),
  });
  const [local, domain] = user.email.split('@');
  return {
    participantId: userId,
    displayName: safeName(user.name),
    maskedEmail: `${local?.slice(0, 1) ?? ''}…@${domain ?? ''}`,
    membershipStatus: membership.status,
    invitationStatus: user.emailVerified
      ? 'accepted'
      : sent
        ? 'sent'
        : 'not_sent',
    source: source ? 'simpleshop' : 'manual',
    baselineReady:
      membership.status === 'active' &&
      Boolean(profile) &&
      roles.some((role) => role.role === 'participant'),
  };
}

async function preview(
  db: Db,
  eventId: string,
  input: ProgramAccessPreviewRequest,
): Promise<ProgramAccessPreview> {
  const participant = await person(db, eventId, input.participantId);
  if (!participant.baselineReady)
    fail(
      'Je nutný aktivní membership, profil a role participant. Použijte /admin/ucastnici.',
    );
  const version = await db.query.eventAdminVersions.findFirst({
    where: eq(schema.eventAdminVersions.eventId, eventId),
  });
  const currentRoles = await db.query.eventRoles.findMany({
    where: and(
      eq(schema.eventRoles.eventId, eventId),
      eq(schema.eventRoles.userId, input.participantId),
      isNull(schema.eventRoles.revokedAt),
    ),
  });
  let speakerProfileId: string | null = null,
    speakerVersion: number | null = null;
  let sessionIds: string[] = [];
  const roomIds: string[] = [];
  const requested: Array<'speaker' | 'room_operator' | 'moderator'> = [];
  const selection = input.selection;
  if (selection.preset === 'coach') {
    const room = await db.query.rooms.findFirst({
      where: and(
        eq(schema.rooms.eventId, eventId),
        eq(schema.rooms.id, selection.roomId),
        inArray(schema.rooms.slug, [
          'koucovaci-zona-radim',
          'koucovaci-zona-stana',
        ]),
      ),
    });
    if (!room || room.status === 'archived')
      fail('Zvolte existující koučovací místnost.');
    roomIds.push(room.id);
    requested.push('room_operator');
    sessionIds = (
      await db.query.programSessions.findMany({
        columns: { id: true },
        where: and(
          eq(schema.programSessions.eventId, eventId),
          eq(schema.programSessions.roomId, room.id),
          eq(schema.programSessions.type, 'coaching'),
        ),
      })
    ).map((row) => row.id);
  } else if (selection.preset === 'moderator') {
    sessionIds = sorted(selection.sessionIds);
    requested.push('moderator');
  } else {
    const speaker = await db.query.speakerProfiles.findFirst({
      where: and(
        eq(schema.speakerProfiles.eventId, eventId),
        eq(schema.speakerProfiles.id, selection.speakerProfileId),
      ),
    });
    if (
      !speaker ||
      speaker.status === 'archived' ||
      (speaker.userId && speaker.userId !== input.participantId)
    )
      fail('Speaker profil chybí nebo patří jinému účtu.');
    if (input.operation === 'revoke' && speaker.userId !== input.participantId)
      fail('Speaker profil není propojen s tímto účtem.');
    const other = await db.query.speakerProfiles.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.speakerProfiles.eventId, eventId),
        eq(schema.speakerProfiles.userId, input.participantId),
      ),
    });
    if (other && other.id !== speaker.id)
      fail('Účet už má jiný speaker profil.');
    speakerProfileId = speaker.id;
    speakerVersion = speaker.version;
    sessionIds = (
      await db.query.sessionSpeakers.findMany({
        columns: { sessionId: true },
        where: and(
          eq(schema.sessionSpeakers.eventId, eventId),
          eq(schema.sessionSpeakers.speakerProfileId, speaker.id),
        ),
      })
    ).map((row) => row.sessionId);
    requested.push('speaker');
    if (selection.preset === 'activity_leader') requested.push('room_operator');
  }
  if (!sessionIds.length)
    fail('Chybí přiřazené session; nejprve opravte program.');
  const allSessions = await db.query.programSessions.findMany({
    where: and(
      eq(schema.programSessions.eventId, eventId),
      inArray(schema.programSessions.id, sessionIds),
    ),
  });
  const sessions = allSessions.filter((session) =>
    selection.preset === 'speaker'
      ? session.questionMode === 'moderated_follow_up'
      : selection.preset === 'activity_leader'
        ? ['mastermind', 'workshop', 'networking'].includes(session.type)
        : true,
  );
  if (
    !sessions.length ||
    (selection.preset === 'moderator' &&
      sessions.some(
        (session) => session.questionMode !== 'moderated_follow_up',
      ))
  )
    fail('Vybraný program nepodporuje tuto roli.');
  if (selection.preset === 'moderator' && sessions.length !== sessionIds.length)
    fail('Session nepatří do tohoto eventu.');
  if (
    input.operation === 'apply' &&
    sessions.some(
      (session) =>
        session.status === 'archived' || session.status === 'cancelled',
    )
  )
    fail('Zrušenou nebo archivovanou session nelze přiřadit.');
  if (
    input.operation === 'apply' &&
    ['coach', 'activity_leader'].includes(selection.preset) &&
    sessions.some(
      (session) =>
        !session.roomId ||
        session.capacityMode !== 'reservation' ||
        !session.capacity ||
        session.capacity <= 0,
    )
  )
    fail('Aktivita potřebuje místnost a kladnou rezervační kapacitu.');
  for (const session of sessions.filter((item) => item.reservationGroupId)) {
    const members = await db.query.programSessions.findMany({
      columns: { id: true },
      where: and(
        eq(schema.programSessions.eventId, eventId),
        eq(
          schema.programSessions.reservationGroupId,
          session.reservationGroupId!,
        ),
      ),
    });
    if (
      members.some((member) => !sessions.some((item) => item.id === member.id))
    )
      fail('Scope musí obsahovat všechny části sdílené rezervace.');
  }
  const roles: ProgramAccessPreview['roles'] = requested.map((role) => {
    const current = currentRoles.find((item) => item.role === role);
    const addSessions =
      role === 'speaker' || selection.preset === 'coach'
        ? []
        : sessions.map((session) => session.id);
    const addRooms = role === 'room_operator' ? roomIds : [];
    const resultingSessions =
      input.operation === 'apply'
        ? sorted([...(current?.scope.sessionIds ?? []), ...addSessions])
        : (current?.scope.sessionIds ?? []).filter(
            (id) => !addSessions.includes(id),
          );
    const resultingRooms =
      input.operation === 'apply'
        ? sorted([...(current?.scope.roomIds ?? []), ...addRooms])
        : (current?.scope.roomIds ?? []).filter((id) => !addRooms.includes(id));
    // Removing a leader's roster leaves a separately useful Q&A speaker capability intact.
    const keepSpeaker =
      role === 'speaker' &&
      selection.preset === 'activity_leader' &&
      allSessions.some(
        (session) => session.questionMode === 'moderated_follow_up',
      );
    return {
      role,
      sessionIds: resultingSessions,
      roomIds: resultingRooms,
      revoke:
        input.operation === 'revoke' &&
        !keepSpeaker &&
        (role === 'speaker' ||
          (!resultingSessions.length && !resultingRooms.length)),
    };
  });
  const roomRows = await db.query.rooms.findMany({
    columns: { id: true, name: true },
    where: eq(schema.rooms.eventId, eventId),
  });
  const result = {
    eventId,
    participant,
    assignmentsVersion: version?.assignmentsVersion ?? 1,
    roles,
    sessions: sessions
      .map((session) => ({
        id: session.id,
        title: session.title,
        startsAt: session.startsAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
        roomName:
          roomRows.find((room) => room.id === session.roomId)?.name ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    speakerProfileId,
    speakerVersion,
    operation: input.operation,
  };
  return programAccessPreviewSchema.parse({
    ...result,
    previewHash: createHash('sha256')
      .update(JSON.stringify(result))
      .digest('hex'),
  });
}

export async function handleProgramAccess(
  request: Request,
  eventId: string,
  action: 'search' | 'options' | 'preview' | 'apply',
  dependencies: AdminRoleExportDependencies,
): Promise<Response> {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== (action === 'options' ? 'GET' : 'POST'))
      fail('Nepodporovaná metoda.', 'METHOD_NOT_ALLOWED', 405);
    if (request.method === 'POST') requireSameOrigin(request, dependencies);
    const { actorId, eventStatus } = await authorize(
      request,
      eventId,
      'role:manage',
      dependencies,
    );
    if (eventStatus === 'archived') fail('Event je archivovaný.');
    const raw = request.method === 'POST' ? await request.text() : '';
    if (raw.length > 8192)
      fail('Požadavek je příliš velký.', 'VALIDATION_FAILED', 422);
    let value: unknown = {};
    try {
      if (raw) value = JSON.parse(raw);
    } catch {
      fail('Neplatný JSON.', 'VALIDATION_FAILED', 422);
    }
    let result: unknown;
    if (action === 'search') {
      const parsed = programAccessSearchSchema.safeParse(value);
      if (!parsed.success)
        fail('Zadejte alespoň dva znaky.', 'VALIDATION_FAILED', 422);
      const pattern = `%${parsed.data.query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
      const rows = await dependencies.db
        .select({ id: schema.users.id })
        .from(schema.eventMemberships)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.eventMemberships.userId),
        )
        .where(
          and(
            eq(schema.eventMemberships.eventId, eventId),
            or(
              ilike(schema.users.name, pattern),
              ilike(schema.users.email, pattern),
            ),
          ),
        )
        .orderBy(asc(schema.users.name), asc(schema.users.id))
        .limit(20);
      result = programAccessSearchResponseSchema.parse({
        eventId,
        items: await Promise.all(
          rows.map((row) => person(dependencies.db, eventId, row.id)),
        ),
      });
    } else if (action === 'options') {
      const [speakers, rooms, sessions] = await Promise.all([
        dependencies.db.query.speakerProfiles.findMany({
          columns: { id: true, firstName: true, lastName: true, userId: true },
          where: eq(schema.speakerProfiles.eventId, eventId),
        }),
        dependencies.db.query.rooms.findMany({
          columns: { id: true, name: true, slug: true },
          where: eq(schema.rooms.eventId, eventId),
        }),
        dependencies.db.query.programSessions.findMany({
          columns: {
            id: true,
            title: true,
            startsAt: true,
            endsAt: true,
            roomId: true,
          },
          where: and(
            eq(schema.programSessions.eventId, eventId),
            eq(schema.programSessions.questionMode, 'moderated_follow_up'),
          ),
        }),
      ]);
      result = programAccessOptionsSchema.parse({
        eventId,
        speakers: speakers.map((s) => ({
          id: s.id,
          name: safeName(`${s.firstName} ${s.lastName}`),
          linkedUserId: s.userId,
        })),
        rooms: rooms
          .filter((r) =>
            ['koucovaci-zona-radim', 'koucovaci-zona-stana'].includes(r.slug),
          )
          .map((r) => ({ id: r.id, name: r.name })),
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          startsAt: s.startsAt.toISOString(),
          endsAt: s.endsAt.toISOString(),
          roomName: rooms.find((r) => r.id === s.roomId)?.name ?? null,
        })),
      });
    } else if (action === 'preview') {
      const parsed = programAccessPreviewRequestSchema.safeParse(value);
      if (!parsed.success) fail('Neplatný výběr.', 'VALIDATION_FAILED', 422);
      result = await preview(dependencies.db, eventId, parsed.data);
    } else {
      const parsed = programAccessMutationSchema.safeParse(value);
      if (!parsed.success) fail('Neplatná změna.', 'VALIDATION_FAILED', 422);
      const input = parsed.data;
      const now = dependencies.now?.() ?? new Date();
      await dependencies.db
        .insert(schema.eventAdminVersions)
        .values({ eventId })
        .onConflictDoNothing();
      const mutation = await executeIdempotentMutation(
        dependencies.db,
        {
          eventId,
          actorId,
          scope: 'admin.program-access',
          key: readIdempotencyKey(request.headers),
          requestHash: hashIdempotencyRequest({
            method: request.method,
            path: new URL(request.url).pathname,
            body: raw,
          }),
          ttlMs: 86400000,
          now,
        },
        async (tx) => {
          await acquireTransactionLock(tx, `admin-roles:${eventId}`);
          await authorize(request, eventId, 'role:manage', {
            ...dependencies,
            db: tx as unknown as Database,
          });
          const checked = await preview(tx, eventId, input);
          if (
            checked.assignmentsVersion !== input.expectedVersion ||
            checked.previewHash !== input.previewHash
          )
            fail('Náhled se změnil. Načtěte jej znovu.', 'STALE_VERSION');
          if (checked.speakerProfileId) {
            const remove = checked.roles.some(
              (role) => role.role === 'speaker' && role.revoke,
            );
            const updated = await tx
              .update(schema.speakerProfiles)
              .set({
                userId: remove ? null : input.participantId,
                version: sql`${schema.speakerProfiles.version}+1`,
                updatedAt: now,
              })
              .where(
                and(
                  eq(schema.speakerProfiles.eventId, eventId),
                  eq(schema.speakerProfiles.id, checked.speakerProfileId),
                  eq(schema.speakerProfiles.version, checked.speakerVersion!),
                ),
              )
              .returning({ id: schema.speakerProfiles.id });
            if (!updated.length)
              fail('Speaker profil se změnil.', 'STALE_VERSION');
          }
          for (const role of checked.roles) {
            const existing = await tx.query.eventRoles.findFirst({
              where: and(
                eq(schema.eventRoles.eventId, eventId),
                eq(schema.eventRoles.userId, input.participantId),
                eq(schema.eventRoles.role, role.role),
                isNull(schema.eventRoles.revokedAt),
              ),
            });
            if (role.revoke) {
              if (existing)
                await tx
                  .update(schema.eventRoles)
                  .set({ revokedAt: now })
                  .where(eq(schema.eventRoles.id, existing.id));
            } else if (existing)
              await tx
                .update(schema.eventRoles)
                .set({
                  scope: { sessionIds: role.sessionIds, roomIds: role.roomIds },
                })
                .where(eq(schema.eventRoles.id, existing.id));
            else if (input.operation === 'apply')
              await tx.insert(schema.eventRoles).values({
                id: generateUuidV7(),
                eventId,
                userId: input.participantId,
                role: role.role,
                scope: { sessionIds: role.sessionIds, roomIds: role.roomIds },
                grantedBy: actorId,
                grantedAt: now,
              });
          }
          await tx
            .update(schema.eventAdminVersions)
            .set({
              assignmentsVersion: input.expectedVersion + 1,
              updatedAt: now,
            })
            .where(eq(schema.eventAdminVersions.eventId, eventId));
          const auditId = await writeAuditLog(tx, {
            eventId,
            actorId,
            actorType: 'user',
            action: input.operation === 'apply' ? 'role.grant' : 'role.revoke',
            targetType: 'program_access',
            targetId: input.participantId,
            requestId,
            reason: input.reason,
            after: {
              preset: input.selection.preset,
              roles: checked.roles,
              version: input.expectedVersion + 1,
            },
          });
          return {
            status: 200,
            body: programAccessMutationResponseSchema.parse({
              eventId,
              assignmentsVersion: input.expectedVersion + 1,
              outcome: input.operation === 'apply' ? 'applied' : 'revoked',
              auditId,
            }),
          };
        },
      );
      result = mutation.body;
    }
    return Response.json(result, { headers });
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(headers).forEach(([key, value]) =>
      response.headers.set(key, value),
    );
    return response;
  }
}
