import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { events } from './events.js';
import { users } from './auth.js';

export const invitationBatches = pgTable(
  'invitation_batches',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('invitation_batches_event_idx').on(t.eventId, t.createdAt)],
);

/** Durable jobs contain no bearer links or recipient addresses. */
export const invitationDeliveries = pgTable(
  'invitation_deliveries',
  {
    id: uuid('id').primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => invitationBatches.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    delivery: varchar('delivery', { length: 16 })
      .$type<'participant' | 'team'>()
      .notNull(),
    status: varchar('status', { length: 16 })
      .$type<'pending' | 'processing' | 'delivered' | 'failed' | 'skipped'>()
      .default('pending')
      .notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    leaseToken: uuid('lease_token'),
    preparedAt: timestamp('prepared_at', { withTimezone: true }),
    recipientHash: varchar('recipient_hash', { length: 64 }),
    tokenHash: varchar('token_hash', { length: 64 }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    lastError: varchar('last_error', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('invitation_deliveries_dispatch_idx').on(t.status, t.availableAt),
    index('invitation_deliveries_batch_idx').on(t.batchId),
    uniqueIndex('invitation_deliveries_active_user_unique')
      .on(t.eventId, t.userId)
      .where(sql`${t.status} in ('pending', 'processing')`),
    check(
      'invitation_deliveries_status_check',
      sql`${t.status} in ('pending', 'processing', 'delivered', 'failed', 'skipped')`,
    ),
    check(
      'invitation_deliveries_delivery_check',
      sql`${t.delivery} in ('participant', 'team')`,
    ),
    check('invitation_deliveries_attempts_check', sql`${t.attempts} >= 0`),
  ],
);
