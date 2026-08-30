import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { programSessions } from './content.js';
import { eventMemberships, events } from './events.js';

export const ratingTargetType = pgEnum('rating_target_type', [
  'session',
  'event',
]);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    authorUserId: uuid('author_user_id').notNull(),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.sessionId],
      foreignColumns: [programSessions.eventId, programSessions.id],
      name: 'questions_session_event_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.eventId, table.authorUserId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'questions_author_membership_fk',
    }).onDelete('cascade'),
    index('questions_session_created_idx').on(
      table.eventId,
      table.sessionId,
      table.createdAt,
      table.id,
    ),
    check(
      'questions_text_length_check',
      sql`char_length(${table.text}) between 1 and 1000`,
    ),
  ],
);

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id'),
    userId: uuid('user_id').notNull(),
    targetType: ratingTargetType('target_type').notNull(),
    score: integer('score').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.userId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'ratings_membership_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.eventId, table.sessionId],
      foreignColumns: [programSessions.eventId, programSessions.id],
      name: 'ratings_session_event_fk',
    }).onDelete('cascade'),
    uniqueIndex('ratings_user_event_unique')
      .on(table.eventId, table.userId, table.targetType)
      .where(sql`${table.targetType} = 'event' and ${table.sessionId} is null`),
    uniqueIndex('ratings_user_session_unique')
      .on(table.eventId, table.sessionId, table.userId, table.targetType)
      .where(
        sql`${table.targetType} = 'session' and ${table.sessionId} is not null`,
      ),
    index('ratings_event_created_idx').on(table.eventId, table.createdAt),
    check('ratings_score_check', sql`${table.score} between 1 and 5`),
    check(
      'ratings_target_consistency_check',
      sql`(${table.targetType} = 'event' and ${table.sessionId} is null) or (${table.targetType} = 'session' and ${table.sessionId} is not null)`,
    ),
    check(
      'ratings_comment_length_check',
      sql`${table.comment} is null or char_length(${table.comment}) between 1 and 2000`,
    ),
  ],
);
