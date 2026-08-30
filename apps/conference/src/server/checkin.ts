import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  checkinBootstrapResponseSchema,
  checkinConfirmRequestSchema,
  checkinConfirmResponseSchema,
  checkinLookupRequestSchema,
  checkinLookupResponseSchema,
  checkinSearchRequestSchema,
  checkinSearchResponseSchema,
  checkinStatsResponseSchema,
  checkinUndoRequestSchema,
  checkinUndoResponseSchema,
  type CheckinLookupResponse,
  type CheckinRecord,
} from '@byzon/domain/contracts/check-in';
import { and, count, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { rateLimitHeaders, type RateLimitDecision } from './api/rate-limit';
import type {
  CheckinRateLimitKind,
  CheckinRateLimiter,
} from './checkin-rate-limit';
import { CURRENT_EVENT_SLUG } from './current-event';
import { loadEventPolicy } from './policy';

const LOOKUP_TTL_MS = 60_000;
const UNDO_WINDOW_SECONDS = 300;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
const uuidSchema = z.string().uuid();

interface CheckinIdentity {
  user: { id: string };
}

export interface CheckinDependencies {
  db: Database;
  deviceId?: string;
  getSession(headers: Headers): Promise<CheckinIdentity | null>;
  rateLimit?: CheckinRateLimiter;
  currentEventSlug?: string;
  now?: () => Date;
  /** Credential integration remains disabled until the ticket-code security gate. */
  resolveCredential?: (
    opaqueValue: string,
    eventId: string,
  ) => Promise<string | null>;
}

export type CheckinAction =
  | 'context'
  | 'lookup'
  | 'search'
  | 'confirm'
  | 'stats'
  | { undoCheckinId: string };

interface AuthorizedContext {
  event: {
    id: string;
    name: string;
    timezone: string;
  };
  actor: {
    id: string;
    displayLabel: string;
    role: 'checkin_operator' | 'organizer_admin';
  };
  device: { id: string; label: string; state: 'trusted' | 'revoked' };
  station: { id: string; name: string };
}

const apiProblem = (
  status: number,
  code: string,
  title: string,
  detail: string,
  headers?: Record<string, string>,
): ApiProblemError =>
  new ApiProblemError({
    status,
    code,
    title,
    detail,
    ...(headers ? { headers } : {}),
  });

const privateHeaders = (requestId: string) => ({
  'cache-control': 'private, no-store',
  'content-type': 'application/json',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const success = (
  body: Record<string, unknown>,
  requestId: string,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...privateHeaders(requestId), ...extraHeaders },
  });

const parseJson = async (request: Request): Promise<unknown> => {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Invalid request',
      'The request body is too large.',
    );
  }
  try {
    return await request.json();
  } catch {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Invalid request',
      'The request body must contain valid JSON.',
    );
  }
};

const maskEmail = (email: string): string => {
  const separator = email.lastIndexOf('@');
  if (separator < 1) return 'x***@invalid.example';
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return `${local.slice(0, 1)}***@${domain}`;
};

const referenceSuffix = (value: string): string => {
  const safe = value.replace(/[^A-Za-z0-9]/g, '').slice(-4);
  return safe.length >= 2 ? safe : `XX${safe}`.slice(-2);
};

const ticketState = (
  status: (typeof schema.tickets.$inferSelect)['status'],
): 'valid' | 'cancelled' | 'refunded' | 'blocked' => {
  if (status === 'cancelled' || status === 'refunded' || status === 'blocked') {
    return status;
  }
  return status === 'activated' ? 'valid' : 'blocked';
};

const enforceDecision = (decision: RateLimitDecision): void => {
  if (decision.allowed) return;
  throw apiProblem(
    429,
    'CHECKIN_RATE_LIMITED',
    'Too many requests',
    'Too many check-in requests were received. Try again later.',
    rateLimitHeaders(decision),
  );
};

const authorize = async (
  request: Request,
  dependencies: CheckinDependencies,
  kind: CheckinRateLimitKind,
): Promise<{
  context: AuthorizedContext;
  rateHeaders: Record<string, string>;
}> => {
  const identity = await dependencies.getSession(request.headers);
  const userId = uuidSchema.safeParse(identity?.user.id);
  if (!identity || !userId.success) {
    throw apiProblem(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
      'A valid operator session is required.',
    );
  }
  const now = dependencies.now?.() ?? new Date();
  const event = await dependencies.db.query.events.findFirst({
    columns: {
      id: true,
      name: true,
      timezone: true,
      operationalDataAnonymizesAt: true,
    },
    where: and(
      eq(
        schema.events.slug,
        dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
      ),
      inArray(schema.events.status, ['activation_open', 'live']),
    ),
  });
  if (
    !event ||
    (event.operationalDataAnonymizesAt !== null &&
      event.operationalDataAnonymizesAt <= now)
  ) {
    throw apiProblem(
      404,
      'CHECKIN_NOT_FOUND',
      'Check-in not found',
      'The check-in event is not available.',
    );
  }

  const policy = await loadEventPolicy(
    dependencies.db,
    { userId: userId.data },
    event.id,
  );
  if (!policy?.allows('checkin:perform')) {
    throw apiProblem(
      403,
      'CHECKIN_PERMISSION_DENIED',
      'Check-in permission denied',
      'The account cannot operate check-in for this event.',
    );
  }
  const role = policy.roles.includes('organizer_admin')
    ? 'organizer_admin'
    : policy.roles.includes('checkin_operator')
      ? 'checkin_operator'
      : null;
  if (!role) {
    throw apiProblem(
      403,
      'CHECKIN_PERMISSION_DENIED',
      'Check-in permission denied',
      'The account cannot operate check-in for this event.',
    );
  }

  const parsedDeviceId = uuidSchema.safeParse(dependencies.deviceId);
  if (!parsedDeviceId.success) {
    throw apiProblem(
      404,
      'CHECKIN_NOT_FOUND',
      'Check-in device not configured',
      'This runtime has no provisioned check-in device.',
    );
  }
  const [deviceRow, actorRow] = await Promise.all([
    dependencies.db
      .select({
        id: schema.operatorDevices.id,
        label: schema.operatorDevices.label,
        state: schema.operatorDevices.state,
        stationId: schema.checkinStations.id,
        stationName: schema.checkinStations.name,
      })
      .from(schema.operatorDevices)
      .innerJoin(
        schema.checkinStations,
        and(
          eq(schema.checkinStations.eventId, schema.operatorDevices.eventId),
          eq(schema.checkinStations.id, schema.operatorDevices.stationId),
        ),
      )
      .where(
        and(
          eq(schema.operatorDevices.eventId, event.id),
          eq(schema.operatorDevices.id, parsedDeviceId.data),
        ),
      )
      .limit(1),
    dependencies.db.query.users.findFirst({
      columns: { name: true },
      where: eq(schema.users.id, userId.data),
    }),
  ]);
  const device = deviceRow[0];
  if (!device) {
    throw apiProblem(
      404,
      'CHECKIN_NOT_FOUND',
      'Check-in device not found',
      'The provisioned device is not assigned to this event.',
    );
  }
  if (device.state === 'revoked') {
    throw apiProblem(
      403,
      'CHECKIN_DEVICE_REVOKED',
      'Check-in device revoked',
      'The provisioned check-in device was revoked.',
    );
  }

  let rateHeaders: Record<string, string> = {};
  if (dependencies.rateLimit) {
    const decision = await dependencies.rateLimit(kind, userId.data, device.id);
    enforceDecision(decision);
    rateHeaders = rateLimitHeaders(decision);
  }
  await dependencies.db
    .update(schema.operatorDevices)
    .set({ lastSeenAt: now })
    .where(eq(schema.operatorDevices.id, device.id));

  return {
    context: {
      event: { id: event.id, name: event.name, timezone: event.timezone },
      actor: {
        id: userId.data,
        displayLabel: actorRow?.name || 'Check-in obsluha',
        role,
      },
      device: { id: device.id, label: device.label, state: device.state },
      station: { id: device.stationId, name: device.stationName },
    },
    rateHeaders,
  };
};

const personProjection = async (
  db: Database | DatabaseTransaction,
  eventId: string,
  ticketId: string,
) => {
  const rows = await db
    .select({
      ticketId: schema.tickets.id,
      status: schema.tickets.status,
      suffix: schema.tickets.codeSuffix,
      userId: schema.tickets.holderUserId,
      firstName: schema.participantProfiles.firstName,
      lastName: schema.participantProfiles.lastName,
      email: schema.participantProfiles.contactEmail,
    })
    .from(schema.tickets)
    .innerJoin(
      schema.participantProfiles,
      and(
        eq(schema.participantProfiles.eventId, schema.tickets.eventId),
        eq(schema.participantProfiles.userId, schema.tickets.holderUserId),
      ),
    )
    .where(
      and(eq(schema.tickets.eventId, eventId), eq(schema.tickets.id, ticketId)),
    )
    .limit(1);
  return rows[0] ?? null;
};

const recordProjection = (
  input: {
    id: string;
    occurredAt: Date;
    undoneAt: Date | null;
    stationId: string;
    stationName: string;
  },
  context: AuthorizedContext,
  now: Date,
): CheckinRecord => {
  const expiresAt = new Date(
    input.occurredAt.getTime() + UNDO_WINDOW_SECONDS * 1_000,
  );
  const allowed =
    input.undoneAt === null &&
    expiresAt.getTime() > now.getTime() &&
    (context.actor.role === 'organizer_admin' ||
      context.actor.role === 'checkin_operator');
  return {
    id: input.id,
    occurredAt: input.occurredAt.toISOString(),
    station: { id: input.stationId, name: input.stationName },
    undo: allowed
      ? {
          allowed: true,
          expiresAt: expiresAt.toISOString(),
          unavailableReason: null,
        }
      : {
          allowed: false,
          expiresAt: null,
          unavailableReason:
            input.undoneAt !== null
              ? 'already_undone'
              : expiresAt <= now
                ? 'window_expired'
                : 'role_forbidden',
        },
  };
};

const previousActiveCheckin = async (
  db: Database | DatabaseTransaction,
  eventId: string,
  ticketId: string,
) => {
  const rows = await db
    .select({
      id: schema.checkIns.id,
      occurredAt: schema.checkIns.occurredAt,
      undoneAt: schema.checkIns.undoneAt,
      stationId: schema.checkinStations.id,
      stationName: schema.checkinStations.name,
    })
    .from(schema.checkIns)
    .innerJoin(
      schema.checkinStations,
      and(
        eq(schema.checkinStations.eventId, schema.checkIns.eventId),
        eq(schema.checkinStations.id, schema.checkIns.stationId),
      ),
    )
    .where(
      and(
        eq(schema.checkIns.eventId, eventId),
        eq(schema.checkIns.ticketId, ticketId),
        isNull(schema.checkIns.undoneAt),
      ),
    )
    .orderBy(desc(schema.checkIns.occurredAt))
    .limit(1);
  return rows[0] ?? null;
};

const lookupResponse = async (
  request: Request,
  context: AuthorizedContext,
  dependencies: CheckinDependencies,
): Promise<CheckinLookupResponse> => {
  const parsed = checkinLookupRequestSchema.safeParse(await parseJson(request));
  if (!parsed.success) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Invalid lookup',
      'The lookup request is invalid.',
    );
  }
  const now = dependencies.now?.() ?? new Date();
  const lookupId = generateUuidV7();
  const expiresAt = new Date(now.getTime() + LOOKUP_TTL_MS);
  let ticketId: string | null = null;
  if (parsed.data.method === 'manual_search') {
    const ticket = await dependencies.db.query.tickets.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.tickets.eventId, context.event.id),
        eq(schema.tickets.holderUserId, parsed.data.personId),
        inArray(schema.tickets.status, [
          'activated',
          'cancelled',
          'refunded',
          'blocked',
        ]),
      ),
      orderBy: [desc(schema.tickets.updatedAt)],
    });
    ticketId = ticket?.id ?? null;
  } else if (dependencies.resolveCredential) {
    ticketId = await dependencies.resolveCredential(
      parsed.data.credential.opaqueValue,
      context.event.id,
    );
  }
  if (!ticketId) {
    return checkinLookupResponseSchema.parse({
      lookupId,
      expiresAt: expiresAt.toISOString(),
      outcome: 'unknown',
      person: null,
      ticket: null,
      previousCheckin: null,
      confirmation: { state: 'unavailable' },
    });
  }
  const projection = await personProjection(
    dependencies.db,
    context.event.id,
    ticketId,
  );
  if (!projection || !projection.userId) {
    return checkinLookupResponseSchema.parse({
      lookupId,
      expiresAt: expiresAt.toISOString(),
      outcome: 'unknown',
      person: null,
      ticket: null,
      previousCheckin: null,
      confirmation: { state: 'unavailable' },
    });
  }
  const previous = await previousActiveCheckin(
    dependencies.db,
    context.event.id,
    ticketId,
  );
  const state = ticketState(projection.status);
  const outcome = state !== 'valid' ? state : previous ? 'duplicate' : 'valid';
  await dependencies.db.insert(schema.checkinLookups).values({
    id: lookupId,
    eventId: context.event.id,
    ticketId,
    operatorUserId: context.actor.id,
    deviceId: context.device.id,
    outcome,
    expiresAt,
    createdAt: now,
  });
  const person = {
    id: projection.userId,
    displayName: `${projection.firstName} ${projection.lastName}`,
    maskedEmail: maskEmail(projection.email),
  };
  const ticket = { referenceSuffix: referenceSuffix(projection.suffix), state };
  if (outcome === 'valid') {
    return checkinLookupResponseSchema.parse({
      lookupId,
      expiresAt: expiresAt.toISOString(),
      outcome,
      person,
      ticket,
      previousCheckin: null,
      confirmation: { state: 'required' },
    });
  }
  if (outcome === 'duplicate' && previous) {
    return checkinLookupResponseSchema.parse({
      lookupId,
      expiresAt: expiresAt.toISOString(),
      outcome,
      person,
      ticket,
      previousCheckin: recordProjection(previous, context, now),
      confirmation: { state: 'unavailable' },
    });
  }
  return checkinLookupResponseSchema.parse({
    lookupId,
    expiresAt: expiresAt.toISOString(),
    outcome,
    person,
    ticket,
    previousCheckin: null,
    confirmation: { state: 'unavailable' },
  });
};

const handleSearch = async (
  request: Request,
  context: AuthorizedContext,
  dependencies: CheckinDependencies,
) => {
  const parsed = checkinSearchRequestSchema.safeParse(await parseJson(request));
  if (!parsed.success) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Invalid search',
      'The search request is invalid.',
    );
  }
  const escaped = parsed.data.query.replace(/[\\%_]/g, (value) => `\\${value}`);
  const pattern = `%${escaped}%`;
  const rows = await dependencies.db
    .select({
      userId: schema.participantProfiles.userId,
      firstName: schema.participantProfiles.firstName,
      lastName: schema.participantProfiles.lastName,
      email: schema.participantProfiles.contactEmail,
      suffix: schema.tickets.codeSuffix,
      status: schema.tickets.status,
    })
    .from(schema.participantProfiles)
    .innerJoin(
      schema.tickets,
      and(
        eq(schema.tickets.eventId, schema.participantProfiles.eventId),
        eq(schema.tickets.holderUserId, schema.participantProfiles.userId),
      ),
    )
    .where(
      and(
        eq(schema.participantProfiles.eventId, context.event.id),
        inArray(schema.tickets.status, [
          'activated',
          'cancelled',
          'refunded',
          'blocked',
        ]),
        or(
          ilike(schema.participantProfiles.firstName, pattern),
          ilike(schema.participantProfiles.lastName, pattern),
          ilike(schema.participantProfiles.contactEmail, pattern),
        ),
      ),
    )
    .limit(5);
  return checkinSearchResponseSchema.parse({
    results: rows.map((row) => ({
      person: {
        id: row.userId,
        displayName: `${row.firstName} ${row.lastName}`,
        maskedEmail: maskEmail(row.email),
      },
      ticket: {
        referenceSuffix: referenceSuffix(row.suffix),
        state: ticketState(row.status),
      },
    })),
    limitedTo: 5,
  });
};

const handleConfirm = async (
  request: Request,
  context: AuthorizedContext,
  dependencies: CheckinDependencies,
  requestId: string,
) => {
  const bodyText = await request.text();
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    raw = null;
  }
  const parsed = checkinConfirmRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Invalid confirmation',
      'The confirmation request is invalid.',
    );
  }
  if (
    parsed.data.deviceId !== context.device.id ||
    parsed.data.stationId !== context.station.id
  ) {
    throw apiProblem(
      403,
      'CHECKIN_DEVICE_REVOKED',
      'Device mismatch',
      'The lookup belongs to a different check-in device.',
    );
  }
  const key = readIdempotencyKey(request.headers);
  const now = dependencies.now?.() ?? new Date();
  const result = await executeIdempotentMutation(
    dependencies.db,
    {
      eventId: context.event.id,
      actorId: context.actor.id,
      scope: 'checkin.confirm',
      key,
      requestHash: hashIdempotencyRequest({
        method: request.method,
        path: new URL(request.url).pathname,
        body: bodyText,
      }),
      ttlMs: IDEMPOTENCY_TTL_MS,
      now,
    },
    async (transaction) => {
      const lookup = await transaction.query.checkinLookups.findFirst({
        where: and(
          eq(schema.checkinLookups.id, parsed.data.lookupId),
          eq(schema.checkinLookups.eventId, context.event.id),
          eq(schema.checkinLookups.operatorUserId, context.actor.id),
          eq(schema.checkinLookups.deviceId, context.device.id),
        ),
      });
      if (!lookup || lookup.expiresAt <= now) {
        throw apiProblem(
          409,
          'CHECKIN_LOOKUP_EXPIRED',
          'Lookup expired',
          'Create a new lookup before confirming check-in.',
        );
      }
      await acquireTransactionLock(
        transaction,
        `checkin-ticket:${context.event.id}:${lookup.ticketId}`,
      );
      const projection = await personProjection(
        transaction,
        context.event.id,
        lookup.ticketId,
      );
      if (
        !projection ||
        !projection.userId ||
        projection.status !== 'activated'
      ) {
        throw apiProblem(
          409,
          'CHECKIN_TICKET_STATE_CHANGED',
          'Ticket state changed',
          'The ticket is no longer valid for check-in.',
        );
      }
      const existing = await previousActiveCheckin(
        transaction,
        context.event.id,
        lookup.ticketId,
      );
      const person = {
        id: projection.userId,
        displayName: `${projection.firstName} ${projection.lastName}`,
        maskedEmail: maskEmail(projection.email),
      };
      const ticket = {
        referenceSuffix: referenceSuffix(projection.suffix),
        state: 'valid' as const,
      };
      if (existing) {
        const response = checkinConfirmResponseSchema.parse({
          outcome: 'duplicate',
          person,
          ticket,
          checkin: recordProjection(existing, context, now),
        });
        return { status: 200, body: response };
      }
      const checkinId = generateUuidV7();
      await transaction.insert(schema.checkIns).values({
        id: checkinId,
        eventId: context.event.id,
        ticketId: lookup.ticketId,
        holderUserId: projection.userId,
        stationId: context.station.id,
        deviceId: context.device.id,
        checkedInBy: context.actor.id,
        occurredAt: now,
      });
      await writeAuditLog(transaction, {
        eventId: context.event.id,
        actorId: context.actor.id,
        actorType: 'user',
        action: 'checkin.confirm',
        targetType: 'checkin',
        targetId: checkinId,
        requestId,
        after: { outcome: 'checked_in', stationId: context.station.id },
      });
      const response = checkinConfirmResponseSchema.parse({
        outcome: 'checked_in',
        person,
        ticket,
        checkin: recordProjection(
          {
            id: checkinId,
            occurredAt: now,
            undoneAt: null,
            stationId: context.station.id,
            stationName: context.station.name,
          },
          context,
          now,
        ),
      });
      return { status: 201, body: response, resultReference: checkinId };
    },
  );
  return {
    body: result.body,
    status: result.status,
    replayed: result.replayed,
  };
};

const handleUndo = async (
  request: Request,
  checkinId: string,
  context: AuthorizedContext,
  dependencies: CheckinDependencies,
  requestId: string,
) => {
  if (!uuidSchema.safeParse(checkinId).success) {
    throw apiProblem(
      404,
      'CHECKIN_NOT_FOUND',
      'Check-in not found',
      'The check-in record is not available.',
    );
  }
  const bodyText = await request.text();
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    raw = null;
  }
  const parsed = checkinUndoRequestSchema.safeParse(raw);
  if (!parsed.success) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Invalid undo request',
      'A bounded reason is required.',
    );
  }
  const key = readIdempotencyKey(request.headers);
  const now = dependencies.now?.() ?? new Date();
  const result = await executeIdempotentMutation(
    dependencies.db,
    {
      eventId: context.event.id,
      actorId: context.actor.id,
      scope: 'checkin.undo',
      key,
      requestHash: hashIdempotencyRequest({
        method: request.method,
        path: new URL(request.url).pathname,
        body: bodyText,
      }),
      ttlMs: IDEMPOTENCY_TTL_MS,
      now,
    },
    async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `checkin-record:${context.event.id}:${checkinId}`,
      );
      const record = await transaction.query.checkIns.findFirst({
        where: and(
          eq(schema.checkIns.eventId, context.event.id),
          eq(schema.checkIns.id, checkinId),
        ),
      });
      if (!record) {
        throw apiProblem(
          404,
          'CHECKIN_NOT_FOUND',
          'Check-in not found',
          'The check-in record is not available.',
        );
      }
      if (record.undoneAt) {
        return {
          status: 200,
          body: checkinUndoResponseSchema.parse({
            outcome: 'already_undone',
            checkinId,
            undoneAt: record.undoneAt.toISOString(),
          }),
        };
      }
      if (
        record.occurredAt.getTime() + UNDO_WINDOW_SECONDS * 1_000 <=
        now.getTime()
      ) {
        throw apiProblem(
          409,
          'CHECKIN_UNDO_WINDOW_EXPIRED',
          'Undo window expired',
          'The operator undo window has expired.',
        );
      }
      await transaction
        .update(schema.checkIns)
        .set({
          undoneAt: now,
          undoneBy: context.actor.id,
          undoReason: parsed.data.reason,
        })
        .where(eq(schema.checkIns.id, checkinId));
      await writeAuditLog(transaction, {
        eventId: context.event.id,
        actorId: context.actor.id,
        actorType: 'user',
        action: 'checkin.undo',
        targetType: 'checkin',
        targetId: checkinId,
        requestId,
        reason: parsed.data.reason,
        before: { status: 'active' },
        after: { status: 'undone' },
      });
      return {
        status: 200,
        body: checkinUndoResponseSchema.parse({
          outcome: 'undone',
          checkinId,
          undoneAt: now.toISOString(),
        }),
      };
    },
  );
  return {
    body: result.body,
    status: result.status,
    replayed: result.replayed,
  };
};

export const handleCheckinRequest = async (
  request: Request,
  action: CheckinAction,
  dependencies: CheckinDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    const expectedMethod =
      action === 'context' || action === 'stats' ? 'GET' : 'POST';
    if (request.method !== expectedMethod) {
      throw apiProblem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    const rateKind: CheckinRateLimitKind =
      action === 'context' || action === 'stats'
        ? 'read'
        : action === 'lookup' || action === 'search'
          ? 'lookup'
          : 'mutation';
    const { context, rateHeaders } = await authorize(
      request,
      dependencies,
      rateKind,
    );
    if (action === 'context') {
      const body = checkinBootstrapResponseSchema.parse({
        serverNow: (dependencies.now?.() ?? new Date()).toISOString(),
        event: context.event,
        station: context.station,
        device: context.device,
        actor: {
          displayLabel: context.actor.displayLabel,
          role: context.actor.role,
          permissions: { confirm: true, undo: true },
        },
        policy: {
          credentialAdapter: 'synthetic_demo_only',
          operatingMode: 'online_authoritative',
          offlineCheckinEnabled: false,
          searchMinLength: 2,
          searchMaxLength: 80,
          searchResultLimit: 5,
          undoWindowSeconds: UNDO_WINDOW_SECONDS,
        },
      });
      return success(body, requestId, 200, rateHeaders);
    }
    if (action === 'lookup') {
      return success(
        await lookupResponse(request, context, dependencies),
        requestId,
        200,
        rateHeaders,
      );
    }
    if (action === 'search') {
      return success(
        await handleSearch(request, context, dependencies),
        requestId,
        200,
        rateHeaders,
      );
    }
    if (action === 'confirm') {
      const result = await handleConfirm(
        request,
        context,
        dependencies,
        requestId,
      );
      return success(result.body, requestId, result.status, {
        ...rateHeaders,
        'idempotency-replayed': String(result.replayed),
      });
    }
    if (action === 'stats') {
      const now = dependencies.now?.() ?? new Date();
      const [checkedIn, duplicates, exceptions] = await Promise.all([
        dependencies.db
          .select({ count: count() })
          .from(schema.checkIns)
          .where(
            and(
              eq(schema.checkIns.eventId, context.event.id),
              isNull(schema.checkIns.undoneAt),
            ),
          ),
        dependencies.db
          .select({ count: count() })
          .from(schema.checkinLookups)
          .where(
            and(
              eq(schema.checkinLookups.eventId, context.event.id),
              eq(schema.checkinLookups.outcome, 'duplicate'),
            ),
          ),
        dependencies.db
          .select({ count: count() })
          .from(schema.checkinLookups)
          .where(
            and(
              eq(schema.checkinLookups.eventId, context.event.id),
              inArray(schema.checkinLookups.outcome, [
                'cancelled',
                'refunded',
                'blocked',
              ]),
            ),
          ),
      ]);
      return success(
        checkinStatsResponseSchema.parse({
          checkedIn: checkedIn[0]?.count ?? 0,
          duplicates: duplicates[0]?.count ?? 0,
          exceptions: exceptions[0]?.count ?? 0,
          updatedAt: now.toISOString(),
        }),
        requestId,
        200,
        rateHeaders,
      );
    }
    const result = await handleUndo(
      request,
      action.undoCheckinId,
      context,
      dependencies,
      requestId,
    );
    return success(result.body, requestId, result.status, {
      ...rateHeaders,
      'idempotency-replayed': String(result.replayed),
    });
  } catch (error) {
    const response = problemResponse(error, requestId);
    response.headers.set('cache-control', 'private, no-store');
    response.headers.set('vary', 'Authorization, Cookie');
    response.headers.set('x-content-type-options', 'nosniff');
    return response;
  }
};
