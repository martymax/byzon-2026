import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  supportMutationRequestSchema,
  supportMutationResponseSchema,
  supportSearchQuerySchema,
  supportSearchResponseSchema,
  type SupportRecord,
} from '@byzon/domain/contracts/support';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { rateLimitHeaders, type RateLimitDecision } from './api/rate-limit';
import type { AdminSupportRateLimiter } from './admin-support-rate-limit';
import { CURRENT_EVENT_SLUG } from './current-event';
import { EventAccessDeniedError, requireEventPermission } from './policy';
import { promoteAutomaticWaitlist } from './reservation-waitlist';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const uuidSchema = z.string().uuid();

export interface AdminSupportDependencies {
  db: Database;
  allowedOrigin: string;
  currentEventSlug?: string;
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  now?: () => Date;
  rateLimit?: AdminSupportRateLimiter;
}

const privateHeaders = (requestId: string) => ({
  'cache-control': 'private, no-store',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const problem = (
  status: number,
  code: string,
  title: string,
  detail: string,
  extra?: Record<string, unknown>,
) => new ApiProblemError({ status, code, title, detail, ...extra });

const authorize = async (
  request: Request,
  eventId: string,
  permission: 'participant:operational:read' | 'ticket:any:manage',
  dependencies: AdminSupportDependencies,
) => {
  if (!uuidSchema.safeParse(eventId).success) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Support data is unavailable.',
    );
  }
  const identity = await dependencies.getSession(request.headers);
  if (!identity) {
    throw problem(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
      'A valid session is required.',
    );
  }
  const event = await dependencies.db.query.events.findFirst({
    columns: { id: true },
    where: and(
      eq(schema.events.id, eventId),
      eq(
        schema.events.slug,
        dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
      ),
    ),
  });
  if (!event) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Support data is unavailable.',
    );
  }
  try {
    await requireEventPermission(
      dependencies.db,
      { userId: identity.user.id },
      eventId,
      permission,
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Support data is unavailable.',
    );
  }
  return identity.user.id;
};

const requireSameOrigin = (
  request: Request,
  dependencies: AdminSupportDependencies,
): void => {
  if (request.headers.get('origin') !== dependencies.allowedOrigin) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The request origin is not allowed.',
    );
  }
};

const withRateLimitHeaders = (
  response: Response,
  decision: RateLimitDecision | null,
): Response => {
  if (decision) {
    Object.entries(rateLimitHeaders(decision)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
  }
  return response;
};

const maskEmail = (email: string) => {
  const at = email.lastIndexOf('@');
  return at > 0
    ? `${email.slice(0, 1)}***@${email.slice(at + 1)}`
    : 'x***@invalid.example';
};

const ticketState = (
  state: (typeof schema.tickets.$inferSelect)['status'],
): SupportRecord['ticketState'] => {
  if (state === 'blocked' || state === 'cancelled' || state === 'refunded') {
    return state;
  }
  return state === 'activated' ? 'active' : 'cancelled';
};

const suffix = (value: string) => {
  const safe = value.replace(/[^A-Za-z0-9]/g, '').slice(-8);
  return safe.length >= 2 ? safe : `XX${safe}`.slice(-2);
};

const safeLabel = (value: string, fallback: string): string => {
  const normalized = value
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069<>]/g, '')
    .trim()
    .slice(0, 80);
  return normalized || fallback;
};

const recordFrom = (row: {
  eventId: string;
  ticketId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  suffix: string;
  status: (typeof schema.tickets.$inferSelect)['status'];
  version: number;
}): SupportRecord => {
  const state = ticketState(row.status);
  return {
    eventId: row.eventId,
    participantId: row.userId,
    ticketId: row.ticketId,
    displayName: safeLabel(
      `${row.firstName} ${row.lastName}`,
      'Účastník bez uvedeného jména',
    ),
    maskedContact: maskEmail(row.email),
    referenceSuffix: suffix(row.suffix),
    ticketState: state,
    accessState: 'claimed',
    version: row.version,
    availableActions:
      state === 'active'
        ? ['block']
        : state === 'blocked'
          ? ['reactivate']
          : [],
  };
};

const loadRecord = async (
  db: Database | DatabaseTransaction,
  eventId: string,
  ticketId: string,
) => {
  const rows = await db
    .select({
      eventId: schema.tickets.eventId,
      ticketId: schema.tickets.id,
      userId: schema.tickets.holderUserId,
      firstName: schema.participantProfiles.firstName,
      lastName: schema.participantProfiles.lastName,
      email: schema.participantProfiles.contactEmail,
      suffix: schema.tickets.codeSuffix,
      status: schema.tickets.status,
      version: schema.tickets.version,
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
  const row = rows[0];
  return row?.userId ? recordFrom({ ...row, userId: row.userId }) : null;
};

export const handleAdminSupportSearch = async (
  request: Request,
  eventId: string,
  dependencies: AdminSupportDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    if (request.method !== 'POST') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    requireSameOrigin(request, dependencies);
    const actorId = await authorize(
      request,
      eventId,
      'participant:operational:read',
      dependencies,
    );
    rateLimitDecision =
      (await dependencies.rateLimit?.('search', actorId)) ?? null;
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      raw = null;
    }
    const parsed = supportSearchQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid search',
        'The support search is invalid.',
      );
    }
    const escaped = parsed.data.query.replace(
      /[\\%_]/g,
      (value) => `\\${value}`,
    );
    const pattern = `%${escaped}%`;
    const rows = await dependencies.db
      .selectDistinctOn([schema.tickets.holderUserId], {
        eventId: schema.tickets.eventId,
        ticketId: schema.tickets.id,
        userId: schema.tickets.holderUserId,
        firstName: schema.participantProfiles.firstName,
        lastName: schema.participantProfiles.lastName,
        email: schema.participantProfiles.contactEmail,
        suffix: schema.tickets.codeSuffix,
        status: schema.tickets.status,
        version: schema.tickets.version,
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
        and(
          eq(schema.tickets.eventId, eventId),
          inArray(schema.tickets.status, [
            'activated',
            'blocked',
            'cancelled',
            'refunded',
          ]),
          or(
            ilike(schema.participantProfiles.firstName, pattern),
            ilike(schema.participantProfiles.lastName, pattern),
            ilike(schema.participantProfiles.contactEmail, pattern),
            ilike(schema.tickets.codeSuffix, pattern),
          ),
        ),
      )
      .orderBy(schema.tickets.holderUserId, desc(schema.tickets.updatedAt))
      .limit(5);
    const matches = rows.flatMap((row) =>
      row.userId ? [recordFrom({ ...row, userId: row.userId })] : [],
    );
    const body = supportSearchResponseSchema.parse({
      eventId,
      limitedTo: 5,
      outcome:
        matches.length === 0
          ? 'no_match'
          : matches.length === 1
            ? 'single_match'
            : 'ambiguous',
      matches,
    });
    return withRateLimitHeaders(
      Response.json(body, { headers: privateHeaders(requestId) }),
      rateLimitDecision,
    );
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return withRateLimitHeaders(response, rateLimitDecision);
  }
};

export const handleAdminSupportMutation = async (
  request: Request,
  eventId: string,
  dependencies: AdminSupportDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    if (request.method !== 'POST') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    requireSameOrigin(request, dependencies);
    const actorId = await authorize(
      request,
      eventId,
      'ticket:any:manage',
      dependencies,
    );
    rateLimitDecision =
      (await dependencies.rateLimit?.('mutation', actorId)) ?? null;
    const rawBody = await request.text();
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      raw = null;
    }
    const parsed = supportMutationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid support action',
        'The support action is invalid.',
      );
    }
    if (parsed.data.action !== 'block' && parsed.data.action !== 'reactivate') {
      throw problem(
        409,
        'SUPPORT_INVALID_TRANSITION',
        'Unsupported transition',
        'This support transition is not enabled until its ticket workflow is approved.',
      );
    }
    const key = readIdempotencyKey(request.headers);
    const changedAt = dependencies.now?.() ?? new Date();
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'support.ticket',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: rawBody,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: changedAt,
      },
      async (transaction) => {
        await acquireTransactionLock(
          transaction,
          `participant-agenda:${eventId}:${parsed.data.participantId}`,
        );
        await acquireTransactionLock(transaction, `content-publish:${eventId}`);
        const reservations = await transaction
          .select({ sessionId: schema.reservations.sessionId })
          .from(schema.reservations)
          .where(
            and(
              eq(schema.reservations.eventId, eventId),
              eq(schema.reservations.userId, parsed.data.participantId),
              eq(schema.reservations.status, 'confirmed'),
            ),
          );
        const sessionIds = [
          ...new Set(reservations.map(({ sessionId }) => sessionId)),
        ].sort();
        for (const sessionId of sessionIds) {
          await acquireTransactionLock(
            transaction,
            `participant-reservation:${eventId}:${sessionId}`,
          );
        }
        const ticket = await transaction.query.tickets.findFirst({
          where: and(
            eq(schema.tickets.eventId, eventId),
            eq(schema.tickets.id, parsed.data.ticketId),
            eq(schema.tickets.holderUserId, parsed.data.participantId),
          ),
        });
        if (!ticket) {
          throw problem(
            404,
            'SUPPORT_RECORD_NOT_FOUND',
            'Support record not found',
            'The support record is unavailable.',
          );
        }
        if (ticket.version !== parsed.data.expectedVersion) {
          throw problem(
            409,
            'STALE_VERSION',
            'Support record changed',
            'Reload the current support record.',
            { currentVersion: ticket.version },
          );
        }
        const expectedState =
          parsed.data.action === 'block' ? 'activated' : 'blocked';
        const nextState =
          parsed.data.action === 'block' ? 'blocked' : 'activated';
        if (ticket.status !== expectedState) {
          throw problem(
            409,
            'SUPPORT_INVALID_TRANSITION',
            'Invalid ticket transition',
            'The ticket no longer permits this transition.',
          );
        }
        await transaction
          .update(schema.tickets)
          .set({
            status: nextState,
            version: sql`${schema.tickets.version} + 1`,
            updatedAt: changedAt,
          })
          .where(eq(schema.tickets.id, ticket.id));
        await transaction.insert(schema.ticketEvents).values({
          id: generateUuidV7(),
          eventId,
          ticketId: ticket.id,
          actorType: 'user',
          actorId,
          fromStatus: ticket.status,
          toStatus: nextState,
          reason: parsed.data.reason,
          requestId,
          occurredAt: changedAt,
        });
        if (parsed.data.action === 'block') {
          await transaction
            .update(schema.reservations)
            .set({
              status: 'cancelled',
              cancelledAt: changedAt,
              version: sql`${schema.reservations.version} + 1`,
            })
            .where(
              and(
                eq(schema.reservations.eventId, eventId),
                eq(schema.reservations.userId, parsed.data.participantId),
                eq(schema.reservations.status, 'confirmed'),
              ),
            );
          await transaction
            .update(schema.waitlistEntries)
            .set({ status: 'cancelled', cancelledAt: changedAt })
            .where(
              and(
                eq(schema.waitlistEntries.eventId, eventId),
                eq(schema.waitlistEntries.userId, parsed.data.participantId),
                eq(schema.waitlistEntries.status, 'waiting'),
              ),
            );
          await transaction
            .update(schema.participantAgendas)
            .set({
              updatedAt: changedAt,
              version: sql`${schema.participantAgendas.version} + 1`,
            })
            .where(
              and(
                eq(schema.participantAgendas.eventId, eventId),
                eq(schema.participantAgendas.userId, parsed.data.participantId),
              ),
            );
          for (const sessionId of sessionIds) {
            await promoteAutomaticWaitlist({
              transaction,
              eventId,
              sessionId,
              now: changedAt,
              requestId: uuidSchema.safeParse(requestId).success
                ? requestId
                : generateUuidV7(),
              generateId: generateUuidV7,
            });
          }
        }
        const auditId = await writeAuditLog(transaction, {
          eventId,
          actorId,
          actorType: 'user',
          action: `support.${parsed.data.action}`,
          targetType: 'ticket',
          targetId: ticket.id,
          requestId,
          reason: parsed.data.reason,
          before: { status: ticket.status, version: ticket.version },
          after: { status: nextState, version: ticket.version + 1 },
        });
        const record = await loadRecord(transaction, eventId, ticket.id);
        if (!record) {
          throw problem(
            404,
            'SUPPORT_RECORD_NOT_FOUND',
            'Support record not found',
            'The updated support record is unavailable.',
          );
        }
        const response = supportMutationResponseSchema.parse({
          eventId,
          record,
          outcome: 'applied',
          changedAt: changedAt.toISOString(),
          audit: { auditId },
        });
        return { status: 200, body: response };
      },
    );
    return withRateLimitHeaders(
      Response.json(
        supportMutationResponseSchema.parse({
          ...result.body,
          outcome: result.replayed ? 'already_applied' : result.body.outcome,
        }),
        {
          status: result.status,
          headers: {
            ...privateHeaders(requestId),
            'idempotency-replayed': String(result.replayed),
          },
        },
      ),
      rateLimitDecision,
    );
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return withRateLimitHeaders(response, rateLimitDecision);
  }
};
