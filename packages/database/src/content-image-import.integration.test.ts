import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createDatabaseClient } from './client.js';
import { importContentJson } from './content-import.js';
import { generateUuidV7 } from './ids.js';
import { writeAuditLog } from './audit.js';
import * as schema from './schema/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)(
  'CMS image import preservation',
  () => {
    it('preserves an uploaded logo and a removed photo when the static source changes', async () => {
      const client = createDatabaseClient({
        connectionString: databaseUrl!,
        max: 2,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: 1000,
        applicationName: 'byzon-image-import-test',
        onUnexpectedError: vi.fn(),
      });
      const directory = await mkdtemp(join(tmpdir(), 'byzon-image-import-'));
      try {
        const eventId = generateUuidV7();
        const slug = `image-import-${eventId}`;
        await client.db.insert(schema.events).values({
          id: eventId,
          slug,
          name: 'Image import',
          timezone: 'Europe/Prague',
          startsAt: new Date('2026-09-18T06:00Z'),
          endsAt: new Date('2026-09-19T20:00Z'),
        });
        const repositoryRoot = resolve(import.meta.dirname, '../../..');
        const sourceFile = join(
          repositoryRoot,
          'static-site/data/content.json',
        );
        const options = {
          db: client.db,
          repositoryRoot,
          sourceFile,
          eventSlug: slug,
        };
        await importContentJson(options);
        const partner = await client.db.query.partners.findFirst({
          where: eq(schema.partners.eventId, eventId),
        });
        const speaker = await client.db.query.speakerProfiles.findFirst({
          where: eq(schema.speakerProfiles.eventId, eventId),
        });
        const id = generateUuidV7();
        await client.db.insert(schema.assets).values({
          id,
          eventId,
          bucketKey: `content-images/${eventId}/${id}.webp`,
          purpose: 'partner_logo',
          originalFilename: 'partner_logo.webp',
          sniffedMimeType: 'image/webp',
          sizeBytes: 100,
          checksumSha256: 'a'.repeat(64),
          status: 'ready',
        });
        await client.db
          .update(schema.partners)
          .set({ logoAssetId: id })
          .where(eq(schema.partners.id, partner!.id));
        await client.db
          .update(schema.speakerProfiles)
          .set({ photoAssetId: null })
          .where(eq(schema.speakerProfiles.id, speaker!.id));
        for (const [targetId, action] of [
          [partner!.id, 'content.asset.replace'],
          [speaker!.id, 'content.asset.remove'],
        ] as const) {
          await writeAuditLog(client.db, {
            eventId,
            actorId: null,
            actorType: 'system',
            action,
            targetType: 'content',
            targetId,
            requestId: generateUuidV7(),
          });
        }
        const changed = JSON.parse(await readFile(sourceFile, 'utf8'));
        const changedFile = join(directory, 'content.json');
        await writeFile(changedFile, JSON.stringify(changed, null, 4));
        await importContentJson({ ...options, sourceFile: changedFile });
        expect(
          (
            await client.db.query.partners.findFirst({
              where: eq(schema.partners.id, partner!.id),
            })
          )?.logoAssetId,
        ).toBe(id);
        expect(
          (
            await client.db.query.speakerProfiles.findFirst({
              where: eq(schema.speakerProfiles.id, speaker!.id),
            })
          )?.photoAssetId,
        ).toBeNull();
      } finally {
        await client.close();
        await rm(directory, { recursive: true, force: true });
      }
    });
  },
);
