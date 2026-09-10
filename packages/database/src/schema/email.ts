import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { participantProfiles } from './profiles.js';
import { outboxStatus } from './operations.js';

/** Cascade with the private profile, including frozen recipient/content used for retries. */
export const emailDeliveries = pgTable(
  'email_deliveries',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    deduplicationKey: varchar('deduplication_key', { length: 256 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: outboxStatus('status').default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    leaseToken: uuid('lease_token'),
    rendered: jsonb('rendered').$type<{
      to: string;
      subject: string;
      html: string;
      text: string;
    }>(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastError: varchar('last_error', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.eventId, t.userId],
      foreignColumns: [participantProfiles.eventId, participantProfiles.userId],
      name: 'email_deliveries_profile_fk',
    }).onDelete('cascade'),
    uniqueIndex('email_deliveries_dedup_unique').on(
      t.eventId,
      t.userId,
      t.deduplicationKey,
    ),
    index('email_deliveries_dispatch_idx').on(t.status, t.availableAt),
    check('email_deliveries_attempts_check', sql`${t.attempts} >= 0`),
    check(
      'email_deliveries_expiry_check',
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
  ],
);
