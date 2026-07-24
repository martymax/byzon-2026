import { defineApiProblemSchema } from '@byzon/domain/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineApiEndpoint } from './endpoint.js';

const successSchema = z.strictObject({ value: z.string() });
const problemSchema = defineApiProblemSchema('CAPACITY_FULL', 409);

const definition = {
  method: 'GET',
  requestSchema: null,
  successSchema,
  problemSchema,
  problemCodes: ['CAPACITY_FULL'],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
} as const;

describe('defineApiEndpoint', () => {
  it('freezes a valid endpoint and its explicit problem code allowlist', () => {
    const endpoint = defineApiEndpoint(definition);

    expect(endpoint).toMatchObject(definition);
    expect(Object.isFrozen(endpoint)).toBe(true);
    expect(Object.isFrozen(endpoint.problemCodes)).toBe(true);
  });

  it('rejects unsafe method policies', () => {
    expect(() =>
      defineApiEndpoint({
        ...definition,
        requestSchema: z.strictObject({ query: z.string() }),
      }),
    ).toThrow('Invalid API endpoint policy');
    expect(() =>
      defineApiEndpoint({
        ...definition,
        idempotency: 'optional',
      }),
    ).toThrow('Invalid API endpoint policy');
    expect(() =>
      defineApiEndpoint({
        ...definition,
        method: 'POST',
        retry: 'safe-read',
      }),
    ).toThrow('Invalid API endpoint policy');
    expect(() =>
      defineApiEndpoint({
        ...definition,
        method: 'HEAD',
        responseKind: 'json',
      }),
    ).toThrow('Invalid API endpoint policy');
  });

  it('rejects invalid and duplicate problem codes', () => {
    expect(() =>
      defineApiEndpoint({
        ...definition,
        problemCodes: ['invalid-code'],
      }),
    ).toThrow();
    expect(() =>
      defineApiEndpoint({
        ...definition,
        problemCodes: ['CAPACITY_FULL', 'CAPACITY_FULL'],
      }),
    ).toThrow('Duplicate API problem code');
  });
});
