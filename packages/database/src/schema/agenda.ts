import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { programSessions } from './content.js';
import { eventMemberships } from './events.js';

export const reservationStatus = pgEnum('reservation_status', [
  'confirmed',
  'cancelled',
]);

export const waitlistEntryStatus = pgEnum('waitlist_entry_status', [
  'waiting',
  'promoted',
  'cancelled',
]);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    userId: uuid('user_id').notNull(),
    status: reservationStatus('status').default('confirmed').notNull(),
    source: varchar('source', { length: 32 }).notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    unique('reservations_event_id_id_unique').on(table.eventId, table.id),
    foreignKey({
      columns: [table.eventId, table.sessionId],
      foreignColumns: [programSessions.eventId, programSessions.id],
      name: 'reservations_session_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.userId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'reservations_membership_event_fk',
    }).onDelete('restrict'),
    uniqueIndex('reservations_active_user_session_unique')
      .on(table.eventId, table.sessionId, table.userId)
      .where(sql`${table.status} = 'confirmed'`),
    index('reservations_event_session_status_idx').on(
      table.eventId,
      table.sessionId,
      table.status,
    ),
    index('reservations_event_user_status_idx').on(
      table.eventId,
      table.userId,
      table.status,
    ),
    check('reservations_version_check', sql`${table.version} >= 1`),
    check(
      'reservations_source_check',
      sql`${table.source} ~ '^[a-z][a-z0-9_]{0,31}$'`,
    ),
    check(
      'reservations_cancelled_state_check',
      sql`(${table.status} = 'confirmed' and ${table.cancelledAt} is null) or (${table.status} = 'cancelled' and ${table.cancelledAt} is not null)`,
    ),
  ],
);

export const waitlistEntries = pgTable(
  'waitlist_entries',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    userId: uuid('user_id').notNull(),
    status: waitlistEntryStatus('status').default('waiting').notNull(),
    positionSequence: integer('position_sequence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    unique('waitlist_entries_event_id_id_unique').on(table.eventId, table.id),
    foreignKey({
      columns: [table.eventId, table.sessionId],
      foreignColumns: [programSessions.eventId, programSessions.id],
      name: 'waitlist_entries_session_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.userId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'waitlist_entries_membership_event_fk',
    }).onDelete('restrict'),
    uniqueIndex('waitlist_entries_session_position_unique').on(
      table.eventId,
      table.sessionId,
      table.positionSequence,
    ),
    uniqueIndex('waitlist_entries_waiting_user_session_unique')
      .on(table.eventId, table.sessionId, table.userId)
      .where(sql`${table.status} = 'waiting'`),
    index('waitlist_entries_event_session_status_position_idx').on(
      table.eventId,
      table.sessionId,
      table.status,
      table.positionSequence,
    ),
    index('waitlist_entries_event_user_status_idx').on(
      table.eventId,
      table.userId,
      table.status,
    ),
    check(
      'waitlist_entries_position_sequence_check',
      sql`${table.positionSequence} > 0`,
    ),
    check(
      'waitlist_entries_state_check',
      sql`(${table.status} = 'waiting' and ${table.promotedAt} is null and ${table.cancelledAt} is null) or (${table.status} = 'promoted' and ${table.promotedAt} is not null and ${table.cancelledAt} is null) or (${table.status} = 'cancelled' and ${table.promotedAt} is null and ${table.cancelledAt} is not null)`,
    ),
  ],
);
