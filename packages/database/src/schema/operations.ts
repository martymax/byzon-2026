import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { eventMemberships, events } from './events.js';
import { tickets } from './tickets.js';

export const outboxStatus = pgEnum('outbox_status', [
  'pending',
  'processing',
  'delivered',
  'failed',
]);

export const checkinDeviceState = pgEnum('checkin_device_state', [
  'trusted',
  'revoked',
]);

export const checkinStations = pgTable(
  'checkin_stations',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('checkin_stations_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('checkin_stations_event_name_unique').on(
      table.eventId,
      table.name,
    ),
    index('checkin_stations_event_id_idx').on(table.eventId),
  ],
);

export const operatorDevices = pgTable(
  'operator_devices',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    stationId: uuid('station_id').notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    state: checkinDeviceState('state').default('trusted').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('operator_devices_event_id_id_unique').on(table.eventId, table.id),
    foreignKey({
      columns: [table.eventId, table.stationId],
      foreignColumns: [checkinStations.eventId, checkinStations.id],
      name: 'operator_devices_station_event_fk',
    }).onDelete('restrict'),
    index('operator_devices_event_id_idx').on(table.eventId),
    index('operator_devices_station_id_idx').on(table.stationId),
  ],
);

export const checkinLookups = pgTable(
  'checkin_lookups',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    operatorUserId: uuid('operator_user_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    outcome: varchar('outcome', { length: 32 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.ticketId],
      foreignColumns: [tickets.eventId, tickets.id],
      name: 'checkin_lookups_ticket_event_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.eventId, table.operatorUserId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'checkin_lookups_operator_event_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.eventId, table.deviceId],
      foreignColumns: [operatorDevices.eventId, operatorDevices.id],
      name: 'checkin_lookups_device_event_fk',
    }).onDelete('cascade'),
    index('checkin_lookups_event_id_idx').on(table.eventId),
    index('checkin_lookups_expiry_idx').on(table.expiresAt),
    check(
      'checkin_lookups_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const checkIns = pgTable(
  'check_ins',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    holderUserId: uuid('holder_user_id').notNull(),
    stationId: uuid('station_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    checkedInBy: uuid('checked_in_by').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    undoneBy: uuid('undone_by'),
    undoReason: text('undo_reason'),
  },
  (table) => [
    unique('check_ins_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('check_ins_active_ticket_unique')
      .on(table.eventId, table.ticketId)
      .where(sql`${table.undoneAt} is null`),
    foreignKey({
      columns: [table.eventId, table.ticketId],
      foreignColumns: [tickets.eventId, tickets.id],
      name: 'check_ins_ticket_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.holderUserId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'check_ins_holder_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.stationId],
      foreignColumns: [checkinStations.eventId, checkinStations.id],
      name: 'check_ins_station_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.deviceId],
      foreignColumns: [operatorDevices.eventId, operatorDevices.id],
      name: 'check_ins_device_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.checkedInBy],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'check_ins_operator_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.undoneBy],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'check_ins_undo_operator_event_fk',
    }).onDelete('restrict'),
    index('check_ins_event_occurred_idx').on(table.eventId, table.occurredAt),
    index('check_ins_holder_idx').on(table.eventId, table.holderUserId),
    check(
      'check_ins_undo_consistency_check',
      sql`(${table.undoneAt} is null and ${table.undoneBy} is null and ${table.undoReason} is null) or (${table.undoneAt} is not null and ${table.undoneBy} is not null and char_length(${table.undoReason}) between 8 and 240)`,
    ),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorType: varchar('actor_type', { length: 32 }).notNull(),
    action: varchar('action', { length: 128 }).notNull(),
    targetType: varchar('target_type', { length: 128 }).notNull(),
    targetId: text('target_id'),
    requestId: varchar('request_id', { length: 128 }).notNull(),
    reason: text('reason'),
    before: jsonb('before_json').$type<Record<string, unknown>>(),
    after: jsonb('after_json').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('audit_logs_event_id_created_at_idx').on(
      table.eventId,
      table.createdAt,
    ),
    index('audit_logs_actor_id_idx').on(table.actorId),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    type: varchar('type', { length: 128 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 128 }).notNull(),
    aggregateId: text('aggregate_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    deduplicationKey: text('deduplication_key').notNull(),
    status: outboxStatus('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('outbox_events_event_dedup_unique').on(
      table.eventId,
      table.deduplicationKey,
    ),
    index('outbox_events_dispatch_idx').on(table.status, table.availableAt),
    index('outbox_events_event_id_idx').on(table.eventId),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    scope: varchar('scope', { length: 128 }).notNull(),
    key: text('key').notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<Record<string, unknown>>(),
    resultReference: text('result_reference'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('idempotency_keys_actor_scope_key_unique').on(
      table.eventId,
      sql`coalesce(${table.actorId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.scope,
      table.key,
    ),
    index('idempotency_keys_event_id_idx').on(table.eventId),
    index('idempotency_keys_expires_at_idx').on(table.expiresAt),
  ],
);
