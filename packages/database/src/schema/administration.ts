import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventMemberships, events } from './events.js';

export const registrationMode = pgEnum('registration_mode', [
  'open',
  'invite_only',
  'closed',
]);
export const operationalExportState = pgEnum('operational_export_state', [
  'queued',
  'processing',
  'ready',
  'failed',
  'expired',
]);

export const eventOperationalSettings = pgTable(
  'event_operational_settings',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => events.id, { onDelete: 'cascade' }),
    registrationMode: registrationMode('registration_mode')
      .default('invite_only')
      .notNull(),
    reservationChangesAllowed: boolean('reservation_changes_allowed')
      .default(true)
      .notNull(),
    supportMessage: varchar('support_message', { length: 240 })
      .default('V případě potíží kontaktujte organizační tým BYZON.')
      .notNull(),
    version: integer('version').default(1).notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.updatedBy],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'event_operational_settings_updater_event_fk',
    }).onDelete('restrict'),
    check(
      'event_operational_settings_version_check',
      sql`${table.version} > 0`,
    ),
  ],
);

export const eventAdminVersions = pgTable('event_admin_versions', {
  eventId: uuid('event_id')
    .primaryKey()
    .references(() => events.id, { onDelete: 'cascade' }),
  assignmentsVersion: integer('assignments_version').default(1).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const operationalExportRequests = pgTable(
  'operational_export_requests',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    requestedBy: uuid('requested_by').notNull(),
    report: varchar('report', { length: 64 }).notNull(),
    format: varchar('format', { length: 8 }).notNull(),
    rangeFrom: timestamp('range_from', { withTimezone: true }),
    rangeTo: timestamp('range_to', { withTimezone: true }),
    reason: text('reason').notNull(),
    state: operationalExportState('state').default('queued').notNull(),
    objectKey: text('object_key'),
    contentType: varchar('content_type', { length: 80 }),
    content: text('content'),
    checksumSha256: varchar('checksum_sha256', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.requestedBy],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'operational_export_requests_requester_event_fk',
    }).onDelete('restrict'),
    index('operational_export_requests_dispatch_idx').on(
      table.state,
      table.createdAt,
    ),
    index('operational_export_requests_event_idx').on(
      table.eventId,
      table.createdAt,
    ),
    check(
      'operational_export_requests_format_check',
      sql`${table.format} in ('csv', 'json')`,
    ),
    check(
      'operational_export_requests_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'operational_export_requests_range_check',
      sql`${table.rangeFrom} is null or ${table.rangeTo} is null or ${table.rangeTo} >= ${table.rangeFrom}`,
    ),
    check(
      'operational_export_requests_content_check',
      sql`(${table.state} = 'ready' and ${table.contentType} is not null and ${table.content} is not null and ${table.checksumSha256} is not null) or (${table.state} <> 'ready' and ${table.contentType} is null and ${table.content} is null)`,
    ),
  ],
);
