import type { ApiFailure, ApiProblem } from '@byzon/domain/contracts';

export type PrivateResourceInvalidationReason =
  'permission' | 'session_expired';

type Listener = (reason: PrivateResourceInvalidationReason) => void;

const listeners = new Set<Listener>();

export const privateResourceInvalidationReason = <Problem extends ApiProblem>(
  failure: ApiFailure<Problem>,
  status?: number,
): PrivateResourceInvalidationReason | null => {
  if (status === 401) return 'session_expired';
  if (status === 403) return 'permission';
  if (failure.kind === 'session_expired') return 'session_expired';
  if (failure.kind !== 'problem') return null;
  if (
    failure.problem.code === 'AUTHENTICATION_REQUIRED' ||
    failure.problem.code === 'AUTH_SESSION_EXPIRED'
  ) {
    return 'session_expired';
  }
  return failure.problem.code === 'EVENT_ACCESS_DENIED' ? 'permission' : null;
};

export const invalidateParticipantPrivateResources = (
  reason: PrivateResourceInvalidationReason,
): void => {
  for (const listener of listeners) listener(reason);
};

export const subscribeToPrivateResourceInvalidation = (
  listener: Listener,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
