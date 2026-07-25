import type {
  ParticipantAgendaMutationProblem,
  ParticipantAgendaMutationResponse,
  ParticipantAgendaResponse,
} from '@byzon/domain/contracts';

import type { ApiPort } from '@/lib/api';
import { mutateParticipantAgenda } from '@/lib/agenda-api';

import {
  enqueueOfflineAgendaMutation,
  listOfflineAgendaQueue,
  readOfflineAgendaSnapshot,
  removeOfflineAgendaQueueRecord,
  updateOfflineAgendaQueueRecord,
  wipeAllParticipantOfflineData,
  writeOfflineAgendaSnapshot,
  type OfflineAgendaQueueRecord,
  type OfflineAgendaRecord,
} from './offline-database';
import {
  parseApprovedOfflineAgendaMutation,
  parseParticipantOfflineScope,
  toAgendaMutationRequest,
  type ParticipantOfflineScope,
} from './offline-policy';

export interface OfflineAgendaQueueSummary {
  readonly conflict: number;
  readonly pending: number;
  readonly retry: number;
  readonly total: number;
}

export interface OfflineAgendaSyncResult {
  readonly canonical: ParticipantAgendaResponse | null;
  readonly invalidation: 'permission' | 'session_expired' | null;
  readonly processed: number;
  readonly summary: OfflineAgendaQueueSummary;
}

export const EMPTY_OFFLINE_AGENDA_QUEUE: OfflineAgendaQueueSummary =
  Object.freeze({
    conflict: 0,
    pending: 0,
    retry: 0,
    total: 0,
  });

const activeSyncs = new Map<string, Promise<OfflineAgendaSyncResult>>();

const scopeKey = (scope: ParticipantOfflineScope) =>
  `${scope.eventId}:${scope.userId}`;

const queueSummary = (
  records: readonly OfflineAgendaQueueRecord[],
): OfflineAgendaQueueSummary => {
  const pending = records.filter(({ status }) => status === 'pending').length;
  const retry = records.filter(({ status }) => status === 'retry').length;
  const conflict = records.filter(({ status }) => status === 'conflict').length;
  return {
    pending,
    retry,
    conflict,
    total: pending + retry + conflict,
  };
};

export const readOfflineAgendaQueueSummary = async (
  scope: ParticipantOfflineScope,
): Promise<OfflineAgendaQueueSummary> =>
  queueSummary(await listOfflineAgendaQueue(scope));

export const retryOfflineAgendaConflict = async (
  scope: ParticipantOfflineScope,
  expectedVersion: number,
): Promise<OfflineAgendaQueueSummary> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new TypeError('Conflict retry requires a canonical agenda version.');
  }
  const records = await listOfflineAgendaQueue(parsedScope);
  const conflict = records.find((record) => record.status === 'conflict');
  if (!conflict) return queueSummary(records);
  await updateOfflineAgendaQueueRecord(conflict, {
    attempts: 0,
    expectedVersion,
    lastProblemCode: null,
    status: 'pending',
  });
  return readOfflineAgendaQueueSummary(parsedScope);
};

export const readScopedOfflineAgenda = (
  scope: ParticipantOfflineScope,
): Promise<OfflineAgendaRecord | null> => readOfflineAgendaSnapshot(scope);

export const persistCanonicalOfflineAgenda = (
  scope: ParticipantOfflineScope,
  snapshot: ParticipantAgendaResponse,
): Promise<OfflineAgendaRecord> =>
  writeOfflineAgendaSnapshot(scope, snapshot, new Date());

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
  idempotencyKey = globalThis.crypto?.randomUUID(),
): Promise<OfflineAgendaQueueRecord> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  const parsedMutation = parseApprovedOfflineAgendaMutation(mutation);
  if (!idempotencyKey) {
    throw new TypeError('Secure UUID generation is unavailable.');
  }
  const queued = await enqueueOfflineAgendaMutation(
    parsedScope,
    parsedMutation,
    idempotencyKey,
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
): Promise<void> => {
  await updateOfflineAgendaQueueRecord(record, {
    attempts: record.attempts + 1,
    lastProblemCode: problemCode,
    status,
  });
};

const executeSync = async (
  scope: ParticipantOfflineScope,
  api: ApiPort,
): Promise<OfflineAgendaSyncResult> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  const records = await listOfflineAgendaQueue(parsedScope);
  let canonical: ParticipantAgendaResponse | null = null;
  let processed = 0;

  for (const record of records) {
    if (record.status === 'conflict') continue;
    const result = await mutateParticipantAgenda(
      api,
      toAgendaMutationRequest(record),
      record.idempotencyKey,
    );
    if (result.ok) {
      if (
        result.kind !== 'success' ||
        !canonicalMatchesScope(result.data, parsedScope) ||
        result.data.mutation.action !== record.action ||
        result.data.mutation.sessionId !== record.sessionId
      ) {
        await markQueueFailure(record, 'conflict', 'INVALID_RESPONSE');
        continue;
      }
      canonical = snapshotFromMutation(result.data);
      await writeOfflineAgendaSnapshot(parsedScope, canonical);
      await removeOfflineAgendaQueueRecord(record);
      processed += 1;
      continue;
    }

    if (result.failure.kind === 'problem') {
      const invalidation = problemInvalidation(result.failure.problem);
      if (invalidation) {
        await wipeAllParticipantOfflineData(invalidation);
        return {
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
        await writeOfflineAgendaSnapshot(parsedScope, problemCanonical);
      }
      const retryable =
        result.failure.problem.code === 'IDEMPOTENCY_IN_PROGRESS' ||
        result.failure.problem.code === 'INTERNAL_ERROR';
      await markQueueFailure(
        record,
        retryable ? 'retry' : 'conflict',
        result.failure.problem.code,
      );
      if (retryable) break;
      continue;
    }

    if (result.failure.kind === 'session_expired') {
      await wipeAllParticipantOfflineData('session_expired');
      return {
        canonical: null,
        invalidation: 'session_expired',
        processed,
        summary: EMPTY_OFFLINE_AGENDA_QUEUE,
      };
    }
    if (result.failure.kind === 'aborted') break;
    await markQueueFailure(record, 'retry', result.failure.kind.toUpperCase());
    break;
  }

  return {
    canonical,
    invalidation: null,
    processed,
    summary: queueSummary(await listOfflineAgendaQueue(parsedScope)),
  };
};

export const syncOfflineAgendaQueue = (
  scope: ParticipantOfflineScope,
  api: ApiPort,
): Promise<OfflineAgendaSyncResult> => {
  const key = scopeKey(parseParticipantOfflineScope(scope));
  const active = activeSyncs.get(key);
  if (active) return active;
  const sync = executeSync(scope, api).finally(() => {
    if (activeSyncs.get(key) === sync) activeSyncs.delete(key);
  });
  activeSyncs.set(key, sync);
  return sync;
};
