'use client';

import type {
  AgendaTimeConflictWarning,
  ParticipantAgendaMutationProblem,
  ParticipantAgendaMutationResponse,
  ParticipantAgendaResponse,
} from '@byzon/domain/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserAgendaApi,
  mutateParticipantAgenda,
  requestParticipantAgenda,
  type ParticipantAgendaMutationInput,
} from '@/lib/agenda-api';
import {
  invalidateParticipantPrivateResources,
  privateResourceInvalidationReason,
  subscribeToPrivateResourceInvalidation,
  type PrivateResourceInvalidationReason,
} from '@/lib/private-resource-events';

import {
  useParticipantAccountResourceOptional,
  type ParticipantAccountResourceState,
} from './participant-account-resource';
import {
  mapParticipantAgendaMutationFailure,
  mapParticipantAgendaReadFailure,
  type AgendaMutationFeedback,
  type AgendaReadFailureState,
} from './participant-agenda-failures';
import type { AgendaMutationIntent } from './participant-agenda-model';

export type ParticipantAgendaResourceState =
  | AgendaReadFailureState
  | {
      readonly status: 'ready';
      readonly data: ParticipantAgendaResponse;
      readonly scopeKey: string;
    };

export type AgendaConflict = AgendaTimeConflictWarning & {
  readonly action: 'accept_offer' | 'add' | 'reserve';
};

interface PendingAgendaMutation {
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly intent: AgendaMutationIntent;
  readonly scopeKey: string;
}

export interface ParticipantAgendaResource {
  readonly conflict: AgendaConflict | null;
  readonly feedback: AgendaMutationFeedback | null;
  readonly pending: AgendaMutationIntent | null;
  readonly readOnly: boolean;
  readonly state: ParticipantAgendaResourceState;
  readonly dismissConflict: () => void;
  readonly dismissFeedback: () => void;
  readonly mutate: (intent: AgendaMutationIntent) => Promise<void>;
  readonly retry: () => void;
  readonly retryMutation: () => Promise<void>;
}

const createAgendaIdempotencyKey = (): string => {
  const suffix =
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `agenda-action:${suffix}`;
};

const accountFailureState = (
  status: ParticipantAccountResourceState['status'],
): AgendaReadFailureState => {
  switch (status) {
    case 'idle':
    case 'loading':
      return { status: 'loading' };
    case 'offline':
      return { status: 'offline' };
    case 'session_expired':
    case 'cleared':
      return { status: 'session_expired' };
    case 'error':
      return { status: 'error' };
    case 'pending_activation':
    case 'permission':
    case 'revoked':
    case 'suspended':
      return { status: 'permission' };
    case 'ready':
      return { status: 'loading' };
  }
};

const mutationInput = (
  intent: AgendaMutationIntent,
  expectedVersion: number,
): ParticipantAgendaMutationInput => {
  switch (intent.action) {
    case 'accept_offer':
    case 'decline_offer':
      return {
        action: intent.action,
        expectedVersion,
        offerId: intent.offerId,
        sessionId: intent.sessionId,
      };
    case 'registration_estimate':
      return {
        action: intent.action,
        expectedVersion,
        registered: intent.registered,
        sessionId: intent.sessionId,
      };
    default:
      return {
        action: intent.action,
        expectedVersion,
        sessionId: intent.sessionId,
      };
  }
};

const mutationMatchesIntent = (
  response: ParticipantAgendaMutationResponse,
  intent: AgendaMutationIntent,
): boolean => {
  if (
    response.mutation.action !== intent.action ||
    response.mutation.sessionId !== intent.sessionId
  ) {
    return false;
  }
  if (intent.action === 'accept_offer' || intent.action === 'decline_offer') {
    return (
      response.mutation.action === intent.action &&
      response.mutation.offerId === intent.offerId
    );
  }
  if (intent.action === 'registration_estimate') {
    return (
      response.mutation.action === 'registration_estimate' &&
      response.mutation.registered === intent.registered
    );
  }
  return true;
};

const snapshotFromMutation = (
  response: ParticipantAgendaMutationResponse,
): ParticipantAgendaResponse => {
  const { mutation, timeConflict, ...snapshot } = response;
  void mutation;
  void timeConflict;
  return snapshot;
};

const conflictFromMutation = (
  response: ParticipantAgendaMutationResponse,
): AgendaConflict | null => {
  if (response.timeConflict === null) return null;
  switch (response.mutation.action) {
    case 'accept_offer':
    case 'add':
    case 'reserve':
      return {
        ...response.timeConflict,
        action: response.mutation.action,
      };
    default:
      return null;
  }
};

const canonicalProblemAgenda = (
  problem: ParticipantAgendaMutationProblem,
): ParticipantAgendaResponse | null =>
  'agenda' in problem ? problem.agenda : null;

const readStateForInvalidation = (
  reason: PrivateResourceInvalidationReason,
): AgendaReadFailureState =>
  reason === 'permission'
    ? { status: 'permission' }
    : { status: 'session_expired' };

export const useParticipantAgendaResource = (
  expectedEventId: string,
  api: ApiPort = browserAgendaApi,
): ParticipantAgendaResource => {
  const account = useParticipantAccountResourceOptional();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ParticipantAgendaResourceState>({
    status: 'loading',
  });
  const [pending, setPending] = useState<AgendaMutationIntent | null>(null);
  const [feedback, setFeedback] = useState<AgendaMutationFeedback | null>(null);
  const [conflict, setConflict] = useState<AgendaConflict | null>(null);
  const stateRef = useRef(state);
  const pendingAttempt = useRef<PendingAgendaMutation | null>(null);
  const mutationLock = useRef(false);
  const reconciliationRequired = useRef(false);
  const readEpoch = useRef(0);
  const mutationEpoch = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const activeAccountIdentity = useRef<string | null>(null);

  const accountState: ParticipantAccountResourceState = account?.state ?? {
    status: 'permission',
  };
  const accountStatus = accountState.status;
  const accountEventId =
    accountState.status === 'ready' ? accountState.data.event.id : null;
  const accountUserId =
    accountState.status === 'ready' ? accountState.data.user.id : null;
  const accountPhase =
    accountState.status === 'ready' ? accountState.data.event.phase : null;
  const accountTimezone =
    accountState.status === 'ready' ? accountState.data.event.timezone : null;
  const scopeKey =
    accountEventId && accountUserId
      ? `${accountEventId}:${accountUserId}`
      : null;
  const readOnly =
    accountPhase !== null &&
    accountPhase !== 'activation_open' &&
    accountPhase !== 'live';

  const storeState = useCallback((next: ParticipantAgendaResourceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearTransientState = useCallback(() => {
    pendingAttempt.current = null;
    reconciliationRequired.current = false;
    setPending(null);
    setFeedback(null);
    setConflict(null);
  }, []);

  const applyInvalidation = useCallback(
    (reason: PrivateResourceInvalidationReason) => {
      readEpoch.current += 1;
      mutationEpoch.current += 1;
      mutationLock.current = false;
      readController.current?.abort();
      mutationController.current?.abort();
      clearTransientState();
      storeState(readStateForInvalidation(reason));
    },
    [clearTransientState, storeState],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      readController.current?.abort();
      mutationController.current?.abort();
    };
  }, []);

  useEffect(
    () => subscribeToPrivateResourceInvalidation(applyInvalidation),
    [applyInvalidation],
  );

  /* eslint-disable react-hooks/set-state-in-effect -- This effect owns the
     remote resource lifecycle. An account identity transition must atomically
     abort and mask the previous principal's private state before a new read. */
  useEffect(() => {
    const accountIdentity = JSON.stringify([
      accountStatus,
      accountEventId,
      accountUserId,
      accountTimezone,
    ]);
    if (activeAccountIdentity.current !== accountIdentity) {
      activeAccountIdentity.current = accountIdentity;
      readEpoch.current += 1;
      mutationEpoch.current += 1;
      readController.current?.abort();
      mutationController.current?.abort();
      readController.current = null;
      mutationController.current = null;
      mutationLock.current = false;
      clearTransientState();
    }

    readController.current?.abort();
    const epoch = ++readEpoch.current;

    if (
      accountStatus !== 'ready' ||
      !accountEventId ||
      !accountUserId ||
      !scopeKey
    ) {
      clearTransientState();
      storeState(accountFailureState(accountStatus));
      return;
    }

    if (accountEventId !== expectedEventId) {
      invalidateParticipantPrivateResources('permission');
      return;
    }

    const controller = new AbortController();
    readController.current = controller;
    clearTransientState();
    storeState({ status: 'loading' });

    void requestParticipantAgenda(api, controller.signal)
      .then((result) => {
        if (
          controller.signal.aborted ||
          !mounted.current ||
          readEpoch.current !== epoch
        ) {
          return;
        }
        if (result.ok) {
          if (
            result.kind !== 'success' ||
            result.data.eventId !== expectedEventId ||
            result.data.eventId !== accountEventId ||
            result.data.userId !== accountUserId ||
            result.data.eventTimezone !== accountTimezone
          ) {
            invalidateParticipantPrivateResources('permission');
            return;
          }
          storeState({
            status: 'ready',
            data: result.data,
            scopeKey,
          });
          return;
        }

        const invalidation = privateResourceInvalidationReason(
          result.failure,
          result.status,
        );
        if (invalidation) {
          invalidateParticipantPrivateResources(invalidation);
          return;
        }
        const mapped = mapParticipantAgendaReadFailure(result.failure);
        if (mapped) storeState(mapped);
      })
      .catch(() => {
        if (
          !controller.signal.aborted &&
          mounted.current &&
          readEpoch.current === epoch
        ) {
          storeState({ status: 'error' });
        }
      });

    return () => controller.abort();
  }, [
    accountEventId,
    accountStatus,
    accountTimezone,
    accountUserId,
    api,
    attempt,
    clearTransientState,
    expectedEventId,
    scopeKey,
    storeState,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  const executeMutation = useCallback(
    async (request: PendingAgendaMutation): Promise<void> => {
      if (mutationLock.current) return;
      mutationLock.current = true;
      const current = stateRef.current;
      if (
        reconciliationRequired.current ||
        pending !== null ||
        current.status !== 'ready' ||
        current.scopeKey !== request.scopeKey ||
        current.data.version !== request.expectedVersion ||
        current.data.eventId !== expectedEventId ||
        current.data.eventId !== accountEventId ||
        current.data.userId !== accountUserId ||
        readOnly
      ) {
        pendingAttempt.current = null;
        mutationLock.current = false;
        return;
      }

      const epoch = ++mutationEpoch.current;
      const controller = new AbortController();
      mutationController.current?.abort();
      mutationController.current = controller;
      pendingAttempt.current = request;
      setPending(request.intent);
      setFeedback(null);
      setConflict(null);

      try {
        const result = await mutateParticipantAgenda(
          api,
          mutationInput(request.intent, request.expectedVersion),
          request.idempotencyKey,
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          !mounted.current ||
          mutationEpoch.current !== epoch
        ) {
          return;
        }

        if (result.ok) {
          const latest = stateRef.current;
          if (
            result.kind !== 'success' ||
            latest.status !== 'ready' ||
            latest.scopeKey !== request.scopeKey ||
            latest.data.version !== request.expectedVersion ||
            result.data.eventId !== expectedEventId ||
            result.data.eventId !== accountEventId ||
            result.data.userId !== accountUserId ||
            result.data.eventTimezone !== accountTimezone ||
            (result.data.mutation.outcome === 'applied'
              ? result.data.version <= request.expectedVersion
              : result.data.version < request.expectedVersion) ||
            !mutationMatchesIntent(result.data, request.intent)
          ) {
            pendingAttempt.current = null;
            invalidateParticipantPrivateResources('permission');
            return;
          }
          pendingAttempt.current = null;
          reconciliationRequired.current = false;
          storeState({
            status: 'ready',
            data: snapshotFromMutation(result.data),
            scopeKey: request.scopeKey,
          });
          setConflict(conflictFromMutation(result.data));
          return;
        }

        const invalidation = privateResourceInvalidationReason(
          result.failure,
          result.status,
        );
        if (invalidation) {
          pendingAttempt.current = null;
          invalidateParticipantPrivateResources(invalidation);
          return;
        }

        if (result.failure.kind === 'problem') {
          const problem = result.failure.problem;
          const canonical = canonicalProblemAgenda(problem);
          if (canonical) {
            const problemSessionId =
              'sessionId' in problem ? problem.sessionId : null;
            const offerMismatch =
              problem.code === 'OFFER_EXPIRED' &&
              (request.intent.action !== 'accept_offer' &&
              request.intent.action !== 'decline_offer'
                ? true
                : problem.offerId !== request.intent.offerId);
            const latest = stateRef.current;
            if (
              offerMismatch ||
              (problemSessionId !== null &&
                problemSessionId !== request.intent.sessionId) ||
              canonical.eventId !== expectedEventId ||
              canonical.eventId !== accountEventId ||
              canonical.userId !== accountUserId ||
              canonical.eventTimezone !== accountTimezone
            ) {
              pendingAttempt.current = null;
              invalidateParticipantPrivateResources('permission');
              return;
            }
            if (
              latest.status !== 'ready' ||
              latest.scopeKey !== request.scopeKey ||
              latest.data.version !== request.expectedVersion ||
              canonical.version < latest.data.version
            ) {
              pendingAttempt.current = null;
              reconciliationRequired.current = true;
              setFeedback({ kind: 'error', retry: 'read' });
              return;
            }
            storeState({
              status: 'ready',
              data: canonical,
              scopeKey: request.scopeKey,
            });
          }
        }

        const mapped = mapParticipantAgendaMutationFailure(result.failure);
        if (mapped) {
          if (mapped.kind === 'disabled') {
            pendingAttempt.current = null;
            reconciliationRequired.current = false;
            storeState({ status: 'disabled' });
            return;
          }
          if (mapped.retry !== 'mutation') pendingAttempt.current = null;
          reconciliationRequired.current = mapped.retry === 'read';
          setFeedback(mapped);
        }
      } catch {
        if (!controller.signal.aborted && mounted.current) {
          setFeedback({ kind: 'error', retry: 'mutation' });
        }
      } finally {
        if (mounted.current && mutationEpoch.current === epoch) {
          mutationLock.current = false;
          setPending(null);
        }
      }
    },
    [
      accountEventId,
      accountTimezone,
      accountUserId,
      api,
      expectedEventId,
      pending,
      readOnly,
      storeState,
    ],
  );

  const mutate = useCallback(
    async (intent: AgendaMutationIntent) => {
      const current = stateRef.current;
      if (
        mutationLock.current ||
        reconciliationRequired.current ||
        pendingAttempt.current !== null ||
        pending !== null ||
        current.status !== 'ready' ||
        readOnly
      ) {
        return;
      }
      await executeMutation({
        expectedVersion: current.data.version,
        idempotencyKey: createAgendaIdempotencyKey(),
        intent,
        scopeKey: current.scopeKey,
      });
    },
    [executeMutation, pending, readOnly],
  );

  const retryMutation = useCallback(async () => {
    const request = pendingAttempt.current;
    if (!request || mutationLock.current || pending !== null) return;
    await executeMutation(request);
  }, [executeMutation, pending]);

  const dismissFeedback = useCallback(() => {
    if (pendingAttempt.current !== null || reconciliationRequired.current) {
      return;
    }
    setFeedback(null);
  }, []);

  const visibleState = useMemo<ParticipantAgendaResourceState>(
    () =>
      accountStatus !== 'ready' ||
      !accountEventId ||
      !accountUserId ||
      !accountTimezone ||
      !scopeKey
        ? accountFailureState(accountStatus)
        : accountEventId !== expectedEventId
          ? { status: 'permission' }
          : state.status === 'ready' &&
              (state.scopeKey !== scopeKey ||
                state.data.eventId !== accountEventId ||
                state.data.userId !== accountUserId ||
                state.data.eventTimezone !== accountTimezone)
            ? { status: 'loading' }
            : state,
    [
      accountEventId,
      accountStatus,
      accountTimezone,
      accountUserId,
      expectedEventId,
      scopeKey,
      state,
    ],
  );
  const privateStateIsVisible = visibleState.status === 'ready';

  return useMemo(
    () => ({
      conflict: privateStateIsVisible ? conflict : null,
      dismissConflict: () => setConflict(null),
      dismissFeedback,
      feedback: privateStateIsVisible ? feedback : null,
      mutate,
      pending: privateStateIsVisible ? pending : null,
      readOnly: !privateStateIsVisible || readOnly,
      retry,
      retryMutation,
      state: visibleState,
    }),
    [
      conflict,
      dismissFeedback,
      feedback,
      mutate,
      pending,
      privateStateIsVisible,
      readOnly,
      retry,
      retryMutation,
      visibleState,
    ],
  );
};
