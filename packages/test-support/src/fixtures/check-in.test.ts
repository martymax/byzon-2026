import { describe, expect, it } from 'vitest';

import {
  checkinBootstrapFixtures,
  checkinConfirmFixtures,
  checkinConfirmProblemFixtures,
  checkinFixtureIds,
  checkinLookupFixtures,
  checkinLookupProblemFixtures,
  checkinSearchFixtures,
  checkinUndoFixtures,
  checkinUndoProblemFixtures,
} from './check-in.js';

describe('synthetic CS-CHECKIN-01 fixtures', () => {
  it('covers all operator-visible lookup outcomes without full email PII', () => {
    expect(Object.keys(checkinLookupFixtures)).toEqual([
      'valid',
      'duplicate',
      'cancelled',
      'refunded',
      'blocked',
      'unknown',
    ]);
    for (const fixture of Object.values(checkinLookupFixtures)) {
      if (fixture.person) {
        expect(fixture.person.maskedEmail).toContain('***');
      }
    }
  });

  it('binds confirm, undo and shell fixtures to the same synthetic scope', () => {
    expect(checkinBootstrapFixtures.operator.event.id).toBe(
      checkinFixtureIds.event,
    );
    expect(checkinConfirmFixtures.checked_in.checkin.id).toBe(
      checkinFixtureIds.checkin,
    );
    expect(checkinUndoFixtures.undone.checkinId).toBe(
      checkinFixtureIds.checkin,
    );
  });

  it('keeps lookup disclosure bounded and fixtures frozen', () => {
    expect(checkinSearchFixtures.matches!.results).toHaveLength(2);
    expect(Object.isFrozen(checkinSearchFixtures.matches!)).toBe(true);
  });

  it('covers canonical failure recovery branches', () => {
    expect(checkinLookupProblemFixtures.rate_limited.code).toBe(
      'CHECKIN_RATE_LIMITED',
    );
    expect(checkinConfirmProblemFixtures.lookup_expired.code).toBe(
      'CHECKIN_LOOKUP_EXPIRED',
    );
    expect(checkinUndoProblemFixtures.window_expired.code).toBe(
      'CHECKIN_UNDO_WINDOW_EXPIRED',
    );
  });
});
