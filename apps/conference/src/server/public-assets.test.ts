import { describe, expect, it, vi } from 'vitest';

import { publicAssetLocation, readPublicAsset } from './public-assets';

const eventId = '01910000-0000-7000-8000-000000000001';
const assetId = '01910000-0000-7000-8000-000000000002';

describe('public content assets', () => {
  it('maps packaged WebP images to the conference application', () => {
    expect(
      publicAssetLocation({
        eventId,
        bucketKey: `public-static/${eventId}/assets/img/2026/08/speaker.webp`,
      }),
    ).toBe('/content-assets/assets/img/2026/08/speaker.webp');
  });

  it('keeps other imported public images on the canonical static website', () => {
    expect(
      publicAssetLocation({
        eventId,
        bucketKey: `public-static/${eventId}/assets/img/2026/08/wexia.svg`,
      }),
    ).toBe('https://byzon.cz/assets/img/2026/08/wexia.svg');
  });

  it.each([
    `private/${eventId}/logo.png`,
    `public-static/${eventId}/assets/docs/file.pdf`,
    `public-static/${eventId}/assets/img/../secret.png`,
    `public-static/${eventId}/assets/img/%2e%2e/secret.png`,
    `public-static/${eventId}/assets/img/logo\\hidden.png`,
    `public-static/${eventId}/assets/img/logo.png?redirect=elsewhere`,
  ])('rejects a non-allowlisted bucket key: %s', (bucketKey) => {
    expect(publicAssetLocation({ eventId, bucketKey })).toBeNull();
  });

  it('redirects a valid public asset without requiring participant identity', async () => {
    const findAsset = vi.fn().mockResolvedValue({
      eventId,
      bucketKey: `public-static/${eventId}/assets/img/logo.png`,
    });

    const response = await readPublicAsset(assetId, findAsset);

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://byzon.cz/assets/img/logo.png',
    );
    expect(response.headers.get('cache-control')).toContain('max-age=300');
    expect(findAsset).toHaveBeenCalledWith(assetId);
  });

  it('does not query storage for malformed identifiers', async () => {
    const findAsset = vi.fn();

    const response = await readPublicAsset('not-an-id', findAsset);

    expect(response.status).toBe(404);
    expect(findAsset).not.toHaveBeenCalled();
  });
});
