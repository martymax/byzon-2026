import * as testSupport from '@byzon/test-support';
import * as fixtures from '@byzon/test-support/fixtures';
import { describe, expect, it } from 'vitest';

describe('test-support public exports', () => {
  it('exposes the harness and fixtures through declared package subpaths', () => {
    expect(testSupport.defineFixtureFactory).toBeTypeOf('function');
    expect(fixtures.baseProblemFixture.code).toBe('INTERNAL_ERROR');
    expect(fixtures.fixtureContextMatrix).toHaveLength(35);
    expect(fixtures.participantProgramFixtures.happy?.version).toBe(3);
  });
});
