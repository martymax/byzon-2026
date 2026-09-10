import { mkdtemp, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleAdminContentAsset } from './admin-content-assets';
import { createContentAssetStorage } from './content-asset-storage';
import { handleAdminContent } from './admin-content';
import {
  previewContentPublication,
  publishContent,
} from './content-publication';
import { readPublicAsset } from './public-assets';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const origin = 'https://app.byzon.test';
integration('admin image volume integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 4,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 1000,
    applicationName: 'byzon-assets-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7();
  const userId = generateUuidV7();
  const outsider = generateUuidV7();
  const partnerId = generateUuidV7();
  const speakerId = generateUuidV7();
  let root: string;
  let bytes: Buffer;
  const dependencies = (actor = userId) => ({
    db: client.db,
    allowedOrigin: origin,
    getSession: async () => ({ user: { id: actor } }),
    storage: createContentAssetStorage({
      root,
      publicRoot: join(root, 'public'),
    }),
    rateLimit: vi.fn(async () => {}),
  });
  const request = (
    method = 'GET',
    version?: number,
    query = '',
    upload = bytes,
    sourceOrigin = origin,
  ) => {
    const form = new FormData();
    form.set(
      'file',
      new File([new Uint8Array(upload)], 'logo.png', { type: 'image/png' }),
    );
    form.set('altText', 'Logo partnera');
    return new Request(`${origin}/api${query}`, {
      method,
      headers: {
        origin: sourceOrigin,
        ...(version ? { 'if-match': `"${version}"` } : {}),
      },
      ...(method === 'PUT' ? { body: form } : {}),
    });
  };
  const call = (
    req: Request,
    id = partnerId,
    resource = 'partners',
    actor = userId,
    event = eventId,
  ) => handleAdminContentAsset(req, event, resource, id, dependencies(actor));
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'byzon-assets-integration-'));
    bytes = await sharp({
      create: { width: 48, height: 24, channels: 4, background: '#ffffff00' },
    })
      .png()
      .toBuffer();
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: `asset-${eventId}`,
      name: 'Asset test',
      timezone: 'Europe/Prague',
      startsAt: new Date('2026-09-18T06:00Z'),
      endsAt: new Date('2026-09-19T20:00Z'),
    });
    await client.db.insert(schema.users).values([
      { id: userId, name: 'Organizer', email: `${userId}@example.invalid` },
      {
        id: outsider,
        name: 'Participant',
        email: `${outsider}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values([
      { eventId, userId },
      { eventId, userId: outsider },
    ]);
    await client.db.insert(schema.eventRoles).values({
      id: generateUuidV7(),
      eventId,
      userId,
      role: 'organizer_admin',
    });
    const dayId = generateUuidV7();
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Test day',
      sortOrder: 0,
    });
    await client.db.insert(schema.programSessions).values({
      id: generateUuidV7(),
      eventId,
      dayId,
      slug: 'test-session',
      title: 'Test session',
      type: 'talk',
      startsAt: new Date('2026-09-18T08:00Z'),
      endsAt: new Date('2026-09-18T09:00Z'),
      sortOrder: 0,
    });
    await client.db.insert(schema.partners).values({
      id: partnerId,
      eventId,
      slug: 'logo-test',
      name: 'Logo test',
      sortOrder: 0,
    });
    await client.db.insert(schema.speakerProfiles).values({
      id: speakerId,
      eventId,
      slug: 'photo-test',
      firstName: 'Test',
      lastName: 'Speaker',
      sortOrder: 0,
    });
  });
  afterAll(async () => {
    await client.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('uploads, reloads, previews, downloads, versions the owner and publishes without exposing the draft', async () => {
    expect((await (await call(request())).json()).asset).toBeNull();
    const response = await call(request('PUT', 1));
    expect(response.status).toBe(200);
    const uploaded = await response.json();
    expect(uploaded.ownerVersion).toBe(2);
    expect(uploaded.asset).toMatchObject({
      altText: 'Logo partnera',
      contentType: 'image/webp',
      preview: { width: 48, height: 24 },
    });
    expect(JSON.stringify(uploaded)).not.toContain(root);
    const reloaded = await (await call(request())).json();
    expect(reloaded.asset.assetId).toBe(uploaded.asset.assetId);
    const preview = await call(
      new Request(`${origin}${reloaded.asset.preview.url}`),
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get('cache-control')).toBe('private, no-store');
    const download = await call(
      request(
        'GET',
        undefined,
        `?file=download&assetId=${uploaded.asset.assetId}`,
      ),
    );
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.from(await download.arrayBuffer())).toEqual(
      Buffer.from(await preview.arrayBuffer()),
    );
    const lookup = async (id: string) =>
      (await client.db.query.assets.findFirst({
        where: and(eq(schema.assets.id, id), eq(schema.assets.isPublic, true)),
      })) ?? null;
    expect(
      (
        await readPublicAsset(
          uploaded.asset.assetId,
          lookup,
          dependencies().storage.read,
        )
      ).status,
    ).toBe(404);
    const saved = await handleAdminContent(
      new Request(`${origin}/api`, {
        method: 'PATCH',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'New partner title',
          version: uploaded.ownerVersion,
        }),
      }),
      eventId,
      'partners',
      partnerId,
      dependencies(),
    );
    expect(saved.status).toBe(200);
    const draft = await previewContentPublication(client.db, eventId);
    await publishContent(client.db, {
      eventId,
      actorId: userId,
      requestId: generateUuidV7(),
      expectedPreviousVersion: 0,
      expectedChecksumSha256: draft.checksumSha256,
    });
    expect(
      (
        await readPublicAsset(
          uploaded.asset.assetId,
          lookup,
          dependencies().storage.read,
        )
      ).status,
    ).toBe(200);
    const replaced = await (await call(request('PUT', 3))).json();
    expect(replaced.ownerVersion).toBe(4);
    expect(replaced.asset.assetId).not.toBe(uploaded.asset.assetId);
    // Old publication keeps its own immutable image after replacement and removal.
    expect(
      (
        await readPublicAsset(
          uploaded.asset.assetId,
          lookup,
          dependencies().storage.read,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await readPublicAsset(
          replaced.asset.assetId,
          lookup,
          dependencies().storage.read,
        )
      ).status,
    ).toBe(404);
    expect(
      (await call(request('DELETE', 4, `?assetId=${replaced.asset.assetId}`)))
        .status,
    ).toBe(200);
    expect((await (await call(request())).json()).asset).toBeNull();
    const audit = await client.db.query.auditLogs.findMany({
      where: eq(schema.auditLogs.eventId, eventId),
    });
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'content.asset.replace',
        'content.asset.download',
        'content.asset.remove',
      ]),
    );
  });

  it('enforces permissions, event isolation, origin, version, file validation and archived state', async () => {
    expect(
      (await call(request(), partnerId, 'partners', outsider)).status,
    ).toBe(404);
    expect(
      (await call(request(), partnerId, 'partners', userId, generateUuidV7()))
        .status,
    ).toBe(404);
    expect(
      (await call(request('PUT', 5, '', bytes, 'https://evil.example'))).status,
    ).toBe(403);
    expect((await call(request('PUT', 1))).status).toBe(409);
    expect(
      (await call(request('PUT', 5, '', Buffer.from('<svg/>')))).status,
    ).toBe(422);
    expect(
      (await call(request('PUT', 5, '', Buffer.alloc(3 * 1024 * 1024 + 1))))
        .status,
    ).toBe(422);
    const sessionless = await handleAdminContentAsset(
      request(),
      eventId,
      'partners',
      partnerId,
      { ...dependencies(), getSession: async () => null },
    );
    expect(sessionless.status).toBe(401);
    await client.db
      .update(schema.partners)
      .set({ status: 'archived' })
      .where(eq(schema.partners.id, partnerId));
    expect((await call(request('PUT', 5))).status).toBe(409);
  });

  it('serializes concurrent uploads and supports speaker photos using the same volume', async () => {
    const results = await Promise.all([
      call(request('PUT', 1), speakerId, 'speakers'),
      call(request('PUT', 1), speakerId, 'speakers'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const data = await (await call(request(), speakerId, 'speakers')).json();
    expect(data.asset.purpose).toBe('speaker_photo');
    const expired = new URL(`${origin}${data.asset.preview.url}`);
    expired.searchParams.set('expires', '1');
    expect(
      (await call(new Request(expired), speakerId, 'speakers')).status,
    ).toBe(404);
    const persisted = await readdir(join(root, 'content-images', eventId));
    expect(persisted).toHaveLength(3);
  });

  it('resolves and downloads an existing packaged SVG logo', async () => {
    const id = generateUuidV7();
    const assetId = generateUuidV7();
    const directory = join(root, 'public/content-assets/assets/img');
    await mkdir(directory, { recursive: true });
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="red"/></svg>';
    await writeFile(join(directory, 'logo.svg'), svg);
    await client.db.insert(schema.assets).values({
      id: assetId,
      eventId,
      bucketKey: `public-static/${eventId}/assets/img/logo.svg`,
      purpose: 'partner_logo',
      originalFilename: 'logo.svg',
      sniffedMimeType: 'image/svg+xml',
      sizeBytes: Buffer.byteLength(svg),
      checksumSha256: 'a'.repeat(64),
      status: 'ready',
      isPublic: true,
    });
    await client.db.insert(schema.partners).values({
      id,
      eventId,
      name: 'SVG logo',
      slug: 'svg-logo',
      sortOrder: 1,
      logoAssetId: assetId,
    });
    const resolved = await call(request(), id);
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).asset.preview).toMatchObject({
      width: 100,
      height: 50,
    });
    const download = await call(
      request('GET', undefined, `?file=download&assetId=${assetId}`),
      id,
    );
    expect(await download.text()).toBe(svg);
    expect(download.headers.get('content-type')).toBe('image/svg+xml');
  });
});
