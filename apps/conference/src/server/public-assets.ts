import { z } from 'zod';

const assetIdSchema = z.string().uuid();
const LOCAL_CONTENT_ASSET_PREFIX = '/content-assets';

export interface PublicAssetRecord {
  readonly bucketKey: string;
  readonly eventId: string;
  readonly sniffedMimeType?: string | null;
}

export const publicAssetLocation = (
  asset: PublicAssetRecord,
): string | null => {
  const prefix = `public-static/${asset.eventId}`;
  if (!asset.bucketKey.startsWith(prefix)) return null;
  const sourcePath = asset.bucketKey.slice(prefix.length);
  const segments = sourcePath.split('/');
  if (
    !sourcePath.startsWith('/assets/img/') ||
    sourcePath.includes('\\') ||
    sourcePath.includes('%') ||
    sourcePath.includes('?') ||
    sourcePath.includes('#') ||
    /[\u0000-\u001f\u007f]/.test(sourcePath) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    return null;
  }
  return `${LOCAL_CONTENT_ASSET_PREFIX}${sourcePath}`;
};

const notFound = () =>
  new Response(null, {
    status: 404,
    headers: { 'cache-control': 'public, max-age=60' },
  });

export const readPublicAsset = async (
  assetId: string,
  findAsset: (id: string) => Promise<PublicAssetRecord | null>,
  readImage?: (key: string, eventId: string) => Promise<Buffer>,
): Promise<Response> => {
  if (!assetIdSchema.safeParse(assetId).success) return notFound();
  const asset = await findAsset(assetId);
  if (!asset) return notFound();
  if (
    asset.bucketKey.startsWith(`content-images/${asset.eventId}/`) &&
    readImage &&
    asset.sniffedMimeType === 'image/webp'
  ) {
    try {
      const bytes = await readImage(asset.bucketKey, asset.eventId);
      return new Response(new Uint8Array(bytes), {
        headers: {
          'content-type': 'image/webp',
          'content-length': String(bytes.length),
          'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch {
      return notFound();
    }
  }
  const location = publicAssetLocation(asset);
  if (!location) return notFound();
  return new Response(null, {
    status: 307,
    headers: {
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
      location,
    },
  });
};
