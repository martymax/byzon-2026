import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  accounts,
  agendaItems,
  auditLogs,
  consentRecords,
  eventFeatures,
  eventMemberships,
  eventRoles,
  events,
  idempotencyKeys,
  legalDocuments,
  outboxEvents,
  participantProfiles,
  participantAgendas,
  privacyRequests,
  programSessions,
  reservations,
  sessions,
  users,
  verifications,
  waitlistEntries,
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
  participantProfiles,
  participantAgendas,
  agendaItems,
  privacyRequests,
  reservations,
  waitlistEntries,
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
    participantProfiles,
    participantAgendas,
    agendaItems,
    privacyRequests,
    reservations,
    waitlistEntries,
  ])('$0 is explicitly event-scoped', (table) => {
    expect(
      getTableConfig(table).columns.map((column) => column.name),
    ).toContain('event_id');
  });

  it('stores onboarding minimum per event without changing the global identity', () => {
    const columns = getTableConfig(participantProfiles).columns.map(
      (column) => column.name,
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        'event_id',
        'user_id',
        'first_name',
        'last_name',
        'company',
        'contact_email',
        'networking_enabled',
        'onboarding_completed_at',
        'version',
      ]),
    );
  });

  it('keeps active roster sources unique and event-scoped', () => {
    const reservationConfig = getTableConfig(reservations);
    const waitlistConfig = getTableConfig(waitlistEntries);

    expect(
      reservationConfig.indexes.some(
        (index) =>
          index.config.name === 'reservations_active_user_session_unique' &&
          index.config.unique &&
          index.config.where,
      ),
    ).toBeTruthy();
    expect(
      waitlistConfig.indexes.some(
        (index) =>
          index.config.name ===
            'waitlist_entries_waiting_user_session_unique' &&
          index.config.unique &&
          index.config.where,
      ),
    ).toBeTruthy();
    expect(
      reservationConfig.foreignKeys.some(
        (key) =>
          key
            .reference()
            .columns.map((column) => column.name)
            .join(',') === 'event_id,session_id',
      ),
    ).toBe(true);
    expect(
      waitlistConfig.foreignKeys.some(
        (key) =>
          key
            .reference()
            .columns.map((column) => column.name)
            .join(',') === 'event_id,user_id',
      ),
    ).toBe(true);
  });

  it('stores an optional event-scoped reservation group on program sessions', () => {
    const sessionConfig = getTableConfig(programSessions);
    expect(sessionConfig.columns.map((column) => column.name)).toContain(
      'reservation_group_id',
    );
    expect(
      sessionConfig.foreignKeys.some((key) => {
        const reference = key.reference();
        return (
          reference.columns.map(({ name }) => name).join(',') ===
            'event_id,reservation_group_id' &&
          reference.foreignColumns.map(({ name }) => name).join(',') ===
            'event_id,id'
        );
      }),
    ).toBe(true);
  });

  it('stores one versioned agenda root and one projection per participant session', () => {
    const agendaConfig = getTableConfig(participantAgendas);
    const itemConfig = getTableConfig(agendaItems);

    expect(
      agendaConfig.primaryKeys[0]?.columns.map(({ name }) => name),
    ).toEqual(['event_id', 'user_id']);
    expect(itemConfig.primaryKeys[0]?.columns.map(({ name }) => name)).toEqual([
      'event_id',
      'user_id',
      'session_id',
    ]);
    expect(
      itemConfig.foreignKeys.some(
        (key) =>
          key.reference().foreignTable === participantAgendas &&
          key
            .reference()
            .columns.map(({ name }) => name)
            .join(',') === 'event_id,user_id',
      ),
    ).toBe(true);
    expect(
      itemConfig.foreignKeys.some(
        (key) =>
          key
            .reference()
            .columns.map(({ name }) => name)
            .join(',') === 'event_id,session_id',
      ),
    ).toBe(true);
  });

  it('stores one event-scoped privacy request per user and kind', () => {
    expect(
      getTableConfig(privacyRequests).indexes.some(
        (index) =>
          index.config.name === 'privacy_requests_event_user_kind_unique' &&
          index.config.unique,
      ),
    ).toBe(true);
  });

  it('deduplicates consent records for a retried onboarding request', () => {
    expect(
      getTableConfig(consentRecords).indexes.some(
        (index) =>
          index.config.name === 'consent_records_request_document_unique' &&
          index.config.unique,
      ),
    ).toBe(true);
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
