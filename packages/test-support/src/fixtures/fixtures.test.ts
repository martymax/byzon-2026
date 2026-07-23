import {
  sessionExpiredProblemSchema,
  defineApiProblemSchema,
} from '@byzon/domain/contracts';
import { describe, expect, it } from 'vitest';

import {
  baseProblemFixture,
  baseProblemFixtureFactory,
  fixtureContextMatrix,
  fixtureEventPhases,
  fixtureEventRoles,
  sessionExpiredProblemFixture,
} from './index.js';

describe('base problem fixtures', () => {
  it('conforms to exact shared problem contracts', () => {
    expect(
      defineApiProblemSchema('INTERNAL_ERROR', 500).parse(baseProblemFixture),
    ).toEqual(baseProblemFixture);
    expect(
      sessionExpiredProblemSchema.parse(sessionExpiredProblemFixture),
    ).toEqual(sessionExpiredProblemFixture);
  });

  it('uses stable synthetic request IDs and deterministic variants', () => {
    const first = baseProblemFixtureFactory.create('repeatable');
    const second = baseProblemFixtureFactory.create('repeatable');

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain('@');
  });
});

describe('role and event phase fixtures', () => {
  it('covers every role and phase exactly once per matrix combination', () => {
    expect(fixtureEventRoles).toHaveLength(7);
    expect(fixtureEventPhases).toHaveLength(5);
    expect(fixtureContextMatrix).toHaveLength(35);
    expect(
      new Set(fixtureContextMatrix.map(({ role, phase }) => `${role}:${phase}`))
        .size,
    ).toBe(35);
  });

  it('is deeply frozen so one test cannot mutate another scenario', () => {
    expect(Object.isFrozen(fixtureEventRoles)).toBe(true);
    expect(Object.isFrozen(fixtureEventPhases)).toBe(true);
    expect(Object.isFrozen(fixtureContextMatrix)).toBe(true);
    expect(Object.isFrozen(fixtureContextMatrix[0])).toBe(true);
  });
});
