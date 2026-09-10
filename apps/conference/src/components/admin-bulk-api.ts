import type { ApiProblem } from '@byzon/domain/contracts';
import type { ApiResult } from '@/lib/api/endpoint';
import type { AdminBulkResult } from './admin-bulk';
import {
  adminFailureMessage,
  isAdminSecurityFailure,
  isAmbiguousAdminMutationFailure,
  isStaleAdminFailure,
} from './admin-workspace-runtime';

export const adminBulkApiResult = (
  result: ApiResult<unknown, ApiProblem>,
  invalidate: (message: string) => void,
): AdminBulkResult => {
  if (result.ok)
    return result.kind === 'success'
      ? { ok: true }
      : {
          ok: false,
          stop: true,
          message: 'Server nepotvrdil změnu. Načtěte aktuální stav.',
        };
  const message = adminFailureMessage(
    result.failure,
    result.metadata?.requestId,
  );
  if (isAdminSecurityFailure(result)) invalidate(message);
  return {
    ok: false,
    message,
    stop:
      isAdminSecurityFailure(result) ||
      isAmbiguousAdminMutationFailure(result) ||
      isStaleAdminFailure(result.failure) ||
      result.status === 429 ||
      (result.status ?? 0) >= 500,
  };
};
