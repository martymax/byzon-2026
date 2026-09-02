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
const coachingMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0010_coaching_slots.sql'),
  'utf8',
);
const ticketParticipantApplyMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0020_goofy_green_goblin.sql'),
  'utf8',
);
const ticketParticipantProfileBackfillMigration = readFileSync(
  resolve(
    packageRoot,
    'drizzle/0022_backfill_simpleshop_participant_profiles.sql',
  ),
  'utf8',
);
const announcementRolloutMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0023_enable_byzon_announcements.sql'),
  'utf8',
);
const networkingRolloutMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0024_enable_byzon_networking.sql'),
  'utf8',
);
const mastermindGroupMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0025_group_tomas_ryza_mastermind.sql'),
  'utf8',
);
const coachingReservationLimitMigration = readFileSync(
  resolve(packageRoot, 'drizzle/0026_one_coaching_reservation.sql'),
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
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0010_coaching_slots',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0020_goofy_green_goblin',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0022_backfill_simpleshop_participant_profiles',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0023_enable_byzon_announcements',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0024_enable_byzon_networking',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0025_group_tomas_ryza_mastermind',
    );
    expect(journal.entries?.map((entry) => entry.tag)).toContain(
      '0026_one_coaching_reservation',
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
    expect(coachingMigration).toContain(
      'Legacy coaching sessions contain participant state',
    );
    expect(coachingMigration).toContain(
      'Legacy coaching source paths require reconciliation',
    );
    expect(coachingMigration).toContain("'content-publish:'");
    expect(coachingMigration).toContain("'koucink-radim-0915'");
    expect(coachingMigration).toContain("'koucink-stana-1615'");
    expect(coachingMigration).toContain('\'coaching\'::"session_type"');
    expect(coachingMigration).toContain('\'reservation\'::"capacity_mode"');
    expect(coachingMigration).toContain("'Pátek!G18:I18#stana'");
    expect(coachingMigration).toContain(
      'b2743415963f645c11815d582f4a800a83094d78bb6c83763f06e56ec3822e48',
    );
    expect(ticketParticipantApplyMigration).toContain(
      'CREATE TABLE "ticket_source_participants"',
    );
    expect(ticketParticipantApplyMigration).toContain(
      'ADD COLUMN "preview_status"',
    );
    expect(ticketParticipantApplyMigration).toContain(
      'ticket_import_rows_preview_status_check',
    );
    expect(ticketParticipantApplyMigration).not.toContain('contact_email');
    expect(ticketParticipantApplyMigration).not.toContain('code_hmac');
    expect(ticketParticipantProfileBackfillMigration).toContain(
      'INSERT INTO "participant_profiles"',
    );
    expect(ticketParticipantProfileBackfillMigration).toContain(
      'FROM "ticket_source_participants"',
    );
    expect(ticketParticipantProfileBackfillMigration).toContain(
      'ON CONFLICT ("event_id", "user_id") DO NOTHING',
    );
    expect(mastermindGroupMigration).toContain('"reservation_group_id" uuid');
    expect(mastermindGroupMigration).toContain(
      'sessions_reservation_group_event_fk',
    );
    expect(mastermindGroupMigration).toContain(
      "'program.days[1].stages[1].events[1]'",
    );
    expect(mastermindGroupMigration).toContain(
      "'program.days[1].stages[1].events[3]'",
    );
    expect(mastermindGroupMigration).toContain('"capacity" = 6');
    expect(mastermindGroupMigration).toContain(
      'Mastermind reservation group contains participant state for event %',
    );
    expect(coachingReservationLimitMigration).toContain(
      'reservations_single_coaching_trigger',
    );
    expect(coachingReservationLimitMigration).toContain(
      'reservations_active_user_coaching_unique',
    );
    expect(coachingReservationLimitMigration).toContain(
      "'coaching-reservation:'",
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
    expect(coachingMigration).not.toContain('gen_random_uuid()');
    expect(ticketParticipantApplyMigration).not.toContain('gen_random_uuid()');
    expect(ticketParticipantProfileBackfillMigration).not.toContain(
      'gen_random_uuid()',
    );
    expect(mastermindGroupMigration).not.toContain('gen_random_uuid()');
    expect(coachingReservationLimitMigration).not.toContain(
      'gen_random_uuid()',
    );
  });

  it('seeds both event scopes idempotently, enables current participant features and keeps isolation disabled', () => {
    expect(seed).toContain("'byzon-2026'");
    expect(seed).toContain("'byzon-isolation-test'");
    expect(seed).toContain("'archived'");
    expect(seed).toContain(
      `CASE WHEN "slug" = 'byzon-2026' THEN true ELSE false END`,
    );
    expect(seed).toContain(
      '"announcements_enabled" = EXCLUDED."announcements_enabled"',
    );
    expect(seed).toContain(
      '"networking_enabled" = EXCLUDED."networking_enabled"',
    );
    expect(seed.match(/ON CONFLICT/g)).toHaveLength(4);
  });

  it('rolls announcements out only to the canonical BYZON 2026 event', () => {
    expect(announcementRolloutMigration).toContain(
      `WHERE "slug" = 'byzon-2026'`,
    );
    expect(announcementRolloutMigration).toContain(
      '"announcements_enabled" = true',
    );
    expect(announcementRolloutMigration).not.toContain('byzon-isolation-test');
  });

  it('rolls networking out only to the canonical BYZON 2026 event', () => {
    expect(networkingRolloutMigration).toContain(`WHERE "slug" = 'byzon-2026'`);
    expect(networkingRolloutMigration).toContain('"networking_enabled" = true');
    expect(networkingRolloutMigration).not.toContain('byzon-isolation-test');
  });
});
