import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  idempotencyKeySchema,
  participantAgendaMutationProblemSchema,
  participantAgendaMutationRequestSchema,
  participantAgendaMutationResponseSchema,
  participantAgendaResponseSchema,
  participantAgendaCalendar,
  problemTypeForCode,
  publishedAgendaReservationWindowsSchema,
  publishedProgramAgendaSnapshotSchema,
  type AgendaReservationConflict,
  type AgendaSessionSnapshot,
  type ParticipantAgendaItem,
  type ParticipantAgendaMutationResponse,
  type ParticipantAgendaResponse,
  type PublishedProgramAgendaSnapshot,
} from '@byzon/domain/contracts';
import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { rateLimitHeaders, type RateLimitDecision } from './api/rate-limit';
import {
  issueAgendaCalendarTicket,
  readAgendaCalendarTicket,
} from './agenda-calendar-ticket';
import { CURRENT_EVENT_SLUG } from './current-event';
import type { ParticipantAgendaRateLimiter } from './participant-agenda-rate-limit';
import { EventAccessDeniedError, requireEventPermission } from './policy';
import { acquireCoachingReservationLock } from './reservation-policy';
import { promoteAutomaticWaitlist } from './reservation-waitlist';

const MAX_AGENDA_ITEMS = 512;
const MAX_BODY_BYTES = 16_384;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const CALENDAR_UID_DOMAIN = 'agenda.byzon.cz';
const uuidSchema = z.string().uuid();
const participantAgendaLockKey = (eventId: string, userId: string): string =>
  `participant-agenda:${eventId}:${userId}`;
const agendaMutationReceiptSchema = z.strictObject({
  action: z.enum([
    'add',
    'remove',
    'reserve',
    'cancel',
    'join_waitlist',
    'leave_waitlist',
  ]),
  sessionId: uuidSchema,
  outcome: z.enum(['applied', 'already_applied']),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
type AgendaMutationReceipt = z.infer<typeof agendaMutationReceiptSchema>;

export interface ParticipantAgendaOperationalDrift {
  code:
    | 'active_waitlist_without_capacity'
    | 'confirmed_reservation_without_capacity';
  eventId: string;
  sessionId: string;
}

interface AgendaSessionIdentity {
  user: { id: string };
}

export interface ParticipantAgendaDependencies {
  db: Database;
  allowedOrigin: string;
  getSession(headers: Headers): Promise<AgendaSessionIdentity | null>;
  currentEventSlug?: string;
  now?: () => Date;
  generateId?: () => string;
  onOperationalDrift?: (drift: ParticipantAgendaOperationalDrift) => void;
  rateLimit?: ParticipantAgendaRateLimiter;
}

export interface ParticipantAgendaCalendarDependencies extends ParticipantAgendaDependencies {
  calendarTicketSecret: string;
}

type AgendaDatabase = Database | DatabaseTransaction;
type AgendaEvent = Pick<
  typeof schema.events.$inferSelect,
  'id' | 'operationalDataAnonymizesAt' | 'status' | 'timezone'
>;

interface AgendaContext {
  event: AgendaEvent;
  program: PublishedProgramAgendaSnapshot;
  publicationVersion: number;
}

class StaleAgendaVersionError extends Error {
  constructor() {
    super('Agenda version changed');
    this.name = 'StaleAgendaVersionError';
  }
}

class AgendaCapacityFullError extends Error {
  constructor(readonly sessionId: string) {
    super('Agenda session capacity is full');
    this.name = 'AgendaCapacityFullError';
  }
}

class AgendaReservationClosedError extends Error {
  constructor(readonly sessionId: string) {
    super('Agenda session reservations are closed');
    this.name = 'AgendaReservationClosedError';
  }
}

class AgendaReservationConflictError extends Error {
  constructor(
    readonly sessionId: string,
    readonly conflict: AgendaReservationConflict,
    readonly reservationSessionIds: readonly string[],
    readonly until: Date,
    readonly allowed: boolean,
    readonly agendaVersion: number,
  ) {
    super('Agenda reservation conflicts with an existing reservation');
    this.name = 'AgendaReservationConflictError';
  }
}

const apiProblem = (
  status: number,
  code: string,
  title: string,
  detail: string,
  fieldErrors?: Record<string, string[]>,
): ApiProblemError =>
  new ApiProblemError({
    status,
    code,
    title,
    detail,
    ...(fieldErrors ? { fieldErrors } : {}),
  });

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
    'The participant agenda is not available for this account.',
  );

const agendaDisabled = (): ApiProblemError =>
  apiProblem(
    409,
    'AGENDA_DISABLED',
    'Agenda unavailable',
    'The participant agenda is not available in the current event phase.',
  );

const sessionNotFound = (): ApiProblemError =>
  apiProblem(
    404,
    'SESSION_NOT_FOUND',
    'Session not found',
    'The requested published session was not found.',
  );

const validationFailed = (
  fieldErrors: Record<string, string[]> = {
    body: ['The request is invalid.'],
  },
): ApiProblemError =>
  apiProblem(
    422,
    'VALIDATION_FAILED',
    'Validation failed',
    'The request does not satisfy the participant agenda contract.',
    fieldErrors,
  );

const privateHeaders = (
  requestId: string,
  contentType: string,
  extra: Record<string, string> = {},
): HeadersInit => ({
  'cache-control': 'private, no-store',
  'content-type': contentType,
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
  ...extra,
});

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
  body: ParticipantAgendaResponse | ParticipantAgendaMutationResponse,
  requestId: string,
  extra: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: privateHeaders(requestId, 'application/json', extra),
  });

const calendarSuccessResponse = (
  body: ParticipantAgendaResponse,
  requestId: string,
): Response =>
  new Response(participantAgendaCalendar(body), {
    status: 200,
    headers: privateHeaders(requestId, 'text/calendar; charset=utf-8', {
      'content-disposition':
        'attachment; filename="byzon-2026-moje-agenda.ics"',
    }),
  });

const calendarRedirectResponse = (
  requestId: string,
  allowedOrigin: string,
  ticket: string,
): Response => {
  const location = new URL('/api/v1/me/agenda.ics', allowedOrigin);
  location.searchParams.set('ticket', ticket);
  return new Response(null, {
    status: 303,
    headers: privateHeaders(requestId, 'text/plain; charset=utf-8', {
      location: location.toString(),
      'referrer-policy': 'no-referrer',
    }),
  });
};

const withRateLimitHeaders = (
  response: Response,
  decision: RateLimitDecision | null,
): Response => {
  if (!decision) return response;
  for (const [name, value] of Object.entries(rateLimitHeaders(decision))) {
    response.headers.set(name, value);
  }
  return response;
};

const zodFieldErrors = (error: z.ZodError): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues.slice(0, 50)) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
    const messages = result[path] ?? [];
    if (messages.length < 10) messages.push(issue.message.slice(0, 512));
    result[path] = messages;
  }
  return Object.keys(result).length > 0
    ? result
    : { body: ['The request is invalid.'] };
};

const requireSession = async (
  request: Request,
  dependencies: ParticipantAgendaDependencies,
): Promise<AgendaSessionIdentity> => {
  const session = await dependencies.getSession(request.headers);
  if (!session || !uuidSchema.safeParse(session.user.id).success) {
    throw authenticationRequired();
  }
  return session;
};

const requireReadTransport = (request: Request): void => {
  if (
    new URL(request.url).search.length > 0 ||
    request.headers.has('idempotency-key') ||
    request.headers.has('if-match')
  ) {
    throw validationFailed({ query: ['Query parameters are not supported.'] });
  }
};

const requireMutationTransport = (
  request: Request,
  allowedOrigin: string,
): string => {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0];
  const key = idempotencyKeySchema.safeParse(
    request.headers.get('idempotency-key'),
  );
  if (request.headers.get('origin') !== allowedOrigin) {
    throw eventAccessDenied();
  }
  if (
    new URL(request.url).search.length > 0 ||
    request.headers.has('if-match') ||
    contentType?.trim().toLowerCase() !== 'application/json'
  ) {
    throw validationFailed();
  }
  if (!key.success) {
    throw validationFailed({
      idempotencyKey: ['A valid Idempotency-Key header is required.'],
    });
  }
  return key.data;
};

const readBoundedJson = async (
  request: Request,
): Promise<{ raw: string; value: unknown }> => {
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)
  ) {
    throw validationFailed({ body: ['The request body is too large.'] });
  }
  const reader = request.body?.getReader();
  if (!reader) throw validationFailed();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw validationFailed({ body: ['The request body is too large.'] });
    }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { raw, value: JSON.parse(raw) as unknown };
  } catch {
    throw validationFailed();
  }
};

const loadAgendaPublication = async (
  db: AgendaDatabase,
  event: AgendaEvent,
): Promise<AgendaContext> => {
  const publication = await db.query.contentPublications.findFirst({
    columns: { reservationWindows: true, snapshot: true, version: true },
    where: eq(schema.contentPublications.eventId, event.id),
    orderBy: [desc(schema.contentPublications.version)],
  });
  const parsed = publishedProgramAgendaSnapshotSchema.safeParse(
    publication?.snapshot,
  );
  const windows = publishedAgendaReservationWindowsSchema.safeParse(
    publication?.reservationWindows,
  );
  if (!publication || !parsed.success || !windows.success)
    throw agendaDisabled();
  return {
    event,
    program: {
      ...parsed.data.program,
      sessions: parsed.data.program.sessions.map((session) => {
        const window = windows.data[session.id];
        return window ? { ...session, ...window } : session;
      }),
    },
    publicationVersion: publication.version,
  };
};

const loadAgendaContext = async (
  dependencies: ParticipantAgendaDependencies,
  userId: string,
  now: Date,
  mutation: boolean,
): Promise<AgendaContext> => {
  const loadedEvent = await dependencies.db.query.events.findFirst({
    columns: {
      id: true,
      operationalDataAnonymizesAt: true,
      status: true,
      timezone: true,
    },
    where: eq(
      schema.events.slug,
      dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
    ),
  });
  const event = requireAgendaEventAvailable(loadedEvent, now, mutation);
  await requireAgendaPermission(dependencies.db, userId, event.id);
  return loadAgendaPublication(dependencies.db, event);
};

const requireAgendaPermission = async (
  db: AgendaDatabase,
  userId: string,
  eventId: string,
): Promise<void> => {
  try {
    await requireEventPermission(db, { userId }, eventId, 'agenda:own:write', {
      ownsResource: true,
    });
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw eventAccessDenied();
  }
};

const requireAgendaEventAvailable = (
  event: AgendaEvent | undefined,
  now: Date,
  mutation: boolean,
): AgendaEvent => {
  if (
    !event ||
    event.status === 'draft' ||
    event.status === 'archived' ||
    (event.operationalDataAnonymizesAt !== null &&
      event.operationalDataAnonymizesAt.getTime() <= now.getTime())
  ) {
    throw eventAccessDenied();
  }
  if (mutation && event.status === 'ended') throw agendaDisabled();
  return event;
};

const sessionSnapshot = (
  context: AgendaContext,
  session: PublishedProgramAgendaSnapshot['sessions'][number],
  operationalStatus: 'cancelled' | 'published',
): AgendaSessionSnapshot => {
  const room = session.roomId
    ? context.program.rooms.find(({ id }) => id === session.roomId)
    : null;
  return {
    id: session.id,
    eventId: context.event.id,
    title: session.title,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    room: room ? { id: room.id, name: room.name } : null,
    status:
      session.status === 'cancelled' || operationalStatus === 'cancelled'
        ? 'cancelled'
        : 'published',
    calendar: {
      uid: `${session.id}@${CALENDAR_UID_DOMAIN}`,
      sequence: context.publicationVersion,
    },
  };
};

const capacityProjection = (
  session: {
    capacity: number | null;
    capacityMode: 'none' | 'registration_estimate' | 'reservation';
    reservationClosesAt: Date | null;
    reservationOpensAt: Date | null;
    startsAt: Date;
    status: 'archived' | 'cancelled' | 'draft' | 'published';
    type:
      | 'break'
      | 'coaching'
      | 'gala'
      | 'mastermind'
      | 'meal'
      | 'networking'
      | 'other'
      | 'panel'
      | 'talk'
      | 'workshop';
    waitlistMode: 'auto_confirm' | 'disabled' | 'offer_with_deadline';
  },
  published: PublishedProgramAgendaSnapshot['sessions'][number],
  confirmed: number,
  now: Date,
): Pick<ParticipantAgendaItem, 'action' | 'capacity'> => {
  if (session.capacityMode !== 'reservation' || session.capacity === null) {
    return {
      capacity: { mode: 'none' },
      action:
        session.status === 'cancelled'
          ? { state: 'cancelled' }
          : { state: 'available' },
    };
  }
  const remaining = Math.max(0, session.capacity - confirmed);
  const opensAt =
    published.reservationOpensAt === undefined
      ? (session.reservationOpensAt?.getTime() ?? Number.NEGATIVE_INFINITY)
      : published.reservationOpensAt === null
        ? Number.NEGATIVE_INFINITY
        : Date.parse(published.reservationOpensAt);
  const closesAt =
    published.reservationClosesAt === undefined
      ? (session.reservationClosesAt?.getTime() ?? session.startsAt.getTime())
      : published.reservationClosesAt === null
        ? Date.parse(published.startsAt)
        : Date.parse(published.reservationClosesAt);
  const closed = now.getTime() < opensAt || now.getTime() >= closesAt;
  return {
    capacity: {
      mode: 'reservation',
      capacity: session.capacity,
      confirmed,
      held: 0,
      remaining,
      waitlistAvailable:
        session.waitlistMode === 'auto_confirm' &&
        !closed &&
        session.status !== 'cancelled',
      actorAvailability: {
        state:
          remaining > 0 && !closed && session.status !== 'cancelled'
            ? 'available'
            : 'unavailable',
      },
    },
    action:
      session.status === 'cancelled'
        ? { state: 'cancelled' }
        : closed
          ? { state: 'closed' }
          : remaining === 0
            ? { state: 'capacity_full' }
            : { state: 'available' },
  };
};

const loadParticipantAgendaSnapshotUnlocked = async (
  db: AgendaDatabase,
  context: AgendaContext,
  userId: string,
  now: Date,
  onOperationalDrift?: (drift: ParticipantAgendaOperationalDrift) => void,
): Promise<ParticipantAgendaResponse> => {
  // These reads also run inside mutations on one transaction client. Keep them
  // sequential so node-postgres never receives concurrent queries on a client.
  const root = await db.query.participantAgendas.findFirst({
    columns: { version: true },
    where: and(
      eq(schema.participantAgendas.eventId, context.event.id),
      eq(schema.participantAgendas.userId, userId),
    ),
  });
  const publishedById = new Map(
    context.program.sessions.map((session) => [session.id, session]),
  );
  const publishedSessionIds = [...publishedById.keys()];
  const savedRows =
    publishedSessionIds.length === 0
      ? []
      : await db
          .select({
            sessionId: schema.agendaItems.sessionId,
            source: schema.agendaItems.source,
            createdAt: schema.agendaItems.createdAt,
          })
          .from(schema.agendaItems)
          .where(
            and(
              eq(schema.agendaItems.eventId, context.event.id),
              eq(schema.agendaItems.userId, userId),
              inArray(schema.agendaItems.sessionId, publishedSessionIds),
            ),
          )
          .limit(MAX_AGENDA_ITEMS + 1);
  const reservationRows =
    publishedSessionIds.length === 0
      ? []
      : await db
          .select({
            id: schema.reservations.id,
            sessionId: schema.reservations.sessionId,
            version: schema.reservations.version,
            createdAt: schema.reservations.createdAt,
          })
          .from(schema.reservations)
          .where(
            and(
              eq(schema.reservations.eventId, context.event.id),
              eq(schema.reservations.userId, userId),
              eq(schema.reservations.status, 'confirmed'),
              inArray(schema.reservations.sessionId, publishedSessionIds),
            ),
          )
          .limit(MAX_AGENDA_ITEMS + 1);
  const activeWaitlistRanks = db
    .select({
      id: schema.waitlistEntries.id,
      sessionId: schema.waitlistEntries.sessionId,
      userId: schema.waitlistEntries.userId,
      joinedAt: schema.waitlistEntries.createdAt,
      position:
        sql<number>`(row_number() over (partition by ${schema.waitlistEntries.eventId}, ${schema.waitlistEntries.sessionId} order by ${schema.waitlistEntries.positionSequence}, ${schema.waitlistEntries.id}))::integer`.as(
          'position',
        ),
    })
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.eventId, context.event.id),
        eq(schema.waitlistEntries.status, 'waiting'),
        inArray(schema.waitlistEntries.sessionId, publishedSessionIds),
      ),
    )
    .as('active_waitlist_ranks');
  const waitingRows =
    publishedSessionIds.length === 0
      ? []
      : await db
          .select({
            id: activeWaitlistRanks.id,
            sessionId: activeWaitlistRanks.sessionId,
            joinedAt: activeWaitlistRanks.joinedAt,
            position: activeWaitlistRanks.position,
          })
          .from(activeWaitlistRanks)
          .where(
            and(
              eq(activeWaitlistRanks.userId, userId),
              inArray(activeWaitlistRanks.sessionId, publishedSessionIds),
            ),
          )
          .limit(MAX_AGENDA_ITEMS + 1);
  if (
    savedRows.length > MAX_AGENDA_ITEMS ||
    reservationRows.length > MAX_AGENDA_ITEMS ||
    waitingRows.length > MAX_AGENDA_ITEMS
  ) {
    throw new Error('Participant agenda row limit exceeded');
  }

  const savedBySession = new Map(savedRows.map((row) => [row.sessionId, row]));
  const reservationBySession = new Map(
    reservationRows.map((row) => [row.sessionId, row]),
  );
  const waitingBySession = new Map(
    waitingRows.map((row) => [row.sessionId, row]),
  );
  const requestedSessionIds = [
    ...new Set([
      ...savedBySession.keys(),
      ...reservationBySession.keys(),
      ...waitingBySession.keys(),
    ]),
  ];
  if (requestedSessionIds.length > MAX_AGENDA_ITEMS) {
    throw new Error('Participant agenda item limit exceeded');
  }
  const operationalRows =
    publishedSessionIds.length === 0
      ? []
      : await db
          .select({
            id: schema.programSessions.id,
            capacity: schema.programSessions.capacity,
            capacityMode: schema.programSessions.capacityMode,
            reservationGroupId: schema.programSessions.reservationGroupId,
            reservationClosesAt: schema.programSessions.reservationClosesAt,
            reservationOpensAt: schema.programSessions.reservationOpensAt,
            startsAt: schema.programSessions.startsAt,
            status: schema.programSessions.status,
            type: schema.programSessions.type,
            waitlistMode: schema.programSessions.waitlistMode,
          })
          .from(schema.programSessions)
          .where(
            and(
              eq(schema.programSessions.eventId, context.event.id),
              inArray(schema.programSessions.id, publishedSessionIds),
              ne(schema.programSessions.status, 'archived'),
            ),
          );
  const operationalById = new Map(operationalRows.map((row) => [row.id, row]));
  const activeReservationTargets = new Set([
    ...reservationBySession.keys(),
    ...waitingBySession.keys(),
  ]);
  const visibleSessionIds = [
    ...new Set([
      ...requestedSessionIds,
      ...operationalRows
        .filter((row) =>
          activeReservationTargets.has(row.reservationGroupId ?? row.id),
        )
        .map(({ id }) => id),
    ]),
  ];
  if (visibleSessionIds.length > MAX_AGENDA_ITEMS) {
    throw new Error('Participant agenda item limit exceeded');
  }
  const reservationTargetIds = [
    ...new Set(
      visibleSessionIds.map((sessionId) => {
        const operational = operationalById.get(sessionId);
        return operational?.reservationGroupId ?? sessionId;
      }),
    ),
  ];
  const capacityRows =
    reservationTargetIds.length === 0
      ? []
      : await db
          .select({
            sessionId: schema.reservations.sessionId,
            confirmed: count(),
          })
          .from(schema.reservations)
          .where(
            and(
              eq(schema.reservations.eventId, context.event.id),
              eq(schema.reservations.status, 'confirmed'),
              inArray(schema.reservations.sessionId, reservationTargetIds),
            ),
          )
          .groupBy(schema.reservations.sessionId);
  const confirmedBySession = new Map(
    capacityRows.map(({ sessionId, confirmed }) => [sessionId, confirmed]),
  );

  const items: ParticipantAgendaItem[] = [];
  for (const sessionId of visibleSessionIds) {
    const published = publishedById.get(sessionId);
    const operational = operationalById.get(sessionId);
    if (!published || !operational) continue;
    const day = context.program.days.find(({ id }) => id === published.dayId);
    if (!day) continue;
    const reservationTargetId =
      operational.reservationGroupId ?? operational.id;
    const reservationPublished =
      publishedById.get(reservationTargetId) ?? published;
    const confirmed = confirmedBySession.get(reservationTargetId) ?? 0;
    const operationalState = capacityProjection(
      operational,
      reservationPublished,
      confirmed,
      now,
    );
    const state =
      published.status === 'cancelled'
        ? {
            ...operationalState,
            capacity:
              operationalState.capacity.mode === 'reservation'
                ? {
                    ...operationalState.capacity,
                    actorAvailability: { state: 'unavailable' as const },
                  }
                : operationalState.capacity,
            action: { state: 'cancelled' as const },
          }
        : operationalState;
    const common = {
      day: { localDate: day.localDate, title: day.title },
      session: sessionSnapshot(
        context,
        published,
        operational.status === 'cancelled' ? 'cancelled' : 'published',
      ),
      ...state,
    };
    const reservation = reservationBySession.get(reservationTargetId);
    if (reservation) {
      if (state.capacity.mode !== 'reservation') {
        onOperationalDrift?.({
          code: 'confirmed_reservation_without_capacity',
          eventId: context.event.id,
          sessionId,
        });
        const safeCapacity = Math.max(1, confirmed);
        items.push({
          day: common.day,
          session: common.session,
          capacity: {
            mode: 'reservation',
            capacity: safeCapacity,
            confirmed: safeCapacity,
            held: 0,
            remaining: 0,
            waitlistAvailable: false,
            actorAvailability: { state: 'unavailable' },
          },
          action:
            common.session.status === 'cancelled'
              ? { state: 'cancelled' }
              : { state: 'closed' },
          state: 'reserved',
          reservation: {
            id: reservation.id,
            version: reservation.version,
            confirmedAt: reservation.createdAt.toISOString(),
            cancellation: { state: 'unavailable', reason: 'closed' },
          },
        });
        continue;
      }
      items.push({
        ...common,
        state: 'reserved',
        reservation: {
          id: reservation.id,
          version: reservation.version,
          confirmedAt: reservation.createdAt.toISOString(),
          cancellation:
            common.session.status === 'published' &&
            now.getTime() < Date.parse(reservationPublished.startsAt)
              ? { state: 'available' }
              : { state: 'unavailable', reason: 'closed' },
        },
      });
      continue;
    }
    const waiting = waitingBySession.get(reservationTargetId);
    if (waiting) {
      if (state.capacity.mode !== 'reservation') {
        onOperationalDrift?.({
          code: 'active_waitlist_without_capacity',
          eventId: context.event.id,
          sessionId,
        });
        const safeCapacity = Math.max(1, confirmed);
        items.push({
          day: common.day,
          session: common.session,
          capacity: {
            mode: 'reservation',
            capacity: safeCapacity,
            confirmed: safeCapacity,
            held: 0,
            remaining: 0,
            waitlistAvailable: false,
            actorAvailability: { state: 'unavailable' },
          },
          action:
            common.session.status === 'cancelled'
              ? { state: 'cancelled' }
              : { state: 'closed' },
          state: 'waitlisted',
          waitlist: {
            id: waiting.id,
            state: 'waiting',
            joinedAt: waiting.joinedAt.toISOString(),
            position: waiting.position,
            actionsAvailable: false,
          },
        });
        continue;
      }
      items.push({
        ...common,
        capacity: {
          ...state.capacity,
          actorAvailability: { state: 'unavailable' },
        },
        state: 'waitlisted',
        waitlist: {
          id: waiting.id,
          state: 'waiting',
          joinedAt: waiting.joinedAt.toISOString(),
          position: waiting.position,
          actionsAvailable:
            operational.waitlistMode === 'auto_confirm' &&
            common.session.status === 'published' &&
            common.action.state !== 'closed',
        },
      });
      continue;
    }
    const saved = savedBySession.get(sessionId);
    if (saved) {
      items.push({
        ...common,
        state: 'saved',
        source: saved.source,
        savedAt: saved.createdAt.toISOString(),
      });
    }
  }
  items.sort((left, right) => {
    const byStart =
      Date.parse(left.session.startsAt) - Date.parse(right.session.startsAt);
    return byStart || left.session.id.localeCompare(right.session.id);
  });
  if (items.length > MAX_AGENDA_ITEMS) {
    throw new Error('Participant agenda item limit exceeded');
  }
  return participantAgendaResponseSchema.parse({
    eventId: context.event.id,
    userId,
    eventTimezone: context.event.timezone,
    serverNow: now.toISOString(),
    version: root?.version ?? 1,
    publicationVersion: context.publicationVersion,
    items,
    calendarExport:
      items.length === 0
        ? { state: 'unavailable', reason: 'empty' }
        : { state: 'available', href: '/api/v1/me/agenda.ics' },
  });
};

const loadCurrentAgendaEvent = async (
  db: AgendaDatabase,
  eventId: string,
  now: Date,
  mutation: boolean,
): Promise<AgendaEvent> => {
  const event = await db.query.events.findFirst({
    columns: {
      id: true,
      operationalDataAnonymizesAt: true,
      status: true,
      timezone: true,
    },
    where: eq(schema.events.id, eventId),
  });
  return requireAgendaEventAvailable(event, now, mutation);
};

export const loadParticipantAgendaSnapshot = async (
  db: Database,
  context: AgendaContext,
  userId: string,
  getNow: () => Date,
  onOperationalDrift?: (drift: ParticipantAgendaOperationalDrift) => void,
): Promise<ParticipantAgendaResponse> =>
  db.transaction(async (transaction) => {
    await acquireTransactionLock(
      transaction,
      participantAgendaLockKey(context.event.id, userId),
    );
    const now = getNow();
    const lockedEvent = await loadCurrentAgendaEvent(
      transaction,
      context.event.id,
      now,
      false,
    );
    await requireAgendaPermission(transaction, userId, context.event.id);
    const lockedContext = await loadAgendaPublication(transaction, lockedEvent);
    return loadParticipantAgendaSnapshotUnlocked(
      transaction,
      lockedContext,
      userId,
      now,
      onOperationalDrift,
    );
  });

const loadProjectedAgendaSessionIds = async (
  transaction: DatabaseTransaction,
  eventId: string,
  userId: string,
  publishedSessionIds: readonly string[],
): Promise<string[]> => {
  if (publishedSessionIds.length === 0) return [];
  const rows = await transaction
    .select({ sessionId: schema.agendaItems.sessionId })
    .from(schema.agendaItems)
    .where(
      and(
        eq(schema.agendaItems.eventId, eventId),
        eq(schema.agendaItems.userId, userId),
        inArray(schema.agendaItems.sessionId, publishedSessionIds),
      ),
    )
    .union(
      transaction
        .select({ sessionId: schema.reservations.sessionId })
        .from(schema.reservations)
        .where(
          and(
            eq(schema.reservations.eventId, eventId),
            eq(schema.reservations.userId, userId),
            eq(schema.reservations.status, 'confirmed'),
            inArray(schema.reservations.sessionId, publishedSessionIds),
          ),
        ),
    )
    .union(
      transaction
        .select({ sessionId: schema.waitlistEntries.sessionId })
        .from(schema.waitlistEntries)
        .where(
          and(
            eq(schema.waitlistEntries.eventId, eventId),
            eq(schema.waitlistEntries.userId, userId),
            eq(schema.waitlistEntries.status, 'waiting'),
            inArray(schema.waitlistEntries.sessionId, publishedSessionIds),
          ),
        ),
    )
    .limit(MAX_AGENDA_ITEMS + 1);
  return rows.map(({ sessionId }) => sessionId);
};

const ensureAgendaRoot = async (
  transaction: DatabaseTransaction,
  eventId: string,
  userId: string,
): Promise<number> => {
  await transaction
    .insert(schema.participantAgendas)
    .values({ eventId, userId })
    .onConflictDoNothing();
  const root = await transaction.query.participantAgendas.findFirst({
    columns: { version: true },
    where: and(
      eq(schema.participantAgendas.eventId, eventId),
      eq(schema.participantAgendas.userId, userId),
    ),
  });
  if (!root) throw eventAccessDenied();
  return root.version;
};

const bumpAgendaVersion = async (
  transaction: DatabaseTransaction,
  eventId: string,
  userId: string,
  now: Date,
): Promise<void> => {
  await transaction
    .update(schema.participantAgendas)
    .set({
      version: sql`${schema.participantAgendas.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.participantAgendas.eventId, eventId),
        eq(schema.participantAgendas.userId, userId),
      ),
    );
};

const targetPublishedSession = (
  context: AgendaContext,
  sessionId: string,
  action: AgendaMutationReceipt['action'],
): PublishedProgramAgendaSnapshot['sessions'][number] | undefined => {
  const session = context.program.sessions.find(({ id }) => id === sessionId);
  if (
    action !== 'remove' &&
    action !== 'leave_waitlist' &&
    (!session || session.status === 'cancelled')
  ) {
    throw sessionNotFound();
  }
  return session;
};

const conflictFor = (
  snapshot: ParticipantAgendaResponse,
  sessionId: string,
): ParticipantAgendaMutationResponse['timeConflict'] => {
  const target = snapshot.items.find(
    ({ session }) => session.id === sessionId,
  )?.session;
  if (!target || target.status !== 'published') return null;
  const conflicts = snapshot.items
    .map(({ session }) => session)
    .filter(
      (session) =>
        session.status === 'published' &&
        session.id !== target.id &&
        Date.parse(session.startsAt) < Date.parse(target.endsAt) &&
        Date.parse(session.endsAt) > Date.parse(target.startsAt),
    )
    .sort((left, right) => {
      const byStart = Date.parse(left.startsAt) - Date.parse(right.startsAt);
      return byStart || left.id.localeCompare(right.id);
    })
    .slice(0, 10);
  return conflicts.length === 0
    ? null
    : {
        eventId: snapshot.eventId,
        sessionId,
        targetSession: target,
        conflictingSessions: conflicts,
      };
};

interface ReservationConflictState {
  readonly conflict: AgendaReservationConflict;
  readonly reservationSessionIds: readonly string[];
  readonly until: Date;
}

const loadReservationConflict = async (
  transaction: DatabaseTransaction,
  context: AgendaContext,
  userId: string,
  sessionId: string,
  reservationTargetId: string,
  targetClosesAt: number,
): Promise<ReservationConflictState | null> => {
  const operationalRows = await transaction
    .select({
      id: schema.programSessions.id,
      reservationGroupId: schema.programSessions.reservationGroupId,
      status: schema.programSessions.status,
      type: schema.programSessions.type,
    })
    .from(schema.programSessions)
    .where(
      and(
        eq(schema.programSessions.eventId, context.event.id),
        inArray(
          schema.programSessions.id,
          context.program.sessions.map(({ id }) => id),
        ),
        ne(schema.programSessions.status, 'archived'),
      ),
    );
  const operationalById = new Map(operationalRows.map((row) => [row.id, row]));
  const publishedById = new Map(
    context.program.sessions.map((published) => [published.id, published]),
  );
  const targetSessions = operationalRows
    .filter(
      (row) =>
        (row.reservationGroupId ?? row.id) === reservationTargetId &&
        row.status !== 'cancelled',
    )
    .map(({ id }) => publishedById.get(id))
    .filter(
      (
        published,
      ): published is PublishedProgramAgendaSnapshot['sessions'][number] =>
        published !== undefined && published.status !== 'cancelled',
    );
  if (targetSessions.length === 0) return null;
  const targetIsCoaching = operationalRows.some(
    (row) =>
      (row.reservationGroupId ?? row.id) === reservationTargetId &&
      row.status !== 'cancelled' &&
      row.type === 'coaching',
  );

  const confirmedReservations = await transaction
    .select({ sessionId: schema.reservations.sessionId })
    .from(schema.reservations)
    .where(
      and(
        eq(schema.reservations.eventId, context.event.id),
        eq(schema.reservations.userId, userId),
        eq(schema.reservations.status, 'confirmed'),
        ne(schema.reservations.sessionId, reservationTargetId),
      ),
    );
  const conflictingRootIds: string[] = [];
  const conflictingPublished = new Map<
    string,
    PublishedProgramAgendaSnapshot['sessions'][number]
  >();
  let until = targetClosesAt;
  let reason: AgendaReservationConflict['reason'] = 'time_overlap';
  for (const reservation of confirmedReservations) {
    const projections = operationalRows
      .filter(
        (row) =>
          (row.reservationGroupId ?? row.id) === reservation.sessionId &&
          row.status !== 'cancelled',
      )
      .map(({ id }) => publishedById.get(id))
      .filter(
        (
          published,
        ): published is PublishedProgramAgendaSnapshot['sessions'][number] =>
          published !== undefined && published.status !== 'cancelled',
      );
    const overlapping = projections.filter((projection) =>
      targetSessions.some(
        (target) =>
          Date.parse(projection.startsAt) < Date.parse(target.endsAt) &&
          Date.parse(projection.endsAt) > Date.parse(target.startsAt),
      ),
    );
    const coachingLimit =
      targetIsCoaching &&
      operationalRows.some(
        (row) =>
          (row.reservationGroupId ?? row.id) === reservation.sessionId &&
          row.status !== 'cancelled' &&
          row.type === 'coaching',
      );
    if (overlapping.length === 0 && !coachingLimit) continue;
    if (coachingLimit) reason = 'coaching_limit';
    conflictingRootIds.push(reservation.sessionId);
    projections.forEach((projection) => {
      until = Math.min(until, Date.parse(projection.startsAt));
    });
    (coachingLimit ? projections : overlapping).forEach((projection) =>
      conflictingPublished.set(projection.id, projection),
    );
  }
  const reservationSessionIds = [...new Set(conflictingRootIds)].sort();
  if (reservationSessionIds.length === 0) return null;
  if (
    reservationSessionIds.length > 10 ||
    targetSessions.length > 10 ||
    conflictingPublished.size > 10 ||
    !Number.isFinite(until)
  ) {
    throw new Error('Reservation conflict projection limit exceeded');
  }
  const snapshotFor = (
    published: PublishedProgramAgendaSnapshot['sessions'][number],
  ): AgendaSessionSnapshot => {
    const operational = operationalById.get(published.id);
    return sessionSnapshot(
      context,
      published,
      operational?.status === 'cancelled' ? 'cancelled' : 'published',
    );
  };
  const byStart = (
    left: PublishedProgramAgendaSnapshot['sessions'][number],
    right: PublishedProgramAgendaSnapshot['sessions'][number],
  ): number =>
    Date.parse(left.startsAt) - Date.parse(right.startsAt) ||
    left.id.localeCompare(right.id);
  return {
    reservationSessionIds,
    until: new Date(until),
    conflict: {
      eventId: context.event.id,
      sessionId,
      reason,
      targetSessions: [...targetSessions].sort(byStart).map(snapshotFor),
      conflictingSessions: [...conflictingPublished.values()]
        .sort(byStart)
        .map(snapshotFor),
    },
  };
};

const receiptPostconditionHolds = (
  snapshot: ParticipantAgendaResponse,
  receipt: AgendaMutationReceipt,
): boolean => {
  const item = snapshot.items.find(
    ({ session }) => session.id === receipt.sessionId,
  );
  switch (receipt.action) {
    case 'add':
      return (
        item !== undefined &&
        (receipt.outcome !== 'applied' || item.state === 'saved')
      );
    case 'remove':
      return item === undefined;
    case 'reserve':
      return item?.state === 'reserved';
    case 'cancel':
      return item === undefined || item.state === 'saved';
    case 'join_waitlist':
      return item?.state === 'waitlisted' || item?.state === 'reserved';
    case 'leave_waitlist':
      return item === undefined || item.state === 'saved';
  }
};

const canonicalProblemResponse = (
  error:
    | StaleAgendaVersionError
    | AgendaCapacityFullError
    | AgendaReservationClosedError
    | AgendaReservationConflictError,
  snapshot: ParticipantAgendaResponse,
  requestId: string,
): Response => {
  let classified = error;
  if (
    error instanceof AgendaReservationConflictError &&
    snapshot.version !== error.agendaVersion
  ) {
    classified = new StaleAgendaVersionError();
  }
  if (
    !(classified instanceof StaleAgendaVersionError) &&
    !(classified instanceof AgendaReservationConflictError)
  ) {
    const classifiedSessionId = classified.sessionId;
    const item = snapshot.items.find(
      ({ session }) => session.id === classifiedSessionId,
    );
    if (
      !item ||
      item.session.status !== 'published' ||
      item.capacity.mode !== 'reservation'
    ) {
      return privateProblemResponse(sessionNotFound(), requestId);
    }
    if (item.action.state === 'capacity_full') {
      classified = new AgendaCapacityFullError(classifiedSessionId);
    } else if (item.action.state === 'closed') {
      classified = new AgendaReservationClosedError(classifiedSessionId);
    } else {
      classified = new StaleAgendaVersionError();
    }
  }
  const candidate =
    classified instanceof StaleAgendaVersionError
      ? {
          type: problemTypeForCode('STALE_VERSION'),
          title: 'Agenda version changed',
          status: 409,
          code: 'STALE_VERSION',
          detail: 'Reload the canonical agenda before retrying the mutation.',
          requestId,
          currentVersion: snapshot.version,
          agenda: snapshot,
        }
      : classified instanceof AgendaReservationConflictError
        ? {
            type: problemTypeForCode('RESERVATION_CONFLICT'),
            title:
              classified.conflict.reason === 'coaching_limit'
                ? 'Only one coaching reservation is allowed'
                : 'Reservation overlaps another reservation',
            status: 409,
            code: 'RESERVATION_CONFLICT',
            detail:
              classified.conflict.reason === 'coaching_limit'
                ? 'A participant may reserve only one coaching slot for the event. Choose whether to keep it or replace it with the new one.'
                : 'Choose whether to keep the existing reservation or replace it with the new one.',
            requestId,
            sessionId: classified.sessionId,
            agenda: snapshot,
            conflict: classified.conflict,
            replacement: {
              allowed: classified.allowed,
              until: classified.until.toISOString(),
              reservationSessionIds: classified.reservationSessionIds,
            },
          }
        : classified instanceof AgendaCapacityFullError
          ? {
              type: problemTypeForCode('CAPACITY_FULL'),
              title: 'Session capacity is full',
              status: 409,
              code: 'CAPACITY_FULL',
              detail:
                'The final available place was reserved by another request.',
              requestId,
              sessionId: classified.sessionId,
              agenda: snapshot,
            }
          : {
              type: problemTypeForCode('RESERVATION_CLOSED'),
              title: 'Reservations are closed',
              status: 409,
              code: 'RESERVATION_CLOSED',
              detail: 'Reservations are not open for this session.',
              requestId,
              sessionId: classified.sessionId,
              agenda: snapshot,
            };
  const problem = participantAgendaMutationProblemSchema.parse(candidate);
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: privateHeaders(requestId, 'application/problem+json'),
  });
};

const readParticipantAgendaRepresentation = async (
  request: Request,
  dependencies: ParticipantAgendaDependencies,
  respond: (body: ParticipantAgendaResponse, requestId: string) => Response,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    requireReadTransport(request);
    const session = await requireSession(request, dependencies);
    rateLimitDecision =
      (await dependencies.rateLimit?.('read', session.user.id)) ?? null;
    const getNow = dependencies.now ?? (() => new Date());
    const now = getNow();
    const context = await loadAgendaContext(
      dependencies,
      session.user.id,
      now,
      false,
    );
    const body = await loadParticipantAgendaSnapshot(
      dependencies.db,
      context,
      session.user.id,
      getNow,
      dependencies.onOperationalDrift,
    );
    return withRateLimitHeaders(respond(body, requestId), rateLimitDecision);
  } catch (error) {
    return withRateLimitHeaders(
      privateProblemResponse(error, requestId),
      rateLimitDecision,
    );
  }
};

export const readParticipantAgenda = (
  request: Request,
  dependencies: ParticipantAgendaDependencies,
): Promise<Response> =>
  readParticipantAgendaRepresentation(
    request,
    dependencies,
    (body, requestId) => successResponse(body, requestId),
  );

export const readParticipantAgendaCalendar = (
  request: Request,
  dependencies: ParticipantAgendaCalendarDependencies,
): Promise<Response> =>
  readParticipantAgendaCalendarWithTicket(request, dependencies);

const calendarTicketFromRequest = (request: Request): string | null => {
  if (
    request.headers.has('idempotency-key') ||
    request.headers.has('if-match')
  ) {
    throw validationFailed({
      query: ['Calendar download parameters are invalid.'],
    });
  }
  const parameters = [...new URL(request.url).searchParams.entries()];
  if (parameters.length === 0) return null;
  if (
    parameters.length !== 1 ||
    parameters[0]?.[0] !== 'ticket' ||
    parameters[0][1].length === 0
  ) {
    throw validationFailed({
      query: ['Calendar download parameters are invalid.'],
    });
  }
  return parameters[0][1];
};

async function readParticipantAgendaCalendarWithTicket(
  request: Request,
  dependencies: ParticipantAgendaCalendarDependencies,
): Promise<Response> {
  const requestId = getRequestId(request.headers);
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    const getNow = dependencies.now ?? (() => new Date());
    const ticket = calendarTicketFromRequest(request);
    if (ticket === null) {
      const session = await requireSession(request, dependencies);
      rateLimitDecision =
        (await dependencies.rateLimit?.('read', session.user.id)) ?? null;
      const now = getNow();
      const context = await loadAgendaContext(
        dependencies,
        session.user.id,
        now,
        false,
      );
      const body = await loadParticipantAgendaSnapshot(
        dependencies.db,
        context,
        session.user.id,
        getNow,
        dependencies.onOperationalDrift,
      );
      const sealedTicket = issueAgendaCalendarTicket({
        secret: dependencies.calendarTicketSecret,
        now: getNow(),
        userId: body.userId,
        eventId: body.eventId,
        agendaVersion: body.version,
        publicationVersion: body.publicationVersion,
      });
      return withRateLimitHeaders(
        calendarRedirectResponse(
          requestId,
          dependencies.allowedOrigin,
          sealedTicket,
        ),
        rateLimitDecision,
      );
    }

    const claims = readAgendaCalendarTicket({
      secret: dependencies.calendarTicketSecret,
      token: ticket,
      now: getNow(),
    });
    if (!claims) throw authenticationRequired();
    rateLimitDecision =
      (await dependencies.rateLimit?.('read', claims.userId)) ?? null;
    const context = await loadAgendaContext(
      dependencies,
      claims.userId,
      getNow(),
      false,
    );
    const body = await loadParticipantAgendaSnapshot(
      dependencies.db,
      context,
      claims.userId,
      getNow,
      dependencies.onOperationalDrift,
    );
    if (
      body.userId !== claims.userId ||
      body.eventId !== claims.eventId ||
      body.version !== claims.agendaVersion ||
      body.publicationVersion !== claims.publicationVersion
    ) {
      throw authenticationRequired();
    }
    return withRateLimitHeaders(
      calendarSuccessResponse(body, requestId),
      rateLimitDecision,
    );
  } catch (error) {
    return withRateLimitHeaders(
      privateProblemResponse(error, requestId),
      rateLimitDecision,
    );
  }
}

export const mutateParticipantAgenda = async (
  request: Request,
  dependencies: ParticipantAgendaDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  const getNow = dependencies.now ?? (() => new Date());
  let rateLimitDecision: RateLimitDecision | null = null;
  let canonical: { context: AgendaContext; userId: string } | undefined;
  try {
    const key = requireMutationTransport(request, dependencies.allowedOrigin);
    const session = await requireSession(request, dependencies);
    rateLimitDecision =
      (await dependencies.rateLimit?.('mutation', session.user.id)) ?? null;
    const now = getNow();
    let responseNow = now;
    const context = await loadAgendaContext(
      dependencies,
      session.user.id,
      now,
      false,
    );
    canonical = { context, userId: session.user.id };
    const json = await readBoundedJson(request);
    const parsed = participantAgendaMutationRequestSchema.safeParse(json.value);
    if (!parsed.success) throw validationFailed(zodFieldErrors(parsed.error));
    if (
      parsed.data.action !== 'add' &&
      parsed.data.action !== 'remove' &&
      parsed.data.action !== 'reserve' &&
      parsed.data.action !== 'cancel' &&
      parsed.data.action !== 'join_waitlist' &&
      parsed.data.action !== 'leave_waitlist'
    ) {
      throw validationFailed({
        action: ['This agenda action is not enabled in the current rollout.'],
      });
    }
    const action: AgendaMutationReceipt['action'] = parsed.data.action;
    const generateId = dependencies.generateId ?? generateUuidV7;
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId: context.event.id,
        actorId: session.user.id,
        scope: 'participant.agenda-action',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: json.raw,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now,
        generateId,
      },
      async (transaction) => {
        await acquireTransactionLock(
          transaction,
          participantAgendaLockKey(context.event.id, session.user.id),
        );
        if (
          parsed.data.action === 'add' ||
          parsed.data.action === 'reserve' ||
          parsed.data.action === 'cancel' ||
          parsed.data.action === 'join_waitlist' ||
          parsed.data.action === 'leave_waitlist'
        ) {
          await acquireTransactionLock(
            transaction,
            `content-publish:${context.event.id}`,
          );
          await acquireTransactionLock(
            transaction,
            `participant-reservation:${context.event.id}:${parsed.data.sessionId}`,
          );
        }
        const mutationNow = getNow();
        responseNow = mutationNow;
        const lockedEvent = await loadCurrentAgendaEvent(
          transaction,
          context.event.id,
          mutationNow,
          true,
        );
        await requireAgendaPermission(
          transaction,
          session.user.id,
          context.event.id,
        );
        const lockedContext = await loadAgendaPublication(
          transaction,
          lockedEvent,
        );
        const publishedTarget = targetPublishedSession(
          lockedContext,
          parsed.data.sessionId,
          action,
        );
        const currentVersion = await ensureAgendaRoot(
          transaction,
          context.event.id,
          session.user.id,
        );
        if (currentVersion !== parsed.data.expectedVersion) {
          throw new StaleAgendaVersionError();
        }

        const operationalTarget =
          await transaction.query.programSessions.findFirst({
            columns: {
              id: true,
              capacity: true,
              capacityMode: true,
              reservationGroupId: true,
              reservationClosesAt: true,
              reservationOpensAt: true,
              startsAt: true,
              status: true,
              type: true,
              waitlistMode: true,
            },
            where: and(
              eq(schema.programSessions.eventId, context.event.id),
              eq(schema.programSessions.id, parsed.data.sessionId),
            ),
          });
        if (
          action !== 'remove' &&
          action !== 'leave_waitlist' &&
          (!operationalTarget ||
            operationalTarget.status === 'archived' ||
            operationalTarget.status === 'cancelled')
        ) {
          throw sessionNotFound();
        }
        const reservationTargetId =
          operationalTarget?.reservationGroupId ?? parsed.data.sessionId;
        if (reservationTargetId !== parsed.data.sessionId) {
          await acquireTransactionLock(
            transaction,
            `participant-reservation:${context.event.id}:${reservationTargetId}`,
          );
        }
        const reservationOperationalTarget =
          reservationTargetId === parsed.data.sessionId
            ? operationalTarget
            : await transaction.query.programSessions.findFirst({
                columns: {
                  id: true,
                  capacity: true,
                  capacityMode: true,
                  reservationGroupId: true,
                  reservationClosesAt: true,
                  reservationOpensAt: true,
                  startsAt: true,
                  status: true,
                  type: true,
                  waitlistMode: true,
                },
                where: and(
                  eq(schema.programSessions.eventId, context.event.id),
                  eq(schema.programSessions.id, reservationTargetId),
                ),
              });
        if (
          action !== 'remove' &&
          action !== 'leave_waitlist' &&
          (!reservationOperationalTarget ||
            reservationOperationalTarget.status === 'archived' ||
            reservationOperationalTarget.status === 'cancelled')
        ) {
          throw sessionNotFound();
        }
        const reservationPublishedTarget =
          lockedContext.program.sessions.find(
            ({ id }) => id === reservationTargetId,
          ) ?? publishedTarget;

        if (
          (parsed.data.action === 'reserve' ||
            parsed.data.action === 'join_waitlist') &&
          reservationOperationalTarget?.type === 'coaching'
        ) {
          await acquireCoachingReservationLock(
            transaction,
            context.event.id,
            session.user.id,
          );
        }

        let outcome: 'applied' | 'already_applied' = 'already_applied';
        let replacedReservationSessionIds: readonly string[] = [];
        if (parsed.data.action === 'add') {
          const projectedSessionIds = await loadProjectedAgendaSessionIds(
            transaction,
            context.event.id,
            session.user.id,
            lockedContext.program.sessions.map(({ id }) => id),
          );
          const targetAlreadyProjected = projectedSessionIds.includes(
            parsed.data.sessionId,
          );
          if (
            !targetAlreadyProjected &&
            projectedSessionIds.length >= MAX_AGENDA_ITEMS
          ) {
            throw validationFailed({
              sessionId: [
                'The agenda has reached the maximum number of items.',
              ],
            });
          }
          if (!targetAlreadyProjected) {
            const inserted = await transaction
              .insert(schema.agendaItems)
              .values({
                eventId: context.event.id,
                userId: session.user.id,
                sessionId: parsed.data.sessionId,
                source: 'manual',
                createdAt: mutationNow,
                updatedAt: mutationNow,
              })
              .onConflictDoNothing()
              .returning({ sessionId: schema.agendaItems.sessionId });
            if (inserted.length === 1) outcome = 'applied';
          }
        } else if (parsed.data.action === 'remove') {
          const reservation = await transaction.query.reservations.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.reservations.eventId, context.event.id),
              eq(schema.reservations.userId, session.user.id),
              eq(schema.reservations.sessionId, reservationTargetId),
              eq(schema.reservations.status, 'confirmed'),
            ),
          });
          const waiting = await transaction.query.waitlistEntries.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.waitlistEntries.eventId, context.event.id),
              eq(schema.waitlistEntries.userId, session.user.id),
              eq(schema.waitlistEntries.sessionId, reservationTargetId),
              eq(schema.waitlistEntries.status, 'waiting'),
            ),
          });
          if (reservation || waiting) {
            throw validationFailed({
              action: [
                'A confirmed reservation or waitlist entry cannot be removed as a saved item.',
              ],
            });
          }
          const deleted = await transaction
            .delete(schema.agendaItems)
            .where(
              and(
                eq(schema.agendaItems.eventId, context.event.id),
                eq(schema.agendaItems.userId, session.user.id),
                eq(schema.agendaItems.sessionId, parsed.data.sessionId),
              ),
            )
            .returning({ sessionId: schema.agendaItems.sessionId });
          if (deleted.length === 1) outcome = 'applied';
        } else if (parsed.data.action === 'cancel') {
          if (!reservationOperationalTarget || !reservationPublishedTarget) {
            throw sessionNotFound();
          }
          if (
            mutationNow.getTime() >=
            Date.parse(reservationPublishedTarget.startsAt)
          ) {
            throw new AgendaReservationClosedError(parsed.data.sessionId);
          }
          const existing = await transaction.query.reservations.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.reservations.eventId, context.event.id),
              eq(schema.reservations.userId, session.user.id),
              eq(schema.reservations.sessionId, reservationTargetId),
              eq(schema.reservations.status, 'confirmed'),
            ),
          });
          if (existing) {
            const cancelled = await transaction
              .update(schema.reservations)
              .set({
                status: 'cancelled',
                cancelledAt: mutationNow,
                version: sql`${schema.reservations.version} + 1`,
              })
              .where(
                and(
                  eq(schema.reservations.eventId, context.event.id),
                  eq(schema.reservations.id, existing.id),
                  eq(schema.reservations.status, 'confirmed'),
                ),
              )
              .returning({ id: schema.reservations.id });
            if (cancelled.length === 1) outcome = 'applied';
            if (cancelled.length === 1) {
              await promoteAutomaticWaitlist({
                transaction,
                eventId: context.event.id,
                sessionId: reservationTargetId,
                now: mutationNow,
                requestId: uuidSchema.safeParse(requestId).success
                  ? requestId
                  : generateUuidV7(),
                generateId,
              });
            }
          }
        } else if (parsed.data.action === 'leave_waitlist') {
          const cancelled = await transaction
            .update(schema.waitlistEntries)
            .set({ status: 'cancelled', cancelledAt: mutationNow })
            .where(
              and(
                eq(schema.waitlistEntries.eventId, context.event.id),
                eq(schema.waitlistEntries.userId, session.user.id),
                eq(schema.waitlistEntries.sessionId, reservationTargetId),
                eq(schema.waitlistEntries.status, 'waiting'),
              ),
            )
            .returning({ id: schema.waitlistEntries.id });
          if (cancelled.length === 1) outcome = 'applied';
        } else {
          if (!reservationOperationalTarget || !reservationPublishedTarget) {
            throw sessionNotFound();
          }
          const saved = await transaction.query.agendaItems.findFirst({
            columns: { sessionId: true },
            where: and(
              eq(schema.agendaItems.eventId, context.event.id),
              eq(schema.agendaItems.userId, session.user.id),
              eq(schema.agendaItems.sessionId, parsed.data.sessionId),
            ),
          });
          if (!saved) {
            throw validationFailed({
              sessionId: ['Add the session to the agenda before reserving.'],
            });
          }
          // ADR-016 makes active event access authoritative for 2026. The
          // post-lock permission check above already revalidates membership
          // and an eligible event role; no ticket credential is issued.
          if (
            reservationOperationalTarget.capacityMode !== 'reservation' ||
            reservationOperationalTarget.capacity === null ||
            (parsed.data.action === 'join_waitlist' &&
              reservationOperationalTarget.waitlistMode !== 'auto_confirm')
          ) {
            throw sessionNotFound();
          }
          const opensAt =
            reservationPublishedTarget.reservationOpensAt === undefined
              ? (reservationOperationalTarget.reservationOpensAt?.getTime() ??
                Number.NEGATIVE_INFINITY)
              : reservationPublishedTarget.reservationOpensAt === null
                ? Number.NEGATIVE_INFINITY
                : Date.parse(reservationPublishedTarget.reservationOpensAt);
          const closesAt =
            reservationPublishedTarget.reservationClosesAt === undefined
              ? (reservationOperationalTarget.reservationClosesAt?.getTime() ??
                reservationOperationalTarget.startsAt.getTime())
              : reservationPublishedTarget.reservationClosesAt === null
                ? Date.parse(reservationPublishedTarget.startsAt)
                : Date.parse(reservationPublishedTarget.reservationClosesAt);
          if (
            mutationNow.getTime() < opensAt ||
            mutationNow.getTime() >= closesAt
          ) {
            throw new AgendaReservationClosedError(parsed.data.sessionId);
          }
          const existing = await transaction.query.reservations.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.reservations.eventId, context.event.id),
              eq(schema.reservations.userId, session.user.id),
              eq(schema.reservations.sessionId, reservationTargetId),
              eq(schema.reservations.status, 'confirmed'),
            ),
          });
          if (!existing) {
            const waiting = await transaction.query.waitlistEntries.findFirst({
              columns: { id: true },
              where: and(
                eq(schema.waitlistEntries.eventId, context.event.id),
                eq(schema.waitlistEntries.userId, session.user.id),
                eq(schema.waitlistEntries.sessionId, reservationTargetId),
                eq(schema.waitlistEntries.status, 'waiting'),
              ),
            });
            if (waiting && parsed.data.action === 'reserve') {
              throw validationFailed({
                action: [
                  'A waiting participant cannot bypass the canonical waitlist.',
                ],
              });
            }
            if (parsed.data.action === 'reserve') {
              const conflict = await loadReservationConflict(
                transaction,
                lockedContext,
                session.user.id,
                parsed.data.sessionId,
                reservationTargetId,
                closesAt,
              );
              const requestedReplacementIds = [
                ...(parsed.data.replaceReservationSessionIds ?? []),
              ].sort();
              if (conflict) {
                const replacementMatches =
                  requestedReplacementIds.length ===
                    conflict.reservationSessionIds.length &&
                  requestedReplacementIds.every(
                    (id, index) => id === conflict.reservationSessionIds[index],
                  );
                const replacementAllowed =
                  mutationNow.getTime() < conflict.until.getTime();
                if (!replacementMatches || !replacementAllowed) {
                  throw new AgendaReservationConflictError(
                    parsed.data.sessionId,
                    conflict.conflict,
                    conflict.reservationSessionIds,
                    conflict.until,
                    replacementAllowed,
                    currentVersion,
                  );
                }
                replacedReservationSessionIds = conflict.reservationSessionIds;
                for (const conflictingSessionId of conflict.reservationSessionIds) {
                  await acquireTransactionLock(
                    transaction,
                    `participant-reservation:${context.event.id}:${conflictingSessionId}`,
                  );
                }
              } else if (requestedReplacementIds.length > 0) {
                throw new StaleAgendaVersionError();
              }
            }
            const capacityRows = await transaction
              .select({ confirmed: count() })
              .from(schema.reservations)
              .where(
                and(
                  eq(schema.reservations.eventId, context.event.id),
                  eq(schema.reservations.sessionId, reservationTargetId),
                  eq(schema.reservations.status, 'confirmed'),
                ),
              );
            const capacityIsFull =
              (capacityRows[0]?.confirmed ?? 0) >=
              reservationOperationalTarget.capacity;
            if (capacityIsFull && parsed.data.action === 'reserve') {
              throw new AgendaCapacityFullError(parsed.data.sessionId);
            }
            if (
              capacityIsFull &&
              parsed.data.action === 'join_waitlist' &&
              !waiting
            ) {
              const [lastPosition] = await transaction
                .select({
                  value: sql<number>`coalesce(max(${schema.waitlistEntries.positionSequence}), 0)::integer`,
                })
                .from(schema.waitlistEntries)
                .where(
                  and(
                    eq(schema.waitlistEntries.eventId, context.event.id),
                    eq(schema.waitlistEntries.sessionId, reservationTargetId),
                  ),
                );
              await transaction.insert(schema.waitlistEntries).values({
                id: generateId(),
                eventId: context.event.id,
                userId: session.user.id,
                sessionId: reservationTargetId,
                status: 'waiting',
                positionSequence: (lastPosition?.value ?? 0) + 1,
                createdAt: mutationNow,
              });
              outcome = 'applied';
            } else if (!capacityIsFull && !waiting) {
              if (replacedReservationSessionIds.length > 0) {
                const cancelled = await transaction
                  .update(schema.reservations)
                  .set({
                    status: 'cancelled',
                    cancelledAt: mutationNow,
                    version: sql`${schema.reservations.version} + 1`,
                  })
                  .where(
                    and(
                      eq(schema.reservations.eventId, context.event.id),
                      eq(schema.reservations.userId, session.user.id),
                      eq(schema.reservations.status, 'confirmed'),
                      inArray(
                        schema.reservations.sessionId,
                        replacedReservationSessionIds,
                      ),
                    ),
                  )
                  .returning({ sessionId: schema.reservations.sessionId });
                if (
                  new Set(cancelled.map(({ sessionId }) => sessionId)).size !==
                  replacedReservationSessionIds.length
                ) {
                  throw new StaleAgendaVersionError();
                }
                for (const replacedSessionId of replacedReservationSessionIds) {
                  await promoteAutomaticWaitlist({
                    transaction,
                    eventId: context.event.id,
                    sessionId: replacedSessionId,
                    now: mutationNow,
                    requestId: uuidSchema.safeParse(requestId).success
                      ? requestId
                      : generateUuidV7(),
                    generateId,
                  });
                }
              }
              await transaction.insert(schema.reservations).values({
                id: generateId(),
                eventId: context.event.id,
                userId: session.user.id,
                sessionId: reservationTargetId,
                source:
                  parsed.data.action === 'join_waitlist'
                    ? 'waitlist_join'
                    : 'participant',
                status: 'confirmed',
                version: 1,
                createdAt: mutationNow,
              });
              outcome = 'applied';
            }
          }
        }
        if (outcome === 'applied') {
          await bumpAgendaVersion(
            transaction,
            context.event.id,
            session.user.id,
            responseNow,
          );
          await writeAuditLog(transaction, {
            eventId: context.event.id,
            actorId: session.user.id,
            actorType: 'user',
            action:
              parsed.data.action === 'reserve'
                ? 'reservation.created'
                : parsed.data.action === 'cancel'
                  ? 'reservation.cancelled'
                  : parsed.data.action === 'join_waitlist'
                    ? 'waitlist.joined'
                    : parsed.data.action === 'leave_waitlist'
                      ? 'waitlist.left'
                      : `agenda.${parsed.data.action}`,
            targetType: 'program_session',
            targetId: parsed.data.sessionId,
            requestId: uuidSchema.safeParse(requestId).success
              ? requestId
              : generateUuidV7(),
            ...(replacedReservationSessionIds.length > 0
              ? {
                  before: {
                    replacedReservationSessionIds,
                  },
                }
              : {}),
            after: { agendaVersion: currentVersion + 1 },
          });
        }
        const version =
          outcome === 'applied' ? currentVersion + 1 : currentVersion;
        const receipt = agendaMutationReceiptSchema.parse({
          action: parsed.data.action,
          sessionId: parsed.data.sessionId,
          outcome,
          version,
        });
        return {
          status: 200,
          body: receipt,
          resultReference: parsed.data.sessionId,
        };
      },
    );
    const receipt = agendaMutationReceiptSchema.parse(result.body);
    const snapshot = await loadParticipantAgendaSnapshot(
      dependencies.db,
      context,
      session.user.id,
      getNow,
      dependencies.onOperationalDrift,
    );
    const responseSuperseded = !receiptPostconditionHolds(snapshot, receipt);
    const body = participantAgendaMutationResponseSchema.parse({
      ...snapshot,
      mutation: {
        action: receipt.action,
        sessionId: receipt.sessionId,
        outcome: responseSuperseded ? 'superseded' : receipt.outcome,
      },
      timeConflict:
        !responseSuperseded &&
        (receipt.action === 'add' || receipt.action === 'join_waitlist')
          ? conflictFor(snapshot, receipt.sessionId)
          : null,
    });
    return withRateLimitHeaders(
      successResponse(body, requestId, {
        'idempotency-replayed': result.replayed ? 'true' : 'false',
      }),
      rateLimitDecision,
    );
  } catch (error) {
    if (
      canonical &&
      (error instanceof StaleAgendaVersionError ||
        error instanceof AgendaCapacityFullError ||
        error instanceof AgendaReservationClosedError ||
        error instanceof AgendaReservationConflictError)
    ) {
      try {
        const snapshot = await loadParticipantAgendaSnapshot(
          dependencies.db,
          canonical.context,
          canonical.userId,
          getNow,
          dependencies.onOperationalDrift,
        );
        return withRateLimitHeaders(
          canonicalProblemResponse(error, snapshot, requestId),
          rateLimitDecision,
        );
      } catch (canonicalError) {
        return withRateLimitHeaders(
          privateProblemResponse(canonicalError, requestId),
          rateLimitDecision,
        );
      }
    }
    return withRateLimitHeaders(
      privateProblemResponse(error, requestId),
      rateLimitDecision,
    );
  }
};
