import { and, eq, sql } from 'drizzle-orm';
import type { Database, DatabaseTransaction } from './client.js';
import * as schema from './schema/index.js';

export const invitationDelivery = (
  roles: readonly string[],
  participantReady: boolean,
): 'participant' | 'team' | null => {
  if (roles.includes('organizer_admin')) return 'team';
  if (
    participantReady &&
    roles.some((role) => role === 'participant' || role === 'speaker')
  )
    return 'participant';
  return roles.some((role) =>
    ['room_operator', 'moderator', 'checkin_operator'].includes(role),
  )
    ? 'team'
    : null;
};

/** Shared eligibility for listing, enqueueing and revalidation immediately before delivery. */
export const invitationCandidateFields = (eventId: string) => ({
  userId: schema.users.id,
  displayName: schema.users.name,
  email: schema.users.email,
  emailVerified: schema.users.emailVerified,
  roles: sql<
    string[]
  >`array(select distinct role::text from event_roles where event_id = ${eventId} and user_id = ${schema.users.id} and revoked_at is null)`,
  participantReady: sql<boolean>`exists (
    select 1 from participant_profiles p where p.event_id = ${eventId} and p.user_id = ${schema.users.id}
    and (exists (select 1 from tickets t where t.event_id = ${eventId} and t.holder_user_id = ${schema.users.id} and t.status = 'activated')
      or exists (select 1 from ticket_source_participants t where t.event_id = ${eventId} and t.user_id = ${schema.users.id} and t.source_status = 'paid'))
  )`,
});

export const invitationCandidateQuery = (
  db: Database | DatabaseTransaction,
  eventId: string,
) =>
  db
    .select(invitationCandidateFields(eventId))
    .from(schema.eventMemberships)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.eventMemberships.userId),
    );

export const invitationCandidateConditions = (eventId: string) =>
  and(
    eq(schema.eventMemberships.eventId, eventId),
    eq(schema.eventMemberships.status, 'active'),
    sql`not exists (select 1 from privacy_requests p where p.event_id = ${eventId} and p.user_id = ${schema.users.id} and p.status in ('pending', 'completed'))`,
  );
