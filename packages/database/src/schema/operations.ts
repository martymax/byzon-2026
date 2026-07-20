import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { events } from './events.js';

export const outboxStatus = pgEnum('outbox_status', [
  'pending',
  'processing',
  'delivered',
  'failed',
]);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
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
    requestId: uuid('request_id').notNull(),
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
    id: uuid('id').defaultRandom().primaryKey(),
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
    id: uuid('id').defaultRandom().primaryKey(),
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
