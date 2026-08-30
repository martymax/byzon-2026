import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
  text,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { users } from './auth.js';
import { events } from './events.js';

export const networkingFieldVisibility = pgEnum('networking_field_visibility', [
  'hidden',
  'directory',
]);
export const networkingModerationStatus = pgEnum(
  'networking_moderation_status',
  ['visible', 'hidden'],
);
export const todayHuntingValue = pgEnum('today_hunting_value', [
  'know_how',
  'team',
  'investors',
  'business_partners',
  'suppliers',
  'clients',
]);

export const participantProfiles = pgTable(
  'participant_profiles',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    firstName: varchar('first_name', { length: 128 }).notNull(),
    lastName: varchar('last_name', { length: 128 }).notNull(),
    company: varchar('company', { length: 160 }),
    jobTitle: varchar('job_title', { length: 160 }),
    bio: text('bio'),
    linkedinUrl: varchar('linkedin_url', { length: 2_048 }),
    todayHunting: todayHuntingValue('today_hunting')
      .array()
      .default([])
      .notNull(),
    contactEmail: varchar('contact_email', { length: 320 }).notNull(),
    phone: varchar('phone', { length: 16 }),
    version: integer('version').default(1).notNull(),
    networkingEnabled: boolean('networking_enabled'),
    moderationStatus: networkingModerationStatus('moderation_status')
      .default('visible')
      .notNull(),
    phoneVisibility: networkingFieldVisibility('phone_visibility')
      .default('hidden')
      .notNull(),
    emailVisibility: networkingFieldVisibility('email_visibility')
      .default('hidden')
      .notNull(),
    linkedinVisibility: networkingFieldVisibility('linkedin_visibility')
      .default('hidden')
      .notNull(),
    networkingAnonymizedAt: timestamp('networking_anonymized_at', {
      withTimezone: true,
    }),
    onboardingCompletedAt: timestamp('onboarding_completed_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.eventId, table.userId],
      name: 'participant_profiles_pk',
    }),
    index('participant_profiles_event_id_idx').on(table.eventId),
    index('participant_profiles_user_id_idx').on(table.userId),
    check('participant_profiles_version_check', sql`${table.version} >= 1`),
  ],
);
