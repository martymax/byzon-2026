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
    expect(migration).toContain('CREATE TABLE "events"');
    expect(migration).toContain('consent_records_legal_document_event_fk');
    expect(onboardingMigration).toContain(
      'CREATE TABLE "participant_profiles"',
    );
    expect(onboardingMigration).toContain(
      'consent_records_request_document_unique',
    );
  });

  it('does not introduce UUIDv4 database defaults', () => {
    expect(migration).not.toContain('gen_random_uuid()');
    expect(onboardingMigration).not.toContain('gen_random_uuid()');
  });

  it('seeds both event scopes idempotently and keeps the test event archived', () => {
    expect(seed).toContain("'byzon-2026'");
    expect(seed).toContain("'byzon-isolation-test'");
    expect(seed).toContain("'archived'");
    expect(seed.match(/ON CONFLICT/g)).toHaveLength(2);
  });
});
