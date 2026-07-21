import { describe, expect, it } from 'vitest';

import { localInputValue, zonedLocalToIso } from './admin-content-console';

describe('admin event timezone conversion', () => {
  it('uses the named timezone daylight-saving offset', () => {
    expect(zonedLocalToIso('2026-01-15T10:00', 'Europe/Prague')).toBe(
      '2026-01-15T09:00:00.000Z',
    );
    expect(zonedLocalToIso('2026-07-15T10:00', 'Europe/Prague')).toBe(
      '2026-07-15T08:00:00.000Z',
    );
  });

  it('round-trips an event-local form value', () => {
    const local = localInputValue('2026-01-15T09:00:00.000Z', 'Europe/Prague');
    expect(local).toBe('2026-01-15T10:00');
    expect(zonedLocalToIso(local, 'Europe/Prague')).toBe(
      '2026-01-15T09:00:00.000Z',
    );
  });
});
