import { schema, type Database } from '@byzon/database';
import {
  adminInvitationRecipientsSchema,
  adminInvitationRoleSchema,
  type AdminInvitationRecipient,
} from '@byzon/domain/contracts';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import { EventAccessDeniedError, requireEventPermission } from './policy';

interface Dependencies {
  db: Database;
  currentEventSlug?: string;
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
}

export const invitationDelivery = (
  roles: AdminInvitationRecipient['roles'],
  participantReady: boolean,
): AdminInvitationRecipient['delivery'] => {
  if (roles.includes('organizer_admin')) return 'team';
  if (participantReady) return 'participant';
  return roles.some((role) =>
    ['room_operator', 'moderator', 'checkin_operator'].includes(role),
  )
    ? 'team'
    : null;
};

export async function handleAdminInvitationRecipients(
  request: Request,
  eventId: string,
  dependencies: Dependencies,
): Promise<Response> {
  const requestId = getRequestId(request.headers);
  const headers = {
    'cache-control': 'private, no-store',
    vary: 'Authorization, Cookie',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  };
  const denied = () =>
    new ApiProblemError({
      status: 403,
      code: 'EVENT_ACCESS_DENIED',
      title: 'Event access denied',
      detail: 'Přehled pozvánek není pro tento účet dostupný.',
    });
  try {
    if (!z.string().uuid().safeParse(eventId).success) throw denied();
    const session = await dependencies.getSession(request.headers);
    if (!session)
      throw new ApiProblemError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Authentication required',
        detail: 'Přihlaste se znovu do administrace.',
      });
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
    if (!event) throw denied();
    const policy = await requireEventPermission(
      dependencies.db,
      { userId: session.user.id },
      eventId,
      'role:manage',
    );
    if (
      !policy.allows('participant:operational:read') ||
      !policy.allows('ticket:any:manage')
    )
      throw denied();
    const query = z
      .strictObject({ cursor: z.string().uuid().optional() })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success)
      throw new ApiProblemError({
        status: 422,
        code: 'VALIDATION_FAILED',
        title: 'Invalid cursor',
        detail: 'Seznam příjemců načtěte znovu.',
      });
    const rows = await dependencies.db
      .select({
        userId: schema.users.id,
        displayName: schema.users.name,
        email: schema.users.email,
        emailVerified: schema.users.emailVerified,
        roles: sql<string[]>`array(
        select distinct ${schema.eventRoles.role}::text from ${schema.eventRoles}
        where ${schema.eventRoles.eventId} = ${eventId}
          and ${schema.eventRoles.userId} = ${schema.users.id}
          and ${schema.eventRoles.revokedAt} is null
      )`,
        lastSentAt: sql<string | Date | null>`(
        select max(${schema.auditLogs.createdAt}) from ${schema.auditLogs}
        where ${schema.auditLogs.eventId} = ${eventId}
          and ${schema.auditLogs.targetId} = ${schema.users.id}::text
          and ${schema.auditLogs.action} in ('participant.invitation_sent', 'team.invitation_sent')
      )`,
        participantReady: sql<boolean>`exists (
        select 1 from ${schema.participantProfiles}
        where ${schema.participantProfiles.eventId} = ${eventId}
          and ${schema.participantProfiles.userId} = ${schema.users.id}
          and (exists (
            select 1 from ${schema.tickets}
            where ${schema.tickets.eventId} = ${eventId}
              and ${schema.tickets.holderUserId} = ${schema.users.id}
              and ${schema.tickets.status} = 'activated'
          ) or exists (
            select 1 from ${schema.ticketSourceParticipants}
            where ${schema.ticketSourceParticipants.eventId} = ${eventId}
              and ${schema.ticketSourceParticipants.userId} = ${schema.users.id}
              and ${schema.ticketSourceParticipants.sourceStatus} = 'paid'
          ))
      )`,
      })
      .from(schema.eventMemberships)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.eventMemberships.userId),
      )
      .where(
        and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.status, 'active'),
          query.data.cursor
            ? gt(schema.users.id, query.data.cursor)
            : undefined,
        ),
      )
      .orderBy(asc(schema.users.id))
      .limit(201);
    const items = rows
      .slice(0, 200)
      .flatMap((row): AdminInvitationRecipient[] => {
        const roles = row.roles.flatMap((role) => {
          const parsed = adminInvitationRoleSchema.safeParse(role);
          return parsed.success ? [parsed.data] : [];
        });
        if (roles.length === 0) return [];
        const lastSentAt = row.lastSentAt
          ? new Date(row.lastSentAt).toISOString()
          : null;
        return [
          {
            userId: row.userId,
            displayName: row.displayName,
            email: row.email,
            roles,
            invitation: {
              status: row.emailVerified
                ? 'accepted'
                : lastSentAt
                  ? 'sent'
                  : 'not_sent',
              lastSentAt,
            },
            delivery: invitationDelivery(roles, row.participantReady),
          },
        ];
      });
    return Response.json(
      adminInvitationRecipientsSchema.parse({
        eventId,
        items,
        nextCursor: rows.length > 200 ? rows[199]!.userId : null,
      }),
      { headers },
    );
  } catch (error) {
    const response = problemResponse(
      error instanceof EventAccessDeniedError ? denied() : error,
      requestId,
    );
    Object.entries(headers).forEach(([key, value]) =>
      response.headers.set(key, value),
    );
    return response;
  }
}
