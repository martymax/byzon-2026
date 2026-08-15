'use client';

import type {
  ApiFailure,
  IdentityBootstrapProblem,
  IdentityBootstrapResponse,
  IdentityPrivacyRequestResponse,
  IdentityProfileUpdateResponse,
  RequestId,
} from '@byzon/domain/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserIdentityApi,
  requestIdentityBootstrap,
} from '@/lib/identity-api';
import {
  invalidateParticipantPrivateResources,
  privateResourceInvalidationReason,
  subscribeToPrivateResourceInvalidation,
} from '@/lib/private-resource-events';

export type ParticipantAccountResourceState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly data: IdentityBootstrapResponse;
      readonly scopeKey: string;
    }
  | { readonly status: 'offline' }
  | { readonly status: 'session_expired' }
  | { readonly status: 'cleared' }
  | { readonly status: 'pending_activation' }
  | { readonly status: 'permission' }
  | {
      readonly status: 'suspended' | 'revoked';
      readonly supportReference: string;
    }
  | { readonly status: 'error'; readonly requestId?: RequestId };

export interface ParticipantAccountResourceValue {
  readonly state: ParticipantAccountResourceState;
  readonly revision: number;
  readonly activate: () => void;
  readonly retry: () => void;
  readonly discardPrivateData: (
    status: 'session_expired' | 'permission',
  ) => void;
  readonly clearPrivateData: (
    reason?: 'logout' | 'switch_account',
  ) => Promise<'cleared' | 'none_present'>;
  readonly commitProfile: (
    response: IdentityProfileUpdateResponse,
    expectedVersion: number,
  ) => boolean;
  readonly commitPrivacyRequest: (
    response: IdentityPrivacyRequestResponse,
    expectedKind: 'data_deletion',
  ) => boolean;
}

export type ParticipantAccountScope =
  | { readonly kind: 'active'; readonly eventId: string }
  | { readonly kind: 'archived'; readonly eventFingerprint: string }
  | { readonly kind: 'unavailable' };

const ParticipantAccountResourceContext =
  createContext<ParticipantAccountResourceValue | null>(null);

const mapFailure = (
  failure: ApiFailure<IdentityBootstrapProblem>,
): ParticipantAccountResourceState | null => {
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

const safeBootstrapState = (
  data: IdentityBootstrapResponse,
  scopeKind: ParticipantAccountScope['kind'],
  expectedEventId: string | null,
  scopeKey: string,
  archivedScopeMatched: boolean,
): ParticipantAccountResourceState => {
  if (scopeKind === 'unavailable') {
    return { status: 'permission' };
  }
  if (
    scopeKind === 'active' &&
    (data.event.id !== expectedEventId ||
      data.event.phase === 'draft' ||
      data.event.phase === 'archived')
  ) {
    return { status: 'permission' };
  }
  if (
    scopeKind === 'archived' &&
    (!archivedScopeMatched ||
      data.event.phase !== 'archived' ||
      (data.profileManagement.state !== 'read_only' &&
        data.profileManagement.state !== 'removed'))
  ) {
    return { status: 'permission' };
  }
  const access = data.membership.access;
  if (access.state === 'suspended' || access.state === 'revoked') {
    return {
      status: access.state,
      supportReference: access.supportReference,
    };
  }
  if (access.state === 'pending_activation') {
    return { status: 'pending_activation' };
  }
  if (!data.membership.roles.includes('participant')) {
    return { status: 'permission' };
  }
  return { status: 'ready', data, scopeKey };
};

const PARTICIPANT_ACCOUNT_SCOPE_DOMAIN =
  'byzon:participant-account-scope:v1\u0000';

const archiveEventFingerprint = async (
  eventId: string,
): Promise<string | null> => {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${PARTICIPANT_ACCOUNT_SCOPE_DOMAIN}${eventId}`),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
};

export const ParticipantAccountResourceProvider = ({
  api = browserIdentityApi,
  children,
  scope,
}: {
  readonly api?: ApiPort;
  readonly children: ReactNode;
  readonly scope: ParticipantAccountScope;
}) => {
  const [active, setActive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<ParticipantAccountResourceState>({
    status: 'idle',
  });
  const stateRef = useRef(state);
  const requestEpoch = useRef(0);
  const scopeKind = scope.kind;
  const expectedEventId = scope.kind === 'active' ? scope.eventId : null;
  const archivedEventFingerprint =
    scope.kind === 'archived' ? scope.eventFingerprint : null;
  const archivedScopeIsValid =
    archivedEventFingerprint === null ||
    /^[0-9a-f]{64}$/.test(archivedEventFingerprint);
  const scopeKey =
    scope.kind === 'active'
      ? `active:${scope.eventId}`
      : scope.kind === 'archived'
        ? `archived:${scope.eventFingerprint}`
        : 'unavailable';
  const storeState = useCallback((next: ParticipantAccountResourceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    if (!active) return;
    if (scopeKind === 'unavailable' || !archivedScopeIsValid) {
      requestEpoch.current += 1;
      void invalidateParticipantPrivateResources('permission');
      return;
    }
    const epoch = ++requestEpoch.current;
    const controller = new AbortController();
    void requestIdentityBootstrap(api, controller.signal)
      .then(async (result) => {
        if (controller.signal.aborted || requestEpoch.current !== epoch) {
          return;
        }
        if (result.ok && result.kind === 'success') {
          const archivedScopeMatched =
            scopeKind !== 'archived' ||
            (await archiveEventFingerprint(result.data.event.id)) ===
              archivedEventFingerprint;
          if (controller.signal.aborted || requestEpoch.current !== epoch) {
            return;
          }
          const next = safeBootstrapState(
            result.data,
            scopeKind,
            expectedEventId,
            scopeKey,
            archivedScopeMatched,
          );
          if (next.status !== 'ready') {
            void invalidateParticipantPrivateResources('permission');
          }
          storeState(next);
          setRevision((value) => value + 1);
          return;
        }
        if (!result.ok) {
          const invalidation = privateResourceInvalidationReason(
            result.failure,
            result.status,
          );
          if (invalidation) {
            void invalidateParticipantPrivateResources(invalidation);
            requestEpoch.current += 1;
            setActive(false);
            storeState({ status: invalidation });
            return;
          }
          const next = mapFailure(result.failure);
          if (next) storeState(next);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && requestEpoch.current === epoch) {
          storeState({ status: 'error' });
        }
      });
    return () => controller.abort();
  }, [
    active,
    api,
    archivedEventFingerprint,
    archivedScopeIsValid,
    attempt,
    expectedEventId,
    scopeKey,
    scopeKind,
    storeState,
  ]);

  const activate = useCallback(() => {
    if (scopeKind === 'unavailable' || !archivedScopeIsValid) {
      void invalidateParticipantPrivateResources('permission');
      requestEpoch.current += 1;
      setActive(false);
      storeState({ status: 'permission' });
      return;
    }
    if (
      stateRef.current.status !== 'idle' &&
      stateRef.current.status !== 'ready'
    ) {
      return;
    }
    storeState({ status: 'loading' });
    setActive(true);
    setAttempt((value) => value + 1);
  }, [archivedScopeIsValid, scopeKind, storeState]);
  const retry = useCallback(() => {
    if (scopeKind === 'unavailable' || !archivedScopeIsValid) {
      void invalidateParticipantPrivateResources('permission');
      requestEpoch.current += 1;
      setActive(false);
      storeState({ status: 'permission' });
      return;
    }
    storeState({ status: 'loading' });
    setActive(true);
    setAttempt((value) => value + 1);
  }, [archivedScopeIsValid, scopeKind, storeState]);

  const applyDiscardPrivateData = useCallback(
    (status: 'session_expired' | 'permission') => {
      if (stateRef.current.status === status) {
        setActive(false);
        return;
      }
      requestEpoch.current += 1;
      setActive(false);
      storeState({ status });
    },
    [storeState],
  );
  const discardPrivateData = useCallback(
    (status: 'session_expired' | 'permission') => {
      void invalidateParticipantPrivateResources(status);
      applyDiscardPrivateData(status);
    },
    [applyDiscardPrivateData],
  );
  const clearPrivateData = useCallback(
    async (reason: 'logout' | 'switch_account' = 'logout') => {
      const disposition =
        stateRef.current.status === 'ready' ? 'cleared' : 'none_present';
      await invalidateParticipantPrivateResources('session_expired', reason);
      requestEpoch.current += 1;
      setActive(false);
      storeState({ status: 'cleared' });
      return disposition;
    },
    [storeState],
  );

  useEffect(
    () => subscribeToPrivateResourceInvalidation(applyDiscardPrivateData),
    [applyDiscardPrivateData],
  );

  const commitProfile = useCallback(
    (
      response: IdentityProfileUpdateResponse,
      expectedVersion: number,
    ): boolean => {
      const current = stateRef.current;
      if (
        current.status !== 'ready' ||
        current.scopeKey !== scopeKey ||
        current.data.event.id !== response.eventId ||
        current.data.user.id !== response.userId ||
        current.data.profileManagement.state !== 'editable' ||
        current.data.profileManagement.version !== expectedVersion ||
        response.profileManagement.state !== 'editable' ||
        response.profileManagement.version !== expectedVersion + 1
      ) {
        return false;
      }
      storeState({
        status: 'ready',
        scopeKey: current.scopeKey,
        data: {
          ...current.data,
          profile: response.profile,
          profileManagement: response.profileManagement,
        },
      });
      setRevision((value) => value + 1);
      return true;
    },
    [scopeKey, storeState],
  );

  const commitPrivacyRequest = useCallback(
    (
      response: IdentityPrivacyRequestResponse,
      expectedKind: 'data_deletion',
    ): boolean => {
      const current = stateRef.current;
      const key = 'deletionRequest';
      if (
        current.status !== 'ready' ||
        current.scopeKey !== scopeKey ||
        current.data.event.id !== response.eventId ||
        current.data.user.id !== response.userId ||
        response.request.kind !== expectedKind ||
        current.data.privacy[key] !== 'available'
      ) {
        return false;
      }
      storeState({
        status: 'ready',
        scopeKey: current.scopeKey,
        data: {
          ...current.data,
          privacy: {
            ...current.data.privacy,
            [key]: response.request.state,
          },
        },
      });
      setRevision((value) => value + 1);
      return true;
    },
    [scopeKey, storeState],
  );

  const scopedState = useMemo<ParticipantAccountResourceState>(
    () =>
      state.status === 'ready' && state.scopeKey !== scopeKey
        ? { status: 'permission' }
        : state,
    [scopeKey, state],
  );

  const value = useMemo<ParticipantAccountResourceValue>(
    () => ({
      state: scopedState,
      revision,
      activate,
      retry,
      discardPrivateData,
      clearPrivateData,
      commitProfile,
      commitPrivacyRequest,
    }),
    [
      activate,
      clearPrivateData,
      discardPrivateData,
      commitPrivacyRequest,
      commitProfile,
      retry,
      revision,
      scopedState,
    ],
  );

  return (
    <ParticipantAccountResourceContext.Provider value={value}>
      {children}
    </ParticipantAccountResourceContext.Provider>
  );
};

export const useParticipantAccountResourceOptional =
  (): ParticipantAccountResourceValue | null => {
    const resource = useContext(ParticipantAccountResourceContext);
    const activate = resource?.activate;
    const [mountSnapshot] = useState(() =>
      resource
        ? {
            revision: resource.revision,
            status: resource.state.status,
          }
        : null,
    );
    useEffect(() => activate?.(), [activate]);
    if (!resource || !mountSnapshot) return null;
    return resource.state.status === 'idle' ||
      (mountSnapshot.status === 'ready' &&
        resource.state.status === 'ready' &&
        resource.revision === mountSnapshot.revision)
      ? { ...resource, state: { status: 'loading' } }
      : resource;
  };

export const useParticipantAccountResource =
  (): ParticipantAccountResourceValue => {
    const resource = useParticipantAccountResourceOptional();
    if (!resource) {
      throw new Error(
        'useParticipantAccountResource must be used inside ParticipantAccountResourceProvider.',
      );
    }
    return resource;
  };
