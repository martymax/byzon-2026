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

  it('fails closed when the environment is absent or misspelled', () => {
    expect(frontendPreviewAvailable({ nodeEnv: undefined })).toBe(false);
    expect(frontendPreviewAvailable({ nodeEnv: 'prod' })).toBe(false);
    expect(frontendPreviewAvailable({ nodeEnv: '' })).toBe(false);
  });
});
