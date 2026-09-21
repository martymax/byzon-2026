import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { participantProfiles } from './profiles.js';

/** Evaluation-only bearer credentials. Never accepted by the authentication system. */
export const conferenceFeedbackResponses = pgTable(
  'conference_feedback_responses',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    answers: jsonb('answers')
      .$type<Record<string, string>>()
      .default({})
      .notNull(),
    currentStep: varchar('current_step', { length: 32 })
      .default('intro')
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.eventId, table.userId],
      foreignColumns: [participantProfiles.eventId, participantProfiles.userId],
      name: 'conference_feedback_profile_fk',
    }).onDelete('cascade'),
    uniqueIndex('conference_feedback_event_user_unique').on(
      table.eventId,
      table.userId,
    ),
    uniqueIndex('conference_feedback_token_hash_unique').on(table.tokenHash),
    index('conference_feedback_event_updated_idx').on(
      table.eventId,
      table.updatedAt,
    ),
    check(
      'conference_feedback_token_hash_check',
      sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'conference_feedback_answers_object_check',
      sql`jsonb_typeof(${table.answers}) = 'object'`,
    ),
  ],
);
