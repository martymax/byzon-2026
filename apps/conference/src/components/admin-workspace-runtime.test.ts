import { describe, expect, it } from 'vitest';

import {
  isAdminSecurityFailure,
  isAmbiguousAdminMutationFailure,
} from './admin-workspace-runtime';

describe('admin failure classification', () => {
  it.each([401, 403])(
    'treats a malformed top-level %s as a security failure, never as retryable',
    (status) => {
      const result = {
        status,
        failure: {
          kind: 'invalid_response' as const,
          requestId: 'admin-malformed-security-0001',
        },
      };

      expect(isAdminSecurityFailure(result)).toBe(true);
      expect(isAmbiguousAdminMutationFailure(result)).toBe(false);
    },
  );

  it('keeps a non-security invalid success response eligible only for exact retry', () => {
    const result = {
      status: 200,
      failure: {
        kind: 'invalid_response' as const,
        requestId: 'admin-invalid-success-0001',
      },
    };

    expect(isAdminSecurityFailure(result)).toBe(false);
    expect(isAmbiguousAdminMutationFailure(result)).toBe(true);
  });
});
