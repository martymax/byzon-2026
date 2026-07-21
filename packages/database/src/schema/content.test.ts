import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  assets,
  contentPages,
  contentPublications,
  eventDays,
  faqItems,
  partners,
  programSessions,
  rooms,
  sessionSpeakers,
  speakerProfiles,
  venues,
} from './index.js';

const eventOwnedTables = [
  assets,
  eventDays,
  venues,
  rooms,
  programSessions,
  speakerProfiles,
  sessionSpeakers,
  contentPages,
  faqItems,
  partners,
  contentPublications,
];

const foreignKeyColumns = (table: (typeof eventOwnedTables)[number]) =>
  getTableConfig(table).foreignKeys.map((key) =>
    key
      .reference()
      .columns.map((column) => column.name)
      .join(','),
  );

describe('stage 3 content schema', () => {
  it.each(eventOwnedTables)(
    '$0 is explicitly event-scoped and indexed',
    (table) => {
      const config = getTableConfig(table);

      expect(config.columns.map((column) => column.name)).toContain('event_id');
      expect(
        config.indexes.some((index) =>
          index.config.columns.some(
            (column) => 'name' in column && column.name === 'event_id',
          ),
        ),
      ).toBe(true);
    },
  );

  it.each([
    [assets, 'event_id,owner_user_id'],
    [rooms, 'event_id,venue_id'],
    [programSessions, 'event_id,day_id'],
    [programSessions, 'event_id,room_id'],
    [speakerProfiles, 'event_id,photo_asset_id'],
    [speakerProfiles, 'event_id,user_id'],
    [sessionSpeakers, 'event_id,session_id'],
    [sessionSpeakers, 'event_id,speaker_profile_id'],
    [contentPages, 'event_id,hero_asset_id'],
    [partners, 'event_id,logo_asset_id'],
    [contentPublications, 'event_id,published_by'],
  ] as const)(
    '$0 prevents cross-event references through $1',
    (table, expectedColumns) => {
      expect(foreignKeyColumns(table)).toContain(expectedColumns);
    },
  );

  it('stores the complete program and reservation-policy skeleton', () => {
    const columns = getTableConfig(programSessions).columns.map(
      (column) => column.name,
    );

    expect(columns).toEqual(
      expect.arrayContaining([
        'day_id',
        'room_id',
        'slug',
        'title',
        'summary',
        'description',
        'type',
        'starts_at',
        'ends_at',
        'status',
        'capacity_mode',
        'capacity',
        'reservation_opens_at',
        'reservation_closes_at',
        'waitlist_mode',
        'waitlist_offer_ttl_minutes',
        'allow_release_after_deadline',
        'version',
      ]),
    );
  });

  it('stores private asset metadata without a public bucket URL', () => {
    const columns = getTableConfig(assets).columns.map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        'bucket_key',
        'owner_user_id',
        'purpose',
        'original_filename',
        'declared_mime_type',
        'sniffed_mime_type',
        'size_bytes',
        'checksum_sha256',
        'status',
        'is_public',
      ]),
    );
    expect(columns).not.toContain('public_url');
  });

  it('defines versioned immutable publication payloads and observable sync state', () => {
    const config = getTableConfig(contentPublications);
    const columns = config.columns.map((column) => column.name);

    expect(columns).toEqual(
      expect.arrayContaining([
        'version',
        'snapshot',
        'checksum_sha256',
        'published_by',
        'published_at',
        'sync_status',
        'synced_at',
        'last_sync_error',
      ]),
    );
    expect(
      config.indexes.some(
        (index) =>
          index.config.name === 'content_publications_event_version_unique' &&
          index.config.unique,
      ),
    ).toBe(true);
  });

  it('leaves all entity identifiers to the UUIDv7 generator', () => {
    for (const table of eventOwnedTables) {
      const id = getTableConfig(table).columns.find(
        (column) => column.name === 'id',
      );
      if (id) expect(id.hasDefault).toBe(false);
    }
  });
});
