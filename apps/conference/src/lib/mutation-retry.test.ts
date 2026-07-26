import { problemTypeForCode } from '@byzon/domain/contracts';
import { describe, expect, it } from 'vitest';

import { shouldRetainMutationKey } from './mutation-retry';

describe('ambiguous mutation retry policy', () => {
  it.each([
    { kind: 'aborted' },
    { kind: 'offline' },
    { kind: 'timeout' },
    { kind: 'transport' },
    { kind: 'invalid_response' },
  ] as const)('retains a key after $kind', (failure) => {
    expect(shouldRetainMutationKey(failure)).toBe(true);
  });

  it('retains a key after an internal server error', () => {
    expect(
      shouldRetainMutationKey({
        kind: 'problem',
        problem: {
          type: problemTypeForCode('INTERNAL_ERROR'),
          title: 'Internal error',
          status: 500,
          code: 'INTERNAL_ERROR',
          detail: 'The outcome is unknown.',
          requestId: 'retry-policy-0001',
        },
      }),
    ).toBe(true);
  });

  it('retains a key while the original request is still in progress', () => {
    expect(
      shouldRetainMutationKey({
        kind: 'problem',
        problem: {
          type: problemTypeForCode('IDEMPOTENCY_IN_PROGRESS'),
          title: 'Still running',
          status: 409,
          code: 'IDEMPOTENCY_IN_PROGRESS',
          detail: 'Retry later with the same key.',
          requestId: 'retry-policy-0002',
        },
      }),
    ).toBe(true);
  });

  it('rotates after an authoritative session failure', () => {
    expect(
      shouldRetainMutationKey({
        kind: 'session_expired',
        problem: {
          type: problemTypeForCode('AUTH_SESSION_EXPIRED'),
          title: 'Session expired',
          status: 401,
          code: 'AUTH_SESSION_EXPIRED',
          detail: 'Authenticate again.',
          requestId: 'retry-policy-0003',
        },
      }),
    ).toBe(false);
  });

  it.each([
    ['CLAIM_RATE_LIMITED', 429],
    ['IDEMPOTENCY_KEY_REUSED', 409],
  ] as const)('rotates after deterministic %s', (code, status) => {
    expect(
      shouldRetainMutationKey({
        kind: 'problem',
        problem: {
          type: problemTypeForCode(code),
          title: 'Deterministic outcome',
          status,
          code,
          detail: 'The request can be changed or deliberately retried.',
          requestId: 'retry-policy-0004',
        },
      }),
    ).toBe(false);
  });
});
