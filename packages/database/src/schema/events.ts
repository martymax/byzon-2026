import { sql } from 'drizzle-orm';
import {
  check,
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';

export const eventStatus = pgEnum('event_status', [
  'draft',
  'activation_open',
  'live',
  'ended',
  'archived',
]);
export const membershipStatus = pgEnum('membership_status', [
  'active',
  'suspended',
  'revoked',
]);
export const eventRole = pgEnum('event_role', [
  'participant',
  'speaker',
  'organizer_admin',
  'checkin_operator',
  'moderator',
  'room_operator',
  'system_worker',
]);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey(),
    slug: varchar('slug', { length: 128 }).notNull(),
    name: text('name').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    status: eventStatus('status').default('draft').notNull(),
    activationOpensAt: timestamp('activation_opens_at', { withTimezone: true }),
    networkingDeletesAt: timestamp('networking_deletes_at', {
      withTimezone: true,
    }),
    operationalDataAnonymizesAt: timestamp('operational_data_anonymizes_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('events_slug_unique').on(table.slug),
    check('events_time_range_check', sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const eventFeatures = pgTable('event_features', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => events.id, { onDelete: 'cascade' }),
  networkingEnabled: boolean('networking_enabled').default(false).notNull(),
  announcementsEnabled: boolean('announcements_enabled')
    .default(false)
    .notNull(),
  speakerPortalEnabled: boolean('speaker_portal_enabled')
    .default(false)
    .notNull(),
  questionsEnabled: boolean('questions_enabled').default(false).notNull(),
  pollsEnabled: boolean('polls_enabled').default(false).notNull(),
  ratingsEnabled: boolean('ratings_enabled').default(false).notNull(),
  socialWallEnabled: boolean('social_wall_enabled').default(false).notNull(),
  offlineCheckinEnabled: boolean('offline_checkin_enabled')
    .default(false)
    .notNull(),
  publicContentSyncEnabled: boolean('public_content_sync_enabled')
    .default(false)
    .notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const eventMemberships = pgTable(
  'event_memberships',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: membershipStatus('status').default('active').notNull(),
    offlineRevocationEpoch: uuid('offline_revocation_epoch')
      .defaultRandom()
      .notNull(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revocationReason: text('revocation_reason'),
  },
  (table) => [
    primaryKey({
      columns: [table.eventId, table.userId],
      name: 'event_memberships_pk',
    }),
    index('event_memberships_event_id_idx').on(table.eventId),
    index('event_memberships_user_id_idx').on(table.userId),
  ],
);

export const eventRoles = pgTable(
  'event_roles',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: eventRole('role').notNull(),
    scope: jsonb('scope_json')
      .$type<{
        roomIds?: string[];
        sessionIds?: string[];
        stationIds?: string[];
      }>()
      .default({})
      .notNull(),
    grantedBy: uuid('granted_by').references(() => users.id, {
      onDelete: 'restrict',
    }),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('event_roles_event_id_idx').on(table.eventId),
    index('event_roles_user_id_idx').on(table.userId),
    uniqueIndex('event_roles_active_unique')
      .on(table.eventId, table.userId, table.role)
      .where(sql`${table.revokedAt} is null`),
  ],
);
