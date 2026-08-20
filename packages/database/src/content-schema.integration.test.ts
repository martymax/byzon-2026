import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDatabaseClient, withTransaction } from './client.js';
import { generateUuidV7 } from './ids.js';
import * as schema from './schema/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('content schema integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-content-schema-integration-test',
    onUnexpectedError: vi.fn(),
  });
  let primaryEventId: string;
  let isolationEventId: string;

  beforeAll(async () => {
    const eventRows = await client.db
      .select({ id: schema.events.id, slug: schema.events.slug })
      .from(schema.events);
    primaryEventId = eventRows.find(({ slug }) => slug === 'byzon-2026')!.id;
    isolationEventId = eventRows.find(
      ({ slug }) => slug === 'byzon-isolation-test',
    )!.id;
  });

  afterAll(async () => {
    await client.close();
  });

  it('rejects a cross-event asset reference', async () => {
    await expect(
      withTransaction(client.db, async (transaction) => {
        const assetId = generateUuidV7();
        await transaction.insert(schema.assets).values({
          id: assetId,
          eventId: primaryEventId,
          bucketKey: `integration/${assetId}`,
          purpose: 'speaker_photo',
          originalFilename: 'speaker.png',
          declaredMimeType: 'image/png',
          sniffedMimeType: 'image/png',
          sizeBytes: 128,
          checksumSha256: 'a'.repeat(64),
          status: 'ready',
        });

        await transaction.insert(schema.speakerProfiles).values({
          id: generateUuidV7(),
          eventId: isolationEventId,
          slug: `cross-event-${assetId}`,
          firstName: 'Cross',
          lastName: 'Event',
          photoAssetId: assetId,
          sortOrder: 0,
        });
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'speaker_profiles_photo_asset_event_fk',
      }),
    });
  });

  it('rejects an invalid session time range', async () => {
    await expect(
      withTransaction(client.db, async (transaction) => {
        const dayId = generateUuidV7();
        await transaction.insert(schema.eventDays).values({
          id: dayId,
          eventId: primaryEventId,
          localDate: '2026-09-18',
          title: 'Integration day',
          sortOrder: 99,
        });
        await transaction.insert(schema.programSessions).values({
          id: generateUuidV7(),
          eventId: primaryEventId,
          dayId,
          slug: `invalid-session-${dayId}`,
          title: 'Invalid session',
          startsAt: new Date('2026-09-18T10:00:00.000Z'),
          endsAt: new Date('2026-09-18T09:00:00.000Z'),
          sortOrder: 0,
        });
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'sessions_time_range_check',
      }),
    });
  });

  it('rejects a capacity mode without a positive capacity', async () => {
    await expect(
      withTransaction(client.db, async (transaction) => {
        const dayId = generateUuidV7();
        await transaction.insert(schema.eventDays).values({
          id: dayId,
          eventId: primaryEventId,
          localDate: '2026-09-18',
          title: 'Capacity integration day',
          sortOrder: 99,
        });
        await transaction.insert(schema.programSessions).values({
          id: generateUuidV7(),
          eventId: primaryEventId,
          dayId,
          slug: `invalid-capacity-${dayId}`,
          title: 'Invalid capacity',
          startsAt: new Date('2026-09-18T09:00:00.000Z'),
          endsAt: new Date('2026-09-18T10:00:00.000Z'),
          capacityMode: 'reservation',
          capacity: null,
          sortOrder: 0,
        });
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'sessions_capacity_policy_check',
      }),
    });
  });

  it('requires the publisher membership in the same event', async () => {
    await expect(
      withTransaction(client.db, async (transaction) => {
        const userId = generateUuidV7();
        await transaction.insert(schema.users).values({
          id: userId,
          name: 'Content integration publisher',
          email: `${userId}@example.invalid`,
        });
        await transaction.insert(schema.eventMemberships).values({
          eventId: primaryEventId,
          userId,
        });
        await transaction.insert(schema.contentPublications).values({
          id: generateUuidV7(),
          eventId: isolationEventId,
          version: 1,
          snapshot: { eventId: isolationEventId },
          checksumSha256: 'b'.repeat(64),
          publishedBy: userId,
        });
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'content_publications_publisher_membership_event_fk',
      }),
    });
  });

  it('keeps publication payload immutable while allowing sync progress', async () => {
    const rollback = new Error('rollback successful publication probe');

    await expect(
      withTransaction(client.db, async (transaction) => {
        const userId = generateUuidV7();
        const publicationId = generateUuidV7();
        await transaction.insert(schema.users).values({
          id: userId,
          name: 'Publication integration user',
          email: `${userId}@example.invalid`,
        });
        await transaction.insert(schema.eventMemberships).values({
          eventId: primaryEventId,
          userId,
        });
        await transaction.insert(schema.contentPublications).values({
          id: publicationId,
          eventId: primaryEventId,
          version: 999_999,
          snapshot: { eventId: primaryEventId, sessions: [] },
          checksumSha256: 'c'.repeat(64),
          publishedBy: userId,
        });

        await transaction
          .update(schema.contentPublications)
          .set({ syncAttempts: 1, syncStatus: 'synced', syncedAt: new Date() })
          .where(
            and(
              eq(schema.contentPublications.eventId, primaryEventId),
              eq(schema.contentPublications.id, publicationId),
            ),
          );
        const [publication] = await transaction
          .select()
          .from(schema.contentPublications)
          .where(eq(schema.contentPublications.id, publicationId));

        expect(publication).toMatchObject({
          id: publicationId,
          syncAttempts: 1,
          syncStatus: 'synced',
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    await expect(
      withTransaction(client.db, async (transaction) => {
        const userId = generateUuidV7();
        const publicationId = generateUuidV7();
        await transaction.insert(schema.users).values({
          id: userId,
          name: 'Immutable publication integration user',
          email: `${userId}@example.invalid`,
        });
        await transaction.insert(schema.eventMemberships).values({
          eventId: primaryEventId,
          userId,
        });
        await transaction.insert(schema.contentPublications).values({
          id: publicationId,
          eventId: primaryEventId,
          version: 999_998,
          snapshot: { eventId: primaryEventId, sessions: [] },
          checksumSha256: 'd'.repeat(64),
          publishedBy: userId,
        });
        await transaction
          .update(schema.contentPublications)
          .set({
            reservationWindows: {
              [generateUuidV7()]: {
                reservationOpensAt: null,
                reservationClosesAt: null,
              },
            },
          })
          .where(eq(schema.contentPublications.id, publicationId));
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'content_publications_immutable',
      }),
    });

    await expect(
      withTransaction(client.db, async (transaction) => {
        const userId = generateUuidV7();
        const publicationId = generateUuidV7();
        await transaction.insert(schema.users).values({
          id: userId,
          name: 'Undeletable publication integration user',
          email: `${userId}@example.invalid`,
        });
        await transaction.insert(schema.eventMemberships).values({
          eventId: primaryEventId,
          userId,
        });
        await transaction.insert(schema.contentPublications).values({
          id: publicationId,
          eventId: primaryEventId,
          version: 999_997,
          snapshot: { eventId: primaryEventId, sessions: [] },
          checksumSha256: 'e'.repeat(64),
          publishedBy: userId,
        });
        await transaction
          .delete(schema.contentPublications)
          .where(eq(schema.contentPublications.id, publicationId));
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'content_publications_immutable',
      }),
    });
  });
});
