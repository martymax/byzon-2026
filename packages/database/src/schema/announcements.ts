import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { programSessions } from './content.js';
import { eventMemberships, events } from './events.js';

export const announcementAudienceKind = pgEnum('announcement_audience_kind', [
  'event',
  'session',
]);

export const announcementPreviews = pgTable(
  'announcement_previews',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    version: integer('version').default(1).notNull(),
    draft: jsonb('draft_json').$type<Record<string, unknown>>().notNull(),
    recipientUserIds: jsonb('recipient_user_ids_json')
      .$type<string[]>()
      .notNull(),
    recipientCount: integer('recipient_count').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    sentAnnouncementId: uuid('sent_announcement_id'),
  },
  (table) => [
    unique('announcement_previews_event_id_id_unique').on(
      table.eventId,
      table.id,
    ),
    foreignKey({
      columns: [table.eventId, table.createdBy],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'announcement_previews_creator_event_fk',
    }).onDelete('restrict'),
    index('announcement_previews_event_created_idx').on(
      table.eventId,
      table.createdAt,
    ),
    check('announcement_previews_version_check', sql`${table.version} > 0`),
    check(
      'announcement_previews_count_check',
      sql`${table.recipientCount} >= 0`,
    ),
    check(
      'announcement_previews_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'announcement_previews_recipients_array_check',
      sql`jsonb_typeof(${table.recipientUserIds}) = 'array'`,
    ),
  ],
);

export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    previewId: uuid('preview_id').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    summary: varchar('summary', { length: 512 }).notNull(),
    bodyText: text('body_text').notNull(),
    severity: varchar('severity', { length: 16 }).default('critical').notNull(),
    audienceKind: announcementAudienceKind('audience_kind').notNull(),
    sessionId: uuid('session_id'),
    sessionTitle: varchar('session_title', { length: 512 }),
    createdBy: uuid('created_by').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('announcements_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('announcements_event_preview_unique').on(
      table.eventId,
      table.previewId,
    ),
    foreignKey({
      columns: [table.eventId, table.previewId],
      foreignColumns: [announcementPreviews.eventId, announcementPreviews.id],
      name: 'announcements_preview_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.sessionId],
      foreignColumns: [programSessions.eventId, programSessions.id],
      name: 'announcements_session_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.createdBy],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'announcements_creator_event_fk',
    }).onDelete('restrict'),
    index('announcements_event_published_idx').on(
      table.eventId,
      table.publishedAt,
    ),
    check('announcements_severity_check', sql`${table.severity} = 'critical'`),
    check(
      'announcements_audience_session_check',
      sql`(${table.audienceKind} = 'event' and ${table.sessionId} is null and ${table.sessionTitle} is null) or (${table.audienceKind} = 'session' and ${table.sessionId} is not null and ${table.sessionTitle} is not null)`,
    ),
  ],
);

export const announcementRecipients = pgTable(
  'announcement_recipients',
  {
    eventId: uuid('event_id').notNull(),
    announcementId: uuid('announcement_id').notNull(),
    userId: uuid('user_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.eventId, table.announcementId, table.userId],
      name: 'announcement_recipients_pk',
    }),
    foreignKey({
      columns: [table.eventId, table.announcementId],
      foreignColumns: [announcements.eventId, announcements.id],
      name: 'announcement_recipients_announcement_event_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.eventId, table.userId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'announcement_recipients_membership_event_fk',
    }).onDelete('cascade'),
    index('announcement_recipients_user_unread_idx').on(
      table.eventId,
      table.userId,
      table.readAt,
    ),
  ],
);
