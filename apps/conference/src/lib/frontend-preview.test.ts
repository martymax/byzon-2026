import { describe, expect, it } from 'vitest';

import { frontendPreviewAvailable } from './frontend-preview';

describe('frontend mocked preview gate', () => {
  it('opens only in a non-production process with explicit mock mode', () => {
    expect(
      frontendPreviewAvailable({
        nodeEnv: 'development',
        mockMode: 'enabled',
      }),
    ).toBe(true);
    expect(
      frontendPreviewAvailable({
        nodeEnv: 'test',
        mockMode: 'enabled',
      }),
    ).toBe(true);
  });

  it('fails closed in production or without explicit opt-in', () => {
    expect(
      frontendPreviewAvailable({
        nodeEnv: 'production',
        mockMode: 'enabled',
      }),
    ).toBe(false);
    expect(
      frontendPreviewAvailable({
        nodeEnv: 'development',
        mockMode: undefined,
      }),
    ).toBe(false);
  });
});
