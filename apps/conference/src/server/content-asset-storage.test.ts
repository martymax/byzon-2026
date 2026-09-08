import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createContentAssetStorage,
  prepareContentImage,
} from './content-asset-storage';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('content image volume', () => {
  it('validates decoded image content and persists a metadata-free WebP across adapter instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'byzon-image-'));
    roots.push(root);
    const original = await sharp({
      create: { width: 20, height: 10, channels: 4, background: '#ff0099' },
    })
      .png()
      .toBuffer();
    const image = await prepareContentImage(
      original,
      'image/png',
      'partner_logo',
    );
    expect(await sharp(image.bytes).metadata()).toMatchObject({
      format: 'webp',
      width: 20,
      height: 10,
    });
    const eventId = '01910000-0000-7000-8000-000000000001';
    const key = `content-images/${eventId}/01910000-0000-7000-8000-000000000002.webp`;
    await createContentAssetStorage({ root }).write(key, image.bytes);
    expect(
      await createContentAssetStorage({ root }).read(key, eventId),
    ).toEqual(image.bytes);
    await expect(
      createContentAssetStorage({ root }).write(key, original),
    ).rejects.toThrow();
    expect(await readFile(join(root, key))).toEqual(image.bytes);
    await createContentAssetStorage({ root }).remove(key);
    await expect(readFile(join(root, key))).rejects.toThrow();
  });
  it('rejects forged MIME types, SVG uploads, oversized bodies and corrupt images', async () => {
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    for (const [bytes, type] of [
      [png, 'image/jpeg'],
      [Buffer.from('<svg/>'), 'image/png'],
      [Buffer.alloc(3 * 1024 * 1024 + 1), 'image/png'],
      [png.subarray(0, 25), 'image/png'],
    ] as const) {
      await expect(
        prepareContentImage(bytes, type, 'partner_logo'),
      ).rejects.toMatchObject({ status: 422 });
    }
  });
  it('rejects path traversal and cross-event reads', async () => {
    const storage = createContentAssetStorage({ root: '/tmp/unused-assets' });
    await expect(
      storage.write('../../escape.webp', Buffer.from('x')),
    ).rejects.toThrow();
    await expect(
      storage.read(
        'content-images/01910000-0000-7000-8000-000000000001/01910000-0000-7000-8000-000000000002.webp',
        '01910000-0000-7000-8000-000000000003',
      ),
    ).rejects.toThrow();
    await expect(
      storage.read('public-static/event/assets/img/../../secret', 'event'),
    ).rejects.toThrow();
  });
});
