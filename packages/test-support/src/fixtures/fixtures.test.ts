import {
  sessionExpiredProblemSchema,
  defineApiProblemSchema,
} from '@byzon/domain/contracts';
import { describe, expect, it } from 'vitest';

import {
  baseProblemFixture,
  baseProblemFixtureFactory,
  fixtureContextName,
  fixtureContextMatrix,
  fixtureEventPhases,
  fixtureEventRoles,
  selectFixtureContexts,
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

  it('selects deterministic named subsets for component test matrices', () => {
    const selected = selectFixtureContexts({
      roles: ['participant', 'organizer_admin'],
      phases: ['activation_open', 'live'],
    });

    expect(selected).toEqual([
      { role: 'participant', phase: 'activation_open' },
      { role: 'organizer_admin', phase: 'activation_open' },
      { role: 'participant', phase: 'live' },
      { role: 'organizer_admin', phase: 'live' },
    ]);
    expect(selected.map(fixtureContextName)).toEqual([
      'participant @ activation_open',
      'organizer_admin @ activation_open',
      'participant @ live',
      'organizer_admin @ live',
    ]);
    expect(Object.isFrozen(selected)).toBe(true);
  });
});
