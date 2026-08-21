import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { and, count, eq, ne } from 'drizzle-orm';
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
    const legacyDayId = generateUuidV7();
    const legacyTimes = [
      '9:15 - 9:45',
      '9:45 - 10:15',
      '10:45 - 11:15',
      '11:15 - 11:45',
      '11:45 - 12:15',
      '13:15 - 13:45',
      '13:45 - 14:15',
      '14:15 - 14:45',
      '15:15 - 15:45',
      '15:45 - 16:15',
      '16:15 - 16:45',
    ];
    const legacyEventIndexes = [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13];
    await client.db.insert(schema.eventDays).values({
      id: legacyDayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Pátek',
      sortOrder: 0,
    });
    const legacySessions = legacyTimes.map((time, index) => {
      const [startsAt, endsAt] = time.split(' - ');
      const id = generateUuidV7();
      return {
        id,
        eventId,
        dayId: legacyDayId,
        slug: `koucovaci-zona-koucovaci-sloty-${time.replace(/\D/g, '')}`,
        title: 'Koučovací sloty',
        startsAt: new Date(`2026-09-18T${startsAt!.padStart(5, '0')}:00+02:00`),
        endsAt: new Date(`2026-09-18T${endsAt!.padStart(5, '0')}:00+02:00`),
        sortOrder: 200 + index,
      };
    });
    await client.db.insert(schema.programSessions).values(legacySessions);
    const legacyProvenance = legacySessions.map(({ id }, index) => ({
      id: generateUuidV7(),
      eventId,
      sourceName: 'static-site/data/content.json',
      sourcePath: `legacy-shifted-coaching[${index}]`,
      sourceSha256: 'e'.repeat(64),
      targetType: 'session',
      targetId: id,
    }));
    await client.db
      .insert(schema.contentImportProvenance)
      .values(legacyProvenance);

    const options = {
      db: client.db,
      eventSlug,
      sourceFile: resolve(repositoryRoot, 'static-site/data/content.json'),
      repositoryRoot,
    };
    await expect(importContentJson(options)).rejects.toThrow(
      'legacy coaching source paths require reconciliation before replacement',
    );
    for (const [index, provenance] of legacyProvenance.entries()) {
      await client.db
        .update(schema.contentImportProvenance)
        .set({
          sourcePath: `program.days[0].stages[2].events[${legacyEventIndexes[index]}]`,
        })
        .where(eq(schema.contentImportProvenance.id, provenance.id));
    }

    const first = await importContentJson(options);
    const firstSessions = await client.db
      .select({
        id: schema.programSessions.id,
        title: schema.programSessions.title,
      })
      .from(schema.programSessions)
      .where(
        and(
          eq(schema.programSessions.eventId, eventId),
          ne(schema.programSessions.status, 'archived'),
        ),
      );

    const preservedWorkshopId = firstSessions.find(
      ({ title }) => title === 'Workshop: Leonid Kushnir',
    )?.id;
    expect(preservedWorkshopId).toBeDefined();
    await client.db
      .update(schema.programSessions)
      .set({
        capacity: 24,
        reservationClosesAt: new Date('2026-09-19T07:00:00.000Z'),
        waitlistMode: 'auto_confirm',
      })
      .where(eq(schema.programSessions.id, preservedWorkshopId!));

    const changedSourceDirectory = await mkdtemp(
      join(tmpdir(), 'byzon-content-import-'),
    );
    const changedSourceFile = join(changedSourceDirectory, 'content.json');
    await writeFile(
      changedSourceFile,
      `${await readFile(options.sourceFile, 'utf8')}\n `,
    );
    let second: Awaited<ReturnType<typeof importContentJson>>;
    try {
      second = await importContentJson({
        ...options,
        sourceFile: changedSourceFile,
      });
    } finally {
      await rm(changedSourceDirectory, { recursive: true, force: true });
    }
    const secondSessions = await client.db
      .select({
        id: schema.programSessions.id,
        slug: schema.programSessions.slug,
        title: schema.programSessions.title,
        summary: schema.programSessions.summary,
        startsAt: schema.programSessions.startsAt,
        endsAt: schema.programSessions.endsAt,
        status: schema.programSessions.status,
        roomId: schema.programSessions.roomId,
        capacityMode: schema.programSessions.capacityMode,
        capacity: schema.programSessions.capacity,
        reservationClosesAt: schema.programSessions.reservationClosesAt,
        waitlistMode: schema.programSessions.waitlistMode,
        type: schema.programSessions.type,
      })
      .from(schema.programSessions)
      .where(
        and(
          eq(schema.programSessions.eventId, eventId),
          ne(schema.programSessions.status, 'archived'),
        ),
      );
    const archivedCoaching = await client.db
      .select({ id: schema.programSessions.id })
      .from(schema.programSessions)
      .where(
        and(
          eq(schema.programSessions.eventId, eventId),
          eq(schema.programSessions.status, 'archived'),
        ),
      );
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

    expect(second.sourceSha256).not.toBe(first.sourceSha256);
    expect(secondSessions.map(({ id }) => id).sort()).toEqual(
      firstSessions.map(({ id }) => id).sort(),
    );
    expect(secondSessions).toHaveLength(82);
    expect(archivedCoaching).toHaveLength(11);
    expect(secondSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'draft',
          roomId: null,
          capacityMode: 'none',
        }),
        expect.objectContaining({
          title: 'Řízený networking',
          startsAt: new Date('2026-09-18T17:00:00.000Z'),
          endsAt: new Date('2026-09-18T19:00:00.000Z'),
        }),
        expect.objectContaining({
          title: 'Expertní Board 21 - mastermind session',
          type: 'mastermind',
          capacityMode: 'reservation',
          capacity: 12,
          reservationClosesAt: new Date('2026-09-18T13:15:00.000Z'),
        }),
        expect.objectContaining({
          title: 'Workshop: Leonid Kushnir',
          type: 'workshop',
          capacityMode: 'reservation',
          capacity: 24,
          reservationClosesAt: new Date('2026-09-19T07:30:00.000Z'),
          waitlistMode: 'disabled',
        }),
        expect.objectContaining({
          title: 'Workshop: Blanka Mrázková',
          type: 'workshop',
          capacityMode: 'reservation',
          capacity: 20,
          reservationClosesAt: new Date('2026-09-19T09:15:00.000Z'),
        }),
        expect.objectContaining({
          title: 'Volný program',
          startsAt: new Date('2026-09-19T11:00:00.000Z'),
          endsAt: new Date('2026-09-19T13:15:00.000Z'),
        }),
      ]),
    );
    const coachingSessions = secondSessions.filter(
      ({ type }) => type === 'coaching',
    );
    expect(coachingSessions).toHaveLength(26);
    expect(
      coachingSessions.filter(({ slug }) => slug.startsWith('koucink-radim-')),
    ).toHaveLength(12);
    expect(
      coachingSessions.filter(({ slug }) => slug.startsWith('koucink-stana-')),
    ).toHaveLength(14);
    expect(
      coachingSessions.every(
        ({
          capacity,
          capacityMode,
          endsAt,
          reservationClosesAt,
          startsAt,
          waitlistMode,
        }) =>
          capacity === 1 &&
          capacityMode === 'reservation' &&
          endsAt.getTime() - startsAt.getTime() === 30 * 60 * 1_000 &&
          reservationClosesAt?.getTime() === startsAt.getTime() &&
          waitlistMode === 'disabled',
      ),
    ).toBe(true);
    expect(
      secondSessions.some(({ title }) => title === 'Koučovací sloty'),
    ).toBe(false);
    expect(
      coachingSessions.every(({ summary }) =>
        summary?.startsWith('Koučovací zóna'),
      ),
    ).toBe(true);
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
  }, 15_000);
});
