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
  discardFailedOfflineAgendaQueue,
  EMPTY_OFFLINE_AGENDA_QUEUE,
  persistCanonicalOfflineAgenda,
  queueApprovedOfflineAgendaMutation,
  readOfflineAgendaQueueSummary,
  readScopedOfflineAgenda,
  retryOfflineAgendaConflict,
  syncOfflineAgendaQueue,
  type OfflineAgendaQueueSummary,
} from '@/lib/offline/offline-agenda';
import { readParticipantOfflineEpoch } from '@/lib/offline/offline-database';
import {
  OFFLINE_AGENDA_SYNC_EVENT,
  offlineAgendaReplayAvailable,
  offlineParticipantAgendaCacheAvailable,
  type ParticipantOfflineScope,
} from '@/lib/offline/offline-policy';
import {
  invalidateParticipantPrivateResources,
  privateResourceInvalidationReason,
  subscribeToPrivateResourceInvalidation,
  transitionParticipantPrivateResourceScope,
  waitForParticipantPrivateResourceCleanup,
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
  readonly action: 'add' | 'join_waitlist' | 'reserve';
};

interface PendingAgendaMutation {
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly intent: AgendaMutationIntent;
  readonly offlineIdempotencyKey: string | null;
  readonly scopeKey: string;
}

export interface ParticipantAgendaResource {
  readonly conflict: AgendaConflict | null;
  readonly feedback: AgendaMutationFeedback | null;
  readonly offline: ParticipantAgendaOfflineState;
  readonly pending: AgendaMutationIntent | null;
  readonly readOnly: boolean;
  readonly state: ParticipantAgendaResourceState;
  readonly discardFailedOfflineQueue: () => Promise<void>;
  readonly dismissConflict: () => void;
  readonly dismissFeedback: () => void;
  readonly mutate: (intent: AgendaMutationIntent) => Promise<void>;
  readonly retry: () => void;
  readonly retryOfflineQueue: () => Promise<void>;
  readonly retryMutation: () => Promise<void>;
}

export interface ParticipantAgendaOfflineState {
  readonly cached: boolean;
  readonly lastSyncedAt: string | null;
  readonly queue: OfflineAgendaQueueSummary;
  readonly syncing: boolean;
}

const feedbackForOfflineQueue = (
  queue: OfflineAgendaQueueSummary,
): AgendaMutationFeedback | null =>
  queue.failed > 0
    ? { kind: 'queue_failed', retry: 'discard' }
    : queue.conflict > 0
      ? { kind: 'queue_conflict', retry: 'sync' }
      : queue.total > 0
        ? { kind: 'queued', retry: 'none' }
        : null;

const createAgendaIdempotencyKeys = (): {
  readonly idempotencyKey: string;
  readonly offlineIdempotencyKey: string | null;
} => {
  const uuid =
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : null;
  const suffix = uuid ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    idempotencyKey: `agenda-action:${suffix}`,
    offlineIdempotencyKey: uuid,
  };
};

const isOfflineApprovedIntent = (
  intent: AgendaMutationIntent,
): intent is Extract<AgendaMutationIntent, { action: 'add' | 'remove' }> =>
  intent.action === 'add' || intent.action === 'remove';

const agendaMatchesScope = (
  data: ParticipantAgendaResponse,
  scope: ParticipantOfflineScope,
  timezone: string,
): boolean =>
  data.eventId === scope.eventId &&
  data.userId === scope.userId &&
  data.eventTimezone === timezone;

const offlineScopesMatch = (
  left: ParticipantOfflineScope | null,
  right: ParticipantOfflineScope,
): boolean => left?.eventId === right.eventId && left.userId === right.userId;

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
): ParticipantAgendaMutationInput => ({
  action: intent.action,
  expectedVersion,
  sessionId: intent.sessionId,
});

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
    case 'add':
    case 'join_waitlist':
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
  const [offline, setOffline] = useState<ParticipantAgendaOfflineState>({
    cached: false,
    lastSyncedAt: null,
    queue: EMPTY_OFFLINE_AGENDA_QUEUE,
    syncing: false,
  });
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
  const activeOfflineScope = useRef<ParticipantOfflineScope | null>(null);
  const activeOfflineEpoch = useRef<string | null>(null);

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
  const accountIdentityKey = JSON.stringify([
    accountStatus,
    accountEventId,
    accountUserId,
    accountTimezone,
  ]);
  const callbackOfflineEpoch = activeOfflineEpoch.current;
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
      activeOfflineEpoch.current = null;
      clearTransientState();
      setOffline({
        cached: false,
        lastSyncedAt: null,
        queue: EMPTY_OFFLINE_AGENDA_QUEUE,
        syncing: false,
      });
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
    if (activeAccountIdentity.current !== accountIdentityKey) {
      const previousScope = activeOfflineScope.current;
      const nextScope =
        accountEventId && accountUserId
          ? { eventId: accountEventId, userId: accountUserId }
          : null;
      if (
        previousScope &&
        (!nextScope ||
          previousScope.eventId !== nextScope.eventId ||
          previousScope.userId !== nextScope.userId)
      ) {
        void transitionParticipantPrivateResourceScope();
      }
      activeOfflineScope.current = nextScope;
      activeOfflineEpoch.current = null;
      activeAccountIdentity.current = accountIdentityKey;
      readEpoch.current += 1;
      mutationEpoch.current += 1;
      readController.current?.abort();
      mutationController.current?.abort();
      readController.current = null;
      mutationController.current = null;
      mutationLock.current = false;
      clearTransientState();
      setOffline({
        cached: false,
        lastSyncedAt: null,
        queue: EMPTY_OFFLINE_AGENDA_QUEUE,
        syncing: false,
      });
    }
    const scopeTransition = waitForParticipantPrivateResourceCleanup();

    readController.current?.abort();
    const epoch = ++readEpoch.current;

    if (
      accountStatus !== 'ready' ||
      !accountEventId ||
      !accountUserId ||
      !accountTimezone ||
      !scopeKey
    ) {
      clearTransientState();
      storeState(accountFailureState(accountStatus));
      return;
    }

    if (accountEventId !== expectedEventId) {
      void invalidateParticipantPrivateResources('permission');
      return;
    }

    const controller = new AbortController();
    const timezone = accountTimezone;
    const offlineScope: ParticipantOfflineScope = {
      eventId: accountEventId,
      userId: accountUserId,
    };
    const offlineCacheAvailable = offlineParticipantAgendaCacheAvailable();
    const epochPromise = scopeTransition.then(() => {
      if (!offlineCacheAvailable || activeOfflineEpoch.current !== null) {
        return activeOfflineEpoch.current;
      }
      return readParticipantOfflineEpoch().then((offlineEpoch) => {
        if (
          !controller.signal.aborted &&
          mounted.current &&
          readEpoch.current === epoch
        ) {
          activeOfflineEpoch.current = offlineEpoch;
        }
        return offlineEpoch;
      });
    });
    readController.current = controller;
    clearTransientState();
    storeState({ status: 'loading' });

    const exposeCachedAgenda = async (): Promise<boolean> => {
      if (!offlineCacheAvailable) return false;
      try {
        const offlineEpoch = await epochPromise;
        if (!offlineEpoch) return false;
        const [record, queue] = await Promise.all([
          readScopedOfflineAgenda(offlineScope, offlineEpoch),
          readOfflineAgendaQueueSummary(offlineScope, offlineEpoch),
        ]);
        if (
          !record ||
          !agendaMatchesScope(record.snapshot, offlineScope, timezone) ||
          controller.signal.aborted ||
          !mounted.current ||
          readEpoch.current !== epoch
        ) {
          return false;
        }
        storeState({
          status: 'ready',
          data: record.snapshot,
          scopeKey,
        });
        setOffline({
          cached: true,
          lastSyncedAt: record.lastSyncedAt,
          queue,
          syncing: false,
        });
        setFeedback(feedbackForOfflineQueue(queue));
        return true;
      } catch {
        return false;
      }
    };

    void epochPromise
      .then(() => {
        if (
          controller.signal.aborted ||
          !mounted.current ||
          readEpoch.current !== epoch
        ) {
          return null;
        }
        return requestParticipantAgenda(api, controller.signal);
      })
      .then(async (result) => {
        if (result === null) return;
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
            !agendaMatchesScope(result.data, offlineScope, timezone)
          ) {
            void invalidateParticipantPrivateResources('permission');
            return;
          }

          const onlineCanonical = result.data;
          if (!offlineCacheAvailable) {
            storeState({
              status: 'ready',
              data: onlineCanonical,
              scopeKey,
            });
            setOffline({
              cached: false,
              lastSyncedAt: null,
              queue: EMPTY_OFFLINE_AGENDA_QUEUE,
              syncing: false,
            });
            return;
          }

          const offlineEpoch = await epochPromise;
          if (!offlineEpoch) {
            storeState({ status: 'error' });
            return;
          }

          let persisted: Awaited<
            ReturnType<typeof persistCanonicalOfflineAgenda>
          >;
          let pendingQueue: OfflineAgendaQueueSummary;
          try {
            [persisted, pendingQueue] = await Promise.all([
              persistCanonicalOfflineAgenda(
                offlineScope,
                onlineCanonical,
                offlineEpoch,
              ),
              readOfflineAgendaQueueSummary(offlineScope, offlineEpoch),
            ]);
          } catch {
            if (
              !controller.signal.aborted &&
              mounted.current &&
              readEpoch.current === epoch
            ) {
              storeState({ status: 'error' });
            }
            return;
          }
          if (
            controller.signal.aborted ||
            !mounted.current ||
            readEpoch.current !== epoch
          ) {
            return;
          }

          storeState({
            status: 'ready',
            data: onlineCanonical,
            scopeKey,
          });
          if (pendingQueue.total === 0) {
            setOffline({
              cached: false,
              lastSyncedAt: persisted.lastSyncedAt,
              queue: EMPTY_OFFLINE_AGENDA_QUEUE,
              syncing: false,
            });
            return;
          }

          setOffline({
            cached: false,
            lastSyncedAt: persisted.lastSyncedAt,
            queue: pendingQueue,
            syncing: true,
          });
          try {
            const synchronized = await syncOfflineAgendaQueue(
              offlineScope,
              api,
              offlineEpoch,
            );
            if (
              controller.signal.aborted ||
              !mounted.current ||
              readEpoch.current !== epoch
            ) {
              return;
            }
            if (synchronized.invalidation) {
              return;
            }
            if (synchronized.blocked) {
              setOffline((current) => ({
                ...current,
                queue: synchronized.summary,
                syncing: false,
              }));
              setFeedback({
                kind: 'offline_restricted',
                retry: 'none',
              });
              return;
            }
            if (
              synchronized.canonical &&
              !agendaMatchesScope(
                synchronized.canonical,
                offlineScope,
                timezone,
              )
            ) {
              void invalidateParticipantPrivateResources('permission');
              return;
            }
            if (synchronized.canonical) {
              storeState({
                status: 'ready',
                data: synchronized.canonical,
                scopeKey,
              });
            }
            setOffline({
              cached: false,
              lastSyncedAt: new Date().toISOString(),
              queue: synchronized.summary,
              syncing: false,
            });
            const queueFeedback = feedbackForOfflineQueue(synchronized.summary);
            if (queueFeedback) {
              setFeedback(queueFeedback);
            } else if (synchronized.processed > 0) {
              setFeedback({ kind: 'synced', retry: 'none' });
            }
          } catch {
            if (mounted.current && readEpoch.current === epoch) {
              setOffline((current) => ({
                ...current,
                syncing: false,
              }));
              setFeedback(feedbackForOfflineQueue(pendingQueue));
            }
          }
          return;
        }

        const invalidation = privateResourceInvalidationReason(
          result.failure,
          result.status,
        );
        if (invalidation) {
          void invalidateParticipantPrivateResources(invalidation);
          return;
        }
        if (
          (result.failure.kind === 'offline' || !navigator.onLine) &&
          (await exposeCachedAgenda())
        ) {
          return;
        }
        const mapped = mapParticipantAgendaReadFailure(result.failure);
        if (mapped) storeState(mapped);
      })
      .catch(async () => {
        if (
          !controller.signal.aborted &&
          mounted.current &&
          readEpoch.current === epoch
        ) {
          if (!(await exposeCachedAgenda())) {
            storeState({
              status: navigator.onLine ? 'error' : 'offline',
            });
          }
        }
      });

    return () => controller.abort();
  }, [
    accountIdentityKey,
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

  useEffect(() => {
    const requestSync = () => retry();
    window.addEventListener('online', requestSync);
    window.addEventListener(OFFLINE_AGENDA_SYNC_EVENT, requestSync);
    return () => {
      window.removeEventListener('online', requestSync);
      window.removeEventListener(OFFLINE_AGENDA_SYNC_EVENT, requestSync);
    };
  }, [retry]);

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
        !accountEventId ||
        current.data.eventId !== accountEventId ||
        !accountUserId ||
        current.data.userId !== accountUserId ||
        !accountTimezone ||
        readOnly
      ) {
        pendingAttempt.current = null;
        mutationLock.current = false;
        return;
      }
      if (offline.queue.total > 0) {
        setFeedback(feedbackForOfflineQueue(offline.queue));
        mutationLock.current = false;
        return;
      }
      if (
        offlineParticipantAgendaCacheAvailable() &&
        !activeOfflineEpoch.current
      ) {
        pendingAttempt.current = null;
        setFeedback({ kind: 'offline_restricted', retry: 'none' });
        mutationLock.current = false;
        return;
      }

      const epoch = ++mutationEpoch.current;
      const mutationScope: ParticipantOfflineScope = {
        eventId: accountEventId,
        userId: accountUserId,
      };
      const mutationOfflineEpoch = activeOfflineEpoch.current;
      const controller = new AbortController();
      mutationController.current?.abort();
      mutationController.current = controller;
      pendingAttempt.current = request;
      setPending(request.intent);
      setFeedback(null);
      setConflict(null);

      try {
        const queueOfflineMutation = async (): Promise<void> => {
          if (
            !isOfflineApprovedIntent(request.intent) ||
            !request.offlineIdempotencyKey ||
            !offlineAgendaReplayAvailable() ||
            !mutationOfflineEpoch
          ) {
            pendingAttempt.current = null;
            setFeedback({ kind: 'offline_restricted', retry: 'none' });
            return;
          }
          await queueApprovedOfflineAgendaMutation(
            mutationScope,
            mutationInput(request.intent, request.expectedVersion),
            request.offlineIdempotencyKey,
            mutationOfflineEpoch,
          );
          const queue = await readOfflineAgendaQueueSummary(
            mutationScope,
            mutationOfflineEpoch,
          );
          pendingAttempt.current = null;
          reconciliationRequired.current = false;
          setOffline((currentOffline) => ({
            ...currentOffline,
            cached: true,
            queue,
            syncing: false,
          }));
          setFeedback({ kind: 'queued', retry: 'none' });
        };

        if (offline.cached || !navigator.onLine) {
          await queueOfflineMutation();
          return;
        }

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
            void invalidateParticipantPrivateResources('permission');
            return;
          }
          pendingAttempt.current = null;
          reconciliationRequired.current = false;
          const canonical = snapshotFromMutation(result.data);
          storeState({
            status: 'ready',
            data: canonical,
            scopeKey: request.scopeKey,
          });
          if (
            offlineParticipantAgendaCacheAvailable() &&
            mutationOfflineEpoch
          ) {
            void persistCanonicalOfflineAgenda(
              mutationScope,
              canonical,
              mutationOfflineEpoch,
            )
              .then((record) => {
                if (!mounted.current) return;
                setOffline((currentOffline) => ({
                  ...currentOffline,
                  cached: false,
                  lastSyncedAt: record.lastSyncedAt,
                }));
              })
              .catch(() => undefined);
          }
          setConflict(conflictFromMutation(result.data));
          return;
        }

        const invalidation = privateResourceInvalidationReason(
          result.failure,
          result.status,
        );
        if (invalidation) {
          pendingAttempt.current = null;
          void invalidateParticipantPrivateResources(invalidation);
          return;
        }

        if (result.failure.kind === 'offline') {
          await queueOfflineMutation();
          return;
        }

        if (result.failure.kind === 'problem') {
          const problem = result.failure.problem;
          const canonical = canonicalProblemAgenda(problem);
          if (canonical) {
            const problemSessionId =
              'sessionId' in problem ? problem.sessionId : null;
            const latest = stateRef.current;
            if (
              (problemSessionId !== null &&
                problemSessionId !== request.intent.sessionId) ||
              canonical.eventId !== expectedEventId ||
              canonical.eventId !== accountEventId ||
              canonical.userId !== accountUserId ||
              canonical.eventTimezone !== accountTimezone
            ) {
              pendingAttempt.current = null;
              void invalidateParticipantPrivateResources('permission');
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
            if (
              offlineParticipantAgendaCacheAvailable() &&
              mutationOfflineEpoch
            ) {
              void persistCanonicalOfflineAgenda(
                mutationScope,
                canonical,
                mutationOfflineEpoch,
              ).catch(() => undefined);
            }
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
          if (!navigator.onLine) {
            if (
              isOfflineApprovedIntent(request.intent) &&
              request.offlineIdempotencyKey &&
              offlineAgendaReplayAvailable() &&
              mutationOfflineEpoch
            ) {
              try {
                await queueApprovedOfflineAgendaMutation(
                  mutationScope,
                  mutationInput(request.intent, request.expectedVersion),
                  request.offlineIdempotencyKey,
                  mutationOfflineEpoch,
                );
                const queue = await readOfflineAgendaQueueSummary(
                  mutationScope,
                  mutationOfflineEpoch,
                );
                pendingAttempt.current = null;
                setOffline((currentOffline) => ({
                  ...currentOffline,
                  cached: true,
                  queue,
                  syncing: false,
                }));
                setFeedback({ kind: 'queued', retry: 'none' });
              } catch {
                setFeedback({ kind: 'error', retry: 'mutation' });
              }
            } else {
              pendingAttempt.current = null;
              setFeedback({ kind: 'offline_restricted', retry: 'none' });
            }
          } else {
            setFeedback({ kind: 'error', retry: 'mutation' });
          }
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
      offline,
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
      const keys = createAgendaIdempotencyKeys();
      await executeMutation({
        expectedVersion: current.data.version,
        idempotencyKey: keys.idempotencyKey,
        intent,
        offlineIdempotencyKey: keys.offlineIdempotencyKey,
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

  const retryOfflineQueue = useCallback(async () => {
    const current = stateRef.current;
    const offlineEpoch = callbackOfflineEpoch;
    if (
      !mounted.current ||
      activeAccountIdentity.current !== accountIdentityKey ||
      activeOfflineEpoch.current !== callbackOfflineEpoch ||
      mutationLock.current ||
      current.status !== 'ready' ||
      !accountEventId ||
      !accountUserId ||
      !accountTimezone ||
      !scopeKey ||
      current.scopeKey !== scopeKey ||
      current.data.eventId !== accountEventId ||
      current.data.userId !== accountUserId
    ) {
      return;
    }
    const scope: ParticipantOfflineScope = {
      eventId: accountEventId,
      userId: accountUserId,
    };
    if (!offlineScopesMatch(activeOfflineScope.current, scope)) return;
    if (offline.queue.failed > 0) {
      setFeedback({ kind: 'queue_failed', retry: 'discard' });
      return;
    }
    if (!navigator.onLine) {
      setFeedback({ kind: 'queue_conflict', retry: 'sync' });
      return;
    }
    if (!offlineAgendaReplayAvailable() || !offlineEpoch) {
      setFeedback({ kind: 'offline_restricted', retry: 'none' });
      return;
    }

    const operationEpoch = mutationEpoch.current;
    const operationIsCurrent = () =>
      mounted.current &&
      mutationEpoch.current === operationEpoch &&
      activeOfflineEpoch.current === offlineEpoch &&
      offlineScopesMatch(activeOfflineScope.current, scope) &&
      stateRef.current.status === 'ready' &&
      stateRef.current.scopeKey === scopeKey;
    mutationLock.current = true;
    setOffline((currentOffline) => ({
      ...currentOffline,
      syncing: true,
    }));
    try {
      if (offline.queue.conflict > 0) {
        await retryOfflineAgendaConflict(
          scope,
          current.data.version,
          offlineEpoch,
        );
        if (!operationIsCurrent()) return;
      }
      const synchronized = await syncOfflineAgendaQueue(
        scope,
        api,
        offlineEpoch,
      );
      if (!operationIsCurrent()) return;
      if (synchronized.invalidation) {
        return;
      }
      if (synchronized.blocked) {
        setOffline((currentOffline) => ({
          ...currentOffline,
          queue: synchronized.summary,
          syncing: false,
        }));
        setFeedback({ kind: 'offline_restricted', retry: 'none' });
        return;
      }
      if (synchronized.canonical) {
        if (
          !agendaMatchesScope(synchronized.canonical, scope, accountTimezone)
        ) {
          void invalidateParticipantPrivateResources('permission');
          return;
        }
        storeState({
          status: 'ready',
          data: synchronized.canonical,
          scopeKey: current.scopeKey,
        });
      }
      setOffline({
        cached: false,
        lastSyncedAt: new Date().toISOString(),
        queue: synchronized.summary,
        syncing: false,
      });
      setFeedback(
        feedbackForOfflineQueue(synchronized.summary) ??
          (synchronized.processed > 0
            ? { kind: 'synced', retry: 'none' }
            : null),
      );
    } catch {
      if (operationIsCurrent()) {
        setFeedback({ kind: 'queue_conflict', retry: 'sync' });
      }
    } finally {
      if (mutationEpoch.current === operationEpoch) {
        mutationLock.current = false;
      }
      if (operationIsCurrent()) {
        setOffline((currentOffline) => ({
          ...currentOffline,
          syncing: false,
        }));
      }
    }
  }, [
    accountIdentityKey,
    accountEventId,
    accountTimezone,
    accountUserId,
    api,
    callbackOfflineEpoch,
    offline.queue.conflict,
    offline.queue.failed,
    scopeKey,
    storeState,
  ]);

  const discardFailedOfflineQueue = useCallback(async () => {
    const current = stateRef.current;
    const offlineEpoch = callbackOfflineEpoch;
    if (
      !mounted.current ||
      activeAccountIdentity.current !== accountIdentityKey ||
      activeOfflineEpoch.current !== callbackOfflineEpoch ||
      mutationLock.current ||
      current.status !== 'ready' ||
      !accountEventId ||
      !accountUserId ||
      !scopeKey ||
      current.scopeKey !== scopeKey ||
      current.data.eventId !== accountEventId ||
      current.data.userId !== accountUserId ||
      !offlineEpoch ||
      offline.queue.failed === 0
    ) {
      return;
    }
    const scope: ParticipantOfflineScope = {
      eventId: accountEventId,
      userId: accountUserId,
    };
    if (!offlineScopesMatch(activeOfflineScope.current, scope)) return;
    const operationEpoch = mutationEpoch.current;
    const operationIsCurrent = () =>
      mounted.current &&
      mutationEpoch.current === operationEpoch &&
      activeOfflineEpoch.current === offlineEpoch &&
      offlineScopesMatch(activeOfflineScope.current, scope) &&
      stateRef.current.status === 'ready' &&
      stateRef.current.scopeKey === scopeKey;
    mutationLock.current = true;
    setOffline((currentOffline) => ({ ...currentOffline, syncing: true }));
    try {
      const queue = await discardFailedOfflineAgendaQueue(scope, offlineEpoch);
      if (!operationIsCurrent()) return;
      setOffline((currentOffline) => ({
        ...currentOffline,
        queue,
        syncing: false,
      }));
      setFeedback({ kind: 'queue_discarded', retry: 'none' });
    } catch {
      if (operationIsCurrent()) {
        setFeedback({ kind: 'queue_failed', retry: 'discard' });
      }
    } finally {
      if (mutationEpoch.current === operationEpoch) {
        mutationLock.current = false;
      }
      if (operationIsCurrent()) {
        setOffline((currentOffline) => ({
          ...currentOffline,
          syncing: false,
        }));
      }
    }
  }, [
    accountEventId,
    accountIdentityKey,
    accountUserId,
    callbackOfflineEpoch,
    offline.queue.failed,
    scopeKey,
  ]);

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
      discardFailedOfflineQueue,
      dismissConflict: () => setConflict(null),
      dismissFeedback,
      feedback: privateStateIsVisible ? feedback : null,
      mutate,
      offline,
      pending: privateStateIsVisible ? pending : null,
      readOnly: !privateStateIsVisible || readOnly,
      retry,
      retryOfflineQueue,
      retryMutation,
      state: visibleState,
    }),
    [
      conflict,
      discardFailedOfflineQueue,
      dismissFeedback,
      feedback,
      mutate,
      offline,
      pending,
      privateStateIsVisible,
      readOnly,
      retry,
      retryOfflineQueue,
      retryMutation,
      visibleState,
    ],
  );
};
