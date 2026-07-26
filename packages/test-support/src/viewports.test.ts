import { describe, expect, it } from 'vitest';

import { targetViewports } from './viewports.js';

describe('target UI viewports', () => {
  it('keeps the approved phone, tablet and desktop dimensions exact', () => {
    expect(targetViewports).toEqual([
      { id: 'phone', label: '375 × 667', width: 375, height: 667 },
      { id: 'tablet', label: '768 × 1024', width: 768, height: 1024 },
      { id: 'desktop', label: '1280 × 800', width: 1280, height: 800 },
    ]);
    expect(Object.isFrozen(targetViewports)).toBe(true);
    expect(targetViewports.every(Object.isFrozen)).toBe(true);
  });
});
