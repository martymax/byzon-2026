import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  hasEventPermission,
  type EventPermission,
  type EventRole,
} from '@byzon/domain';
import {
  adminContextResponseSchema,
  adminPermissionSchema,
  adminReservationListResponseSchema,
  adminReservationMutationRequestSchema,
  adminReservationMutationResponseSchema,
  adminSessionCapacityListResponseSchema,
  adminSessionCapacityMutationRequestSchema,
  adminSessionCapacityMutationResponseSchema,
  adminSessionCapacityRecordSchema,
  idempotencyKeySchema,
  problemTypeForCode,
  type AdminContextResponse,
  type AdminPermission,
  type AdminReservationListResponse,
  type AdminReservationMutationResponse,
  type AdminReservationRecord,
  type AdminSessionCapacityListResponse,
  type AdminSessionCapacityMutationResponse,
  type AdminSessionCapacityRecord,
} from '@byzon/domain/contracts';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { rateLimitHeaders, type RateLimitDecision } from './api/rate-limit';
import type { AdminReservationRateLimiter } from './admin-reservations-rate-limit';
import { CURRENT_EVENT_SLUG } from './current-event';
import { EventAccessDeniedError, requireEventPermission } from './policy';
import { promoteAutomaticWaitlist } from './reservation-waitlist';

const MAX_BODY_BYTES = 16_384;
const MAX_RESERVATIONS = 100;
const MAX_CAPACITY_SESSIONS = 100;
const MAX_ASSIGNED_SESSIONS = 30;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const uuidSchema = z.string().uuid();

interface AdminSessionIdentity {
  user: { id: string };
}

export interface AdminReservationDependencies {
  db: Database;
  allowedOrigin: string;
  getSession(headers: Headers): Promise<AdminSessionIdentity | null>;
  currentEventSlug?: string;
  now?: () => Date;
  generateId?: () => string;
  rateLimit?: AdminReservationRateLimiter;
}

class AdminStaleVersionError extends Error {
  constructor(readonly currentVersion: number) {
    super('Admin snapshot version changed');
    this.name = 'AdminStaleVersionError';
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
    'The requested administration scope is not available for this account.',
  );

const resourceNotFound = (): ApiProblemError =>
  apiProblem(
    404,
    'ADMIN_RESOURCE_NOT_FOUND',
    'Admin resource not found',
    'The requested administration resource does not exist.',
  );

const invalidTransition = (detail: string): ApiProblemError =>
  apiProblem(
    409,
    'ADMIN_INVALID_TRANSITION',
    'Reservation change is not allowed',
    detail,
  );

const validationFailed = (
  fieldErrors?: Record<string, string[]>,
): ApiProblemError =>
  apiProblem(
    422,
    'VALIDATION_FAILED',
    'Validation failed',
    'The administration request is invalid.',
    fieldErrors,
  );

const privateHeaders = (
  requestId: string,
  contentType: string,
  extra: Record<string, string> = {},
): Headers =>
  new Headers({
    ...extra,
    'cache-control': 'private, no-store',
    'content-type': contentType,
    vary: 'Authorization, Cookie',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  });

const privateProblemResponse = (
  error: unknown,
  requestId: string,
): Response => {
  if (error instanceof AdminStaleVersionError) {
    return new Response(
      JSON.stringify({
        type: problemTypeForCode('STALE_VERSION'),
        title: 'Administration snapshot changed',
        status: 409,
        code: 'STALE_VERSION',
        detail: 'Reload the canonical administration record before retrying.',
        requestId,
        currentVersion: error.currentVersion,
      }),
      {
        status: 409,
        headers: privateHeaders(requestId, 'application/problem+json'),
      },
    );
  }
  const response = problemResponse(error, requestId);
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('vary', 'Authorization, Cookie');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
};

const successResponse = (
  body:
    | AdminContextResponse
    | AdminReservationListResponse
    | AdminReservationMutationResponse
    | AdminSessionCapacityListResponse
    | AdminSessionCapacityMutationResponse,
  requestId: string,
  extra: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
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

const requireSession = async (
  request: Request,
  dependencies: AdminReservationDependencies,
): Promise<AdminSessionIdentity> => {
  const session = await dependencies.getSession(request.headers);
  const userId = uuidSchema.safeParse(session?.user.id);
  if (!session || !userId.success) throw authenticationRequired();
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

const zodFieldErrors = (error: z.ZodError): Record<string, string[]> => {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'body';
    fields[path] = [...(fields[path] ?? []), issue.message];
  }
  return fields;
};

const loadCurrentAdminEvent = async (
  db: Database | DatabaseTransaction,
  dependencies: AdminReservationDependencies,
  eventId?: string,
) => {
  const event = await db.query.events.findFirst({
    columns: {
      id: true,
      name: true,
      operationalDataAnonymizesAt: true,
      slug: true,
      status: true,
      timezone: true,
    },
    where: eventId
      ? and(
          eq(schema.events.id, eventId),
          eq(
            schema.events.slug,
            dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
          ),
        )
      : eq(
          schema.events.slug,
          dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
        ),
  });
  if (!event) throw resourceNotFound();
  return event;
};

const requireOperationalDataAvailable = (
  event: Awaited<ReturnType<typeof loadCurrentAdminEvent>>,
  now: Date,
): void => {
  if (
    event.operationalDataAnonymizesAt !== null &&
    event.operationalDataAnonymizesAt.getTime() <= now.getTime()
  ) {
    throw eventAccessDenied();
  }
};

const safeLabel = (
  value: string,
  fallback: string,
  maximum: number,
): string => {
  const normalized = value
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069<>]/g, '')
    .trim()
    .slice(0, maximum);
  return normalized.length > 0 ? normalized : fallback;
};

const participantReference = (userId: string): string =>
  `Účastník •${userId.replaceAll('-', '').slice(-4).toUpperCase()}`;

const permissionContext = (
  permission: AdminPermission,
): { auditedException?: boolean } =>
  permission === 'agenda:any:override' ||
  permission === 'personal-data:operational:export'
    ? { auditedException: true }
    : {};

const allowedAdminPermissions = (
  roles: readonly EventRole[],
): readonly AdminPermission[] =>
  adminPermissionSchema.options.filter((permission) =>
    hasEventPermission(
      roles,
      permission as EventPermission,
      permissionContext(permission),
    ),
  );

export const readAdminContext = async (
  request: Request,
  dependencies: AdminReservationDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    requireReadTransport(request);
    const session = await requireSession(request, dependencies);
    rateLimitDecision =
      (await dependencies.rateLimit?.('read', session.user.id)) ?? null;
    const event = await loadCurrentAdminEvent(dependencies.db, dependencies);
    const [membership, user, roleRows, features] = await Promise.all([
      dependencies.db.query.eventMemberships.findFirst({
        columns: { userId: true },
        where: and(
          eq(schema.eventMemberships.eventId, event.id),
          eq(schema.eventMemberships.userId, session.user.id),
          eq(schema.eventMemberships.status, 'active'),
        ),
      }),
      dependencies.db.query.users.findFirst({
        columns: { name: true },
        where: eq(schema.users.id, session.user.id),
      }),
      dependencies.db.query.eventRoles.findMany({
        columns: { role: true, scope: true },
        where: and(
          eq(schema.eventRoles.eventId, event.id),
          eq(schema.eventRoles.userId, session.user.id),
          isNull(schema.eventRoles.revokedAt),
        ),
      }),
      dependencies.db.query.eventFeatures.findFirst({
        columns: { announcementsEnabled: true },
        where: eq(schema.eventFeatures.eventId, event.id),
      }),
    ]);
    if (!membership || !user) throw eventAccessDenied();
    const roles = roleRows.map(({ role }) => role);
    if (!roles.includes('organizer_admin')) throw eventAccessDenied();
    const adminRoles = roles.filter(
      (
        role,
      ): role is
        | 'organizer_admin'
        | 'checkin_operator'
        | 'moderator'
        | 'room_operator' =>
        role === 'organizer_admin' ||
        role === 'checkin_operator' ||
        role === 'moderator' ||
        role === 'room_operator',
    );
    if (adminRoles.length === 0) throw eventAccessDenied();
    const permissions = allowedAdminPermissions(roles);
    const assignedSessionIds = [
      ...new Set(
        roleRows.flatMap(({ scope }) =>
          Array.isArray(scope.sessionIds)
            ? scope.sessionIds.filter(
                (sessionId): sessionId is string =>
                  uuidSchema.safeParse(sessionId).success,
              )
            : [],
        ),
      ),
    ].slice(0, MAX_ASSIGNED_SESSIONS);
    const assignedRows =
      assignedSessionIds.length === 0
        ? []
        : await dependencies.db
            .select({
              sessionId: schema.programSessions.id,
              title: schema.programSessions.title,
            })
            .from(schema.programSessions)
            .where(
              and(
                eq(schema.programSessions.eventId, event.id),
                inArray(schema.programSessions.id, assignedSessionIds),
              ),
            );
    const assignedById = new Map(
      assignedRows.map(({ sessionId, title }) => [sessionId, title]),
    );
    const body = adminContextResponseSchema.parse({
      event: {
        id: event.id,
        name: safeLabel(event.name, 'Byzon 2026', 160),
        timezone: event.timezone,
        phase: event.status,
      },
      features: {
        announcementsEnabled: features?.announcementsEnabled ?? false,
      },
      capabilities: {
        // Check-in remains outside the 2026 launch scope. The explicit false
        // prevents clients from inferring entry from an otherwise capable role.
        canEnterCheckin: false,
      },
      actor: {
        displayLabel: safeLabel(user.name, 'Přihlášený uživatel', 120),
        roles: [...new Set(adminRoles)],
        permissions,
        assignedSessions: assignedSessionIds.flatMap((sessionId) => {
          const title = assignedById.get(sessionId);
          return title
            ? [
                {
                  sessionId,
                  title: safeLabel(title, 'Přiřazená aktivita', 160),
                },
              ]
            : [];
        }),
      },
    });
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

const loadReservationRecords = async (
  db: Database | DatabaseTransaction,
  eventId: string,
): Promise<readonly AdminReservationRecord[]> => {
  const rows = await db
    .select({
      reservationId: schema.reservations.id,
      userId: schema.reservations.userId,
      sessionId: schema.reservations.sessionId,
      sessionTitle: schema.programSessions.title,
      state: schema.reservations.status,
      capacity: schema.programSessions.capacity,
      version: schema.reservations.version,
    })
    .from(schema.reservations)
    .innerJoin(
      schema.programSessions,
      and(
        eq(schema.programSessions.eventId, schema.reservations.eventId),
        eq(schema.programSessions.id, schema.reservations.sessionId),
      ),
    )
    .where(
      and(
        eq(schema.reservations.eventId, eventId),
        eq(schema.programSessions.capacityMode, 'reservation'),
      ),
    )
    .orderBy(
      desc(schema.reservations.cancelledAt),
      desc(schema.reservations.createdAt),
      desc(schema.reservations.id),
    )
    .limit(MAX_RESERVATIONS);
  const sessionIds = [...new Set(rows.map(({ sessionId }) => sessionId))];
  const counts =
    sessionIds.length === 0
      ? []
      : await db
          .select({
            sessionId: schema.reservations.sessionId,
            confirmed: count(),
          })
          .from(schema.reservations)
          .where(
            and(
              eq(schema.reservations.eventId, eventId),
              eq(schema.reservations.status, 'confirmed'),
              inArray(schema.reservations.sessionId, sessionIds),
            ),
          )
          .groupBy(schema.reservations.sessionId);
  const confirmedBySession = new Map(
    counts.map(({ sessionId, confirmed }) => [sessionId, confirmed]),
  );
  return rows.flatMap((row) => {
    if (row.capacity === null) return [];
    return [
      {
        reservationId: row.reservationId,
        eventId,
        sessionId: row.sessionId,
        sessionTitle: safeLabel(row.sessionTitle, 'Rezervovaná aktivita', 160),
        participantReference: participantReference(row.userId),
        state: row.state === 'confirmed' ? 'reserved' : 'cancelled',
        capacity: row.capacity,
        reservedCount: confirmedBySession.get(row.sessionId) ?? 0,
        version: row.version,
        availableActions:
          row.state === 'confirmed'
            ? (['capacity_override', 'cancel_reservation'] as const)
            : ([] as const),
      },
    ];
  });
};

const loadSessionCapacityRecords = async (
  db: Database | DatabaseTransaction,
  eventId: string,
): Promise<readonly AdminSessionCapacityRecord[]> => {
  const sessions = await db
    .select({
      sessionId: schema.programSessions.id,
      sessionTitle: schema.programSessions.title,
      sessionType: schema.programSessions.type,
      sessionStatus: schema.programSessions.status,
      capacity: schema.programSessions.capacity,
      confirmedCount: count(schema.reservations.id),
      version: schema.programSessions.version,
    })
    .from(schema.programSessions)
    .leftJoin(
      schema.reservations,
      and(
        eq(schema.reservations.eventId, schema.programSessions.eventId),
        eq(schema.reservations.sessionId, schema.programSessions.id),
        eq(schema.reservations.status, 'confirmed'),
      ),
    )
    .where(
      and(
        eq(schema.programSessions.eventId, eventId),
        or(
          eq(schema.programSessions.capacityMode, 'reservation'),
          eq(schema.programSessions.type, 'networking'),
        ),
      ),
    )
    .groupBy(
      schema.programSessions.id,
      schema.programSessions.title,
      schema.programSessions.type,
      schema.programSessions.status,
      schema.programSessions.capacity,
      schema.programSessions.version,
      schema.programSessions.startsAt,
    )
    .orderBy(
      asc(schema.programSessions.startsAt),
      asc(schema.programSessions.id),
    )
    .limit(MAX_CAPACITY_SESSIONS);
  return sessions.flatMap((session) =>
    session.capacity === null && session.sessionType !== 'networking'
      ? []
      : [
          {
            eventId,
            sessionId: session.sessionId,
            sessionTitle: safeLabel(
              session.sessionTitle,
              'Rezervovatelná aktivita',
              160,
            ),
            sessionType: session.sessionType,
            sessionStatus: session.sessionStatus,
            capacity: session.capacity,
            confirmedCount: session.confirmedCount,
            version: session.version,
          },
        ],
  );
};

const requirePermission = async (
  db: Database | DatabaseTransaction,
  userId: string,
  eventId: string,
  permission: 'agenda:any:override' | 'reservation:any:read',
): Promise<void> => {
  try {
    await requireEventPermission(
      db,
      { userId },
      eventId,
      permission,
      permission === 'agenda:any:override'
        ? { auditedException: true }
        : undefined,
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw eventAccessDenied();
  }
};

export const readAdminReservations = async (
  request: Request,
  eventId: string,
  dependencies: AdminReservationDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    requireReadTransport(request);
    if (!uuidSchema.safeParse(eventId).success) throw resourceNotFound();
    const session = await requireSession(request, dependencies);
    rateLimitDecision =
      (await dependencies.rateLimit?.('read', session.user.id)) ?? null;
    const now = dependencies.now?.() ?? new Date();
    const event = await loadCurrentAdminEvent(
      dependencies.db,
      dependencies,
      eventId,
    );
    requireOperationalDataAvailable(event, now);
    await requirePermission(
      dependencies.db,
      session.user.id,
      event.id,
      'reservation:any:read',
    );
    const body = adminReservationListResponseSchema.parse({
      eventId: event.id,
      generatedAt: now.toISOString(),
      items: await loadReservationRecords(dependencies.db, event.id),
    });
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

export const readAdminSessionCapacities = async (
  request: Request,
  eventId: string,
  dependencies: AdminReservationDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    requireReadTransport(request);
    if (!uuidSchema.safeParse(eventId).success) throw resourceNotFound();
    const session = await requireSession(request, dependencies);
    rateLimitDecision =
      (await dependencies.rateLimit?.('read', session.user.id)) ?? null;
    const now = dependencies.now?.() ?? new Date();
    const event = await loadCurrentAdminEvent(
      dependencies.db,
      dependencies,
      eventId,
    );
    requireOperationalDataAvailable(event, now);
    await requirePermission(
      dependencies.db,
      session.user.id,
      event.id,
      'reservation:any:read',
    );
    const body: AdminSessionCapacityListResponse =
      adminSessionCapacityListResponseSchema.parse({
        eventId: event.id,
        generatedAt: now.toISOString(),
        items: await loadSessionCapacityRecords(dependencies.db, event.id),
      });
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

const loadMutationReservation = async (
  transaction: DatabaseTransaction,
  eventId: string,
  reservationId: string,
) =>
  transaction
    .select({
      id: schema.reservations.id,
      userId: schema.reservations.userId,
      sessionId: schema.reservations.sessionId,
      status: schema.reservations.status,
      version: schema.reservations.version,
      capacity: schema.programSessions.capacity,
      sessionVersion: schema.programSessions.version,
      capacityMode: schema.programSessions.capacityMode,
      sessionStatus: schema.programSessions.status,
      sessionTitle: schema.programSessions.title,
      sessionType: schema.programSessions.type,
    })
    .from(schema.reservations)
    .innerJoin(
      schema.programSessions,
      and(
        eq(schema.programSessions.eventId, schema.reservations.eventId),
        eq(schema.programSessions.id, schema.reservations.sessionId),
      ),
    )
    .where(
      and(
        eq(schema.reservations.eventId, eventId),
        eq(schema.reservations.id, reservationId),
      ),
    )
    .limit(1)
    .then(([row]) => row);

export const mutateAdminSessionCapacity = async (
  request: Request,
  eventId: string,
  dependencies: AdminReservationDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  const getNow = dependencies.now ?? (() => new Date());
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    if (!uuidSchema.safeParse(eventId).success) throw resourceNotFound();
    const key = requireMutationTransport(request, dependencies.allowedOrigin);
    const session = await requireSession(request, dependencies);
    rateLimitDecision =
      (await dependencies.rateLimit?.('mutation', session.user.id)) ?? null;
    const event = await loadCurrentAdminEvent(
      dependencies.db,
      dependencies,
      eventId,
    );
    requireOperationalDataAvailable(event, getNow());
    await requirePermission(
      dependencies.db,
      session.user.id,
      event.id,
      'agenda:any:override',
    );
    const json = await readBoundedJson(request);
    const parsed = adminSessionCapacityMutationRequestSchema.safeParse(
      json.value,
    );
    if (!parsed.success) throw validationFailed(zodFieldErrors(parsed.error));
    const generateId = dependencies.generateId ?? generateUuidV7;
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId: event.id,
        actorId: session.user.id,
        scope: 'admin.session-capacity',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: json.raw,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: getNow(),
        generateId,
      },
      async (transaction) => {
        await acquireTransactionLock(
          transaction,
          `content-publish:${event.id}`,
        );
        await acquireTransactionLock(
          transaction,
          `participant-reservation:${event.id}:${parsed.data.sessionId}`,
        );
        const changedAt = getNow();
        const lockedEvent = await loadCurrentAdminEvent(
          transaction,
          dependencies,
          event.id,
        );
        requireOperationalDataAvailable(lockedEvent, changedAt);
        if (lockedEvent.status === 'archived') {
          throw invalidTransition('Archived events are read-only.');
        }
        await requirePermission(
          transaction,
          session.user.id,
          event.id,
          'agenda:any:override',
        );
        const current = await transaction.query.programSessions.findFirst({
          columns: {
            id: true,
            title: true,
            type: true,
            status: true,
            capacityMode: true,
            capacity: true,
            version: true,
          },
          where: and(
            eq(schema.programSessions.eventId, event.id),
            eq(schema.programSessions.id, parsed.data.sessionId),
          ),
        });
        if (!current) throw resourceNotFound();
        if (current.version !== parsed.data.expectedVersion) {
          throw new AdminStaleVersionError(current.version);
        }
        if (
          (current.capacityMode !== 'reservation' &&
            current.type !== 'networking') ||
          (current.capacity === null && current.type !== 'networking')
        ) {
          throw invalidTransition(
            'The session no longer has an editable reservation capacity.',
          );
        }
        if (current.status === 'cancelled' || current.status === 'archived') {
          throw invalidTransition(
            'Capacity cannot be changed for a cancelled or archived session.',
          );
        }
        const countRows = await transaction
          .select({ confirmed: count() })
          .from(schema.reservations)
          .where(
            and(
              eq(schema.reservations.eventId, event.id),
              eq(schema.reservations.sessionId, current.id),
              eq(schema.reservations.status, 'confirmed'),
            ),
          );
        const confirmedCount = countRows[0]?.confirmed ?? 0;
        if (parsed.data.capacity < confirmedCount) {
          throw invalidTransition(
            'Capacity cannot be lower than the current confirmed reservation count.',
          );
        }
        const updated = await transaction
          .update(schema.programSessions)
          .set({
            capacity: parsed.data.capacity,
            capacityMode: 'reservation',
            waitlistMode:
              current.type === 'networking' ? 'auto_confirm' : undefined,
            updatedAt: changedAt,
            version: sql`${schema.programSessions.version} + 1`,
          })
          .where(
            and(
              eq(schema.programSessions.eventId, event.id),
              eq(schema.programSessions.id, current.id),
              eq(schema.programSessions.version, current.version),
            ),
          )
          .returning({ version: schema.programSessions.version });
        if (updated.length !== 1) {
          const latest = await transaction.query.programSessions.findFirst({
            columns: { version: true },
            where: and(
              eq(schema.programSessions.eventId, event.id),
              eq(schema.programSessions.id, current.id),
            ),
          });
          throw latest
            ? new AdminStaleVersionError(latest.version)
            : resourceNotFound();
        }
        await transaction
          .update(schema.reservations)
          .set({ version: sql`${schema.reservations.version} + 1` })
          .where(
            and(
              eq(schema.reservations.eventId, event.id),
              eq(schema.reservations.sessionId, current.id),
            ),
          );
        const promotions =
          current.capacity === null || parsed.data.capacity > current.capacity
            ? await promoteAutomaticWaitlist({
                transaction,
                eventId: event.id,
                sessionId: current.id,
                now: changedAt,
                requestId: uuidSchema.safeParse(requestId).success
                  ? requestId
                  : generateUuidV7(),
                generateId,
              })
            : [];
        const nextVersion = updated[0]!.version;
        const auditId = await writeAuditLog(
          transaction,
          {
            eventId: event.id,
            actorId: session.user.id,
            actorType: 'user',
            action: 'session.capacity_updated',
            targetType: 'session',
            targetId: current.id,
            requestId: uuidSchema.safeParse(requestId).success
              ? requestId
              : generateUuidV7(),
            reason: parsed.data.reason,
            before: {
              capacity: current.capacity,
              confirmedCount,
              version: current.version,
            },
            after: {
              capacity: parsed.data.capacity,
              confirmedCount: confirmedCount + promotions.length,
              promotedCount: promotions.length,
              version: nextVersion,
            },
          },
          { generateId },
        );
        const record = adminSessionCapacityRecordSchema.parse({
          eventId: event.id,
          sessionId: current.id,
          sessionTitle: safeLabel(
            current.title,
            'Rezervovatelná aktivita',
            160,
          ),
          sessionType: current.type,
          sessionStatus: current.status,
          capacity: parsed.data.capacity,
          confirmedCount: confirmedCount + promotions.length,
          version: nextVersion,
        });
        const body = adminSessionCapacityMutationResponseSchema.parse({
          eventId: event.id,
          outcome: 'updated',
          record,
          changedAt: changedAt.toISOString(),
          audit: { auditId },
        });
        return {
          status: 200,
          body,
          resultReference: current.id,
        };
      },
    );
    const body = adminSessionCapacityMutationResponseSchema.parse({
      ...result.body,
      outcome: result.replayed ? 'already_applied' : result.body.outcome,
    });
    return withRateLimitHeaders(
      successResponse(body, requestId, {
        'idempotency-replayed': result.replayed ? 'true' : 'false',
      }),
      rateLimitDecision,
    );
  } catch (error) {
    return withRateLimitHeaders(
      privateProblemResponse(error, requestId),
      rateLimitDecision,
    );
  }
};

export const mutateAdminReservation = async (
  request: Request,
  eventId: string,
  dependencies: AdminReservationDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  const getNow = dependencies.now ?? (() => new Date());
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    if (!uuidSchema.safeParse(eventId).success) throw resourceNotFound();
    const key = requireMutationTransport(request, dependencies.allowedOrigin);
    const session = await requireSession(request, dependencies);
    rateLimitDecision =
      (await dependencies.rateLimit?.('mutation', session.user.id)) ?? null;
    const event = await loadCurrentAdminEvent(
      dependencies.db,
      dependencies,
      eventId,
    );
    requireOperationalDataAvailable(event, getNow());
    await requirePermission(
      dependencies.db,
      session.user.id,
      event.id,
      'agenda:any:override',
    );
    const json = await readBoundedJson(request);
    const parsed = adminReservationMutationRequestSchema.safeParse(json.value);
    if (!parsed.success) throw validationFailed(zodFieldErrors(parsed.error));
    const generateId = dependencies.generateId ?? generateUuidV7;
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId: event.id,
        actorId: session.user.id,
        scope: 'admin.reservation-action',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: json.raw,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: getNow(),
        generateId,
      },
      async (transaction) => {
        const candidate = await transaction.query.reservations.findFirst({
          columns: { sessionId: true, userId: true },
          where: and(
            eq(schema.reservations.eventId, event.id),
            eq(schema.reservations.id, parsed.data.reservationId),
          ),
        });
        if (!candidate) throw resourceNotFound();
        await acquireTransactionLock(
          transaction,
          `participant-agenda:${event.id}:${candidate.userId}`,
        );
        await acquireTransactionLock(
          transaction,
          `content-publish:${event.id}`,
        );
        await acquireTransactionLock(
          transaction,
          `participant-reservation:${event.id}:${candidate.sessionId}`,
        );
        const changedAt = getNow();
        const lockedEvent = await loadCurrentAdminEvent(
          transaction,
          dependencies,
          event.id,
        );
        requireOperationalDataAvailable(lockedEvent, changedAt);
        if (lockedEvent.status === 'archived') {
          throw invalidTransition('Archived events are read-only.');
        }
        await requirePermission(
          transaction,
          session.user.id,
          event.id,
          'agenda:any:override',
        );
        const current = await loadMutationReservation(
          transaction,
          event.id,
          parsed.data.reservationId,
        );
        if (!current) throw resourceNotFound();
        if (current.version !== parsed.data.expectedVersion) {
          throw new AdminStaleVersionError(current.version);
        }
        if (
          current.status !== 'confirmed' ||
          current.capacityMode !== 'reservation' ||
          current.capacity === null
        ) {
          throw invalidTransition(
            'The reservation no longer allows this administration action.',
          );
        }
        const countRows = await transaction
          .select({ confirmed: count() })
          .from(schema.reservations)
          .where(
            and(
              eq(schema.reservations.eventId, event.id),
              eq(schema.reservations.sessionId, current.sessionId),
              eq(schema.reservations.status, 'confirmed'),
            ),
          );
        const confirmedBefore = countRows[0]?.confirmed ?? 0;
        const legacyCapacityOverride =
          parsed.data.action === 'capacity_override';
        let nextCapacity = current.capacity;
        let confirmedAfter = confirmedBefore;
        let promotedCount = 0;
        let nextState: AdminReservationRecord['state'] = 'reserved';
        if (parsed.data.action === 'capacity_override') {
          if (
            current.sessionStatus === 'cancelled' ||
            current.sessionStatus === 'archived'
          ) {
            throw invalidTransition(
              'Capacity cannot be changed for a cancelled or archived session.',
            );
          }
          if (parsed.data.capacity < confirmedBefore) {
            throw invalidTransition(
              'Capacity cannot be lower than the current confirmed reservation count.',
            );
          }
          nextCapacity = parsed.data.capacity;
          await transaction
            .update(schema.programSessions)
            .set({
              capacity: nextCapacity,
              updatedAt: changedAt,
              version: sql`${schema.programSessions.version} + 1`,
            })
            .where(
              and(
                eq(schema.programSessions.eventId, event.id),
                eq(schema.programSessions.id, current.sessionId),
              ),
            );
          await transaction
            .update(schema.reservations)
            .set({ version: sql`${schema.reservations.version} + 1` })
            .where(
              and(
                eq(schema.reservations.eventId, event.id),
                eq(schema.reservations.sessionId, current.sessionId),
              ),
            );
          if (nextCapacity > current.capacity) {
            const promotions = await promoteAutomaticWaitlist({
              transaction,
              eventId: event.id,
              sessionId: current.sessionId,
              now: changedAt,
              requestId: uuidSchema.safeParse(requestId).success
                ? requestId
                : generateUuidV7(),
              generateId,
            });
            promotedCount = promotions.length;
            confirmedAfter += promotedCount;
          }
        } else {
          const cancelled = await transaction
            .update(schema.reservations)
            .set({
              cancelledAt: changedAt,
              status: 'cancelled',
              version: sql`${schema.reservations.version} + 1`,
            })
            .where(
              and(
                eq(schema.reservations.eventId, event.id),
                eq(schema.reservations.id, current.id),
                eq(schema.reservations.status, 'confirmed'),
                eq(schema.reservations.version, current.version),
              ),
            )
            .returning({ id: schema.reservations.id });
          if (cancelled.length !== 1) {
            const latest = await loadMutationReservation(
              transaction,
              event.id,
              current.id,
            );
            throw latest
              ? new AdminStaleVersionError(latest.version)
              : resourceNotFound();
          }
          confirmedAfter = Math.max(0, confirmedBefore - 1);
          nextState = 'cancelled';
          await transaction
            .update(schema.participantAgendas)
            .set({
              updatedAt: changedAt,
              version: sql`${schema.participantAgendas.version} + 1`,
            })
            .where(
              and(
                eq(schema.participantAgendas.eventId, event.id),
                eq(schema.participantAgendas.userId, current.userId),
              ),
            );
          const promotions = await promoteAutomaticWaitlist({
            transaction,
            eventId: event.id,
            sessionId: current.sessionId,
            now: changedAt,
            requestId: uuidSchema.safeParse(requestId).success
              ? requestId
              : generateUuidV7(),
            generateId,
          });
          promotedCount = promotions.length;
          confirmedAfter += promotedCount;
        }
        const auditId = await writeAuditLog(
          transaction,
          {
            eventId: event.id,
            actorId: session.user.id,
            actorType: 'user',
            action: legacyCapacityOverride
              ? 'session.capacity_updated'
              : 'reservation.admin_cancelled',
            targetType: legacyCapacityOverride ? 'session' : 'reservation',
            targetId: legacyCapacityOverride ? current.sessionId : current.id,
            requestId: uuidSchema.safeParse(requestId).success
              ? requestId
              : generateUuidV7(),
            reason: parsed.data.reason,
            before: legacyCapacityOverride
              ? {
                  capacity: current.capacity,
                  confirmedCount: confirmedBefore,
                  version: current.sessionVersion,
                }
              : {
                  capacity: current.capacity,
                  reservationStatus: current.status,
                  version: current.version,
                },
            after: legacyCapacityOverride
              ? {
                  capacity: nextCapacity,
                  confirmedCount: confirmedAfter,
                  promotedCount,
                  version: current.sessionVersion + 1,
                }
              : {
                  capacity: nextCapacity,
                  confirmed: confirmedAfter,
                  promotedCount,
                  reservationStatus: 'cancelled',
                  version: current.version + 1,
                },
          },
          { generateId },
        );
        const record: AdminReservationRecord = {
          reservationId: current.id,
          eventId: event.id,
          sessionId: current.sessionId,
          sessionTitle: safeLabel(
            current.sessionTitle,
            'Rezervovaná aktivita',
            160,
          ),
          participantReference: participantReference(current.userId),
          state: nextState,
          capacity: nextCapacity,
          reservedCount: confirmedAfter,
          version: current.version + 1,
          availableActions:
            nextState === 'reserved'
              ? ['capacity_override', 'cancel_reservation']
              : [],
        };
        const response = adminReservationMutationResponseSchema.parse({
          eventId: event.id,
          outcome: 'updated',
          record,
          changedAt: changedAt.toISOString(),
          audit: { auditId },
        });
        return {
          status: 200,
          body: response,
          resultReference: current.id,
        };
      },
    );
    const body = adminReservationMutationResponseSchema.parse({
      ...result.body,
      outcome: result.replayed ? 'already_applied' : result.body.outcome,
    });
    return withRateLimitHeaders(
      successResponse(body, requestId, {
        'idempotency-replayed': result.replayed ? 'true' : 'false',
      }),
      rateLimitDecision,
    );
  } catch (error) {
    return withRateLimitHeaders(
      privateProblemResponse(error, requestId),
      rateLimitDecision,
    );
  }
};
