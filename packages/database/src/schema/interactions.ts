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

import { programSessions, speakerProfiles } from './content.js';
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
    uniqueIndex('questions_event_session_id_unique').on(
      table.eventId,
      table.sessionId,
      table.id,
    ),
    index('questions_author_created_idx').on(
      table.eventId,
      table.authorUserId,
      table.createdAt,
      table.id,
    ),
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

export const questionAnswers = pgTable(
  'question_answers',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    sessionId: uuid('session_id').notNull(),
    questionId: uuid('question_id').notNull(),
    speakerProfileId: uuid('speaker_profile_id').notNull(),
    answeredByUserId: uuid('answered_by_user_id').notNull(),
    speakerName: text('speaker_name').notNull(),
    text: text('text').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    version: integer('version').default(1).notNull(),
  },
  (table) => [
    uniqueIndex('question_answers_question_unique').on(table.questionId),
    foreignKey({
      columns: [table.eventId, table.sessionId, table.questionId],
      foreignColumns: [questions.eventId, questions.sessionId, questions.id],
      name: 'question_answers_question_event_session_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.eventId, table.speakerProfileId],
      foreignColumns: [speakerProfiles.eventId, speakerProfiles.id],
      name: 'question_answers_speaker_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.answeredByUserId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'question_answers_membership_fk',
    }).onDelete('restrict'),
    index('question_answers_session_idx').on(table.eventId, table.sessionId),
    check(
      'question_answers_text_length_check',
      sql`char_length(${table.text}) between 1 and 4000`,
    ),
    check(
      'question_answers_speaker_name_check',
      sql`char_length(${table.speakerName}) between 1 and 257`,
    ),
    check('question_answers_version_check', sql`${table.version} > 0`),
    check(
      'question_answers_time_check',
      sql`${table.updatedAt} >= ${table.publishedAt}`,
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
