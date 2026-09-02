import { schema, type Database } from '@byzon/database';
import {
  activityRosterResponseSchema,
  publishedProgramSnapshotSchema,
  type ActivityRosterResponse,
} from '@byzon/domain/contracts';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';

const MAX_ASSIGNED_SESSIONS = 30;
const MAX_PARTICIPANTS_PER_SESSION = 250;

interface RosterSessionIdentity {
  user: { id: string };
}

export interface ActivityRosterDependencies {
  db: Database;
  getSession(headers: Headers): Promise<RosterSessionIdentity | null>;
  currentEventSlug?: string;
  now?: () => Date;
}

const uuidSchema = z.string().uuid();
const assignmentScopeSchema = z
  .strictObject({
    sessionIds: z
      .array(uuidSchema)
      .max(MAX_ASSIGNED_SESSIONS)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Assigned sessions must be unique',
      )
      .optional(),
    roomIds: z.array(uuidSchema).max(MAX_ASSIGNED_SESSIONS).optional(),
  })
  .default({});

const apiProblem = (
  status: number,
  code: string,
  title: string,
  detail: string,
): ApiProblemError => new ApiProblemError({ status, code, title, detail });

const authenticationRequired = (): ApiProblemError =>
  apiProblem(
    401,
    'AUTHENTICATION_REQUIRED',
    'Authentication required',
    'A valid session is required.',
  );

const eventAccessDenied = (): ApiProblemError =>
  apiProblem(
    403,
    'EVENT_ACCESS_DENIED',
    'Event access denied',
    'The activity roster is not available for this account.',
  );

const rosterNotFound = (): ApiProblemError =>
  apiProblem(
    404,
    'ROSTER_NOT_FOUND',
    'Roster not found',
    'The assigned activity roster was not found.',
  );

const privateProblemResponse = (
  error: unknown,
  requestId: string,
): Response => {
  const response = problemResponse(error, requestId);
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('vary', 'Authorization, Cookie');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
};

const successResponse = (
  body: ActivityRosterResponse,
  requestId: string,
): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'application/json',
      vary: 'Authorization, Cookie',
      'x-content-type-options': 'nosniff',
      'x-request-id': requestId,
    },
  });

const loadAssignedSessionIds = async (
  dependencies: ActivityRosterDependencies,
  eventId: string,
  userId: string,
): Promise<readonly string[]> => {
  const [membership, assignment] = await Promise.all([
    dependencies.db.query.eventMemberships.findFirst({
      columns: { userId: true },
      where: and(
        eq(schema.eventMemberships.eventId, eventId),
        eq(schema.eventMemberships.userId, userId),
        eq(schema.eventMemberships.status, 'active'),
      ),
    }),
    dependencies.db.query.eventRoles.findFirst({
      columns: { scope: true },
      where: and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.userId, userId),
        eq(schema.eventRoles.role, 'room_operator'),
        isNull(schema.eventRoles.revokedAt),
      ),
    }),
  ]);
  if (!membership || !assignment) throw eventAccessDenied();

  const scope = assignmentScopeSchema.safeParse(assignment.scope);
  if (!scope.success) throw eventAccessDenied();
  return scope.data.sessionIds ?? [];
};

type RosterParticipant =
  ActivityRosterResponse['sessions'][number]['participants'][number];

export const loadActivityRoster = async (
  headers: Headers,
  dependencies: ActivityRosterDependencies,
  requestedSessionId?: string,
): Promise<ActivityRosterResponse> => {
  const session = await dependencies.getSession(headers);
  const userId = uuidSchema.safeParse(session?.user.id);
  if (!session || !userId.success) throw authenticationRequired();
  const generatedAt = dependencies.now?.() ?? new Date();

  const event = await dependencies.db.query.events.findFirst({
    columns: { id: true, operationalDataAnonymizesAt: true },
    where: and(
      eq(
        schema.events.slug,
        dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
      ),
      inArray(schema.events.status, ['activation_open', 'live', 'ended']),
    ),
  });
  if (
    !event ||
    (event.operationalDataAnonymizesAt !== null &&
      event.operationalDataAnonymizesAt.getTime() <= generatedAt.getTime())
  ) {
    throw eventAccessDenied();
  }

  const assignedSessionIds = await loadAssignedSessionIds(
    dependencies,
    event.id,
    userId.data,
  );
  if (requestedSessionId) {
    const parsedSessionId = uuidSchema.safeParse(requestedSessionId);
    if (
      !parsedSessionId.success ||
      !assignedSessionIds.includes(parsedSessionId.data)
    ) {
      throw rosterNotFound();
    }
  }

  const selectedSessionIds = requestedSessionId
    ? [requestedSessionId]
    : [...assignedSessionIds];
  if (selectedSessionIds.length === 0) {
    return activityRosterResponseSchema.parse({
      eventId: event.id,
      generatedAt: generatedAt.toISOString(),
      sessions: [],
    });
  }

  const publication = await dependencies.db.query.contentPublications.findFirst(
    {
      columns: { snapshot: true },
      where: eq(schema.contentPublications.eventId, event.id),
      orderBy: [desc(schema.contentPublications.version)],
    },
  );
  const published = publishedProgramSnapshotSchema.safeParse(
    publication?.snapshot,
  );
  const publishedById = new Map(
    (published.success ? published.data.program.sessions : [])
      .filter(({ status }) => status !== 'cancelled')
      .map((programSession) => [programSession.id, programSession]),
  );
  const publishedSessionIds = selectedSessionIds.filter((sessionId) =>
    publishedById.has(sessionId),
  );

  const operationalSessions =
    publishedSessionIds.length === 0
      ? []
      : await dependencies.db
          .select({
            sessionId: schema.programSessions.id,
            capacity: schema.programSessions.capacity,
            reservationGroupId: schema.programSessions.reservationGroupId,
          })
          .from(schema.programSessions)
          .where(
            and(
              eq(schema.programSessions.eventId, event.id),
              inArray(schema.programSessions.id, publishedSessionIds),
              inArray(schema.programSessions.status, ['draft', 'published']),
              eq(schema.programSessions.capacityMode, 'reservation'),
            ),
          )
          .orderBy(asc(schema.programSessions.id));

  const operationalById = new Map(
    operationalSessions.map((programSession) => [
      programSession.sessionId,
      programSession,
    ]),
  );
  const assignedSessionTargets = new Set<string>();
  const assignedSessions = publishedSessionIds
    .flatMap((sessionId) => {
      const publishedSession = publishedById.get(sessionId);
      const operationalSession = operationalById.get(sessionId);
      if (
        !publishedSession ||
        !operationalSession ||
        operationalSession.capacity === null
      ) {
        return [];
      }
      const reservationTargetId =
        operationalSession.reservationGroupId ?? sessionId;
      if (assignedSessionTargets.has(reservationTargetId)) return [];
      const reservationTarget =
        publishedById.get(reservationTargetId) ?? publishedSession;
      assignedSessionTargets.add(reservationTargetId);
      return [
        {
          sessionId: reservationTargetId,
          title: reservationTarget.title,
          startsAt: new Date(reservationTarget.startsAt),
          capacity: operationalSession.capacity,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.startsAt.getTime() - right.startsAt.getTime() ||
        left.sessionId.localeCompare(right.sessionId),
    );

  if (requestedSessionId && assignedSessions.length !== 1) {
    throw rosterNotFound();
  }

  const sessionIds = assignedSessions.map(({ sessionId }) => sessionId);
  const participantsBySession = new Map<string, RosterParticipant[]>();
  if (sessionIds.length > 0) {
    const maximumParticipantRows =
      sessionIds.length * MAX_PARTICIPANTS_PER_SESSION;
    const [confirmed, waiting] = await Promise.all([
      dependencies.db
        .select({
          id: schema.reservations.id,
          sessionId: schema.reservations.sessionId,
          userId: schema.reservations.userId,
          firstName: schema.participantProfiles.firstName,
          lastName: schema.participantProfiles.lastName,
          company: schema.participantProfiles.company,
        })
        .from(schema.reservations)
        .innerJoin(
          schema.participantProfiles,
          and(
            eq(schema.participantProfiles.eventId, schema.reservations.eventId),
            eq(schema.participantProfiles.userId, schema.reservations.userId),
          ),
        )
        .innerJoin(
          schema.eventMemberships,
          and(
            eq(schema.eventMemberships.eventId, schema.reservations.eventId),
            eq(schema.eventMemberships.userId, schema.reservations.userId),
            eq(schema.eventMemberships.status, 'active'),
          ),
        )
        .where(
          and(
            eq(schema.reservations.eventId, event.id),
            inArray(schema.reservations.sessionId, sessionIds),
            eq(schema.reservations.status, 'confirmed'),
          ),
        )
        .orderBy(
          asc(schema.reservations.sessionId),
          asc(schema.reservations.createdAt),
          asc(schema.reservations.id),
        )
        .limit(maximumParticipantRows + 1),
      dependencies.db
        .select({
          id: schema.waitlistEntries.id,
          sessionId: schema.waitlistEntries.sessionId,
          userId: schema.waitlistEntries.userId,
          firstName: schema.participantProfiles.firstName,
          lastName: schema.participantProfiles.lastName,
          company: schema.participantProfiles.company,
        })
        .from(schema.waitlistEntries)
        .innerJoin(
          schema.participantProfiles,
          and(
            eq(
              schema.participantProfiles.eventId,
              schema.waitlistEntries.eventId,
            ),
            eq(
              schema.participantProfiles.userId,
              schema.waitlistEntries.userId,
            ),
          ),
        )
        .innerJoin(
          schema.eventMemberships,
          and(
            eq(schema.eventMemberships.eventId, schema.waitlistEntries.eventId),
            eq(schema.eventMemberships.userId, schema.waitlistEntries.userId),
            eq(schema.eventMemberships.status, 'active'),
          ),
        )
        .where(
          and(
            eq(schema.waitlistEntries.eventId, event.id),
            inArray(schema.waitlistEntries.sessionId, sessionIds),
            eq(schema.waitlistEntries.status, 'waiting'),
          ),
        )
        .orderBy(
          asc(schema.waitlistEntries.sessionId),
          asc(schema.waitlistEntries.positionSequence),
          asc(schema.waitlistEntries.id),
        )
        .limit(maximumParticipantRows + 1),
    ]);

    if (confirmed.length + waiting.length > maximumParticipantRows) {
      throw new Error('Activity roster exceeds the bounded response size');
    }

    const participantStates = new Set<string>();
    for (const row of confirmed) {
      participantStates.add(`${row.sessionId}:${row.userId}`);
      const participants = participantsBySession.get(row.sessionId) ?? [];
      participants.push({
        reservationId: row.id,
        state: 'reserved',
        displayName: `${row.firstName.trim()} ${row.lastName.trim()}`,
        company: row.company?.trim() || null,
      });
      participantsBySession.set(row.sessionId, participants);
    }
    for (const row of waiting) {
      if (participantStates.has(`${row.sessionId}:${row.userId}`)) {
        throw new Error('Conflicting active reservation and waitlist state');
      }
      const participants = participantsBySession.get(row.sessionId) ?? [];
      participants.push({
        reservationId: row.id,
        state: 'waitlisted',
        displayName: `${row.firstName.trim()} ${row.lastName.trim()}`,
        company: row.company?.trim() || null,
      });
      participantsBySession.set(row.sessionId, participants);
    }
  }

  return activityRosterResponseSchema.parse({
    eventId: event.id,
    generatedAt: generatedAt.toISOString(),
    sessions: assignedSessions.map((assignedSession) => ({
      ...assignedSession,
      capacity: assignedSession.capacity,
      startsAt: assignedSession.startsAt.toISOString(),
      participants: participantsBySession.get(assignedSession.sessionId) ?? [],
    })),
  });
};

export const readActivityRoster = async (
  request: Request,
  dependencies: ActivityRosterDependencies,
  requestedSessionId?: string,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    return successResponse(
      await loadActivityRoster(
        new Headers(request.headers),
        dependencies,
        requestedSessionId,
      ),
      requestId,
    );
  } catch (error) {
    return privateProblemResponse(error, requestId);
  }
};
