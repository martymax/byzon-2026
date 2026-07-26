import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  FixtureValidationError,
  defineFixtureFactory,
  defineFixtureSet,
  validateFixture,
} from './fixture-harness.js';

const exampleSchema = z.strictObject({
  id: z.string().min(1),
  nested: z.strictObject({ count: z.number().int().nonnegative() }),
});

describe('fixture validation harness', () => {
  it('returns deeply frozen, independent and deterministic fixtures', () => {
    const factory = defineFixtureFactory({
      name: 'example',
      schema: exampleSchema,
      defaults: { id: 'fixture-1', nested: { count: 1 } },
    });

    const first = factory.create();
    const second = factory.create();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.nested).not.toBe(second.nested);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.nested)).toBe(true);
  });

  it('validates every transformed variant against the same schema', () => {
    const factory = defineFixtureFactory({
      name: 'example',
      schema: exampleSchema,
      defaults: { id: 'fixture-1', nested: { count: 1 } },
    });

    expect(
      factory.create('empty-count', (base) => ({
        ...base,
        nested: { count: 0 },
      })),
    ).toMatchObject({ nested: { count: 0 } });
    expect(() =>
      factory.create('invalid-count', (base) => ({
        ...base,
        nested: { count: -1 },
      })),
    ).toThrow(FixtureValidationError);
  });

  it('validates named fixture sets at definition time', () => {
    const fixtures = defineFixtureSet({
      name: 'examples',
      schema: exampleSchema,
      fixtures: {
        empty: { id: 'empty', nested: { count: 0 } },
        populated: { id: 'populated', nested: { count: 2 } },
      },
    });

    expect(Object.keys(fixtures)).toEqual(['empty', 'populated']);
    expect(Object.isFrozen(fixtures.populated)).toBe(true);
  });

  it('redacts invalid fixture values from validation errors', () => {
    const secret = 'raw-secret-must-not-leak';

    try {
      validateFixture({
        name: 'redaction.invalid',
        schema: exampleSchema,
        value: { id: secret, nested: { count: -1 }, extra: secret },
      });
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(FixtureValidationError);
      expect(JSON.stringify(error)).not.toContain(secret);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('rejects non-JSON output and unsafe fixture names', () => {
    expect(() =>
      validateFixture({
        name: 'date.invalid',
        schema: z.coerce.string(),
        value: new Date('2026-07-23T00:00:00.000Z'),
      }),
    ).toThrow(FixtureValidationError);
    expect(() =>
      validateFixture({
        name: '../unsafe',
        schema: z.string(),
        value: 'fixture',
      }),
    ).toThrow(TypeError);
  });
});
