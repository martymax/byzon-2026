import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
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

import { eventMemberships, events } from './events.js';

export const contentStatus = pgEnum('content_status', [
  'draft',
  'published',
  'archived',
]);
export const assetStatus = pgEnum('asset_status', [
  'uploading',
  'quarantined',
  'ready',
  'rejected',
  'deleted',
]);
export const sessionType = pgEnum('session_type', [
  'talk',
  'panel',
  'workshop',
  'mastermind',
  'coaching',
  'networking',
  'break',
  'meal',
  'gala',
  'other',
]);
export const sessionStatus = pgEnum('session_status', [
  'draft',
  'published',
  'cancelled',
  'archived',
]);
export const capacityMode = pgEnum('capacity_mode', [
  'none',
  'reservation',
  'registration_estimate',
]);
export const waitlistMode = pgEnum('waitlist_mode', [
  'disabled',
  'auto_confirm',
  'offer_with_deadline',
]);
export const contentPageKind = pgEnum('content_page_kind', [
  'practical',
  'marketing',
  'other',
]);
export const publicationSyncStatus = pgEnum('publication_sync_status', [
  'sync_pending',
  'syncing',
  'synced',
  'sync_failed',
]);

export const contentImportProvenance = pgTable(
  'content_import_provenance',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    sourceName: varchar('source_name', { length: 255 }).notNull(),
    sourcePath: text('source_path').notNull(),
    sourceSha256: varchar('source_sha256', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 64 }).notNull(),
    targetId: uuid('target_id').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('content_import_provenance_event_source_unique').on(
      table.eventId,
      table.sourceName,
      table.sourcePath,
      table.targetType,
    ),
    index('content_import_provenance_event_target_idx').on(
      table.eventId,
      table.targetType,
      table.targetId,
    ),
    check(
      'content_import_provenance_source_sha256_check',
      sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'content_import_provenance_target_type_check',
      sql`${table.targetType} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    ownerUserId: uuid('owner_user_id'),
    bucketKey: text('bucket_key').notNull(),
    purpose: varchar('purpose', { length: 64 }).notNull(),
    originalFilename: text('original_filename').notNull(),
    declaredMimeType: varchar('declared_mime_type', { length: 255 }),
    sniffedMimeType: varchar('sniffed_mime_type', { length: 255 }),
    sizeBytes: integer('size_bytes'),
    checksumSha256: varchar('checksum_sha256', { length: 64 }),
    status: assetStatus('status').default('uploading').notNull(),
    isPublic: boolean('is_public').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    unique('assets_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('assets_bucket_key_unique').on(table.bucketKey),
    foreignKey({
      columns: [table.eventId, table.ownerUserId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'assets_owner_membership_event_fk',
    }).onDelete('restrict'),
    index('assets_event_id_idx').on(table.eventId),
    index('assets_owner_user_id_idx').on(table.ownerUserId),
    index('assets_event_status_idx').on(table.eventId, table.status),
    check(
      'assets_size_bytes_check',
      sql`${table.sizeBytes} is null or ${table.sizeBytes} > 0`,
    ),
    check(
      'assets_checksum_sha256_check',
      sql`${table.checksumSha256} is null or ${table.checksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'assets_ready_metadata_check',
      sql`${table.status} <> 'ready' or (${table.sniffedMimeType} is not null and ${table.sizeBytes} is not null and ${table.checksumSha256} is not null)`,
    ),
    check(
      'assets_public_ready_check',
      sql`${table.isPublic} = false or ${table.status} = 'ready'`,
    ),
  ],
);

export const eventDays = pgTable(
  'event_days',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    localDate: date('local_date', { mode: 'string' }).notNull(),
    title: text('title').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('event_days_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('event_days_event_date_unique').on(
      table.eventId,
      table.localDate,
    ),
    uniqueIndex('event_days_event_sort_order_unique').on(
      table.eventId,
      table.sortOrder,
    ),
    index('event_days_event_id_idx').on(table.eventId),
    check('event_days_sort_order_check', sql`${table.sortOrder} >= 0`),
  ],
);

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 128 }).notNull(),
    name: text('name').notNull(),
    addressLine1: text('address_line_1'),
    addressLine2: text('address_line_2'),
    city: text('city'),
    postalCode: varchar('postal_code', { length: 32 }),
    countryCode: varchar('country_code', { length: 2 }),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    mapQuery: text('map_query'),
    navigationMarkdown: text('navigation_markdown'),
    accessibilityMarkdown: text('accessibility_markdown'),
    heroAssetId: uuid('hero_asset_id'),
    isAvailable: boolean('is_available').default(true).notNull(),
    status: contentStatus('status').default('draft').notNull(),
    sortOrder: integer('sort_order').notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('venues_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('venues_event_slug_unique').on(table.eventId, table.slug),
    foreignKey({
      columns: [table.eventId, table.heroAssetId],
      foreignColumns: [assets.eventId, assets.id],
      name: 'venues_hero_asset_event_fk',
    }).onDelete('restrict'),
    index('venues_event_id_idx').on(table.eventId),
    check('venues_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('venues_version_check', sql`${table.version} > 0`),
    check(
      'venues_latitude_check',
      sql`${table.latitude} is null or ${table.latitude} between -90 and 90`,
    ),
    check(
      'venues_longitude_check',
      sql`${table.longitude} is null or ${table.longitude} between -180 and 180`,
    ),
  ],
);

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    venueId: uuid('venue_id').notNull(),
    slug: varchar('slug', { length: 128 }).notNull(),
    name: text('name').notNull(),
    description: text('description'),
    capacity: integer('capacity'),
    isAvailable: boolean('is_available').default(true).notNull(),
    status: contentStatus('status').default('draft').notNull(),
    sortOrder: integer('sort_order').notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('rooms_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('rooms_event_slug_unique').on(table.eventId, table.slug),
    foreignKey({
      columns: [table.eventId, table.venueId],
      foreignColumns: [venues.eventId, venues.id],
      name: 'rooms_venue_event_fk',
    }).onDelete('restrict'),
    index('rooms_event_id_idx').on(table.eventId),
    index('rooms_event_venue_idx').on(table.eventId, table.venueId),
    check(
      'rooms_capacity_check',
      sql`${table.capacity} is null or ${table.capacity} > 0`,
    ),
    check('rooms_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('rooms_version_check', sql`${table.version} > 0`),
  ],
);

export const programSessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    dayId: uuid('day_id').notNull(),
    roomId: uuid('room_id'),
    slug: varchar('slug', { length: 128 }).notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    description: text('description'),
    type: sessionType('type').default('other').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: sessionStatus('status').default('draft').notNull(),
    reservationGroupId: uuid('reservation_group_id'),
    capacityMode: capacityMode('capacity_mode').default('none').notNull(),
    capacity: integer('capacity'),
    reservationOpensAt: timestamp('reservation_opens_at', {
      withTimezone: true,
    }),
    reservationClosesAt: timestamp('reservation_closes_at', {
      withTimezone: true,
    }),
    waitlistMode: waitlistMode('waitlist_mode').default('disabled').notNull(),
    waitlistOfferTtlMinutes: integer('waitlist_offer_ttl_minutes'),
    allowReleaseAfterDeadline: boolean('allow_release_after_deadline')
      .default(false)
      .notNull(),
    questionsEnabled: boolean('questions_enabled').default(false).notNull(),
    sortOrder: integer('sort_order').notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('sessions_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('sessions_event_slug_unique').on(table.eventId, table.slug),
    foreignKey({
      columns: [table.eventId, table.dayId],
      foreignColumns: [eventDays.eventId, eventDays.id],
      name: 'sessions_day_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.roomId],
      foreignColumns: [rooms.eventId, rooms.id],
      name: 'sessions_room_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.reservationGroupId],
      foreignColumns: [table.eventId, table.id],
      name: 'sessions_reservation_group_event_fk',
    }).onDelete('restrict'),
    index('sessions_event_id_idx').on(table.eventId),
    index('sessions_event_day_time_idx').on(
      table.eventId,
      table.dayId,
      table.startsAt,
    ),
    index('sessions_event_room_time_idx').on(
      table.eventId,
      table.roomId,
      table.startsAt,
    ),
    index('sessions_event_reservation_group_idx').on(
      table.eventId,
      table.reservationGroupId,
    ),
    check(
      'sessions_time_range_check',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    check('sessions_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('sessions_version_check', sql`${table.version} > 0`),
    check(
      'sessions_capacity_policy_check',
      sql`(${table.capacityMode} = 'none' and ${table.capacity} is null) or (${table.capacityMode} <> 'none' and ${table.capacity} is not null and ${table.capacity} > 0)`,
    ),
    check(
      'sessions_reservation_group_policy_check',
      sql`${table.reservationGroupId} is null or ${table.capacityMode} = 'reservation'`,
    ),
    check(
      'sessions_reservation_window_check',
      sql`${table.reservationOpensAt} is null or ${table.reservationClosesAt} is null or ${table.reservationClosesAt} > ${table.reservationOpensAt}`,
    ),
    check(
      'sessions_waitlist_capacity_mode_check',
      sql`${table.waitlistMode} = 'disabled' or ${table.capacityMode} = 'reservation'`,
    ),
    check(
      'sessions_waitlist_ttl_check',
      sql`(${table.waitlistMode} = 'offer_with_deadline' and ${table.waitlistOfferTtlMinutes} is not null and ${table.waitlistOfferTtlMinutes} > 0) or (${table.waitlistMode} <> 'offer_with_deadline' and ${table.waitlistOfferTtlMinutes} is null)`,
    ),
  ],
);

export const speakerProfiles = pgTable(
  'speaker_profiles',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),
    slug: varchar('slug', { length: 128 }).notNull(),
    firstName: varchar('first_name', { length: 128 }).notNull(),
    lastName: varchar('last_name', { length: 128 }).notNull(),
    company: text('company'),
    jobTitle: text('job_title'),
    bioMarkdown: text('bio_markdown'),
    linkedinUrl: text('linkedin_url'),
    instagramUrl: text('instagram_url'),
    facebookUrl: text('facebook_url'),
    websiteUrl: text('website_url'),
    photoAssetId: uuid('photo_asset_id'),
    status: contentStatus('status').default('draft').notNull(),
    sortOrder: integer('sort_order').notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('speaker_profiles_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('speaker_profiles_event_slug_unique').on(
      table.eventId,
      table.slug,
    ),
    uniqueIndex('speaker_profiles_event_user_unique').on(
      table.eventId,
      table.userId,
    ),
    foreignKey({
      columns: [table.eventId, table.photoAssetId],
      foreignColumns: [assets.eventId, assets.id],
      name: 'speaker_profiles_photo_asset_event_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.eventId, table.userId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'speaker_profiles_membership_event_fk',
    }).onDelete('restrict'),
    index('speaker_profiles_event_id_idx').on(table.eventId),
    index('speaker_profiles_user_id_idx').on(table.userId),
    check('speaker_profiles_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('speaker_profiles_version_check', sql`${table.version} > 0`),
  ],
);

export const sessionSpeakers = pgTable(
  'session_speakers',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    speakerProfileId: uuid('speaker_profile_id').notNull(),
    sortOrder: integer('sort_order').notNull(),
    role: varchar('role', { length: 128 }),
  },
  (table) => [
    primaryKey({
      columns: [table.eventId, table.sessionId, table.speakerProfileId],
      name: 'session_speakers_pk',
    }),
    foreignKey({
      columns: [table.eventId, table.sessionId],
      foreignColumns: [programSessions.eventId, programSessions.id],
      name: 'session_speakers_session_event_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.eventId, table.speakerProfileId],
      foreignColumns: [speakerProfiles.eventId, speakerProfiles.id],
      name: 'session_speakers_speaker_event_fk',
    }).onDelete('cascade'),
    uniqueIndex('session_speakers_session_order_unique').on(
      table.eventId,
      table.sessionId,
      table.sortOrder,
    ),
    index('session_speakers_event_id_idx').on(table.eventId),
    index('session_speakers_speaker_idx').on(
      table.eventId,
      table.speakerProfileId,
    ),
    check('session_speakers_sort_order_check', sql`${table.sortOrder} >= 0`),
  ],
);

export const contentPages = pgTable(
  'content_pages',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 128 }).notNull(),
    kind: contentPageKind('kind').default('practical').notNull(),
    title: text('title').notNull(),
    summary: text('summary'),
    bodyMarkdown: text('body_markdown').notNull(),
    heroAssetId: uuid('hero_asset_id'),
    status: contentStatus('status').default('draft').notNull(),
    sortOrder: integer('sort_order').notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('content_pages_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('content_pages_event_slug_unique').on(
      table.eventId,
      table.slug,
    ),
    foreignKey({
      columns: [table.eventId, table.heroAssetId],
      foreignColumns: [assets.eventId, assets.id],
      name: 'content_pages_hero_asset_event_fk',
    }).onDelete('restrict'),
    index('content_pages_event_id_idx').on(table.eventId),
    check('content_pages_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('content_pages_version_check', sql`${table.version} > 0`),
  ],
);

export const faqItems = pgTable(
  'faq_items',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    category: varchar('category', { length: 128 }),
    question: text('question').notNull(),
    answerMarkdown: text('answer_markdown').notNull(),
    status: contentStatus('status').default('draft').notNull(),
    sortOrder: integer('sort_order').notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('faq_items_event_id_id_unique').on(table.eventId, table.id),
    index('faq_items_event_id_idx').on(table.eventId),
    index('faq_items_event_sort_order_idx').on(table.eventId, table.sortOrder),
    check('faq_items_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('faq_items_version_check', sql`${table.version} > 0`),
  ],
);

export const partners = pgTable(
  'partners',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 128 }).notNull(),
    name: text('name').notNull(),
    descriptionMarkdown: text('description_markdown'),
    websiteUrl: text('website_url'),
    category: varchar('category', { length: 128 }),
    tier: varchar('tier', { length: 128 }),
    logoAssetId: uuid('logo_asset_id'),
    status: contentStatus('status').default('draft').notNull(),
    sortOrder: integer('sort_order').notNull(),
    version: integer('version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('partners_event_id_id_unique').on(table.eventId, table.id),
    uniqueIndex('partners_event_slug_unique').on(table.eventId, table.slug),
    foreignKey({
      columns: [table.eventId, table.logoAssetId],
      foreignColumns: [assets.eventId, assets.id],
      name: 'partners_logo_asset_event_fk',
    }).onDelete('restrict'),
    index('partners_event_id_idx').on(table.eventId),
    check('partners_sort_order_check', sql`${table.sortOrder} >= 0`),
    check('partners_version_check', sql`${table.version} > 0`),
  ],
);

export const contentPublications = pgTable(
  'content_publications',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    reservationWindows: jsonb('reservation_windows')
      .$type<
        Record<
          string,
          {
            reservationOpensAt: string | null;
            reservationClosesAt: string | null;
          }
        >
      >()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    publishedBy: uuid('published_by').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    syncStatus: publicationSyncStatus('sync_status')
      .default('sync_pending')
      .notNull(),
    syncAttempts: integer('sync_attempts').default(0).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
  },
  (table) => [
    unique('content_publications_event_id_id_unique').on(
      table.eventId,
      table.id,
    ),
    uniqueIndex('content_publications_event_version_unique').on(
      table.eventId,
      table.version,
    ),
    foreignKey({
      columns: [table.eventId, table.publishedBy],
      foreignColumns: [eventMemberships.eventId, eventMemberships.userId],
      name: 'content_publications_publisher_membership_event_fk',
    }).onDelete('restrict'),
    index('content_publications_event_id_idx').on(table.eventId),
    index('content_publications_event_published_at_idx').on(
      table.eventId,
      table.publishedAt,
    ),
    index('content_publications_sync_status_idx').on(table.syncStatus),
    check('content_publications_version_check', sql`${table.version} > 0`),
    check(
      'content_publications_checksum_check',
      sql`${table.checksumSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'content_publications_snapshot_object_check',
      sql`jsonb_typeof(${table.snapshot}) = 'object'`,
    ),
    check(
      'content_publications_reservation_windows_object_check',
      sql`jsonb_typeof(${table.reservationWindows}) = 'object'`,
    ),
    check(
      'content_publications_sync_attempts_check',
      sql`${table.syncAttempts} >= 0`,
    ),
  ],
);
