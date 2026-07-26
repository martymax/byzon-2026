'use client';

import {
  type ApiFailure,
  type IdentityBootstrapProblem,
  type IdentityBootstrapResponse,
  type RequestId,
} from '@byzon/domain/contracts';
import { useCallback, useEffect, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserIdentityApi,
  requestIdentityBootstrap,
} from '@/lib/identity-api';

export type IdentityBootstrapState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: IdentityBootstrapResponse }
  | { readonly status: 'offline' }
  | { readonly status: 'session_expired' }
  | { readonly status: 'permission' }
  | { readonly status: 'error'; readonly requestId?: RequestId };

const mapFailure = (
  failure: ApiFailure<IdentityBootstrapProblem>,
): IdentityBootstrapState | null => {
  switch (failure.kind) {
    case 'aborted':
      return null;
    case 'offline':
      return { status: 'offline' };
    case 'session_expired':
      return { status: 'session_expired' };
    case 'problem':
      if (
        failure.problem.code === 'AUTHENTICATION_REQUIRED' ||
        failure.problem.code === 'AUTH_SESSION_EXPIRED'
      ) {
        return { status: 'session_expired' };
      }
      if (failure.problem.code === 'EVENT_ACCESS_DENIED') {
        return { status: 'permission' };
      }
      return { status: 'error', requestId: failure.problem.requestId };
    case 'invalid_response':
    case 'transport':
      return {
        status: 'error',
        ...(failure.requestId ? { requestId: failure.requestId } : {}),
      };
    case 'timeout':
      return { status: 'error' };
  }
};

export const useIdentityBootstrap = (
  api: ApiPort = browserIdentityApi,
): {
  readonly state: IdentityBootstrapState;
  readonly revision: number;
  readonly retry: () => void;
} => {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<
    IdentityBootstrapState & { readonly attempt: number }
  >({
    status: 'loading',
    attempt: 0,
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void requestIdentityBootstrap(api, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok && result.kind === 'success') {
          setRevision((value) => value + 1);
          setState({ status: 'ready', data: result.data, attempt });
          return;
        }
        if (!result.ok) {
          const mapped = mapFailure(result.failure);
          if (mapped) setState({ ...mapped, attempt });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: 'error', attempt });
        }
      });
    return () => controller.abort();
  }, [api, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const current: IdentityBootstrapState =
    state.attempt === attempt ? state : { status: 'loading' };

  return {
    state: current,
    revision,
    retry,
  };
};
