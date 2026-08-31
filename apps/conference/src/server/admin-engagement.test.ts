import { describe, expect, it } from 'vitest';

import { maskModeratorContact } from './admin-engagement';

describe('admin engagement privacy helpers', () => {
  it('returns a useful but non-reversible contact hint', () => {
    expect(maskModeratorContact('moderator@example.test')).toBe(
      'm***@example.test',
    );
    expect(maskModeratorContact('invalid')).toBe('x***@invalid.example');
  });
});
