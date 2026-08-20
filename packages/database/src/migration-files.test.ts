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
  });

  it('does not introduce UUIDv4 database defaults', () => {
    expect(migration).not.toContain('gen_random_uuid()');
    expect(onboardingMigration).not.toContain('gen_random_uuid()');
    expect(contentMigration).not.toContain('gen_random_uuid()');
    expect(identityMigration).not.toContain('gen_random_uuid()');
  });

  it('seeds both event scopes idempotently and keeps the test event archived', () => {
    expect(seed).toContain("'byzon-2026'");
    expect(seed).toContain("'byzon-isolation-test'");
    expect(seed).toContain("'archived'");
    expect(seed.match(/ON CONFLICT/g)).toHaveLength(2);
  });
});
