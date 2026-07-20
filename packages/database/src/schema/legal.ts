import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
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
import { events } from './events.js';

export const legalDocumentType = pgEnum('legal_document_type', [
  'terms',
  'privacy_notice',
  'networking_consent',
  'other',
]);
export const consentDecision = pgEnum('consent_decision', [
  'accepted',
  'withdrawn',
  'acknowledged',
]);

export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    type: legalDocumentType('type').notNull(),
    version: varchar('version', { length: 64 }).notNull(),
    title: text('title').notNull(),
    contentUrl: text('content_url'),
    content: text('content'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    isCurrent: boolean('is_current').default(false).notNull(),
  },
  (table) => [
    uniqueIndex('legal_documents_version_unique').on(
      table.eventId,
      table.type,
      table.version,
    ),
    unique('legal_documents_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('legal_documents_current_unique')
      .on(table.eventId, table.type)
      .where(sql`${table.isCurrent} = true`),
    index('legal_documents_event_id_idx').on(table.eventId),
  ],
);

export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    legalDocumentId: uuid('legal_document_id').notNull(),
    decision: consentDecision('decision').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    source: varchar('source', { length: 64 }).notNull(),
    requestId: uuid('request_id').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.legalDocumentId],
      foreignColumns: [legalDocuments.eventId, legalDocuments.id],
      name: 'consent_records_legal_document_event_fk',
    }).onDelete('restrict'),
    index('consent_records_event_id_idx').on(table.eventId),
    index('consent_records_user_id_idx').on(table.userId),
  ],
);
