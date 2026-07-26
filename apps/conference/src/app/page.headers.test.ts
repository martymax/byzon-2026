import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config';

describe('private root login document policy', () => {
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
});
