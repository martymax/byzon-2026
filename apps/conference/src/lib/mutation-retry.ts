import type { ApiFailure, ApiProblem } from '@byzon/domain/contracts';

/**
 * A mutation key must survive every result where the server may already have
 * committed the side effect. Only authoritative session failures and
 * deterministic business problems allow the caller to mint a new key.
 */
export const shouldRetainMutationKey = <Problem extends ApiProblem>(
  failure: ApiFailure<Problem>,
): boolean => {
  switch (failure.kind) {
    case 'aborted':
    case 'offline':
    case 'timeout':
    case 'transport':
    case 'invalid_response':
      return true;
    case 'session_expired':
      return false;
    case 'problem':
      return (
        failure.problem.code === 'INTERNAL_ERROR' ||
        failure.problem.code === 'IDEMPOTENCY_IN_PROGRESS'
      );
  }
};
