import {
  boolean,
  index,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { users } from './auth.js';
import { events } from './events.js';

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
    contactEmail: varchar('contact_email', { length: 320 }).notNull(),
    phone: varchar('phone', { length: 16 }),
    networkingEnabled: boolean('networking_enabled'),
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
  ],
);
