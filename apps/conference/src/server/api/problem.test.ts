import { describe, expect, it } from 'vitest';

import { ApiProblemError, getRequestId, problemResponse } from './problem';

describe('API problem responses', () => {
  it('returns the required application/problem+json contract', async () => {
    const response = problemResponse(
      new ApiProblemError({
        status: 409,
        code: 'IDEMPOTENCY_KEY_REUSED',
        title: 'Idempotency conflict',
        detail: 'The key was already used for a different request.',
        fieldErrors: { idempotencyKey: ['must be unique per payload'] },
      }),
      'request-12345678',
    );

    expect(response.status).toBe(409);
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe('request-12345678');
    await expect(response.json()).resolves.toEqual({
      type: 'urn:byzon:problem:idempotency-key-reused',
      title: 'Idempotency conflict',
      status: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
      detail: 'The key was already used for a different request.',
      requestId: 'request-12345678',
      fieldErrors: { idempotencyKey: ['must be unique per payload'] },
    });
  });

  it('does not expose an unknown exception message', async () => {
    const response = problemResponse(
      new Error('database password raw-secret-value'),
      'request-unknown-1',
    );
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(body).not.toContain('raw-secret-value');
    expect(body).not.toContain('database password');
    expect(body).toContain('INTERNAL_ERROR');
  });

  it('accepts only bounded request IDs and replaces invalid input', () => {
    expect(
      getRequestId(new Headers({ 'x-request-id': 'client-request-123' })),
    ).toBe('client-request-123');
    expect(
      getRequestId(
        new Headers({ 'x-request-id': 'invalid request id' }),
        () => 'generated-request-id',
      ),
    ).toBe('generated-request-id');
  });
});
