import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  adminParticipantDetailSchema,
  adminParticipantInviteRequestSchema,
  adminParticipantInviteResponseSchema,
  adminParticipantListRequestSchema,
  adminParticipantListResponseSchema,
  adminParticipantUpdateRequestSchema,
  adminParticipantUpdateResponseSchema,
  supportMutationRequestSchema,
  supportMutationResponseSchema,
  supportSearchQuerySchema,
  supportSearchResponseSchema,
  type AdminParticipantDetail,
  type AdminParticipantInvitationStatus,
  type AdminParticipantNetworkingState,
  type SupportRecord,
} from '@byzon/domain/contracts/support';
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm';
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
  sendParticipantInvitation?: (input: {
    email: string;
    recipientName: string;
  }) => Promise<void>;
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

const availableActionsForTicketState = (
  state: SupportRecord['ticketState'],
): SupportRecord['availableActions'] =>
  state === 'active' ? ['block'] : state === 'blocked' ? ['reactivate'] : [];

const networkingStateFrom = (row: {
  networkingEnabled: boolean | null;
  moderationStatus: 'visible' | 'hidden';
}): AdminParticipantNetworkingState =>
  row.moderationStatus === 'hidden'
    ? 'moderated'
    : row.networkingEnabled === true
      ? 'enabled'
      : 'disabled';

const invitationFrom = (row: {
  emailVerified: boolean;
  lastInvitationSentAt: Date | null;
}): {
  status: AdminParticipantInvitationStatus;
  lastSentAt: string | null;
} => ({
  status: row.emailVerified
    ? 'accepted'
    : row.lastInvitationSentAt
      ? 'sent'
      : 'not_sent',
  lastSentAt: row.lastInvitationSentAt?.toISOString() ?? null,
});

const participantAccessFor = (
  db: Database | DatabaseTransaction,
  eventId: string,
) =>
  db
    .select({
      id: schema.tickets.id,
      eventId: schema.tickets.eventId,
      userId: sql<string>`${schema.tickets.holderUserId}`.as('user_id'),
      source:
        sql<'ticket' | 'simpleshop'>`'ticket'`.as('source'),
      referenceValue: schema.tickets.codeSuffix,
      externalId: schema.tickets.externalId,
      orderExternalId: schema.tickets.orderExternalId,
      status: schema.tickets.status,
      claimedAt: schema.tickets.claimedAt,
      version: schema.tickets.version,
      updatedAt: schema.tickets.updatedAt,
    })
    .from(schema.tickets)
    .where(
      and(
        eq(schema.tickets.eventId, eventId),
        isNotNull(schema.tickets.holderUserId),
      ),
    )
    .unionAll(
      db
        .select({
          id: schema.ticketSourceParticipants.id,
          eventId: schema.ticketSourceParticipants.eventId,
          userId: schema.ticketSourceParticipants.userId,
          source:
            sql<'ticket' | 'simpleshop'>`'simpleshop'`.as('source'),
          referenceValue: schema.ticketSourceParticipants.externalId,
          externalId:
            sql<string | null>`${schema.ticketSourceParticipants.externalId}`.as(
              'external_id',
            ),
          orderExternalId:
            sql<string | null>`${schema.ticketSourceParticipants.orderExternalId}`.as(
              'order_external_id',
            ),
          status:
            sql<
              (typeof schema.tickets.$inferSelect)['status']
            >`'activated'::ticket_status`.as('status'),
          claimedAt: sql<Date | null>`null::timestamptz`.as('claimed_at'),
          version: schema.ticketSourceParticipants.version,
          updatedAt: schema.ticketSourceParticipants.updatedAt,
        })
        .from(schema.ticketSourceParticipants)
        .where(eq(schema.ticketSourceParticipants.eventId, eventId)),
    )
    .as('participant_access');

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
    availableActions: availableActionsForTicketState(state),
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

const loadParticipantDetail = async (
  db: Database | DatabaseTransaction,
  eventId: string,
  participantId: string,
): Promise<AdminParticipantDetail | null> => {
  const participantAccess = participantAccessFor(db, eventId);
  const rows = await db
    .select({
      participantId: schema.participantProfiles.userId,
      ticketId: participantAccess.id,
      firstName: schema.participantProfiles.firstName,
      lastName: schema.participantProfiles.lastName,
      contactEmail: schema.participantProfiles.contactEmail,
      phone: schema.participantProfiles.phone,
      company: schema.participantProfiles.company,
      jobTitle: schema.participantProfiles.jobTitle,
      introduction: schema.participantProfiles.bio,
      linkedinUrl: schema.participantProfiles.linkedinUrl,
      todayHunting: schema.participantProfiles.todayHunting,
      networkingEnabled: schema.participantProfiles.networkingEnabled,
      moderationStatus: schema.participantProfiles.moderationStatus,
      onboardingCompletedAt: schema.participantProfiles.onboardingCompletedAt,
      membershipStatus: schema.eventMemberships.status,
      profileVersion: schema.participantProfiles.version,
      profileCreatedAt: schema.participantProfiles.createdAt,
      profileUpdatedAt: schema.participantProfiles.updatedAt,
      ticketSource: participantAccess.source,
      ticketReferenceSuffix: participantAccess.referenceValue,
      ticketExternalId: participantAccess.externalId,
      orderExternalId: participantAccess.orderExternalId,
      ticketStatus: participantAccess.status,
      ticketClaimedAt: participantAccess.claimedAt,
      ticketVersion: participantAccess.version,
      emailVerified: schema.users.emailVerified,
      lastInvitationSentAt: sql<Date | null>`(
        select max(${schema.auditLogs.createdAt})
        from ${schema.auditLogs}
        where ${schema.auditLogs.eventId} = ${eventId}
          and ${schema.auditLogs.action} = 'participant.invitation_sent'
          and ${schema.auditLogs.targetId} = ${schema.participantProfiles.userId}::text
      )`,
    })
    .from(schema.participantProfiles)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.participantProfiles.userId),
    )
    .innerJoin(
      schema.eventMemberships,
      and(
        eq(schema.eventMemberships.eventId, schema.participantProfiles.eventId),
        eq(schema.eventMemberships.userId, schema.participantProfiles.userId),
      ),
    )
    .innerJoin(
      participantAccess,
      and(
        eq(participantAccess.eventId, schema.participantProfiles.eventId),
        eq(participantAccess.userId, schema.participantProfiles.userId),
      ),
    )
    .where(
      and(
        eq(schema.participantProfiles.eventId, eventId),
        eq(schema.participantProfiles.userId, participantId),
      ),
    )
    .orderBy(desc(participantAccess.updatedAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const [reservationRows, checkInRows] = await Promise.all([
    db
      .select({
        reservationId: schema.reservations.id,
        sessionId: schema.reservations.sessionId,
        title: schema.programSessions.title,
        startsAt: schema.programSessions.startsAt,
        status: schema.reservations.status,
        source: schema.reservations.source,
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
          eq(schema.reservations.userId, participantId),
        ),
      )
      .orderBy(asc(schema.programSessions.startsAt))
      .limit(100),
    db
      .select({ occurredAt: schema.checkIns.occurredAt })
      .from(schema.checkIns)
      .where(
        and(
          eq(schema.checkIns.eventId, eventId),
          eq(schema.checkIns.holderUserId, participantId),
          isNull(schema.checkIns.undoneAt),
        ),
      )
      .orderBy(desc(schema.checkIns.occurredAt))
      .limit(1),
  ]);
  const state = ticketState(row.ticketStatus);
  return adminParticipantDetailSchema.parse({
    eventId,
    participantId: row.participantId,
    ticketId: row.ticketId,
    firstName: row.firstName,
    lastName: row.lastName,
    contactEmail: row.contactEmail,
    phone: row.phone,
    company: row.company ?? '',
    jobTitle: row.jobTitle ?? '',
    introduction: row.introduction ?? '',
    linkedinUrl: row.linkedinUrl,
    todayHunting: row.todayHunting,
    networkingEnabled: row.networkingEnabled === true,
    moderationStatus: row.moderationStatus,
    onboardingCompleted: row.onboardingCompletedAt !== null,
    membershipStatus: row.membershipStatus,
    invitation: invitationFrom(row),
    ticket: {
      source: row.ticketSource,
      referenceSuffix: suffix(row.ticketReferenceSuffix),
      externalId: row.ticketExternalId?.slice(0, 256) ?? null,
      orderExternalId: row.orderExternalId?.slice(0, 256) ?? null,
      state,
      claimedAt: row.ticketClaimedAt?.toISOString() ?? null,
      version: row.ticketVersion,
      availableActions:
        row.ticketSource === 'ticket'
          ? availableActionsForTicketState(state)
          : [],
    },
    checkIn: checkInRows[0]
      ? { occurredAt: checkInRows[0].occurredAt.toISOString() }
      : null,
    reservations: reservationRows.map((reservation) => ({
      ...reservation,
      title: safeLabel(reservation.title, 'Aktivita bez názvu'),
      startsAt: reservation.startsAt.toISOString(),
    })),
    profileVersion: row.profileVersion,
    createdAt: row.profileCreatedAt.toISOString(),
    updatedAt: row.profileUpdatedAt.toISOString(),
  });
};

export const handleAdminParticipantList = async (
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
    const parsed = adminParticipantListRequestSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid filters',
        'The participant filters are invalid.',
      );
    }

    const participantAccess = participantAccessFor(dependencies.db, eventId);
    const filters = [eq(schema.participantProfiles.eventId, eventId)];
    if (parsed.data.query) {
      const escaped = parsed.data.query.replace(
        /[\\%_]/g,
        (value) => `\\${value}`,
      );
      const pattern = `%${escaped}%`;
      filters.push(
        or(
          ilike(schema.participantProfiles.firstName, pattern),
          ilike(schema.participantProfiles.lastName, pattern),
          ilike(schema.participantProfiles.contactEmail, pattern),
          ilike(schema.participantProfiles.company, pattern),
          ilike(schema.participantProfiles.jobTitle, pattern),
          ilike(participantAccess.referenceValue, pattern),
        )!,
      );
    }
    if (parsed.data.ticketStates.length > 0) {
      const states = parsed.data.ticketStates.map((state) =>
        state === 'active' ? ('activated' as const) : state,
      );
      filters.push(inArray(participantAccess.status, states));
    }
    if (parsed.data.networkingStates.length > 0) {
      filters.push(
        or(
          ...(parsed.data.networkingStates.map((state) =>
            state === 'enabled'
              ? and(
                  eq(schema.participantProfiles.networkingEnabled, true),
                  eq(schema.participantProfiles.moderationStatus, 'visible'),
                )
              : state === 'moderated'
                ? eq(schema.participantProfiles.moderationStatus, 'hidden')
                : and(
                    or(
                      eq(schema.participantProfiles.networkingEnabled, false),
                      isNull(schema.participantProfiles.networkingEnabled),
                    ),
                    eq(schema.participantProfiles.moderationStatus, 'visible'),
                  ),
          ) as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]),
        )!,
      );
    }

    const where = and(...filters);
    const [rows, filteredCountRows, summaryRows] = await Promise.all([
      dependencies.db
        .selectDistinctOn([schema.participantProfiles.userId], {
          participantId: schema.participantProfiles.userId,
          ticketId: participantAccess.id,
          firstName: schema.participantProfiles.firstName,
          lastName: schema.participantProfiles.lastName,
          contactEmail: schema.participantProfiles.contactEmail,
          company: schema.participantProfiles.company,
          jobTitle: schema.participantProfiles.jobTitle,
          accessSource: participantAccess.source,
          referenceSuffix: participantAccess.referenceValue,
          ticketStatus: participantAccess.status,
          networkingEnabled: schema.participantProfiles.networkingEnabled,
          moderationStatus: schema.participantProfiles.moderationStatus,
          profileVersion: schema.participantProfiles.version,
          ticketVersion: participantAccess.version,
          emailVerified: schema.users.emailVerified,
          lastInvitationSentAt: sql<Date | null>`(
            select max(${schema.auditLogs.createdAt})
            from ${schema.auditLogs}
            where ${schema.auditLogs.eventId} = ${eventId}
              and ${schema.auditLogs.action} = 'participant.invitation_sent'
              and ${schema.auditLogs.targetId} = ${schema.participantProfiles.userId}::text
          )`,
          updatedAt: schema.participantProfiles.updatedAt,
          checkedIn: sql<boolean>`exists (
            select 1 from ${schema.checkIns}
            where ${schema.checkIns.eventId} = ${eventId}
              and ${schema.checkIns.holderUserId} = ${schema.participantProfiles.userId}
              and ${schema.checkIns.undoneAt} is null
          )`,
          reservationCount: sql<number>`(
            select count(*)::int from ${schema.reservations}
            where ${schema.reservations.eventId} = ${eventId}
              and ${schema.reservations.userId} = ${schema.participantProfiles.userId}
              and ${schema.reservations.status} = 'confirmed'
          )`,
        })
        .from(schema.participantProfiles)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.participantProfiles.userId),
        )
        .innerJoin(
          participantAccess,
          and(
            eq(participantAccess.eventId, schema.participantProfiles.eventId),
            eq(participantAccess.userId, schema.participantProfiles.userId),
          ),
        )
        .where(where)
        .orderBy(
          schema.participantProfiles.userId,
          desc(participantAccess.updatedAt),
        )
        .limit(parsed.data.limit)
        .offset(parsed.data.offset),
      dependencies.db
        .select({
          count: sql<number>`count(distinct ${schema.participantProfiles.userId})::int`,
        })
        .from(schema.participantProfiles)
        .innerJoin(
          participantAccess,
          and(
            eq(participantAccess.eventId, schema.participantProfiles.eventId),
            eq(participantAccess.userId, schema.participantProfiles.userId),
          ),
        )
        .where(where),
      dependencies.db
        .select({
          total: sql<number>`count(distinct ${schema.participantProfiles.userId})::int`,
          active: sql<number>`count(distinct ${schema.participantProfiles.userId}) filter (where ${participantAccess.status} = 'activated')::int`,
          networkingEnabled: sql<number>`count(distinct ${schema.participantProfiles.userId}) filter (where ${schema.participantProfiles.networkingEnabled} = true and ${schema.participantProfiles.moderationStatus} = 'visible')::int`,
          checkedIn: sql<number>`count(distinct ${schema.checkIns.holderUserId}) filter (where ${schema.checkIns.undoneAt} is null)::int`,
        })
        .from(schema.participantProfiles)
        .innerJoin(
          participantAccess,
          and(
            eq(participantAccess.eventId, schema.participantProfiles.eventId),
            eq(participantAccess.userId, schema.participantProfiles.userId),
          ),
        )
        .leftJoin(
          schema.checkIns,
          and(
            eq(schema.checkIns.eventId, schema.participantProfiles.eventId),
            eq(schema.checkIns.holderUserId, schema.participantProfiles.userId),
          ),
        )
        .where(eq(schema.participantProfiles.eventId, eventId)),
    ]);
    const total = Number(filteredCountRows[0]?.count ?? 0);
    const summary = summaryRows[0];
    const items = rows
      .map((row) => {
        const state = ticketState(row.ticketStatus);
        const invitation = invitationFrom(row);
        return {
          eventId,
          participantId: row.participantId,
          ticketId: row.ticketId,
          displayName: safeLabel(
            `${row.firstName} ${row.lastName}`,
            'Účastník bez jména',
          ),
          contactEmail: row.contactEmail,
          company: row.company ?? '',
          jobTitle: row.jobTitle ?? '',
          referenceSuffix: suffix(row.referenceSuffix),
          ticketState: state,
          accessState:
            invitation.status === 'accepted'
              ? ('claimed' as const)
              : invitation.status === 'sent'
                ? ('recovery_pending' as const)
                : ('not_claimed' as const),
          networkingState: networkingStateFrom(row),
          invitation,
          checkedIn: row.checkedIn,
          reservationCount: Number(row.reservationCount),
          profileVersion: row.profileVersion,
          ticketVersion: row.ticketVersion,
          updatedAt: row.updatedAt.toISOString(),
          availableActions:
            row.accessSource === 'ticket'
              ? availableActionsForTicketState(state)
              : [],
        };
      })
      .sort((left, right) =>
        left.displayName.localeCompare(right.displayName, 'cs'),
      );
    const body = adminParticipantListResponseSchema.parse({
      eventId,
      generatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      items,
      pageInfo: {
        total,
        offset: parsed.data.offset,
        hasMore: parsed.data.offset + items.length < total,
      },
      summary: {
        total: Number(summary?.total ?? 0),
        active: Number(summary?.active ?? 0),
        networkingEnabled: Number(summary?.networkingEnabled ?? 0),
        checkedIn: Number(summary?.checkedIn ?? 0),
      },
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

export const handleAdminParticipantDetail = async (
  request: Request,
  eventId: string,
  participantId: string,
  dependencies: AdminSupportDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'GET') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    await authorize(
      request,
      eventId,
      'participant:operational:read',
      dependencies,
    );
    if (!uuidSchema.safeParse(participantId).success) {
      throw problem(
        404,
        'SUPPORT_RECORD_NOT_FOUND',
        'Participant not found',
        'The participant is unavailable.',
      );
    }
    const detail = await loadParticipantDetail(
      dependencies.db,
      eventId,
      participantId,
    );
    if (!detail) {
      throw problem(
        404,
        'SUPPORT_RECORD_NOT_FOUND',
        'Participant not found',
        'The participant is unavailable.',
      );
    }
    return Response.json(detail, { headers: privateHeaders(requestId) });
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};

export const handleAdminParticipantInvite = async (
  request: Request,
  eventId: string,
  participantId: string,
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
    const parsed = adminParticipantInviteRequestSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.participantId !== participantId ||
      !uuidSchema.safeParse(participantId).success
    ) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid participant invitation',
        'The participant invitation is invalid.',
      );
    }
    if (!dependencies.sendParticipantInvitation) {
      throw problem(
        503,
        'INVITATION_DELIVERY_UNAVAILABLE',
        'Invitation delivery unavailable',
        'The invitation could not be delivered. Try again later.',
      );
    }

    const key = readIdempotencyKey(request.headers);
    const sentAt = dependencies.now?.() ?? new Date();
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'participant.invitation',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: rawBody,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: sentAt,
      },
      async (transaction) => {
        await acquireTransactionLock(
          transaction,
          `participant-invitation:${eventId}:${participantId}`,
        );
        const [participant, event, activeTicket, sourceParticipant] =
          await Promise.all([
            transaction
              .select({
                firstName: schema.participantProfiles.firstName,
                lastName: schema.participantProfiles.lastName,
                email: schema.users.email,
                emailVerified: schema.users.emailVerified,
                membershipStatus: schema.eventMemberships.status,
                lastInvitationSentAt: sql<Date | null>`(
                  select max(${schema.auditLogs.createdAt})
                  from ${schema.auditLogs}
                  where ${schema.auditLogs.eventId} = ${eventId}
                    and ${schema.auditLogs.action} = 'participant.invitation_sent'
                    and ${schema.auditLogs.targetId} = ${participantId}
                )`,
              })
              .from(schema.participantProfiles)
              .innerJoin(
                schema.users,
                eq(schema.users.id, schema.participantProfiles.userId),
              )
              .innerJoin(
                schema.eventMemberships,
                and(
                  eq(
                    schema.eventMemberships.eventId,
                    schema.participantProfiles.eventId,
                  ),
                  eq(
                    schema.eventMemberships.userId,
                    schema.participantProfiles.userId,
                  ),
                ),
              )
              .where(
                and(
                  eq(schema.participantProfiles.eventId, eventId),
                  eq(schema.participantProfiles.userId, participantId),
                ),
              )
              .limit(1)
              .then((rows) => rows[0]),
            transaction.query.events.findFirst({
              columns: { status: true },
              where: eq(schema.events.id, eventId),
            }),
            transaction.query.tickets.findFirst({
              columns: { id: true },
              where: and(
                eq(schema.tickets.eventId, eventId),
                eq(schema.tickets.holderUserId, participantId),
                eq(schema.tickets.status, 'activated'),
              ),
            }),
            transaction.query.ticketSourceParticipants.findFirst({
              columns: { id: true },
              where: and(
                eq(schema.ticketSourceParticipants.eventId, eventId),
                eq(schema.ticketSourceParticipants.userId, participantId),
                eq(schema.ticketSourceParticipants.sourceStatus, 'paid'),
              ),
            }),
          ]);
        if (!participant || !event) {
          throw problem(
            404,
            'SUPPORT_RECORD_NOT_FOUND',
            'Participant not found',
            'The participant is unavailable.',
          );
        }
        if (
          event.status === 'archived' ||
          participant.membershipStatus !== 'active' ||
          (!activeTicket && !sourceParticipant)
        ) {
          throw problem(
            409,
            'SUPPORT_INVALID_TRANSITION',
            'Invitation unavailable',
            'Only an active participant can receive an invitation.',
          );
        }
        try {
          await dependencies.sendParticipantInvitation!({
            email: participant.email,
            recipientName: `${participant.firstName} ${participant.lastName}`,
          });
        } catch {
          throw problem(
            503,
            'INVITATION_DELIVERY_UNAVAILABLE',
            'Invitation delivery unavailable',
            'The invitation could not be delivered. Try again later.',
          );
        }
        const auditId = await writeAuditLog(transaction, {
          eventId,
          actorId,
          actorType: 'user',
          action: 'participant.invitation_sent',
          targetType: 'participant_profile',
          targetId: participantId,
          requestId,
          reason: 'Pozvánka odeslána z administrace.',
          before: {
            invitationStatus: participant.emailVerified
              ? 'accepted'
              : participant.lastInvitationSentAt
                ? 'sent'
                : 'not_sent',
          },
          after: {
            invitationStatus: participant.emailVerified
              ? 'accepted'
              : 'sent',
            sentAt: sentAt.toISOString(),
          },
        });
        return {
          status: 200,
          body: adminParticipantInviteResponseSchema.parse({
            eventId,
            participantId,
            outcome: 'sent',
            sentAt: sentAt.toISOString(),
            invitation: {
              status: participant.emailVerified ? 'accepted' : 'sent',
              lastSentAt: sentAt.toISOString(),
            },
            audit: { auditId },
          }),
        };
      },
    );
    return withRateLimitHeaders(
      Response.json(
        adminParticipantInviteResponseSchema.parse({
          ...result.body,
          outcome: result.replayed ? 'already_sent' : result.body.outcome,
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

export const handleAdminParticipantUpdate = async (
  request: Request,
  eventId: string,
  participantId: string,
  dependencies: AdminSupportDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    if (request.method !== 'PATCH') {
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
    const parsed = adminParticipantUpdateRequestSchema.safeParse(raw);
    if (!parsed.success || parsed.data.participantId !== participantId) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid participant',
        'The participant changes are invalid.',
      );
    }
    const key = readIdempotencyKey(request.headers);
    const changedAt = dependencies.now?.() ?? new Date();
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'participant.profile',
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
          `participant-profile:${eventId}:${participantId}`,
        );
        const [current, event] = await Promise.all([
          transaction.query.participantProfiles.findFirst({
            where: and(
              eq(schema.participantProfiles.eventId, eventId),
              eq(schema.participantProfiles.userId, participantId),
            ),
          }),
          transaction.query.events.findFirst({
            columns: { status: true },
            where: eq(schema.events.id, eventId),
          }),
        ]);
        if (!current || !event) {
          throw problem(
            404,
            'SUPPORT_RECORD_NOT_FOUND',
            'Participant not found',
            'The participant is unavailable.',
          );
        }
        if (event.status === 'archived') {
          throw problem(
            409,
            'SUPPORT_INVALID_TRANSITION',
            'Archived event',
            'Archived participant profiles are read-only.',
          );
        }
        if (current.version !== parsed.data.expectedProfileVersion) {
          throw problem(
            409,
            'STALE_VERSION',
            'Participant changed',
            'Reload the participant before saving.',
            {
              currentVersion: current.version,
            },
          );
        }
        const existingEmail = await transaction.query.users.findFirst({
          columns: { id: true },
          where: eq(schema.users.email, parsed.data.profile.contactEmail),
        });
        if (existingEmail && existingEmail.id !== participantId) {
          throw problem(
            422,
            'VALIDATION_FAILED',
            'Email is already used',
            'Use an email address that is not assigned to another account.',
          );
        }
        const nextVersion = current.version + 1;
        const visibility = parsed.data.profile.networkingEnabled
          ? 'directory'
          : 'hidden';
        await Promise.all([
          transaction
            .update(schema.participantProfiles)
            .set({
              firstName: parsed.data.profile.firstName,
              lastName: parsed.data.profile.lastName,
              contactEmail: parsed.data.profile.contactEmail,
              phone: parsed.data.profile.phone,
              company: parsed.data.profile.company || null,
              jobTitle: parsed.data.profile.jobTitle || null,
              bio: parsed.data.profile.introduction || null,
              linkedinUrl: parsed.data.profile.linkedinUrl,
              todayHunting: parsed.data.profile.todayHunting,
              networkingEnabled: parsed.data.profile.networkingEnabled,
              moderationStatus: parsed.data.profile.moderationStatus,
              emailVisibility: visibility,
              phoneVisibility: visibility,
              linkedinVisibility: visibility,
              version: nextVersion,
              updatedAt: changedAt,
            })
            .where(
              and(
                eq(schema.participantProfiles.eventId, eventId),
                eq(schema.participantProfiles.userId, participantId),
                eq(schema.participantProfiles.version, current.version),
              ),
            ),
          transaction
            .update(schema.users)
            .set({
              name: `${parsed.data.profile.firstName} ${parsed.data.profile.lastName}`,
              email: parsed.data.profile.contactEmail,
              updatedAt: changedAt,
            })
            .where(eq(schema.users.id, participantId)),
        ]);
        const auditId = await writeAuditLog(transaction, {
          eventId,
          actorId,
          actorType: 'user',
          action: 'participant.profile_updated',
          targetType: 'participant_profile',
          targetId: participantId,
          requestId,
          reason: parsed.data.reason,
          before: {
            version: current.version,
            networkingEnabled: current.networkingEnabled === true,
            moderationStatus: current.moderationStatus,
          },
          after: {
            version: nextVersion,
            networkingEnabled: parsed.data.profile.networkingEnabled,
            moderationStatus: parsed.data.profile.moderationStatus,
          },
        });
        const detail = await loadParticipantDetail(
          transaction,
          eventId,
          participantId,
        );
        if (!detail) {
          throw problem(
            404,
            'SUPPORT_RECORD_NOT_FOUND',
            'Participant not found',
            'The updated participant is unavailable.',
          );
        }
        return {
          status: 200,
          body: adminParticipantUpdateResponseSchema.parse({
            eventId,
            outcome: 'updated',
            detail,
            changedAt: changedAt.toISOString(),
            audit: { auditId },
          }),
        };
      },
    );
    return withRateLimitHeaders(
      Response.json(result.body, {
        status: result.status,
        headers: {
          ...privateHeaders(requestId),
          'idempotency-replayed': String(result.replayed),
        },
      }),
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
