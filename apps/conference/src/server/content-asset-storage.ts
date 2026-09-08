import { createHash } from 'node:crypto';
import { mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import sharp from 'sharp';

import { ApiProblemError } from './api/problem';
import { publicAssetLocation } from './public-assets';

// Open runtime files explicitly. These are volume objects or public assets copied
// by the packaging script, not dependencies for Next's static file tracing.
const readContentFile = async (filePath: string): Promise<Buffer> => {
  const file = await open(filePath, 'r');
  try {
    return await file.readFile();
  } finally {
    await file.close();
  }
};

export const MAX_IMAGE_PIXELS = 25_000_000;
export const imageLimit = (purpose: string) =>
  (purpose === 'partner_logo' ? 3 : 5) * 1_024 * 1_024;

export const invalidImage = () =>
  new ApiProblemError({
    status: 422,
    code: 'ADMIN_ASSET_INVALID_FILE',
    title: 'Invalid image',
    detail:
      'Použijte platný obrázek JPEG, PNG nebo WebP v povolené velikosti (nejvýše 25 megapixelů).',
  });

export const prepareContentImage = async (
  bytes: Buffer,
  type: string,
  purpose: string,
) => {
  if (!bytes.length || bytes.length > imageLimit(purpose)) throw invalidImage();
  try {
    const processor = sharp(bytes, {
      limitInputPixels: MAX_IMAGE_PIXELS,
      failOn: 'warning',
    });
    const metadata = await processor.metadata();
    const mime = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    if (
      !metadata.format ||
      !(metadata.format in mime) ||
      mime[metadata.format as keyof typeof mime] !== type ||
      (metadata.pages ?? 1) > 1
    )
      throw invalidImage();
    // Decode and re-encode: discard EXIF, embedded payloads and original filenames.
    const { data, info } = await processor
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    if (data.length > imageLimit(purpose)) throw invalidImage();
    return {
      bytes: data,
      width: info.width,
      height: info.height,
      checksum: createHash('sha256').update(data).digest('hex'),
    };
  } catch (error) {
    if (error instanceof ApiProblemError) throw error;
    throw invalidImage();
  }
};

export interface ContentAssetStorage {
  read(key: string, eventId: string): Promise<Buffer>;
  write(key: string, bytes: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
}

const volumeKey = /^content-images\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/;
export const createContentAssetStorage = (
  options: {
    root?: string;
    publicRoot?: string;
  } = {},
): ContentAssetStorage => {
  const path = (key: string) => {
    if (!volumeKey.test(key)) throw new Error('Invalid image storage key');
    const root =
      options.root ??
      process.env.ASSET_STORAGE_PATH ??
      (process.env.RAILWAY_VOLUME_MOUNT_PATH
        ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/byzon-assets`
        : undefined);
    if (!root || !isAbsolute(root))
      throw new ApiProblemError({
        status: 503,
        code: 'ADMIN_ASSET_STORAGE_UNAVAILABLE',
        title: 'Image storage unavailable',
        detail:
          'Úložiště obrázků není připojené. Správce musí připojit disk aplikace.',
      });
    return `${root.replace(/\/$/, '')}/${key}`;
  };
  return {
    async read(key, eventId) {
      if (key.startsWith('public-static/')) {
        const location = publicAssetLocation({ bucketKey: key, eventId });
        if (!location) throw new Error('Invalid static image key');
        const publicRoot = options.publicRoot ?? `${process.cwd()}/public`;
        return readContentFile(`${publicRoot}${location}`);
      }
      if (!key.startsWith(`content-images/${eventId}/`))
        throw new Error('Invalid image event');
      return readContentFile(path(key));
    },
    async write(key, bytes) {
      const destination = path(key);
      await mkdir(destination.slice(0, destination.lastIndexOf('/')), {
        recursive: true,
        mode: 0o700,
      });
      try {
        await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        // Never remove an existing immutable image on an accidental ID collision.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
          await unlink(destination).catch(() => {});
        throw error;
      }
    },
    async remove(key) {
      await unlink(path(key)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    },
  };
};
