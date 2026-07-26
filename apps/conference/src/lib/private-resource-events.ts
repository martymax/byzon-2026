import type { ApiFailure, ApiProblem } from '@byzon/domain/contracts';

import {
  wipeAllParticipantOfflineData,
  type OfflineWipeReason,
} from './offline/offline-database';
import { abortParticipantPrivateOperations } from './offline/offline-operation-lifecycle';
import { isUuid } from './offline/offline-policy';

export type PrivateResourceInvalidationReason =
  'permission' | 'session_expired';

type Listener = (reason: PrivateResourceInvalidationReason) => void;

const listeners = new Set<Listener>();
export const PRIVATE_RESOURCE_BROADCAST_CHANNEL =
  'byzon:participant-private-invalidation:v1';

interface PrivateResourceBroadcast {
  readonly id: string;
  readonly reason: PrivateResourceInvalidationReason;
  readonly type: 'participant-private-invalidation';
  readonly wipeReason: OfflineWipeReason;
}

let broadcastChannel: BroadcastChannel | null = null;
let cleanupTail: Promise<void> = Promise.resolve();
let scopeTransitionInFlight: Promise<void> | null = null;
const receivedBroadcastIds = new Set<string>();
const wipeReasons = new Set<OfflineWipeReason>([
  'logout',
  'migration_failure',
  'permission',
  'revocation',
  'session_expired',
  'switch_account',
  'user_request',
]);

const defaultWipeReason = (
  reason: PrivateResourceInvalidationReason,
): OfflineWipeReason =>
  reason === 'session_expired' ? 'session_expired' : 'permission';

const createTombstone = (): string => {
  const uuid = globalThis.crypto?.randomUUID();
  if (uuid) return uuid;
  const hexadecimal = (length: number): string =>
    Array.from({ length }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${hexadecimal(8)}-${hexadecimal(4)}-4${hexadecimal(3)}-${variant}${hexadecimal(3)}-${hexadecimal(12)}`;
};

const reportCleanupFailure = (error: unknown): void => {
  console.error('[BYZON offline] Private data cleanup failed.', error);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('byzon:private-cleanup-failed'));
  }
};

const scheduleDurableCleanup = (
  wipeReason: OfflineWipeReason,
  tombstoneEpoch: string,
): Promise<void> => {
  abortParticipantPrivateOperations();
  if (!globalThis.indexedDB) return Promise.resolve();
  const cleanup = cleanupTail
    .catch(() => undefined)
    .then(() =>
      wipeAllParticipantOfflineData(wipeReason, undefined, tombstoneEpoch),
    );
  cleanupTail = cleanup;
  void cleanup.catch(reportCleanupFailure);
  return cleanup;
};

const notifyListeners = (reason: PrivateResourceInvalidationReason): void => {
  for (const listener of listeners) listener(reason);
};

const isPrivateResourceBroadcast = (
  value: unknown,
): value is PrivateResourceBroadcast => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PrivateResourceBroadcast>;
  return (
    candidate.type === 'participant-private-invalidation' &&
    typeof candidate.id === 'string' &&
    isUuid(candidate.id) &&
    (candidate.reason === 'permission' ||
      candidate.reason === 'session_expired') &&
    typeof candidate.wipeReason === 'string' &&
    wipeReasons.has(candidate.wipeReason as OfflineWipeReason)
  );
};

const receiveBroadcast = (value: unknown): void => {
  if (!isPrivateResourceBroadcast(value)) return;
  if (receivedBroadcastIds.has(value.id)) return;
  receivedBroadcastIds.add(value.id);
  if (receivedBroadcastIds.size > 128) {
    const oldest = receivedBroadcastIds.values().next().value;
    if (typeof oldest === 'string') receivedBroadcastIds.delete(oldest);
  }
  notifyListeners(value.reason);
  void scheduleDurableCleanup(value.wipeReason, value.id);
};

const ensureBroadcastChannel = (): BroadcastChannel | null => {
  if (
    broadcastChannel ||
    typeof window === 'undefined' ||
    typeof globalThis.BroadcastChannel !== 'function'
  ) {
    return broadcastChannel;
  }
  broadcastChannel = new BroadcastChannel(PRIVATE_RESOURCE_BROADCAST_CHANNEL);
  broadcastChannel.addEventListener('message', (event) => {
    receiveBroadcast(event.data);
  });
  return broadcastChannel;
};

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

const dispatchParticipantPrivateResourceInvalidation = (
  reason: PrivateResourceInvalidationReason,
  wipeReason: OfflineWipeReason,
  notifyCurrentContext: boolean,
): Promise<void> => {
  if (notifyCurrentContext) notifyListeners(reason);
  const message: PrivateResourceBroadcast = {
    id: createTombstone(),
    reason,
    type: 'participant-private-invalidation',
    wipeReason,
  };
  ensureBroadcastChannel()?.postMessage(message);
  return scheduleDurableCleanup(wipeReason, message.id);
};

export const invalidateParticipantPrivateResources = (
  reason: PrivateResourceInvalidationReason,
  wipeReason: OfflineWipeReason = defaultWipeReason(reason),
): Promise<void> =>
  dispatchParticipantPrivateResourceInvalidation(reason, wipeReason, true);

export const transitionParticipantPrivateResourceScope = (): Promise<void> => {
  abortParticipantPrivateOperations();
  if (scopeTransitionInFlight) return scopeTransitionInFlight;

  const transition = dispatchParticipantPrivateResourceInvalidation(
    'permission',
    'switch_account',
    false,
  );
  scopeTransitionInFlight = transition;
  void transition.then(
    () => {
      if (scopeTransitionInFlight === transition) {
        scopeTransitionInFlight = null;
      }
    },
    () => {
      if (scopeTransitionInFlight === transition) {
        scopeTransitionInFlight = null;
      }
    },
  );
  return transition;
};

export const waitForParticipantPrivateResourceCleanup =
  async (): Promise<void> => {
    // Let every passive effect in the current task publish its transition,
    // then keep following the serialized tail until no later wipe was queued.
    await Promise.resolve();
    let observedCleanup = cleanupTail;
    for (;;) {
      await observedCleanup;
      if (observedCleanup === cleanupTail) return;
      observedCleanup = cleanupTail;
    }
  };

export const subscribeToPrivateResourceInvalidation = (
  listener: Listener,
): (() => void) => {
  ensureBroadcastChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
};
