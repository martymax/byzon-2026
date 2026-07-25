import type { ApiProblem } from '@byzon/domain/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  invalidateParticipantPrivateResources,
  privateResourceInvalidationReason,
  subscribeToPrivateResourceInvalidation,
} from './private-resource-events.js';

describe('participant private-resource invalidation', () => {
  it('fails closed from authoritative HTTP status even with an invalid body', () => {
    const invalidResponse = { kind: 'invalid_response' } as const;

    expect(
      privateResourceInvalidationReason<ApiProblem>(invalidResponse, 401),
    ).toBe('session_expired');
    expect(
      privateResourceInvalidationReason<ApiProblem>(invalidResponse, 403),
    ).toBe('permission');
    expect(
      privateResourceInvalidationReason<ApiProblem>(invalidResponse, 404),
    ).toBeNull();
  });

  it('broadcasts a wipe synchronously and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToPrivateResourceInvalidation(listener);

    invalidateParticipantPrivateResources('session_expired');
    unsubscribe();
    invalidateParticipantPrivateResources('permission');

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('session_expired');
  });
});
