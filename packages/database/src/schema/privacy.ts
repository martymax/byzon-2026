import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { events } from './events.js';

export const privacyRequestKind = pgEnum('privacy_request_kind', [
  'data_deletion',
]);
export const privacyRequestStatus = pgEnum('privacy_request_status', [
  'pending',
  'completed',
  'rejected',
]);

export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: privacyRequestKind('kind').notNull(),
    status: privacyRequestStatus('status').default('pending').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    supportReference: varchar('support_reference', { length: 64 }),
  },
  (table) => [
    uniqueIndex('privacy_requests_event_user_kind_unique').on(
      table.eventId,
      table.userId,
      table.kind,
    ),
    index('privacy_requests_event_id_idx').on(table.eventId),
    index('privacy_requests_user_id_idx').on(table.userId),
    check(
      'privacy_requests_resolution_check',
      sql`(${table.status} = 'pending' AND ${table.resolvedAt} IS NULL AND ${table.supportReference} IS NULL) OR (${table.status} = 'completed' AND ${table.resolvedAt} IS NOT NULL AND ${table.supportReference} IS NULL) OR (${table.status} = 'rejected' AND ${table.resolvedAt} IS NOT NULL AND ${table.supportReference} IS NOT NULL)`,
    ),
  ],
);
