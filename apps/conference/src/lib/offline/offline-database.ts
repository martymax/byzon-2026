import type { ParticipantAgendaResponse } from '@byzon/domain/contracts';

import {
  OFFLINE_QUEUE_MAX_ATTEMPTS,
  PARTICIPANT_OFFLINE_DATABASE_NAME,
  PARTICIPANT_OFFLINE_DATABASE_VERSION,
  isUuid,
  parseApprovedOfflineAgendaMutation,
  parseParticipantOfflineScope,
  parseScopedAgendaSnapshot,
  participantOfflineScopeKey,
  participantOfflineStoreNames,
  type ApprovedOfflineAgendaMutation,
  type ParticipantOfflineScope,
} from './offline-policy';

export type OfflineQueueStatus = 'conflict' | 'pending' | 'retry';
export type OfflineWipeReason =
  | 'logout'
  | 'migration_failure'
  | 'permission'
  | 'revocation'
  | 'session_expired'
  | 'switch_account'
  | 'user_request';

export interface OfflineAgendaRecord {
  readonly schemaVersion: typeof PARTICIPANT_OFFLINE_DATABASE_VERSION;
  readonly scopeKey: string;
  readonly eventId: string;
  readonly userId: string;
  readonly lastSyncedAt: string;
  readonly snapshot: ParticipantAgendaResponse;
}

export interface OfflineMetadataRecord {
  readonly schemaVersion: typeof PARTICIPANT_OFFLINE_DATABASE_VERSION;
  readonly scopeKey: string;
  readonly eventId: string;
  readonly userId: string;
  readonly agendaVersion: number;
  readonly publicationVersion: number;
  readonly lastSyncedAt: string;
}

export interface OfflineAgendaQueueRecord extends ApprovedOfflineAgendaMutation {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly scopeKey: string;
  readonly eventId: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly attempts: number;
  readonly status: OfflineQueueStatus;
  readonly lastProblemCode: string | null;
}

export interface ParticipantOfflineDataEvent {
  readonly kind: 'agenda' | 'queue' | 'wipe';
  readonly scopeKey: string | null;
  readonly reason: OfflineWipeReason | null;
}

type OfflineMigration = (
  database: IDBDatabase,
  transaction: IDBTransaction,
  oldVersion: number,
) => void;

export interface OpenParticipantOfflineDatabaseOptions {
  readonly factory?: IDBFactory;
  readonly migrate?: OfflineMigration;
  readonly name?: string;
}

const offlineDataListeners = new Set<
  (event: ParticipantOfflineDataEvent) => void
>();

export const subscribeToParticipantOfflineData = (
  listener: (event: ParticipantOfflineDataEvent) => void,
): (() => void) => {
  offlineDataListeners.add(listener);
  return () => offlineDataListeners.delete(listener);
};

const notifyOfflineData = (event: ParticipantOfflineDataEvent): void => {
  for (const listener of offlineDataListeners) listener(event);
};

const requestValue = <Value>(request: IDBRequest<Value>): Promise<Value> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new TypeError('IndexedDB request failed.'));
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ?? new TypeError('IndexedDB transaction aborted.'),
      );
    transaction.onerror = () =>
      reject(
        transaction.error ?? new TypeError('IndexedDB transaction failed.'),
      );
  });

const ensureStore = (
  database: IDBDatabase,
  transaction: IDBTransaction,
  name: string,
  keyPath: string,
): IDBObjectStore => {
  if (!database.objectStoreNames.contains(name)) {
    return database.createObjectStore(name, { keyPath });
  }
  const store = transaction.objectStore(name);
  if (store.keyPath !== keyPath) {
    throw new TypeError(`Offline store ${name} has an incompatible key path.`);
  }
  return store;
};

const ensureIndex = (
  store: IDBObjectStore,
  name: string,
  keyPath: string | readonly string[],
): void => {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath);
    return;
  }
  const index = store.index(name);
  const current = Array.isArray(index.keyPath)
    ? [...index.keyPath]
    : index.keyPath;
  const expected = Array.isArray(keyPath) ? [...keyPath] : keyPath;
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new TypeError(`Offline index ${name} is incompatible.`);
  }
};

export const migrateParticipantOfflineDatabase: OfflineMigration = (
  database,
  transaction,
) => {
  const metadata = ensureStore(
    database,
    transaction,
    participantOfflineStoreNames.metadata,
    'scopeKey',
  );
  ensureIndex(metadata, 'eventId', 'eventId');
  ensureIndex(metadata, 'userId', 'userId');

  const agenda = ensureStore(
    database,
    transaction,
    participantOfflineStoreNames.agenda,
    'scopeKey',
  );
  ensureIndex(agenda, 'eventId', 'eventId');
  ensureIndex(agenda, 'userId', 'userId');

  const queue = ensureStore(
    database,
    transaction,
    participantOfflineStoreNames.syncQueue,
    'id',
  );
  ensureIndex(queue, 'scopeKey', 'scopeKey');
  ensureIndex(queue, 'scopeStatus', ['scopeKey', 'status']);
  ensureIndex(queue, 'createdAt', 'createdAt');
};

const openOnce = ({
  factory,
  migrate,
  name,
}: Required<OpenParticipantOfflineDatabaseOptions>): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(name, PARTICIPANT_OFFLINE_DATABASE_VERSION);
    request.onupgradeneeded = (event) => {
      const transaction = request.transaction;
      if (!transaction) {
        reject(new TypeError('IndexedDB migration transaction is missing.'));
        return;
      }
      try {
        migrate(request.result, transaction, event.oldVersion);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
    request.onerror = () =>
      reject(request.error ?? new TypeError('IndexedDB open failed.'));
    request.onblocked = () =>
      reject(new TypeError('IndexedDB upgrade is blocked by another tab.'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });

const deleteDatabase = (factory: IDBFactory, name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(request.error ?? new TypeError('IndexedDB deletion failed.'));
    request.onblocked = () =>
      reject(new TypeError('IndexedDB deletion is blocked by another tab.'));
  });

export const openParticipantOfflineDatabase = async (
  options: OpenParticipantOfflineDatabaseOptions = {},
): Promise<IDBDatabase> => {
  const factory = options.factory ?? globalThis.indexedDB;
  if (!factory) throw new TypeError('IndexedDB is unavailable.');
  const name = options.name ?? PARTICIPANT_OFFLINE_DATABASE_NAME;
  const migrate = options.migrate ?? migrateParticipantOfflineDatabase;
  const resolved = { factory, migrate, name };
  try {
    return await openOnce(resolved);
  } catch {
    // A broken or unknown local schema must never be interpreted as server
    // state. Drop only this app-owned database, then create a clean schema.
    await deleteDatabase(factory, name);
    notifyOfflineData({
      kind: 'wipe',
      scopeKey: null,
      reason: 'migration_failure',
    });
    return openOnce({
      factory,
      name,
      migrate: migrateParticipantOfflineDatabase,
    });
  }
};

const withDatabase = async <Value>(
  operation: (database: IDBDatabase) => Promise<Value>,
  options?: OpenParticipantOfflineDatabaseOptions,
): Promise<Value> => {
  const database = await openParticipantOfflineDatabase(options);
  try {
    return await operation(database);
  } finally {
    database.close();
  }
};

const isoNow = (now: Date | string): string => {
  const parsed = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(parsed.getTime())) {
    throw new TypeError('Offline timestamps must be valid ISO dates.');
  }
  return parsed.toISOString();
};

export const writeOfflineAgendaSnapshot = async (
  scope: ParticipantOfflineScope,
  snapshot: unknown,
  now: Date | string = new Date(),
  options?: OpenParticipantOfflineDatabaseOptions,
): Promise<OfflineAgendaRecord> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  const parsedSnapshot = parseScopedAgendaSnapshot(parsedScope, snapshot);
  const scopeKey = participantOfflineScopeKey(parsedScope);
  const lastSyncedAt = isoNow(now);
  const record: OfflineAgendaRecord = {
    schemaVersion: PARTICIPANT_OFFLINE_DATABASE_VERSION,
    scopeKey,
    eventId: parsedScope.eventId,
    userId: parsedScope.userId,
    lastSyncedAt,
    snapshot: parsedSnapshot,
  };
  const metadata: OfflineMetadataRecord = {
    schemaVersion: PARTICIPANT_OFFLINE_DATABASE_VERSION,
    scopeKey,
    eventId: parsedScope.eventId,
    userId: parsedScope.userId,
    agendaVersion: parsedSnapshot.version,
    publicationVersion: parsedSnapshot.publicationVersion,
    lastSyncedAt,
  };
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.agenda,
        participantOfflineStoreNames.metadata,
      ],
      'readwrite',
    );
    transaction.objectStore(participantOfflineStoreNames.agenda).put(record);
    transaction
      .objectStore(participantOfflineStoreNames.metadata)
      .put(metadata);
    await transactionDone(transaction);
  }, options);
  notifyOfflineData({ kind: 'agenda', scopeKey, reason: null });
  return record;
};

export const readOfflineAgendaSnapshot = async (
  scope: ParticipantOfflineScope,
  options?: OpenParticipantOfflineDatabaseOptions,
): Promise<OfflineAgendaRecord | null> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  const scopeKey = participantOfflineScopeKey(parsedScope);
  const record = await withDatabase(async (database) => {
    const transaction = database.transaction(
      participantOfflineStoreNames.agenda,
      'readonly',
    );
    const value = await requestValue<OfflineAgendaRecord | undefined>(
      transaction
        .objectStore(participantOfflineStoreNames.agenda)
        .get(scopeKey),
    );
    await transactionDone(transaction);
    return value ?? null;
  }, options);
  if (!record) return null;
  try {
    const snapshot = parseScopedAgendaSnapshot(parsedScope, record.snapshot);
    if (
      record.schemaVersion !== PARTICIPANT_OFFLINE_DATABASE_VERSION ||
      record.scopeKey !== scopeKey ||
      record.eventId !== parsedScope.eventId ||
      record.userId !== parsedScope.userId ||
      !Number.isFinite(Date.parse(record.lastSyncedAt))
    ) {
      throw new TypeError('Offline agenda record metadata is invalid.');
    }
    return { ...record, snapshot };
  } catch {
    await wipeParticipantOfflineScope(
      parsedScope,
      'migration_failure',
      options,
    );
    return null;
  }
};

export const enqueueOfflineAgendaMutation = async (
  scope: ParticipantOfflineScope,
  mutation: unknown,
  idempotencyKey: string,
  now: Date | string = new Date(),
  options?: OpenParticipantOfflineDatabaseOptions,
): Promise<OfflineAgendaQueueRecord> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  const parsedMutation = parseApprovedOfflineAgendaMutation(mutation);
  if (!isUuid(idempotencyKey)) {
    throw new TypeError('Offline idempotency key must be a client UUID.');
  }
  const scopeKey = participantOfflineScopeKey(parsedScope);
  const timestamp = isoNow(now);
  const record: OfflineAgendaQueueRecord = {
    ...parsedMutation,
    id: idempotencyKey,
    idempotencyKey,
    scopeKey,
    eventId: parsedScope.eventId,
    userId: parsedScope.userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    attempts: 0,
    status: 'pending',
    lastProblemCode: null,
  };
  const stored = await withDatabase(async (database) => {
    const transaction = database.transaction(
      participantOfflineStoreNames.syncQueue,
      'readwrite',
    );
    const store = transaction.objectStore(
      participantOfflineStoreNames.syncQueue,
    );
    const existing = await requestValue<OfflineAgendaQueueRecord | undefined>(
      store.get(idempotencyKey),
    );
    if (existing) {
      if (
        existing.scopeKey !== record.scopeKey ||
        existing.action !== record.action ||
        existing.sessionId !== record.sessionId ||
        existing.expectedVersion !== record.expectedVersion
      ) {
        transaction.abort();
        throw new TypeError('Offline idempotency key was reused.');
      }
      await transactionDone(transaction);
      return existing;
    }
    store.add(record);
    await transactionDone(transaction);
    return record;
  }, options);
  notifyOfflineData({ kind: 'queue', scopeKey, reason: null });
  return stored;
};

export const listOfflineAgendaQueue = async (
  scope: ParticipantOfflineScope,
  options?: OpenParticipantOfflineDatabaseOptions,
): Promise<readonly OfflineAgendaQueueRecord[]> => {
  const scopeKey = participantOfflineScopeKey(scope);
  return withDatabase(async (database) => {
    const transaction = database.transaction(
      participantOfflineStoreNames.syncQueue,
      'readonly',
    );
    const records = await requestValue<OfflineAgendaQueueRecord[]>(
      transaction
        .objectStore(participantOfflineStoreNames.syncQueue)
        .index('scopeKey')
        .getAll(scopeKey),
    );
    await transactionDone(transaction);
    return records
      .filter(
        (record) =>
          record.scopeKey === scopeKey &&
          record.attempts <= OFFLINE_QUEUE_MAX_ATTEMPTS,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }, options);
};

export const updateOfflineAgendaQueueRecord = async (
  record: OfflineAgendaQueueRecord,
  update: {
    readonly attempts: number;
    readonly expectedVersion?: number;
    readonly lastProblemCode: string | null;
    readonly status: OfflineQueueStatus;
    readonly updatedAt?: Date | string;
  },
  options?: OpenParticipantOfflineDatabaseOptions,
): Promise<OfflineAgendaQueueRecord> => {
  const next: OfflineAgendaQueueRecord = {
    ...record,
    attempts: Math.min(
      OFFLINE_QUEUE_MAX_ATTEMPTS,
      Math.max(0, Math.trunc(update.attempts)),
    ),
    expectedVersion:
      update.expectedVersion === undefined
        ? record.expectedVersion
        : Math.max(1, Math.trunc(update.expectedVersion)),
    lastProblemCode: update.lastProblemCode,
    status: update.status,
    updatedAt: isoNow(update.updatedAt ?? new Date()),
  };
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      participantOfflineStoreNames.syncQueue,
      'readwrite',
    );
    transaction.objectStore(participantOfflineStoreNames.syncQueue).put(next);
    await transactionDone(transaction);
  }, options);
  notifyOfflineData({
    kind: 'queue',
    scopeKey: record.scopeKey,
    reason: null,
  });
  return next;
};

export const removeOfflineAgendaQueueRecord = async (
  record: Pick<OfflineAgendaQueueRecord, 'id' | 'scopeKey'>,
  options?: OpenParticipantOfflineDatabaseOptions,
): Promise<void> => {
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      participantOfflineStoreNames.syncQueue,
      'readwrite',
    );
    transaction
      .objectStore(participantOfflineStoreNames.syncQueue)
      .delete(record.id);
    await transactionDone(transaction);
  }, options);
  notifyOfflineData({
    kind: 'queue',
    scopeKey: record.scopeKey,
    reason: null,
  });
};

const deleteQueueScope = async (
  store: IDBObjectStore,
  scopeKey: string,
): Promise<void> => {
  const keys = await requestValue<IDBValidKey[]>(
    store.index('scopeKey').getAllKeys(scopeKey),
  );
  for (const key of keys) store.delete(key);
};

export const wipeParticipantOfflineScope = async (
  scope: ParticipantOfflineScope,
  reason: OfflineWipeReason,
  options?: OpenParticipantOfflineDatabaseOptions,
): Promise<void> => {
  const scopeKey = participantOfflineScopeKey(scope);
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.agenda,
        participantOfflineStoreNames.metadata,
        participantOfflineStoreNames.syncQueue,
      ],
      'readwrite',
    );
    transaction
      .objectStore(participantOfflineStoreNames.agenda)
      .delete(scopeKey);
    transaction
      .objectStore(participantOfflineStoreNames.metadata)
      .delete(scopeKey);
    await deleteQueueScope(
      transaction.objectStore(participantOfflineStoreNames.syncQueue),
      scopeKey,
    );
    await transactionDone(transaction);
  }, options);
  notifyOfflineData({ kind: 'wipe', scopeKey, reason });
};

export const wipeAllParticipantOfflineData = async (
  reason: OfflineWipeReason,
  options?: OpenParticipantOfflineDatabaseOptions,
): Promise<void> => {
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.agenda,
        participantOfflineStoreNames.metadata,
        participantOfflineStoreNames.syncQueue,
      ],
      'readwrite',
    );
    transaction.objectStore(participantOfflineStoreNames.agenda).clear();
    transaction.objectStore(participantOfflineStoreNames.metadata).clear();
    transaction.objectStore(participantOfflineStoreNames.syncQueue).clear();
    await transactionDone(transaction);
  }, options);
  notifyOfflineData({ kind: 'wipe', scopeKey: null, reason });
};
