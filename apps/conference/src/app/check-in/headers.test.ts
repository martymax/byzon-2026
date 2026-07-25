import { describe, expect, it } from 'vitest';

import nextConfig from '../../../next.config';

describe('private check-in document policy', () => {
  it('serves the operator shell as private no-store with no referrer', async () => {
    const rules = await nextConfig.headers?.();
    const checkinRule = rules?.find((rule) => rule.source === '/check-in');

    expect(checkinRule?.headers).toEqual(
      expect.arrayContaining([
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ]),
    );
  });
});
