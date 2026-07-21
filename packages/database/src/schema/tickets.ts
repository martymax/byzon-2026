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

export const ticketImportBatchStatus = pgEnum('ticket_import_batch_status', [
  'uploaded',
  'validated',
  'awaiting_confirmation',
  'applying',
  'applied',
  'failed',
]);

export const ticketStatus = pgEnum('ticket_status', [
  'valid',
  'activated',
  'cancelled',
  'refunded',
  'transferred',
  'blocked',
]);

export const ticketImportBatches = pgTable(
  'ticket_import_batches',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    source: varchar('source', { length: 64 }).notNull(),
    sourceFilename: text('source_filename').notNull(),
    fileSha256: varchar('file_sha256', { length: 64 }).notNull(),
    status: ticketImportBatchStatus('status').default('uploaded').notNull(),
    rowCount: integer('row_count').default(0).notNull(),
    summary: jsonb('summary_json')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    mapping: jsonb('mapping_json')
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    createdBy: uuid('created_by').notNull(),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('ticket_import_batches_event_file_unique').on(
      table.eventId,
      table.fileSha256,
    ),
    unique('ticket_import_batches_event_id_id_unique').on(
      table.eventId,
      table.id,
    ),
    index('ticket_import_batches_event_id_idx').on(table.eventId),
    foreignKey({
      columns: [table.eventId, table.createdBy],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'ticket_import_batches_creator_membership_event_fk',
    }).onDelete('restrict'),
    check(
      'ticket_import_batches_sha256_check',
      sql`${table.fileSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check('ticket_import_batches_row_count_check', sql`${table.rowCount} >= 0`),
  ],
);

export const ticketImportRows = pgTable(
  'ticket_import_rows',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    rowNumber: integer('row_number').notNull(),
    externalId: text('external_id'),
    orderExternalId: text('order_external_id'),
    codeHmac: varchar('code_hmac', { length: 64 }),
    codeSuffix: varchar('code_suffix', { length: 16 }),
    sourceStatus: text('source_status'),
    mappedStatus: ticketStatus('mapped_status'),
    validationErrors: jsonb('validation_errors_json')
      .$type<string[]>()
      .default([])
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('ticket_import_rows_batch_row_unique').on(
      table.batchId,
      table.rowNumber,
    ),
    index('ticket_import_rows_event_id_idx').on(table.eventId),
    index('ticket_import_rows_batch_id_idx').on(table.batchId),
    foreignKey({
      columns: [table.eventId, table.batchId],
      foreignColumns: [ticketImportBatches.eventId, ticketImportBatches.id],
      name: 'ticket_import_rows_batch_event_fk',
    }).onDelete('cascade'),
    check('ticket_import_rows_row_number_check', sql`${table.rowNumber} > 0`),
    check(
      'ticket_import_rows_code_hmac_check',
      sql`${table.codeHmac} is null or ${table.codeHmac} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    externalId: text('external_id'),
    orderExternalId: text('order_external_id'),
    codeHmac: varchar('code_hmac', { length: 64 }).notNull(),
    codeSuffix: varchar('code_suffix', { length: 16 }).notNull(),
    status: ticketStatus('status').default('valid').notNull(),
    holderUserId: uuid('holder_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    transferredFromTicketId: uuid('transferred_from_ticket_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('tickets_event_code_hmac_unique').on(
      table.eventId,
      table.codeHmac,
    ),
    uniqueIndex('tickets_event_external_id_unique')
      .on(table.eventId, table.externalId)
      .where(sql`${table.externalId} is not null`),
    unique('tickets_event_id_id_unique').on(table.eventId, table.id),
    index('tickets_event_id_idx').on(table.eventId),
    index('tickets_event_status_idx').on(table.eventId, table.status),
    index('tickets_event_holder_idx').on(table.eventId, table.holderUserId),
    index('tickets_event_order_idx').on(table.eventId, table.orderExternalId),
    foreignKey({
      columns: [table.eventId, table.holderUserId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'tickets_holder_membership_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.transferredFromTicketId],
      foreignColumns: [table.eventId, table.id],
      name: 'tickets_transfer_source_event_fk',
    }).onDelete('restrict'),
    check('tickets_code_hmac_check', sql`${table.codeHmac} ~ '^[0-9a-f]{64}$'`),
    check(
      'tickets_claim_state_check',
      sql`(${table.status} = 'activated' and ${table.holderUserId} is not null and ${table.claimedAt} is not null) or ${table.status} <> 'activated'`,
    ),
  ],
);

export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    importBatchId: uuid('import_batch_id'),
    actorType: varchar('actor_type', { length: 32 }).notNull(),
    actorId: uuid('actor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    fromStatus: ticketStatus('from_status'),
    toStatus: ticketStatus('to_status').notNull(),
    reason: text('reason'),
    requestId: uuid('request_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('ticket_events_event_id_idx').on(table.eventId),
    index('ticket_events_ticket_occurred_idx').on(
      table.ticketId,
      table.occurredAt,
    ),
    foreignKey({
      columns: [table.eventId, table.ticketId],
      foreignColumns: [tickets.eventId, tickets.id],
      name: 'ticket_events_ticket_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.importBatchId],
      foreignColumns: [ticketImportBatches.eventId, ticketImportBatches.id],
      name: 'ticket_events_import_batch_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.actorId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'ticket_events_actor_membership_event_fk',
    }).onDelete('restrict'),
  ],
);

export const ticketClaimAttempts = pgTable(
  'ticket_claim_attempts',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    codeBucketHmac: varchar('code_bucket_hmac', { length: 64 }).notNull(),
    codeSuffix: varchar('code_suffix', { length: 16 }),
    result: varchar('result', { length: 32 }).notNull(),
    actorHash: varchar('actor_hash', { length: 64 }),
    ipHash: varchar('ip_hash', { length: 64 }).notNull(),
    userAgentHash: varchar('user_agent_hash', { length: 64 }).notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ticket_claim_attempts_event_id_idx').on(table.eventId),
    index('ticket_claim_attempts_expiry_idx').on(table.expiresAt),
    index('ticket_claim_attempts_event_bucket_idx').on(
      table.eventId,
      table.codeBucketHmac,
      table.attemptedAt,
    ),
    check(
      'ticket_claim_attempts_hashes_check',
      sql`${table.codeBucketHmac} ~ '^[0-9a-f]{64}$' and (${table.actorHash} is null or ${table.actorHash} ~ '^[0-9a-f]{64}$') and ${table.ipHash} ~ '^[0-9a-f]{64}$' and ${table.userAgentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'ticket_claim_attempts_expiry_check',
      sql`${table.expiresAt} > ${table.attemptedAt}`,
    ),
  ],
);
