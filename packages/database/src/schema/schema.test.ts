import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  accounts,
  auditLogs,
  consentRecords,
  eventFeatures,
  eventMemberships,
  eventRoles,
  events,
  idempotencyKeys,
  legalDocuments,
  outboxEvents,
  sessions,
  users,
  verifications,
} from './index.js';

const tables = [
  users,
  sessions,
  accounts,
  verifications,
  events,
  eventFeatures,
  eventMemberships,
  eventRoles,
  legalDocuments,
  consentRecords,
  auditLogs,
  outboxEvents,
  idempotencyKeys,
];

describe('stage 2 database schema', () => {
  it('uses explicit, unique table names', () => {
    const names = tables.map((table) => getTableConfig(table).name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'user',
        'session',
        'account',
        'verification',
        'events',
      ]),
    );
  });

  it.each([
    eventFeatures,
    eventMemberships,
    eventRoles,
    legalDocuments,
    consentRecords,
    auditLogs,
    outboxEvents,
    idempotencyKeys,
  ])('$0 is explicitly event-scoped', (table) => {
    expect(
      getTableConfig(table).columns.map((column) => column.name),
    ).toContain('event_id');
  });

  it('guards the cross-event legal-document relationship with a composite foreign key', () => {
    const foreignKeys = getTableConfig(consentRecords).foreignKeys.map((key) =>
      key.reference(),
    );
    expect(
      foreignKeys.some(
        (key) =>
          key.columns.map((column) => column.name).join(',') ===
          'event_id,legal_document_id',
      ),
    ).toBe(true);
  });

  it('exposes all event feature gates required by the implementation plan', () => {
    const featureColumns = getTableConfig(eventFeatures).columns.map(
      (column) => column.name,
    );
    expect(featureColumns).toEqual(
      expect.arrayContaining([
        'networking_enabled',
        'announcements_enabled',
        'speaker_portal_enabled',
        'questions_enabled',
        'polls_enabled',
        'ratings_enabled',
        'social_wall_enabled',
        'offline_checkin_enabled',
        'public_content_sync_enabled',
      ]),
    );
  });

  it('leaves identifiers to the server-side UUIDv7 generator', () => {
    for (const table of tables) {
      const id = getTableConfig(table).columns.find(
        (column) => column.name === 'id',
      );
      if (id) expect(id.hasDefault).toBe(false);
    }
  });

  it('declares the partial uniqueness required by current legal versions and active roles', () => {
    expect(
      getTableConfig(legalDocuments).indexes.some(
        (index) =>
          index.config.name === 'legal_documents_current_unique' &&
          index.config.where,
      ),
    ).toBeTruthy();
    expect(
      getTableConfig(eventRoles).indexes.some(
        (index) =>
          index.config.name === 'event_roles_active_unique' &&
          index.config.where,
      ),
    ).toBeTruthy();
  });

  it('declares event-scoped deduplication constraints', () => {
    expect(
      getTableConfig(outboxEvents).indexes.some(
        (index) =>
          index.config.name === 'outbox_events_event_dedup_unique' &&
          index.config.unique,
      ),
    ).toBe(true);
    expect(
      getTableConfig(idempotencyKeys).indexes.some(
        (index) =>
          index.config.name === 'idempotency_keys_actor_scope_key_unique' &&
          index.config.unique,
      ),
    ).toBe(true);
  });
});
