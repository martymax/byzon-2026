import { schema, type Database } from '@byzon/database';
import {
  OFFLINE_CONTRACT_VERSION,
  offlineAgendaReplayPreflightRequestSchema,
  offlineAgendaReplayPreflightSchema,
  offlineOwnerLeaseSchema,
} from '@byzon/domain/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const MAX_BODY_BYTES = 8_192;
const OWNER_LEASE_MS = 24 * 60 * 60_000;
const OWNER_LEASE_REFRESH_MS = 60 * 60_000;
const PREFLIGHT_MS = 60_000;
const uuidSchema = z.string().uuid();

interface OfflineIdentity {
  user: { id: string };
}

export interface ParticipantOfflineDependencies {
  db: Database;
  allowedOrigin: string;
  getSession(headers: Headers): Promise<OfflineIdentity | null>;
  currentEventSlug?: string;
  now?: () => Date;
}

const privateHeaders = (requestId: string): HeadersInit => ({
  'cache-control': 'private, no-store',
  'content-type': 'application/json',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const apiProblem = (
  status: number,
  code: string,
  title: string,
  detail: string,
): ApiProblemError => new ApiProblemError({ status, code, title, detail });

const respondProblem = (error: unknown, requestId: string): Response => {
  const response = problemResponse(error, requestId);
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('vary', 'Authorization, Cookie');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
};

const loadOwner = async (
  request: Request,
  dependencies: ParticipantOfflineDependencies,
) => {
  const identity = await dependencies.getSession(request.headers);
  if (!identity || !uuidSchema.safeParse(identity.user.id).success) {
    throw apiProblem(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
      'A valid session is required.',
    );
  }
  const event = await dependencies.db.query.events.findFirst({
    columns: { id: true, status: true },
    where: eq(
      schema.events.slug,
      dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
    ),
  });
  if (!event || event.status === 'draft' || event.status === 'archived') {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Offline participant data is unavailable.',
    );
  }
  const membership = await dependencies.db.query.eventMemberships.findFirst({
    columns: { offlineRevocationEpoch: true },
    where: and(
      eq(schema.eventMemberships.eventId, event.id),
      eq(schema.eventMemberships.userId, identity.user.id),
      eq(schema.eventMemberships.status, 'active'),
    ),
  });
  if (!membership) {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Offline participant data is unavailable.',
    );
  }
  try {
    await requireEventPermission(
      dependencies.db,
      { userId: identity.user.id },
      event.id,
      'agenda:own:write',
      { ownsResource: true },
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Offline participant data is unavailable.',
    );
  }
  return {
    eventId: event.id,
    userId: identity.user.id,
    revocationEpoch: membership.offlineRevocationEpoch,
  };
};

const readJson = async (request: Request): Promise<unknown> => {
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim() !==
    'application/json'
  ) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Validation failed',
      'A JSON request body is required.',
    );
  }
  const declared = request.headers.get('content-length');
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)
  ) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Validation failed',
      'The request body is too large.',
    );
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Validation failed',
      'The request body is too large.',
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Validation failed',
      'The request body is invalid.',
    );
  }
};

export const readParticipantOfflineLease = async (
  request: Request,
  dependencies: ParticipantOfflineDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (
      request.method !== 'GET' ||
      new URL(request.url).search.length > 0 ||
      request.headers.has('idempotency-key')
    ) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The lease request is invalid.',
      );
    }
    const owner = await loadOwner(request, dependencies);
    const now = dependencies.now?.() ?? new Date();
    const lease = offlineOwnerLeaseSchema.parse({
      contractVersion: OFFLINE_CONTRACT_VERSION,
      leaseId: owner.revocationEpoch,
      ...owner,
      issuedAt: now.toISOString(),
      refreshAfter: new Date(
        now.getTime() + OWNER_LEASE_REFRESH_MS,
      ).toISOString(),
      expiresAt: new Date(now.getTime() + OWNER_LEASE_MS).toISOString(),
    });
    return Response.json(lease, { headers: privateHeaders(requestId) });
  } catch (error) {
    return respondProblem(error, requestId);
  }
};

export const preflightParticipantOfflineReplay = async (
  request: Request,
  dependencies: ParticipantOfflineDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (
      request.method !== 'POST' ||
      request.headers.get('origin') !== dependencies.allowedOrigin ||
      new URL(request.url).search.length > 0 ||
      request.headers.has('idempotency-key')
    ) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The replay preflight request is invalid.',
      );
    }
    const parsed = offlineAgendaReplayPreflightRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The replay preflight body is invalid.',
      );
    }
    const owner = await loadOwner(request, dependencies);
    if (
      parsed.data.ownerLeaseId !== owner.revocationEpoch ||
      parsed.data.revocationEpoch !== owner.revocationEpoch
    ) {
      throw apiProblem(
        409,
        'OFFLINE_LEASE_REVOKED',
        'Offline lease revoked',
        'The offline owner lease is no longer current.',
      );
    }
    const agenda = await dependencies.db.query.participantAgendas.findFirst({
      columns: { version: true },
      where: and(
        eq(schema.participantAgendas.eventId, owner.eventId),
        eq(schema.participantAgendas.userId, owner.userId),
      ),
    });
    const version = agenda?.version ?? 1;
    if (version !== parsed.data.agendaVersion) {
      throw apiProblem(
        409,
        'STALE_VERSION',
        'Agenda version changed',
        'Reload the canonical agenda before replaying the mutation.',
      );
    }
    const role = await dependencies.db.query.eventRoles.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.eventRoles.eventId, owner.eventId),
        eq(schema.eventRoles.userId, owner.userId),
        isNull(schema.eventRoles.revokedAt),
      ),
    });
    if (!role) {
      throw apiProblem(
        403,
        'EVENT_ACCESS_DENIED',
        'Event access denied',
        'Offline replay is unavailable.',
      );
    }
    const now = dependencies.now?.() ?? new Date();
    const preflight = offlineAgendaReplayPreflightSchema.parse({
      contractVersion: OFFLINE_CONTRACT_VERSION,
      ...owner,
      ownerLeaseId: owner.revocationEpoch,
      agendaVersion: version,
      issuedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + PREFLIGHT_MS).toISOString(),
    });
    return Response.json(preflight, { headers: privateHeaders(requestId) });
  } catch (error) {
    return respondProblem(error, requestId);
  }
};
