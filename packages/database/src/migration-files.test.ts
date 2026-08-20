import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '..');
const migration = readFileSync(
  resolve(packageRoot, 'drizzle/0000_special_mikhail_rasputin.sql'),
  'utf8',
);
const onboardingMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0001_strong_venus.sql'),
  'utf8',
);
const contentMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0002_superb_roulette.sql'),
  'utf8',
);
const identityMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0006_woozy_the_professor.sql'),
  'utf8',
);
const rosterMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0007_living_magik.sql'),
  'utf8',
);
const agendaWriteMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0008_pretty_firebrand.sql'),
  'utf8',
);
const reservationWindowMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0009_legacy_reservation_windows.sql'),
  'utf8',
);
const journal = JSON.parse(
  readFileSync(resolve(packageRoot, 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries?: Array<{ tag?: string }> };
const seed = readFileSync(
  resolve(packageRoot, 'drizzle/seed/events.sql'),
  'utf8',
);

describe('versioned database artifacts', () => {
  it('tracks the generated migration in the Drizzle journal', () => {
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0000_special_mikhail_rasputin',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0001_strong_venus',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0002_superb_roulette',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0006_woozy_the_professor',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0007_living_magik',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0008_pretty_firebrand',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0009_legacy_reservation_windows',
    );
    expect(migration).toContain('CREATE TABLE "events"');
    expect(migration).toContain('consent_records_legal_document_event_fk');
    expect(onboardingMigration).toContain(
      'CREATE TABLE "participant_profiles"',
    );
    expect(onboardingMigration).toContain(
      'consent_records_request_document_unique',
    );
    expect(contentMigration).toContain('CREATE TABLE "sessions"');
    expect(contentMigration).toContain('sessions_day_event_fk');
    expect(contentMigration).toContain('partners_logo_asset_event_fk');
    expect(contentMigration).toContain(
      'content_publications_immutable_trigger',
    );
    expect(contentMigration).toContain(
      'BEFORE UPDATE OR DELETE ON "content_publications"',
    );
    expect(identityMigration).toContain('CREATE TABLE "privacy_requests"');
    expect(identityMigration).toContain(
      'privacy_requests_event_user_kind_unique',
    );
    expect(identityMigration).toContain(
      'ALTER TABLE "participant_profiles" ADD COLUMN "version"',
    );
    expect(rosterMigration).toContain('CREATE TABLE "reservations"');
    expect(rosterMigration).toContain('CREATE TABLE "waitlist_entries"');
    expect(rosterMigration).toContain(
      'reservations_active_user_session_unique',
    );
    expect(rosterMigration).toContain(
      'waitlist_entries_waiting_user_session_unique',
    );
    expect(rosterMigration).toContain(
      'ALTER TABLE "participant_profiles" ADD COLUMN "company"',
    );
    expect(agendaWriteMigration).toContain(
      'CREATE TABLE "participant_agendas"',
    );
    expect(agendaWriteMigration).toContain('CREATE TABLE "agenda_items"');
    expect(agendaWriteMigration).toContain(
      'agenda_items_participant_agenda_fk',
    );
    expect(agendaWriteMigration).toContain(
      'participant_agendas_membership_event_fk',
    );
    expect(agendaWriteMigration).toContain(
      "'program.days[0].stages[1].events[10]'",
    );
    expect(agendaWriteMigration).toContain(
      "'program.days[1].stages[0].events[2]'",
    );
    expect(agendaWriteMigration).toContain(
      '"reservation_closes_at" = "session"."starts_at"',
    );
    expect(agendaWriteMigration).toContain(
      'Reservation policy backfill validation failed for event %',
    );
    expect(agendaWriteMigration).toContain(
      'LOCK TABLE "reservations" IN SHARE MODE',
    );
    expect(agendaWriteMigration).toContain(
      'Reservation policy backfill would reduce capacity below confirmed reservations for event %',
    );
    expect(agendaWriteMigration).toContain(
      "'2026-09-18T15:15:00+02:00'::timestamptz",
    );
    expect(agendaWriteMigration).toContain("'Workshop: Blanka Mrázková'");
    expect(reservationWindowMigration).toContain('jsonb_object_agg');
    expect(reservationWindowMigration).toContain(
      'LOCK TABLE "sessions" IN SHARE MODE',
    );
    expect(reservationWindowMigration).toContain(
      '\'reservationClosesAt\', to_jsonb("session"."reservation_closes_at")',
    );
    expect(reservationWindowMigration).toContain(
      'OR NEW."reservation_windows" IS DISTINCT FROM OLD."reservation_windows"',
    );
  });

  it('does not introduce UUIDv4 database defaults', () => {
    expect(migration).not.toContain('gen_random_uuid()');
    expect(onboardingMigration).not.toContain('gen_random_uuid()');
    expect(contentMigration).not.toContain('gen_random_uuid()');
    expect(identityMigration).not.toContain('gen_random_uuid()');
    expect(rosterMigration).not.toContain('gen_random_uuid()');
    expect(agendaWriteMigration).not.toContain('gen_random_uuid()');
    expect(reservationWindowMigration).not.toContain('gen_random_uuid()');
  });

  it('seeds both event scopes idempotently and keeps the test event archived', () => {
    expect(seed).toContain("'byzon-2026'");
    expect(seed).toContain("'byzon-isolation-test'");
    expect(seed).toContain("'archived'");
    expect(seed.match(/ON CONFLICT/g)).toHaveLength(2);
  });
});
