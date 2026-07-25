import { describe, expect, it } from 'vitest';

import { frontendPreviewAvailable } from './frontend-preview';

describe('frontend mocked preview gate', () => {
  it('opens only in a non-production process', () => {
    expect(
      frontendPreviewAvailable({
        nodeEnv: 'development',
      }),
    ).toBe(true);
    expect(
      frontendPreviewAvailable({
        nodeEnv: 'test',
      }),
    ).toBe(true);
  });

  it('fails closed in production', () => {
    expect(
      frontendPreviewAvailable({
        nodeEnv: 'production',
      }),
    ).toBe(false);
  });
});
