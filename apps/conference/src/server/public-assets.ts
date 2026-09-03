import { z } from 'zod';

const assetIdSchema = z.string().uuid();
const STATIC_SITE_ORIGIN = 'https://byzon.cz';

export interface PublicAssetRecord {
  readonly bucketKey: string;
  readonly eventId: string;
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
    sourcePath.includes('?') ||
    sourcePath.includes('#') ||
    /[\u0000-\u001f\u007f]/.test(sourcePath) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    return null;
  }
  const location = new URL(sourcePath, STATIC_SITE_ORIGIN);
  return location.origin === STATIC_SITE_ORIGIN &&
    location.pathname.startsWith('/assets/img/')
    ? location.toString()
    : null;
};

const notFound = () =>
  new Response(null, {
    status: 404,
    headers: { 'cache-control': 'public, max-age=60' },
  });

export const readPublicAsset = async (
  assetId: string,
  findAsset: (id: string) => Promise<PublicAssetRecord | null>,
): Promise<Response> => {
  if (!assetIdSchema.safeParse(assetId).success) return notFound();
  const asset = await findAsset(assetId);
  if (!asset) return notFound();
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
