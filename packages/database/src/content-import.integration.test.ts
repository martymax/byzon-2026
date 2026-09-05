import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { and, count, eq, inArray, ne } from 'drizzle-orm';
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
  const restoredParticipantIds = Array.from({ length: 21 }, () =>
    generateUuidV7(),
  );

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
      .delete(schema.reservations)
      .where(eq(schema.reservations.eventId, eventId));
    await client.db
      .delete(schema.eventMemberships)
      .where(eq(schema.eventMemberships.eventId, eventId));
    await client.db
      .delete(schema.programSessions)
      .where(eq(schema.programSessions.eventId, eventId));
    await client.db
      .delete(schema.contentPages)
      .where(eq(schema.contentPages.eventId, eventId));
    await client.db
      .delete(schema.rooms)
      .where(eq(schema.rooms.eventId, eventId));
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
    await client.db
      .delete(schema.users)
      .where(inArray(schema.users.id, restoredParticipantIds));
    await client.close();
  });

  it('reconciles explicitly allowed published source records without duplicates', async () => {
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
        capacity: schema.programSessions.capacity,
        capacityMode: schema.programSessions.capacityMode,
        endsAt: schema.programSessions.endsAt,
        id: schema.programSessions.id,
        reservationClosesAt: schema.programSessions.reservationClosesAt,
        reservationGroupId: schema.programSessions.reservationGroupId,
        slug: schema.programSessions.slug,
        startsAt: schema.programSessions.startsAt,
        title: schema.programSessions.title,
        type: schema.programSessions.type,
        waitlistMode: schema.programSessions.waitlistMode,
      })
      .from(schema.programSessions)
      .where(
        and(
          eq(schema.programSessions.eventId, eventId),
          ne(schema.programSessions.status, 'archived'),
        ),
      );

    expect(firstSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title:
            'Co o svých lidech skutečně víte? Měříte výkon, potenciál nebo jen dojmy?',
          type: 'mastermind',
          capacityMode: 'reservation',
          capacity: 12,
          reservationClosesAt: new Date('2026-09-18T13:15:00.000Z'),
          waitlistMode: 'disabled',
        }),
        expect.objectContaining({
          title:
            'Změna je příležitostí, leadership je cesta. Uchopte svůj osobní leadership skrze metodu LEGO® SERIOUS PLAY®.',
          type: 'workshop',
          capacityMode: 'reservation',
          capacity: 20,
          reservationClosesAt: new Date('2026-09-19T07:30:00.000Z'),
          waitlistMode: 'disabled',
        }),
        expect.objectContaining({
          title: 'Workshop: Blanka Mrázková',
          type: 'workshop',
          capacityMode: 'reservation',
          capacity: 20,
          reservationClosesAt: new Date('2026-09-19T09:15:00.000Z'),
          waitlistMode: 'disabled',
        }),
        expect.objectContaining({
          title: 'Řízený networking',
          capacityMode: 'none',
          capacity: null,
        }),
        expect.objectContaining({
          title: 'Mastermind část 1',
          type: 'mastermind',
          capacityMode: 'reservation',
          capacity: 6,
          reservationClosesAt: new Date('2026-09-19T07:30:00.000Z'),
        }),
        expect.objectContaining({
          title: 'Mastermind část 2',
          type: 'mastermind',
          capacityMode: 'reservation',
          capacity: 6,
          reservationClosesAt: new Date('2026-09-19T07:30:00.000Z'),
        }),
      ]),
    );
    const firstMastermindParts = firstSessions.filter(({ title }) =>
      title.startsWith('Mastermind část'),
    );
    expect(firstMastermindParts).toHaveLength(2);
    expect(
      firstMastermindParts.every(
        ({ reservationGroupId }) =>
          reservationGroupId === firstMastermindParts[0]!.id,
      ),
    ).toBe(true);
    const firstCoachingSessions = firstSessions.filter(
      ({ type }) => type === 'coaching',
    );
    expect(firstCoachingSessions).toHaveLength(26);
    expect(
      firstCoachingSessions.every(
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

    const preservedWorkshopId = firstSessions.find(
      ({ title }) =>
        title ===
        'Změna je příležitostí, leadership je cesta. Uchopte svůj osobní leadership skrze metodu LEGO® SERIOUS PLAY®.',
    )?.id;
    const restoredWorkshopId = firstSessions.find(
      ({ title }) => title === 'Workshop: Blanka Mrázková',
    )?.id;
    const openingSession = firstSessions.find(
      ({ title }) => title === 'Zahájení a slovo primátorky',
    );
    expect(preservedWorkshopId).toBeDefined();
    expect(restoredWorkshopId).toBeDefined();
    expect(openingSession).toBeDefined();
    await client.db
      .update(schema.programSessions)
      .set({
        capacity: 24,
        reservationClosesAt: new Date('2026-09-19T07:00:00.000Z'),
        waitlistMode: 'auto_confirm',
      })
      .where(eq(schema.programSessions.id, preservedWorkshopId!));
    await client.db.insert(schema.users).values(
      restoredParticipantIds.map((id, index) => ({
        id,
        name: `Obnovená kapacita ${index + 1}`,
        email: `restored-capacity-${index + 1}-${eventId}@example.invalid`,
      })),
    );
    await client.db
      .insert(schema.eventMemberships)
      .values(restoredParticipantIds.map((userId) => ({ eventId, userId })));
    await client.db.insert(schema.reservations).values(
      restoredParticipantIds.map((userId) => ({
        id: generateUuidV7(),
        eventId,
        sessionId: restoredWorkshopId!,
        userId,
        source: 'participant',
      })),
    );
    await client.db
      .update(schema.programSessions)
      .set({ capacityMode: 'none', capacity: null })
      .where(eq(schema.programSessions.id, restoredWorkshopId!));
    await client.db
      .update(schema.speakerProfiles)
      .set({ status: 'published' })
      .where(eq(schema.speakerProfiles.eventId, eventId));
    await client.db.insert(schema.partners).values({
      id: generateUuidV7(),
      eventId,
      slug: 'livest',
      name: 'LIVEST',
      status: 'draft',
      sortOrder: 9,
    });
    await client.db
      .update(schema.partners)
      .set({ status: 'published' })
      .where(eq(schema.partners.eventId, eventId));
    await client.db
      .update(schema.venues)
      .set({ status: 'published' })
      .where(eq(schema.venues.eventId, eventId));
    await client.db
      .update(schema.rooms)
      .set({ status: 'published' })
      .where(eq(schema.rooms.eventId, eventId));
    await client.db
      .update(schema.contentPages)
      .set({ status: 'published' })
      .where(eq(schema.contentPages.eventId, eventId));
    await client.db
      .update(schema.programSessions)
      .set({ status: 'published' })
      .where(
        and(
          eq(schema.programSessions.eventId, eventId),
          eq(schema.programSessions.status, 'draft'),
        ),
      );

    const changedSourceDirectory = await mkdtemp(
      join(tmpdir(), 'byzon-content-import-'),
    );
    const changedSourceFile = join(changedSourceDirectory, 'content.json');
    const changedSource = (await readFile(options.sourceFile, 'utf8'))
      .replace(
        '"title": "Zahájení a slovo primátorky"',
        '"title": "Zahájení a slovo primátorky – aktualizováno"',
      )
      .replace('"name": "Bude Hub"', '"name": "Bude Hub – aktualizováno"');
    expect(changedSource).toContain(
      '"title": "Zahájení a slovo primátorky – aktualizováno"',
    );
    await writeFile(changedSourceFile, changedSource);
    let second: Awaited<ReturnType<typeof importContentJson>>;
    try {
      second = await importContentJson({
        ...options,
        sourceFile: changedSourceFile,
        allowPublishedUpdate: true,
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
        reservationGroupId: schema.programSessions.reservationGroupId,
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
    const importedRooms = await client.db
      .select({
        description: schema.rooms.description,
        id: schema.rooms.id,
        name: schema.rooms.name,
        slug: schema.rooms.slug,
      })
      .from(schema.rooms)
      .where(eq(schema.rooms.eventId, eventId));
    const importedPartners = await client.db
      .select({
        logoAssetId: schema.partners.logoAssetId,
        name: schema.partners.name,
        slug: schema.partners.slug,
        websiteUrl: schema.partners.websiteUrl,
      })
      .from(schema.partners)
      .where(
        and(
          eq(schema.partners.eventId, eventId),
          ne(schema.partners.status, 'archived'),
        ),
      );
    const archivedLegacyPartner = await client.db.query.partners.findFirst({
      columns: { name: true, status: true },
      where: and(
        eq(schema.partners.eventId, eventId),
        eq(schema.partners.slug, 'livest'),
      ),
    });
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
    expect(importedRooms).toHaveLength(9);
    expect(importedRooms.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'BYZON Stage',
        'Leadership Stage',
        'Bude Hub – aktualizováno',
        'Koučovací zóna · Radim Roček',
        'Koučovací zóna · Stanislava Maunová',
      ]),
    );
    expect(importedRooms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Rudolfovská tř. 34, České Budějovice',
          name: 'Bude Hub – aktualizováno',
          slug: 'bude-hub',
        }),
      ]),
    );
    expect(importedPartners).toHaveLength(15);
    expect(archivedLegacyPartner).toEqual({
      name: 'LIVEST',
      status: 'archived',
    });
    expect(
      importedPartners.every(({ websiteUrl }) => websiteUrl !== null),
    ).toBe(true);
    expect(importedPartners).toEqual(
      expect.arrayContaining(
        [
          'Frame Land',
          'Growy',
          'Vojáček',
          'Panství Bzí',
          'LEGAL PLUS',
          'dm',
        ].map((name) =>
          expect.objectContaining({
            logoAssetId: expect.any(String),
            name,
          }),
        ),
      ),
    );
    expect(importedPartners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Společnost pro ranou péči',
          slug: 'horizont',
          websiteUrl: 'https://www.ranapece.cz/ceske-budejovice/',
        }),
        expect.objectContaining({
          name: 'LEGAL PLUS',
          websiteUrl: 'https://www.halaburt.cz/',
        }),
        expect.objectContaining({
          name: 'dm',
          websiteUrl: 'https://www.dm.cz/',
        }),
      ]),
    );
    expect(archivedCoaching).toHaveLength(11);
    expect(secondSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'published',
          roomId: expect.any(String),
          capacityMode: 'none',
        }),
        expect.objectContaining({
          id: openingSession!.id,
          slug: openingSession!.slug,
          title: 'Zahájení a slovo primátorky – aktualizováno',
          status: 'published',
        }),
        expect.objectContaining({
          title: 'Řízený networking',
          startsAt: new Date('2026-09-18T17:00:00.000Z'),
          endsAt: new Date('2026-09-18T19:00:00.000Z'),
        }),
        expect.objectContaining({
          title:
            'Co o svých lidech skutečně víte? Měříte výkon, potenciál nebo jen dojmy?',
          type: 'mastermind',
          capacityMode: 'reservation',
          capacity: 12,
          reservationClosesAt: new Date('2026-09-18T13:15:00.000Z'),
        }),
        expect.objectContaining({
          title:
            'Změna je příležitostí, leadership je cesta. Uchopte svůj osobní leadership skrze metodu LEGO® SERIOUS PLAY®.',
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
          capacity: 21,
          reservationClosesAt: new Date('2026-09-19T09:15:00.000Z'),
        }),
        expect.objectContaining({
          title: 'Mastermind část 1',
          type: 'mastermind',
          capacityMode: 'reservation',
          capacity: 6,
          reservationClosesAt: new Date('2026-09-19T07:30:00.000Z'),
        }),
        expect.objectContaining({
          title: 'Mastermind část 2',
          type: 'mastermind',
          capacityMode: 'reservation',
          capacity: 6,
          reservationClosesAt: new Date('2026-09-19T07:30:00.000Z'),
        }),
        expect.objectContaining({
          summary: 'Andrea Bílá',
          title: 'Jak lidsky získat GenZ a vést s energií',
        }),
        expect.objectContaining({
          title: 'Volný program',
          startsAt: new Date('2026-09-19T11:00:00.000Z'),
          endsAt: new Date('2026-09-19T13:15:00.000Z'),
        }),
      ]),
    );
    const secondMastermindParts = secondSessions.filter(({ title }) =>
      title.startsWith('Mastermind část'),
    );
    expect(secondMastermindParts).toHaveLength(2);
    expect(
      secondMastermindParts.every(
        ({ reservationGroupId }) =>
          reservationGroupId === secondMastermindParts[0]!.id,
      ),
    ).toBe(true);
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
  }, 60_000);
});
