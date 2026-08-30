import {
  offlineAgendaReplayEnvelopeSchema,
  type ParticipantAgendaMutationProblem,
  type ParticipantAgendaMutationResponse,
  type ParticipantAgendaResponse,
} from '@byzon/domain/contracts';

import type { ApiPort } from '@/lib/api';
import {
  mutateParticipantAgenda,
  requestParticipantAgenda,
} from '@/lib/agenda-api';

import {
  assertParticipantOfflineEpoch,
  enqueueOfflineAgendaMutation,
  listOfflineAgendaQueue,
  preflightOfflineAgendaQueueRecord,
  readOfflineAgendaSnapshot,
  rebaseOfflineAgendaConflict,
  removeOfflineAgendaQueueRecord,
  toOfflineAgendaQueueContract,
  updateOfflineAgendaQueueRecord,
  writeOfflineAgendaSnapshot,
  type OfflineAgendaQueueRecord,
  type OfflineAgendaRecord,
} from './offline-database';
import {
  abortParticipantPrivateOperations,
  trackParticipantPrivateOperation,
} from './offline-operation-lifecycle';
import { requestParticipantOfflineReplayPreflight } from './offline-api';
import {
  parseApprovedOfflineAgendaMutation,
  parseParticipantOfflineScope,
  offlineAgendaReplayAvailable,
  offlineParticipantAgendaCacheAvailable,
  OFFLINE_QUEUE_MAX_ATTEMPTS,
  toAgendaMutationRequest,
  type ParticipantOfflineScope,
} from './offline-policy';
import { invalidateParticipantPrivateResources } from '../private-resource-events';

export interface OfflineAgendaQueueSummary {
  readonly conflict: number;
  readonly failed: number;
  readonly pending: number;
  readonly retry: number;
  readonly total: number;
}

export interface OfflineAgendaSyncResult {
  readonly blocked: 'owner_unverified' | 'replay_disabled' | null;
  readonly canonical: ParticipantAgendaResponse | null;
  readonly invalidation: 'permission' | 'session_expired' | null;
  readonly processed: number;
  readonly summary: OfflineAgendaQueueSummary;
}

export const EMPTY_OFFLINE_AGENDA_QUEUE: OfflineAgendaQueueSummary =
  Object.freeze({
    conflict: 0,
    failed: 0,
    pending: 0,
    retry: 0,
    total: 0,
  });

interface ActiveOfflineSync {
  readonly controller: AbortController;
  readonly promise: Promise<OfflineAgendaSyncResult>;
}

const activeSyncs = new Map<string, ActiveOfflineSync>();

export const abortOfflineAgendaSyncs = (): void => {
  abortParticipantPrivateOperations();
  activeSyncs.clear();
};

const scopeKey = (scope: ParticipantOfflineScope) =>
  `${scope.eventId}:${scope.userId}`;

const queueSummary = (
  records: readonly OfflineAgendaQueueRecord[],
): OfflineAgendaQueueSummary => {
  const pending = records.filter(({ status }) => status === 'pending').length;
  const retry = records.filter(({ status }) => status === 'retry').length;
  const conflict = records.filter(({ status }) => status === 'conflict').length;
  const failed = records.filter(({ status }) => status === 'failed').length;
  return {
    pending,
    retry,
    conflict,
    failed,
    total: pending + retry + conflict + failed,
  };
};

export const readOfflineAgendaQueueSummary = async (
  scope: ParticipantOfflineScope,
  expectedEpoch?: string,
): Promise<OfflineAgendaQueueSummary> =>
  queueSummary(
    await listOfflineAgendaQueue(scope, {
      ...(expectedEpoch ? { expectedEpoch } : {}),
    }),
  );

export const retryOfflineAgendaConflict = async (
  scope: ParticipantOfflineScope,
  expectedVersion: number,
  expectedEpoch: string,
  createIdempotencyKey: () => string = () =>
    globalThis.crypto?.randomUUID() ?? '',
): Promise<OfflineAgendaQueueSummary> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new TypeError('Conflict retry requires a canonical agenda version.');
  }
  const records = await listOfflineAgendaQueue(parsedScope, { expectedEpoch });
  const conflict = records.find((record) => record.status === 'conflict');
  if (!conflict) return queueSummary(records);
  const nextIdempotencyKey = createIdempotencyKey();
  await rebaseOfflineAgendaConflict(
    conflict,
    expectedVersion,
    nextIdempotencyKey,
    new Date(),
    { expectedEpoch },
  );
  return readOfflineAgendaQueueSummary(parsedScope, expectedEpoch);
};

export const discardFailedOfflineAgendaQueue = async (
  scope: ParticipantOfflineScope,
  expectedEpoch: string,
): Promise<OfflineAgendaQueueSummary> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  const records = await listOfflineAgendaQueue(parsedScope, { expectedEpoch });
  for (const record of records) {
    if (record.status === 'failed') {
      await removeOfflineAgendaQueueRecord(record, { expectedEpoch });
    }
  }
  return readOfflineAgendaQueueSummary(parsedScope, expectedEpoch);
};

export const readScopedOfflineAgenda = (
  scope: ParticipantOfflineScope,
  expectedEpoch?: string,
): Promise<OfflineAgendaRecord | null> =>
  offlineParticipantAgendaCacheAvailable()
    ? readOfflineAgendaSnapshot(scope, {
        ...(expectedEpoch ? { expectedEpoch } : {}),
      })
    : Promise.resolve(null);

export const persistCanonicalOfflineAgenda = (
  scope: ParticipantOfflineScope,
  snapshot: ParticipantAgendaResponse,
  expectedEpoch?: string,
): Promise<OfflineAgendaRecord> => {
  if (!offlineParticipantAgendaCacheAvailable()) {
    return Promise.reject(
      new TypeError(
        'Personal agenda persistence requires an owner lease feature gate.',
      ),
    );
  }
  return writeOfflineAgendaSnapshot(scope, snapshot, new Date(), {
    ...(expectedEpoch ? { expectedEpoch } : {}),
  });
};

const scheduleBackgroundSync = (): void => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  void navigator.serviceWorker.ready
    .then((registration) => {
      const sync = (
        registration as ServiceWorkerRegistration & {
          readonly sync?: { register(tag: string): Promise<void> };
        }
      ).sync;
      return sync?.register('byzon-offline-queue');
    })
    .catch(() => undefined);
};

export const queueApprovedOfflineAgendaMutation = async (
  scope: ParticipantOfflineScope,
  mutation: unknown,
  idempotencyKey: string | undefined = globalThis.crypto?.randomUUID(),
  expectedEpoch?: string,
): Promise<OfflineAgendaQueueRecord> => {
  if (!offlineAgendaReplayAvailable()) {
    throw new TypeError(
      'Offline agenda replay is disabled until owner-bound server support is available.',
    );
  }
  const parsedScope = parseParticipantOfflineScope(scope);
  const parsedMutation = parseApprovedOfflineAgendaMutation(mutation);
  if (!idempotencyKey) {
    throw new TypeError('Secure UUID generation is unavailable.');
  }
  const queued = await enqueueOfflineAgendaMutation(
    parsedScope,
    parsedMutation,
    idempotencyKey,
    new Date(),
    {
      ...(expectedEpoch ? { expectedEpoch } : {}),
    },
  );
  scheduleBackgroundSync();
  return queued;
};

const snapshotFromMutation = (
  response: ParticipantAgendaMutationResponse,
): ParticipantAgendaResponse => {
  const { mutation, timeConflict, ...snapshot } = response;
  void mutation;
  void timeConflict;
  return snapshot;
};

const canonicalFromProblem = (
  problem: ParticipantAgendaMutationProblem,
): ParticipantAgendaResponse | null =>
  'agenda' in problem ? problem.agenda : null;

const problemInvalidation = (
  problem: ParticipantAgendaMutationProblem,
): 'permission' | 'session_expired' | null => {
  if (
    problem.code === 'AUTHENTICATION_REQUIRED' ||
    problem.code === 'AUTH_SESSION_EXPIRED'
  ) {
    return 'session_expired';
  }
  return problem.code === 'EVENT_ACCESS_DENIED' ? 'permission' : null;
};

const canonicalMatchesScope = (
  snapshot: ParticipantAgendaResponse,
  scope: ParticipantOfflineScope,
): boolean =>
  snapshot.eventId === scope.eventId && snapshot.userId === scope.userId;

const markQueueFailure = async (
  record: OfflineAgendaQueueRecord,
  status: 'conflict' | 'retry',
  problemCode: string,
  expectedEpoch: string,
): Promise<void> => {
  const attempts = record.attempts + 1;
  await updateOfflineAgendaQueueRecord(
    record,
    {
      attempts,
      lastProblemCode: problemCode,
      status:
        status === 'retry' && attempts >= OFFLINE_QUEUE_MAX_ATTEMPTS
          ? 'failed'
          : status,
    },
    { expectedEpoch },
  );
};

const executeSync = async (
  scope: ParticipantOfflineScope,
  api: ApiPort,
  expectedEpoch: string,
  signal: AbortSignal,
): Promise<OfflineAgendaSyncResult> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  if (!offlineAgendaReplayAvailable()) {
    return {
      blocked: 'replay_disabled',
      canonical: null,
      invalidation: null,
      processed: 0,
      summary: EMPTY_OFFLINE_AGENDA_QUEUE,
    };
  }
  await assertParticipantOfflineEpoch(expectedEpoch);
  const owner = await requestParticipantAgenda(api, signal);
  if (signal.aborted) {
    return {
      blocked: 'owner_unverified',
      canonical: null,
      invalidation: null,
      processed: 0,
      summary: EMPTY_OFFLINE_AGENDA_QUEUE,
    };
  }
  if (
    !owner.ok ||
    owner.kind !== 'success' ||
    owner.data.eventId !== parsedScope.eventId ||
    owner.data.userId !== parsedScope.userId
  ) {
    const invalidation =
      !owner.ok &&
      (owner.failure.kind === 'session_expired' ||
        (owner.failure.kind === 'problem' &&
          (owner.failure.problem.code === 'AUTHENTICATION_REQUIRED' ||
            owner.failure.problem.code === 'AUTH_SESSION_EXPIRED')))
        ? 'session_expired'
        : !owner.ok &&
            owner.failure.kind === 'problem' &&
            owner.failure.problem.code === 'EVENT_ACCESS_DENIED'
          ? 'permission'
          : owner.ok
            ? 'permission'
            : null;
    if (invalidation) {
      await invalidateParticipantPrivateResources(
        invalidation,
        invalidation === 'permission' ? 'switch_account' : invalidation,
      );
      return {
        blocked: 'owner_unverified',
        canonical: null,
        invalidation,
        processed: 0,
        summary: EMPTY_OFFLINE_AGENDA_QUEUE,
      };
    }
    return {
      blocked: 'owner_unverified',
      canonical: null,
      invalidation: null,
      processed: 0,
      summary: await readOfflineAgendaQueueSummary(parsedScope, expectedEpoch),
    };
  }
  await assertParticipantOfflineEpoch(expectedEpoch);
  const records = await listOfflineAgendaQueue(parsedScope, { expectedEpoch });
  let canonical: ParticipantAgendaResponse | null = null;
  let processed = 0;
  let ownerAgendaVersion = owner.data.version;

  for (const listedRecord of records) {
    if (
      signal.aborted ||
      listedRecord.status === 'conflict' ||
      listedRecord.status === 'failed' ||
      listedRecord.status === 'superseded'
    ) {
      continue;
    }
    const record = await preflightOfflineAgendaQueueRecord(listedRecord, {
      expectedEpoch,
    });
    if (!record) continue;
    if (record.expectedVersion !== ownerAgendaVersion) {
      await markQueueFailure(
        record,
        'conflict',
        'AGENDA_VERSION_CONFLICT',
        expectedEpoch,
      );
      continue;
    }
    const preflightResult = await requestParticipantOfflineReplayPreflight(
      api,
      {
        contractVersion: record.contractVersion,
        ownerLeaseId: record.ownerLeaseId,
        revocationEpoch: record.revocationEpoch,
        agendaVersion: ownerAgendaVersion,
      },
      signal,
    );
    if (signal.aborted) break;
    if (!preflightResult.ok) {
      if (preflightResult.failure.kind === 'problem') {
        const code = preflightResult.failure.problem.code;
        if (
          code === 'AUTHENTICATION_REQUIRED' ||
          code === 'AUTH_SESSION_EXPIRED' ||
          code === 'EVENT_ACCESS_DENIED' ||
          code === 'OFFLINE_LEASE_REVOKED'
        ) {
          const invalidation =
            code === 'AUTHENTICATION_REQUIRED' ||
            code === 'AUTH_SESSION_EXPIRED'
              ? 'session_expired'
              : 'permission';
          await invalidateParticipantPrivateResources(invalidation);
          return {
            blocked: 'owner_unverified',
            canonical: null,
            invalidation,
            processed,
            summary: EMPTY_OFFLINE_AGENDA_QUEUE,
          };
        }
        if (code === 'STALE_VERSION') {
          await markQueueFailure(
            record,
            'conflict',
            'AGENDA_VERSION_CONFLICT',
            expectedEpoch,
          );
          continue;
        }
      }
      await markQueueFailure(
        record,
        'retry',
        'PREFLIGHT_UNAVAILABLE',
        expectedEpoch,
      );
      continue;
    }
    if (preflightResult.kind !== 'success') {
      await markQueueFailure(
        record,
        'retry',
        'PREFLIGHT_INVALID_RESPONSE',
        expectedEpoch,
      );
      continue;
    }
    offlineAgendaReplayEnvelopeSchema.parse({
      preflight: preflightResult.data,
      record: toOfflineAgendaQueueContract(record),
    });
    const replayRecord = await preflightOfflineAgendaQueueRecord(record, {
      expectedEpoch,
    });
    if (!replayRecord) continue;
    const result = await mutateParticipantAgenda(
      api,
      toAgendaMutationRequest(replayRecord),
      replayRecord.idempotencyKey,
      signal,
    );
    if (signal.aborted) break;
    await assertParticipantOfflineEpoch(expectedEpoch);
    if (result.ok) {
      if (
        result.kind !== 'success' ||
        !canonicalMatchesScope(result.data, parsedScope) ||
        result.data.mutation.action !== replayRecord.action ||
        result.data.mutation.sessionId !== replayRecord.sessionId
      ) {
        await markQueueFailure(
          replayRecord,
          'conflict',
          'INVALID_RESPONSE',
          expectedEpoch,
        );
        continue;
      }
      canonical = snapshotFromMutation(result.data);
      ownerAgendaVersion = canonical.version;
      await writeOfflineAgendaSnapshot(parsedScope, canonical, new Date(), {
        expectedEpoch,
      });
      await removeOfflineAgendaQueueRecord(replayRecord, { expectedEpoch });
      processed += 1;
      continue;
    }

    if (result.failure.kind === 'problem') {
      const invalidation = problemInvalidation(result.failure.problem);
      if (invalidation) {
        await invalidateParticipantPrivateResources(invalidation);
        return {
          blocked: null,
          canonical: null,
          invalidation,
          processed,
          summary: EMPTY_OFFLINE_AGENDA_QUEUE,
        };
      }
      const problemCanonical = canonicalFromProblem(result.failure.problem);
      if (
        problemCanonical &&
        canonicalMatchesScope(problemCanonical, parsedScope)
      ) {
        canonical = problemCanonical;
        await writeOfflineAgendaSnapshot(
          parsedScope,
          problemCanonical,
          new Date(),
          { expectedEpoch },
        );
      }
      const retryable =
        result.failure.problem.code === 'IDEMPOTENCY_IN_PROGRESS' ||
        result.failure.problem.code === 'INTERNAL_ERROR';
      await markQueueFailure(
        replayRecord,
        retryable ? 'retry' : 'conflict',
        result.failure.problem.code,
        expectedEpoch,
      );
      if (retryable) break;
      continue;
    }

    if (result.failure.kind === 'session_expired') {
      await invalidateParticipantPrivateResources('session_expired');
      return {
        blocked: null,
        canonical: null,
        invalidation: 'session_expired',
        processed,
        summary: EMPTY_OFFLINE_AGENDA_QUEUE,
      };
    }
    if (result.failure.kind === 'aborted') break;
    await markQueueFailure(
      replayRecord,
      'retry',
      result.failure.kind.toUpperCase(),
      expectedEpoch,
    );
    break;
  }

  return {
    blocked: null,
    canonical,
    invalidation: null,
    processed,
    summary: queueSummary(
      await listOfflineAgendaQueue(parsedScope, { expectedEpoch }),
    ),
  };
};

export const syncOfflineAgendaQueue = (
  scope: ParticipantOfflineScope,
  api: ApiPort,
  expectedEpoch: string,
): Promise<OfflineAgendaSyncResult> => {
  const key = scopeKey(parseParticipantOfflineScope(scope));
  const active = activeSyncs.get(key);
  if (active) return active.promise;
  const controller = new AbortController();
  const stopTracking = trackParticipantPrivateOperation(controller);
  const promise = executeSync(
    scope,
    api,
    expectedEpoch,
    controller.signal,
  ).finally(() => {
    stopTracking();
    if (activeSyncs.get(key)?.promise === promise) activeSyncs.delete(key);
  });
  activeSyncs.set(key, { controller, promise });
  return promise;
};
