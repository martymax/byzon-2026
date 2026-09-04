import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config';

describe('private root login document policy', () => {
  it('allows the dedicated Railway mock preview host to connect to dev HMR', () => {
    expect(nextConfig.allowedDevOrigins).toContain(
      'byzonconference-fe-mock-preview.up.railway.app',
    );
  });

  it('serves the login shell as private no-store with no referrer', async () => {
    const rules = await nextConfig.headers?.();
    const rootRule = rules?.find((rule) => rule.source === '/');

    expect(rootRule?.headers).toEqual(
      expect.arrayContaining([
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ]),
    );
  });

  it('serves packaged content assets with a bounded public cache', async () => {
    const rules = await nextConfig.headers?.();
    const contentAssetRule = rules?.find(
      (rule) => rule.source === '/content-assets/:path*',
    );

    expect(contentAssetRule?.headers).toContainEqual({
      key: 'Cache-Control',
      value: 'public, max-age=300, stale-while-revalidate=3600',
    });
  });
});
