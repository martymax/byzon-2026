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
  problemTypeForCode,
  publishedProgramSnapshotSchema,
  type AgendaSessionSnapshot,
  type ParticipantAgendaItem,
  type ParticipantAgendaMutationResponse,
  type ParticipantAgendaResponse,
  type PublishedProgram,
} from '@byzon/domain/contracts';
import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { rateLimitHeaders, type RateLimitDecision } from './api/rate-limit';
import { CURRENT_EVENT_SLUG } from './current-event';
import type { ParticipantAgendaRateLimiter } from './participant-agenda-rate-limit';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const MAX_AGENDA_ITEMS = 512;
const MAX_BODY_BYTES = 16_384;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const CALENDAR_UID_DOMAIN = 'agenda.byzon.cz';
const uuidSchema = z.string().uuid();
const agendaMutationReceiptSchema = z.strictObject({
  action: z.enum(['add', 'remove', 'reserve']),
  sessionId: uuidSchema,
  outcome: z.enum(['applied', 'already_applied']),
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export interface ParticipantAgendaOperationalDrift {
  code: 'confirmed_reservation_without_capacity';
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

type AgendaDatabase = Database | DatabaseTransaction;
type AgendaEvent = Pick<
  typeof schema.events.$inferSelect,
  'id' | 'operationalDataAnonymizesAt' | 'status' | 'timezone'
>;

interface AgendaContext {
  event: AgendaEvent;
  program: PublishedProgram;
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

class AgendaTicketInactiveError extends Error {
  constructor(readonly sessionId: string) {
    super('An active ticket is required to reserve a place');
    this.name = 'AgendaTicketInactiveError';
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

const loadAgendaContext = async (
  dependencies: ParticipantAgendaDependencies,
  userId: string,
  now: Date,
  mutation: boolean,
): Promise<AgendaContext> => {
  const event = await dependencies.db.query.events.findFirst({
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
  try {
    await requireEventPermission(
      dependencies.db,
      { userId },
      event.id,
      'agenda:own:write',
      { ownsResource: true },
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw eventAccessDenied();
  }
  const publication = await dependencies.db.query.contentPublications.findFirst(
    {
      columns: { snapshot: true, version: true },
      where: eq(schema.contentPublications.eventId, event.id),
      orderBy: [desc(schema.contentPublications.version)],
    },
  );
  const parsed = publishedProgramSnapshotSchema.safeParse(
    publication?.snapshot,
  );
  if (!publication || !parsed.success) throw agendaDisabled();
  return {
    event,
    program: parsed.data.program,
    publicationVersion: publication.version,
  };
};

const sessionSnapshot = (
  context: AgendaContext,
  session: PublishedProgram['sessions'][number],
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
  },
  confirmed: number,
  now: Date,
): Pick<ParticipantAgendaItem, 'action' | 'capacity'> => {
  if (
    session.capacityMode !== 'reservation' ||
    session.capacity === null ||
    session.type === 'networking'
  ) {
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
    session.reservationOpensAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const closesAt =
    session.reservationClosesAt?.getTime() ?? session.startsAt.getTime();
  const closed = now.getTime() < opensAt || now.getTime() >= closesAt;
  return {
    capacity: {
      mode: 'reservation',
      capacity: session.capacity,
      confirmed,
      held: 0,
      remaining,
      waitlistAvailable: false,
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

export const loadParticipantAgendaSnapshot = async (
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
  const savedRows = await db
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
      ),
    )
    .limit(MAX_AGENDA_ITEMS + 1);
  const reservationRows = await db
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
      ),
    )
    .limit(MAX_AGENDA_ITEMS + 1);
  const waitingRows = await db
    .select({
      id: schema.waitlistEntries.id,
      sessionId: schema.waitlistEntries.sessionId,
      joinedAt: schema.waitlistEntries.createdAt,
      position: schema.waitlistEntries.positionSequence,
    })
    .from(schema.waitlistEntries)
    .where(
      and(
        eq(schema.waitlistEntries.eventId, context.event.id),
        eq(schema.waitlistEntries.userId, userId),
        eq(schema.waitlistEntries.status, 'waiting'),
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
  const publishedById = new Map(
    context.program.sessions.map((session) => [session.id, session]),
  );
  const visibleSessionIds = requestedSessionIds.filter((sessionId) =>
    publishedById.has(sessionId),
  );
  const operationalRows =
    visibleSessionIds.length === 0
      ? []
      : await db
          .select({
            id: schema.programSessions.id,
            capacity: schema.programSessions.capacity,
            capacityMode: schema.programSessions.capacityMode,
            reservationClosesAt: schema.programSessions.reservationClosesAt,
            reservationOpensAt: schema.programSessions.reservationOpensAt,
            startsAt: schema.programSessions.startsAt,
            status: schema.programSessions.status,
            type: schema.programSessions.type,
          })
          .from(schema.programSessions)
          .where(
            and(
              eq(schema.programSessions.eventId, context.event.id),
              inArray(schema.programSessions.id, visibleSessionIds),
              ne(schema.programSessions.status, 'archived'),
            ),
          );
  const operationalById = new Map(operationalRows.map((row) => [row.id, row]));
  const capacityRows =
    visibleSessionIds.length === 0
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
              inArray(schema.reservations.sessionId, visibleSessionIds),
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
    const confirmed = confirmedBySession.get(sessionId) ?? 0;
    const state = capacityProjection(operational, confirmed, now);
    const common = {
      day: { localDate: day.localDate, title: day.title },
      session: sessionSnapshot(
        context,
        published,
        operational.status === 'cancelled' ? 'cancelled' : 'published',
      ),
      ...state,
    };
    const reservation = reservationBySession.get(sessionId);
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
          action: { state: 'closed' },
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
          cancellation: {
            state: 'unavailable',
            reason:
              state.action.state === 'closed' ? 'closed' : 'policy_pending',
          },
        },
      });
      continue;
    }
    const waiting = waitingBySession.get(sessionId);
    if (
      waiting &&
      state.capacity.mode === 'reservation' &&
      state.capacity.remaining === 0 &&
      state.action.state === 'capacity_full'
    ) {
      items.push({
        ...common,
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
        : { state: 'unavailable', reason: 'not_ready' },
  });
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
): PublishedProgram['sessions'][number] => {
  const session = context.program.sessions.find(({ id }) => id === sessionId);
  if (!session || session.status === 'cancelled') throw sessionNotFound();
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

const canonicalProblemResponse = (
  error:
    | StaleAgendaVersionError
    | AgendaCapacityFullError
    | AgendaReservationClosedError
    | AgendaTicketInactiveError,
  snapshot: ParticipantAgendaResponse,
  requestId: string,
): Response => {
  const candidate =
    error instanceof StaleAgendaVersionError
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
      : error instanceof AgendaTicketInactiveError
        ? {
            type: problemTypeForCode('TICKET_INACTIVE'),
            title: 'Active ticket required',
            status: 409,
            code: 'TICKET_INACTIVE',
            detail: 'An active ticket is required to reserve this session.',
            requestId,
            sessionId: error.sessionId,
            agenda: snapshot,
          }
        : error instanceof AgendaCapacityFullError
          ? {
              type: problemTypeForCode('CAPACITY_FULL'),
              title: 'Session capacity is full',
              status: 409,
              code: 'CAPACITY_FULL',
              detail:
                'The final available place was reserved by another request.',
              requestId,
              sessionId: error.sessionId,
              agenda: snapshot,
            }
          : {
              type: problemTypeForCode('RESERVATION_CLOSED'),
              title: 'Reservations are closed',
              status: 409,
              code: 'RESERVATION_CLOSED',
              detail: 'Reservations are not open for this session.',
              requestId,
              sessionId: error.sessionId,
              agenda: snapshot,
            };
  const problem = participantAgendaMutationProblemSchema.parse(candidate);
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: privateHeaders(requestId, 'application/problem+json'),
  });
};

export const readParticipantAgenda = async (
  request: Request,
  dependencies: ParticipantAgendaDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    requireReadTransport(request);
    const session = await requireSession(request, dependencies);
    rateLimitDecision =
      (await dependencies.rateLimit?.('read', session.user.id)) ?? null;
    const now = dependencies.now?.() ?? new Date();
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
      now,
      dependencies.onOperationalDrift,
    );
    return withRateLimitHeaders(
      successResponse(body, requestId),
      rateLimitDecision,
    );
  } catch (error) {
    return withRateLimitHeaders(
      privateProblemResponse(error, requestId),
      rateLimitDecision,
    );
  }
};

export const mutateParticipantAgenda = async (
  request: Request,
  dependencies: ParticipantAgendaDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  let rateLimitDecision: RateLimitDecision | null = null;
  let canonical:
    { context: AgendaContext; now: Date; userId: string } | undefined;
  try {
    const key = requireMutationTransport(request, dependencies.allowedOrigin);
    const session = await requireSession(request, dependencies);
    rateLimitDecision =
      (await dependencies.rateLimit?.('mutation', session.user.id)) ?? null;
    const now = dependencies.now?.() ?? new Date();
    const context = await loadAgendaContext(
      dependencies,
      session.user.id,
      now,
      true,
    );
    canonical = { context, now, userId: session.user.id };
    const json = await readBoundedJson(request);
    const parsed = participantAgendaMutationRequestSchema.safeParse(json.value);
    if (!parsed.success) throw validationFailed(zodFieldErrors(parsed.error));
    if (!['add', 'remove', 'reserve'].includes(parsed.data.action)) {
      throw validationFailed({
        action: ['This agenda action is not enabled in the current rollout.'],
      });
    }
    targetPublishedSession(context, parsed.data.sessionId);
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
          `participant-agenda:${context.event.id}:${session.user.id}`,
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
              capacity: true,
              capacityMode: true,
              reservationClosesAt: true,
              reservationOpensAt: true,
              startsAt: true,
              status: true,
              type: true,
            },
            where: and(
              eq(schema.programSessions.eventId, context.event.id),
              eq(schema.programSessions.id, parsed.data.sessionId),
            ),
          });
        if (
          !operationalTarget ||
          operationalTarget.status === 'archived' ||
          (parsed.data.action !== 'remove' &&
            operationalTarget.status === 'cancelled')
        ) {
          throw sessionNotFound();
        }

        let outcome: 'applied' | 'already_applied' = 'already_applied';
        if (parsed.data.action === 'add') {
          const inserted = await transaction
            .insert(schema.agendaItems)
            .values({
              eventId: context.event.id,
              userId: session.user.id,
              sessionId: parsed.data.sessionId,
              source: 'manual',
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .returning({ sessionId: schema.agendaItems.sessionId });
          if (inserted.length === 1) {
            const savedCount = await transaction
              .select({ value: count() })
              .from(schema.agendaItems)
              .where(
                and(
                  eq(schema.agendaItems.eventId, context.event.id),
                  eq(schema.agendaItems.userId, session.user.id),
                ),
              );
            if ((savedCount[0]?.value ?? 0) > MAX_AGENDA_ITEMS) {
              throw validationFailed({
                sessionId: [
                  'The agenda has reached the maximum number of items.',
                ],
              });
            }
            outcome = 'applied';
          }
        } else if (parsed.data.action === 'remove') {
          const reservation = await transaction.query.reservations.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.reservations.eventId, context.event.id),
              eq(schema.reservations.userId, session.user.id),
              eq(schema.reservations.sessionId, parsed.data.sessionId),
              eq(schema.reservations.status, 'confirmed'),
            ),
          });
          const waiting = await transaction.query.waitlistEntries.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.waitlistEntries.eventId, context.event.id),
              eq(schema.waitlistEntries.userId, session.user.id),
              eq(schema.waitlistEntries.sessionId, parsed.data.sessionId),
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
        } else {
          await acquireTransactionLock(
            transaction,
            `participant-reservation:${context.event.id}:${parsed.data.sessionId}`,
          );
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
          const activeTicket = await transaction.query.tickets.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.tickets.eventId, context.event.id),
              eq(schema.tickets.holderUserId, session.user.id),
              eq(schema.tickets.status, 'activated'),
            ),
          });
          if (!activeTicket) {
            throw new AgendaTicketInactiveError(parsed.data.sessionId);
          }
          if (
            operationalTarget.capacityMode !== 'reservation' ||
            operationalTarget.capacity === null ||
            operationalTarget.type === 'networking'
          ) {
            throw sessionNotFound();
          }
          const opensAt =
            operationalTarget.reservationOpensAt?.getTime() ??
            Number.NEGATIVE_INFINITY;
          const closesAt =
            operationalTarget.reservationClosesAt?.getTime() ??
            operationalTarget.startsAt.getTime();
          if (now.getTime() < opensAt || now.getTime() >= closesAt) {
            throw new AgendaReservationClosedError(parsed.data.sessionId);
          }
          const existing = await transaction.query.reservations.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.reservations.eventId, context.event.id),
              eq(schema.reservations.userId, session.user.id),
              eq(schema.reservations.sessionId, parsed.data.sessionId),
              eq(schema.reservations.status, 'confirmed'),
            ),
          });
          if (!existing) {
            const waiting = await transaction.query.waitlistEntries.findFirst({
              columns: { id: true },
              where: and(
                eq(schema.waitlistEntries.eventId, context.event.id),
                eq(schema.waitlistEntries.userId, session.user.id),
                eq(schema.waitlistEntries.sessionId, parsed.data.sessionId),
                eq(schema.waitlistEntries.status, 'waiting'),
              ),
            });
            if (waiting) {
              throw validationFailed({
                action: [
                  'A waiting participant cannot bypass the canonical waitlist.',
                ],
              });
            }
            const capacityRows = await transaction
              .select({ confirmed: count() })
              .from(schema.reservations)
              .where(
                and(
                  eq(schema.reservations.eventId, context.event.id),
                  eq(schema.reservations.sessionId, parsed.data.sessionId),
                  eq(schema.reservations.status, 'confirmed'),
                ),
              );
            if (
              (capacityRows[0]?.confirmed ?? 0) >= operationalTarget.capacity
            ) {
              throw new AgendaCapacityFullError(parsed.data.sessionId);
            }
            await transaction.insert(schema.reservations).values({
              id: generateId(),
              eventId: context.event.id,
              userId: session.user.id,
              sessionId: parsed.data.sessionId,
              source: 'participant',
              status: 'confirmed',
              version: 1,
              createdAt: now,
            });
            outcome = 'applied';
          }
        }
        if (outcome === 'applied') {
          await bumpAgendaVersion(
            transaction,
            context.event.id,
            session.user.id,
            now,
          );
          await writeAuditLog(transaction, {
            eventId: context.event.id,
            actorId: session.user.id,
            actorType: 'user',
            action:
              parsed.data.action === 'reserve'
                ? 'reservation.created'
                : `agenda.${parsed.data.action}`,
            targetType: 'program_session',
            targetId: parsed.data.sessionId,
            requestId: uuidSchema.safeParse(requestId).success
              ? requestId
              : generateUuidV7(),
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
      now,
      dependencies.onOperationalDrift,
    );
    const body = participantAgendaMutationResponseSchema.parse({
      ...snapshot,
      mutation: {
        action: receipt.action,
        sessionId: receipt.sessionId,
        outcome: receipt.outcome,
      },
      timeConflict:
        receipt.action === 'add' || receipt.action === 'reserve'
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
        error instanceof AgendaTicketInactiveError)
    ) {
      try {
        const snapshot = await loadParticipantAgendaSnapshot(
          dependencies.db,
          canonical.context,
          canonical.userId,
          canonical.now,
          dependencies.onOperationalDrift,
        );
        return withRateLimitHeaders(
          canonicalProblemResponse(error, snapshot, requestId),
          rateLimitDecision,
        );
      } catch {
        return withRateLimitHeaders(
          privateProblemResponse(
            new Error('Canonical agenda failed'),
            requestId,
          ),
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
