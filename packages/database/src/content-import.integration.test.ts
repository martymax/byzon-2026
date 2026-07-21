import { resolve } from 'node:path';

import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient } from './client.js';
import { importContentJson } from './content-import.js';
import { generateUuidV7 } from './ids.js';
import * as schema from './schema/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const repositoryRoot = resolve(import.meta.dirname, '../../..');
const eventSlug = `content-import-${generateUuidV7()}`;

integration('content import integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-content-import-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7();

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: eventSlug,
      name: 'Content import test',
      timezone: 'Europe/Prague',
      startsAt: new Date('2026-09-18T06:00:00.000Z'),
      endsAt: new Date('2026-09-19T20:00:00.000Z'),
    });
  });

  afterAll(async () => {
    await client.db
      .delete(schema.programSessions)
      .where(eq(schema.programSessions.eventId, eventId));
    await client.db
      .delete(schema.contentPages)
      .where(eq(schema.contentPages.eventId, eventId));
    await client.db
      .delete(schema.speakerProfiles)
      .where(eq(schema.speakerProfiles.eventId, eventId));
    await client.db
      .delete(schema.partners)
      .where(eq(schema.partners.eventId, eventId));
    await client.db
      .delete(schema.venues)
      .where(eq(schema.venues.eventId, eventId));
    await client.db
      .delete(schema.assets)
      .where(eq(schema.assets.eventId, eventId));
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.close();
  });

  it('imports only drafts and repeats without duplicate domain records', async () => {
    const options = {
      db: client.db,
      eventSlug,
      sourceFile: resolve(repositoryRoot, 'static-site/data/content.json'),
      repositoryRoot,
    };
    const first = await importContentJson(options);
    const firstSessions = await client.db
      .select({ id: schema.programSessions.id })
      .from(schema.programSessions)
      .where(eq(schema.programSessions.eventId, eventId));

    const second = await importContentJson(options);
    const secondSessions = await client.db
      .select({
        id: schema.programSessions.id,
        status: schema.programSessions.status,
        roomId: schema.programSessions.roomId,
        capacityMode: schema.programSessions.capacityMode,
      })
      .from(schema.programSessions)
      .where(eq(schema.programSessions.eventId, eventId));
    const [publicationCount] = await client.db
      .select({ value: count() })
      .from(schema.contentPublications)
      .where(eq(schema.contentPublications.eventId, eventId));
    const [provenanceCount] = await client.db
      .select({ value: count() })
      .from(schema.contentImportProvenance)
      .where(eq(schema.contentImportProvenance.eventId, eventId));
    const linkedSpeakers = await client.db
      .select({ sessionId: schema.sessionSpeakers.sessionId })
      .from(schema.sessionSpeakers)
      .where(eq(schema.sessionSpeakers.eventId, eventId));

    expect(second.sourceSha256).toBe(first.sourceSha256);
    expect(secondSessions.map(({ id }) => id).sort()).toEqual(
      firstSessions.map(({ id }) => id).sort(),
    );
    expect(secondSessions).toHaveLength(65);
    expect(secondSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'draft',
          roomId: null,
          capacityMode: 'none',
        }),
      ]),
    );
    expect(publicationCount!.value).toBe(0);
    expect(provenanceCount!.value).toBeGreaterThan(100);
    expect(linkedSpeakers.length).toBeGreaterThan(0);

    const invalid = await client.db
      .select({ value: count() })
      .from(schema.programSessions)
      .where(
        and(
          eq(schema.programSessions.eventId, eventId),
          eq(schema.programSessions.title, 'Ukončení na Clarionu'),
        ),
      );
    expect(invalid[0]!.value).toBe(0);
  });
});
