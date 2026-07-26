import {
  offlineAgendaConflictRebaseSchema,
  offlineAgendaQueueRecordSchema,
  offlineParticipantAgendaCacheSchema,
  type OfflineAgendaQueueRecord as OfflineAgendaQueueContract,
  type OfflineParticipantAgendaCache,
} from '@byzon/domain/contracts';

import {
  OFFLINE_QUEUE_MAX_ATTEMPTS,
  OFFLINE_PRIVATE_RECORD_LEASE_MS,
  PARTICIPANT_OFFLINE_CONTRACT_VERSION,
  PARTICIPANT_OFFLINE_DATABASE_NAME,
  PARTICIPANT_OFFLINE_DATABASE_VERSION,
  PARTICIPANT_OFFLINE_EPOCH_KEY,
  isUuid,
  parseApprovedOfflineAgendaMutation,
  parseParticipantOfflineScope,
  parseScopedAgendaSnapshot,
  participantOfflineScopeKey,
  participantOfflineStoreNames,
  type ApprovedOfflineAgendaMutation,
  type ParticipantOfflineScope,
} from './offline-policy';

export type OfflineQueueStatus =
  'conflict' | 'failed' | 'pending' | 'retry' | 'superseded';
export type OfflineWipeReason =
  | 'logout'
  | 'migration_failure'
  | 'permission'
  | 'revocation'
  | 'session_expired'
  | 'switch_account'
  | 'user_request';

export interface OfflineAgendaRecord extends OfflineParticipantAgendaCache {
  readonly schemaVersion: typeof PARTICIPANT_OFFLINE_DATABASE_VERSION;
  readonly scopeKey: string;
  readonly lastSyncedAt: string;
}

export interface OfflineMetadataRecord {
  readonly contractVersion: typeof PARTICIPANT_OFFLINE_CONTRACT_VERSION;
  readonly schemaVersion: typeof PARTICIPANT_OFFLINE_DATABASE_VERSION;
  readonly scopeKey: string;
  readonly eventId: string;
  readonly userId: string;
  readonly agendaVersion: number;
  readonly publicationVersion: number;
  readonly ownerLeaseId: string;
  readonly revocationEpoch: string;
  readonly expiresAt: string;
  readonly lastSyncedAt: string;
}

export interface OfflineAgendaQueueRecord extends ApprovedOfflineAgendaMutation {
  readonly contractVersion: typeof PARTICIPANT_OFFLINE_CONTRACT_VERSION;
  readonly schemaVersion: typeof PARTICIPANT_OFFLINE_DATABASE_VERSION;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly ownerLeaseId: string;
  readonly revocationEpoch: string;
  readonly scopeKey: string;
  readonly eventId: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly attempts: number;
  readonly status: OfflineQueueStatus;
  readonly lastProblemCode: string | null;
  readonly supersedesId: string | null;
}

export const toOfflineAgendaQueueContract = (
  record: OfflineAgendaQueueRecord,
): OfflineAgendaQueueContract =>
  offlineAgendaQueueRecordSchema.parse({
    contractVersion: record.contractVersion,
    id: record.id,
    idempotencyKey: record.idempotencyKey,
    eventId: record.eventId,
    userId: record.userId,
    ownerLeaseId: record.ownerLeaseId,
    revocationEpoch: record.revocationEpoch,
    action: record.action,
    sessionId: record.sessionId,
    expectedVersion: record.expectedVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    attempts: record.attempts,
    status: record.status,
    lastProblemCode: record.lastProblemCode,
    supersedesId: record.supersedesId,
  });

const offlineAgendaRecordKeys = new Set([
  'agendaVersion',
  'contractVersion',
  'eventId',
  'expiresAt',
  'kind',
  'lastSyncedAt',
  'lease',
  'publicationVersion',
  'revocationEpoch',
  'schemaVersion',
  'scopeKey',
  'snapshot',
  'storedAt',
  'userId',
]);

const parseOfflineAgendaRecord = (
  value: unknown,
  scope: ParticipantOfflineScope,
  expectedScopeKey: string,
  expectedOwnerEpoch: string,
): OfflineAgendaRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Offline agenda record must be an object.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.getPrototypeOf(candidate) !== Object.prototype ||
    Object.keys(candidate).some((key) => !offlineAgendaRecordKeys.has(key)) ||
    Object.keys(candidate).length !== offlineAgendaRecordKeys.size ||
    candidate.schemaVersion !== PARTICIPANT_OFFLINE_DATABASE_VERSION ||
    candidate.scopeKey !== expectedScopeKey ||
    candidate.lastSyncedAt !== candidate.storedAt ||
    candidate.revocationEpoch !== expectedOwnerEpoch
  ) {
    throw new TypeError('Offline agenda record metadata is invalid.');
  }
  const canonical = offlineParticipantAgendaCacheSchema.parse({
    contractVersion: candidate.contractVersion,
    kind: candidate.kind,
    eventId: candidate.eventId,
    userId: candidate.userId,
    agendaVersion: candidate.agendaVersion,
    publicationVersion: candidate.publicationVersion,
    revocationEpoch: candidate.revocationEpoch,
    storedAt: candidate.storedAt,
    expiresAt: candidate.expiresAt,
    lease: candidate.lease,
    snapshot: candidate.snapshot,
  });
  if (
    canonical.eventId !== scope.eventId ||
    canonical.userId !== scope.userId ||
    Date.parse(canonical.expiresAt) <= Date.now()
  ) {
    throw new TypeError('Offline agenda owner lease is invalid or expired.');
  }
  return {
    ...canonical,
    schemaVersion: PARTICIPANT_OFFLINE_DATABASE_VERSION,
    scopeKey: expectedScopeKey,
    lastSyncedAt: canonical.storedAt,
  };
};

interface ParticipantOfflineControlRecord {
  readonly key: typeof PARTICIPANT_OFFLINE_EPOCH_KEY;
  readonly epoch: string;
  readonly changedAt: string;
  readonly reason: OfflineWipeReason | 'schema_created';
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

export interface ParticipantOfflineOperationOptions extends OpenParticipantOfflineDatabaseOptions {
  readonly expectedEpoch?: string;
}

export class ParticipantOfflineEpochChangedError extends Error {
  constructor() {
    super('Participant offline ownership epoch changed.');
    this.name = 'ParticipantOfflineEpochChangedError';
  }
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

const createEpoch = (): string => {
  const uuid = globalThis.crypto?.randomUUID();
  if (uuid) return uuid;
  const hexadecimal = (length: number): string =>
    Array.from({ length }, () =>
      Math.floor(Math.random() * 16).toString(16),
    ).join('');
  const variant = (8 + Math.floor(Math.random() * 4)).toString(16);
  return `${hexadecimal(8)}-${hexadecimal(4)}-4${hexadecimal(3)}-${variant}${hexadecimal(3)}-${hexadecimal(12)}`;
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
  oldVersion,
) => {
  const control = ensureStore(
    database,
    transaction,
    participantOfflineStoreNames.control,
    'key',
  );
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

  if (oldVersion < PARTICIPANT_OFFLINE_DATABASE_VERSION) {
    // Schema v3 changes the owner binding shared by the snapshot, metadata and
    // queue. Clear all three stores in this upgrade transaction so no v2
    // private record can survive under the newly rotated ownership epoch.
    agenda.clear();
    metadata.clear();
    queue.clear();
    control.put({
      key: PARTICIPANT_OFFLINE_EPOCH_KEY,
      epoch: createEpoch(),
      changedAt: new Date().toISOString(),
      reason: 'schema_created',
    } satisfies ParticipantOfflineControlRecord);
  }
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

const readControlRecord = async (
  store: IDBObjectStore,
): Promise<ParticipantOfflineControlRecord> => {
  const existing = await requestValue<
    ParticipantOfflineControlRecord | undefined
  >(store.get(PARTICIPANT_OFFLINE_EPOCH_KEY));
  if (
    existing &&
    existing.key === PARTICIPANT_OFFLINE_EPOCH_KEY &&
    typeof existing.epoch === 'string' &&
    isUuid(existing.epoch) &&
    Number.isFinite(Date.parse(existing.changedAt))
  ) {
    return existing;
  }
  throw new ParticipantOfflineEpochChangedError();
};

const assertExpectedEpoch = async (
  transaction: IDBTransaction,
  expectedEpoch: string | undefined,
): Promise<ParticipantOfflineControlRecord> => {
  const control = await readControlRecord(
    transaction.objectStore(participantOfflineStoreNames.control),
  );
  if (expectedEpoch !== undefined && control.epoch !== expectedEpoch) {
    transaction.abort();
    throw new ParticipantOfflineEpochChangedError();
  }
  return control;
};

export const readParticipantOfflineEpoch = async (
  options?: OpenParticipantOfflineDatabaseOptions,
): Promise<string> =>
  withDatabase(async (database) => {
    const transaction = database.transaction(
      participantOfflineStoreNames.control,
      'readonly',
    );
    const control = await readControlRecord(
      transaction.objectStore(participantOfflineStoreNames.control),
    );
    await transactionDone(transaction);
    return control.epoch;
  }, options);

export const assertParticipantOfflineEpoch = async (
  expectedEpoch: string,
  options?: OpenParticipantOfflineDatabaseOptions,
): Promise<void> => {
  if (!isUuid(expectedEpoch)) {
    throw new ParticipantOfflineEpochChangedError();
  }
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      participantOfflineStoreNames.control,
      'readonly',
    );
    await assertExpectedEpoch(transaction, expectedEpoch);
    await transactionDone(transaction);
  }, options);
};

export const writeOfflineAgendaSnapshot = async (
  scope: ParticipantOfflineScope,
  snapshot: unknown,
  now: Date | string = new Date(),
  options?: ParticipantOfflineOperationOptions,
): Promise<OfflineAgendaRecord> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  const parsedSnapshot = parseScopedAgendaSnapshot(parsedScope, snapshot);
  const scopeKey = participantOfflineScopeKey(parsedScope);
  const lastSyncedAt = isoNow(now);
  let record: OfflineAgendaRecord | undefined;
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.agenda,
        participantOfflineStoreNames.control,
        participantOfflineStoreNames.metadata,
      ],
      'readwrite',
    );
    const control = await assertExpectedEpoch(
      transaction,
      options?.expectedEpoch,
    );
    const expiresAt = new Date(
      Date.parse(lastSyncedAt) + OFFLINE_PRIVATE_RECORD_LEASE_MS,
    ).toISOString();
    const canonical = offlineParticipantAgendaCacheSchema.parse({
      contractVersion: PARTICIPANT_OFFLINE_CONTRACT_VERSION,
      kind: 'participant-agenda',
      eventId: parsedScope.eventId,
      userId: parsedScope.userId,
      agendaVersion: parsedSnapshot.version,
      publicationVersion: parsedSnapshot.publicationVersion,
      revocationEpoch: control.epoch,
      storedAt: lastSyncedAt,
      expiresAt,
      lease: {
        contractVersion: PARTICIPANT_OFFLINE_CONTRACT_VERSION,
        leaseId: control.epoch,
        eventId: parsedScope.eventId,
        userId: parsedScope.userId,
        revocationEpoch: control.epoch,
        issuedAt: lastSyncedAt,
        refreshAfter: new Date(
          Date.parse(lastSyncedAt) +
            Math.floor(OFFLINE_PRIVATE_RECORD_LEASE_MS / 2),
        ).toISOString(),
        expiresAt,
      },
      snapshot: parsedSnapshot,
    });
    record = {
      ...canonical,
      schemaVersion: PARTICIPANT_OFFLINE_DATABASE_VERSION,
      scopeKey,
      lastSyncedAt,
    };
    const metadata: OfflineMetadataRecord = {
      contractVersion: PARTICIPANT_OFFLINE_CONTRACT_VERSION,
      schemaVersion: PARTICIPANT_OFFLINE_DATABASE_VERSION,
      scopeKey,
      eventId: parsedScope.eventId,
      userId: parsedScope.userId,
      agendaVersion: parsedSnapshot.version,
      publicationVersion: parsedSnapshot.publicationVersion,
      ownerLeaseId: control.epoch,
      revocationEpoch: control.epoch,
      expiresAt,
      lastSyncedAt,
    };
    transaction.objectStore(participantOfflineStoreNames.agenda).put(record);
    transaction
      .objectStore(participantOfflineStoreNames.metadata)
      .put(metadata);
    await transactionDone(transaction);
  }, options);
  if (!record) {
    throw new TypeError('Offline agenda transaction did not persist a record.');
  }
  notifyOfflineData({ kind: 'agenda', scopeKey, reason: null });
  return record;
};

export const readOfflineAgendaSnapshot = async (
  scope: ParticipantOfflineScope,
  options?: ParticipantOfflineOperationOptions,
): Promise<OfflineAgendaRecord | null> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  const scopeKey = participantOfflineScopeKey(parsedScope);
  const result = await withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.agenda,
        participantOfflineStoreNames.control,
      ],
      'readonly',
    );
    const control = await assertExpectedEpoch(
      transaction,
      options?.expectedEpoch,
    );
    const value = await requestValue<unknown>(
      transaction
        .objectStore(participantOfflineStoreNames.agenda)
        .get(scopeKey),
    );
    await transactionDone(transaction);
    return { epoch: control.epoch, value };
  }, options);
  if (result.value === undefined) return null;
  try {
    return parseOfflineAgendaRecord(
      result.value,
      parsedScope,
      scopeKey,
      result.epoch,
    );
  } catch {
    await wipeParticipantOfflineScope(parsedScope, 'migration_failure', {
      ...options,
      expectedEpoch: result.epoch,
    });
    return null;
  }
};

export const enqueueOfflineAgendaMutation = async (
  scope: ParticipantOfflineScope,
  mutation: unknown,
  idempotencyKey: string,
  now: Date | string = new Date(),
  options?: ParticipantOfflineOperationOptions,
): Promise<OfflineAgendaQueueRecord> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  const parsedMutation = parseApprovedOfflineAgendaMutation(mutation);
  if (!isUuid(idempotencyKey)) {
    throw new TypeError('Offline idempotency key must be a client UUID.');
  }
  const scopeKey = participantOfflineScopeKey(parsedScope);
  const timestamp = isoNow(now);
  const stored = await withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.control,
        participantOfflineStoreNames.syncQueue,
      ],
      'readwrite',
    );
    const control = await assertExpectedEpoch(
      transaction,
      options?.expectedEpoch,
    );
    const record: OfflineAgendaQueueRecord = {
      ...parsedMutation,
      contractVersion: PARTICIPANT_OFFLINE_CONTRACT_VERSION,
      schemaVersion: PARTICIPANT_OFFLINE_DATABASE_VERSION,
      id: idempotencyKey,
      idempotencyKey,
      ownerLeaseId: control.epoch,
      revocationEpoch: control.epoch,
      scopeKey,
      eventId: parsedScope.eventId,
      userId: parsedScope.userId,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(
        Date.parse(timestamp) + OFFLINE_PRIVATE_RECORD_LEASE_MS,
      ).toISOString(),
      attempts: 0,
      status: 'pending',
      lastProblemCode: null,
      supersedesId: null,
    };
    parseOfflineAgendaQueueRecord(record, parsedScope, scopeKey, control.epoch);
    const store = transaction.objectStore(
      participantOfflineStoreNames.syncQueue,
    );
    const existing = await requestValue<OfflineAgendaQueueRecord | undefined>(
      store.get(idempotencyKey),
    );
    if (existing) {
      if (
        typeof existing === 'object' &&
        existing.scopeKey !== record.scopeKey
      ) {
        transaction.abort();
        throw new TypeError('Offline idempotency key was reused.');
      }
      const parsedExisting = parseOfflineAgendaQueueRecord(
        existing,
        parsedScope,
        scopeKey,
        control.epoch,
      );
      if (
        parsedExisting.action !== record.action ||
        parsedExisting.sessionId !== record.sessionId ||
        parsedExisting.expectedVersion !== record.expectedVersion
      ) {
        transaction.abort();
        throw new TypeError('Offline idempotency key was reused.');
      }
      await transactionDone(transaction);
      return parsedExisting;
    }
    store.add(record);
    await transactionDone(transaction);
    return record;
  }, options);
  notifyOfflineData({ kind: 'queue', scopeKey, reason: null });
  return stored;
};

const queueStatuses = new Set<OfflineQueueStatus>([
  'conflict',
  'failed',
  'pending',
  'retry',
  'superseded',
]);
const queueRecordKeys = new Set([
  'action',
  'attempts',
  'contractVersion',
  'createdAt',
  'eventId',
  'expiresAt',
  'expectedVersion',
  'id',
  'idempotencyKey',
  'lastProblemCode',
  'ownerLeaseId',
  'revocationEpoch',
  'schemaVersion',
  'scopeKey',
  'sessionId',
  'status',
  'supersedesId',
  'updatedAt',
  'userId',
]);

const parseOfflineAgendaQueueRecord = (
  value: unknown,
  scope: ParticipantOfflineScope,
  expectedScopeKey: string,
  expectedOwnerEpoch?: string,
): OfflineAgendaQueueRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Offline queue record must be an object.');
  }
  const candidate = value as Record<string, unknown>;
  if (
    Object.getPrototypeOf(candidate) !== Object.prototype ||
    Object.keys(candidate).some((key) => !queueRecordKeys.has(key)) ||
    Object.keys(candidate).length !== queueRecordKeys.size
  ) {
    throw new TypeError('Offline queue record schema is invalid.');
  }
  const mutation = parseApprovedOfflineAgendaMutation({
    action: candidate.action,
    expectedVersion: candidate.expectedVersion,
    sessionId: candidate.sessionId,
  });
  const id = candidate.id;
  const idempotencyKey = candidate.idempotencyKey;
  const createdAt = candidate.createdAt;
  const updatedAt = candidate.updatedAt;
  const expiresAt = candidate.expiresAt;
  const attempts = candidate.attempts;
  const status = candidate.status;
  const lastProblemCode = candidate.lastProblemCode;
  const supersedesId = candidate.supersedesId;
  if (
    candidate.contractVersion !== PARTICIPANT_OFFLINE_CONTRACT_VERSION ||
    candidate.schemaVersion !== PARTICIPANT_OFFLINE_DATABASE_VERSION ||
    typeof id !== 'string' ||
    !isUuid(id) ||
    idempotencyKey !== id ||
    candidate.scopeKey !== expectedScopeKey ||
    candidate.eventId !== scope.eventId ||
    candidate.userId !== scope.userId ||
    typeof candidate.ownerLeaseId !== 'string' ||
    !isUuid(candidate.ownerLeaseId) ||
    candidate.revocationEpoch !== candidate.ownerLeaseId ||
    (expectedOwnerEpoch !== undefined &&
      candidate.revocationEpoch !== expectedOwnerEpoch) ||
    typeof createdAt !== 'string' ||
    typeof updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    typeof expiresAt !== 'string' ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    Date.parse(updatedAt) < Date.parse(createdAt) ||
    Date.parse(expiresAt) <= Date.parse(updatedAt) ||
    !Number.isSafeInteger(attempts) ||
    (attempts as number) < 0 ||
    (attempts as number) > OFFLINE_QUEUE_MAX_ATTEMPTS ||
    typeof status !== 'string' ||
    !queueStatuses.has(status as OfflineQueueStatus) ||
    !(
      lastProblemCode === null ||
      (typeof lastProblemCode === 'string' &&
        lastProblemCode.length > 0 &&
        lastProblemCode.length <= 128 &&
        /^[A-Z][A-Z0-9_]+$/.test(lastProblemCode))
    ) ||
    !(
      supersedesId === null ||
      (typeof supersedesId === 'string' && isUuid(supersedesId))
    ) ||
    supersedesId === id ||
    (status === 'pending' && (attempts !== 0 || lastProblemCode !== null)) ||
    (status === 'retry' &&
      ((attempts as number) < 1 ||
        (attempts as number) >= OFFLINE_QUEUE_MAX_ATTEMPTS ||
        lastProblemCode === null)) ||
    (status === 'conflict' &&
      ((attempts as number) < 1 || lastProblemCode === null)) ||
    (status === 'failed' &&
      (attempts !== OFFLINE_QUEUE_MAX_ATTEMPTS || lastProblemCode === null)) ||
    (status === 'superseded' && lastProblemCode === null)
  ) {
    throw new TypeError('Offline queue record metadata is invalid.');
  }
  const parsed: OfflineAgendaQueueRecord = {
    ...mutation,
    contractVersion: PARTICIPANT_OFFLINE_CONTRACT_VERSION,
    schemaVersion: PARTICIPANT_OFFLINE_DATABASE_VERSION,
    id,
    idempotencyKey: id,
    ownerLeaseId: candidate.ownerLeaseId,
    revocationEpoch: candidate.revocationEpoch as string,
    scopeKey: expectedScopeKey,
    eventId: scope.eventId,
    userId: scope.userId,
    createdAt,
    updatedAt,
    expiresAt,
    attempts: attempts as number,
    status: status as OfflineQueueStatus,
    lastProblemCode: lastProblemCode as string | null,
    supersedesId: supersedesId as string | null,
  };
  toOfflineAgendaQueueContract(parsed);
  return parsed;
};

export const listOfflineAgendaQueue = async (
  scope: ParticipantOfflineScope,
  options?: ParticipantOfflineOperationOptions,
): Promise<readonly OfflineAgendaQueueRecord[]> => {
  const parsedScope = parseParticipantOfflineScope(scope);
  const scopeKey = participantOfflineScopeKey(parsedScope);
  return withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.control,
        participantOfflineStoreNames.syncQueue,
      ],
      'readwrite',
    );
    const control = await assertExpectedEpoch(
      transaction,
      options?.expectedEpoch,
    );
    const store = transaction.objectStore(
      participantOfflineStoreNames.syncQueue,
    );
    const index = store.index('scopeKey');
    const [keys, values] = await Promise.all([
      requestValue<IDBValidKey[]>(index.getAllKeys(scopeKey)),
      requestValue<unknown[]>(index.getAll(scopeKey)),
    ]);
    const records: OfflineAgendaQueueRecord[] = [];
    const now = Date.now();
    values.forEach((value, indexPosition) => {
      try {
        const record = parseOfflineAgendaQueueRecord(
          value,
          parsedScope,
          scopeKey,
          control.epoch,
        );
        const key = keys[indexPosition];
        if (Date.parse(record.expiresAt) <= now) {
          if (key !== undefined) store.delete(key);
        } else if (record.status !== 'superseded') {
          records.push(record);
        }
      } catch {
        const key = keys[indexPosition];
        if (key !== undefined) store.delete(key);
      }
    });
    await transactionDone(transaction);
    return records.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }, options);
};

const queueAttemptUnchanged = (
  expected: OfflineAgendaQueueRecord,
  current: OfflineAgendaQueueRecord,
): boolean =>
  current.id === expected.id &&
  current.updatedAt === expected.updatedAt &&
  current.status === expected.status &&
  current.attempts === expected.attempts &&
  current.expectedVersion === expected.expectedVersion &&
  current.ownerLeaseId === expected.ownerLeaseId &&
  current.revocationEpoch === expected.revocationEpoch &&
  current.action === expected.action &&
  current.sessionId === expected.sessionId;

/**
 * Revalidates one replay candidate and removes an expired/invalid record in the
 * same owner-epoch transaction. A caller invokes this again immediately before
 * POST so a record cannot be replayed merely because an earlier list was fresh.
 */
export const preflightOfflineAgendaQueueRecord = async (
  record: OfflineAgendaQueueRecord,
  options?: ParticipantOfflineOperationOptions,
): Promise<OfflineAgendaQueueRecord | null> => {
  const scope = parseParticipantOfflineScope({
    eventId: record.eventId,
    userId: record.userId,
  });
  const expectedScopeKey = participantOfflineScopeKey(scope);
  if (record.scopeKey !== expectedScopeKey) {
    throw new TypeError('Offline queue preflight scope is invalid.');
  }
  return withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.control,
        participantOfflineStoreNames.syncQueue,
      ],
      'readwrite',
    );
    const control = await assertExpectedEpoch(
      transaction,
      options?.expectedEpoch,
    );
    const store = transaction.objectStore(
      participantOfflineStoreNames.syncQueue,
    );
    const value = await requestValue<unknown>(store.get(record.id));
    if (value === undefined) {
      await transactionDone(transaction);
      return null;
    }
    let current: OfflineAgendaQueueRecord;
    try {
      current = parseOfflineAgendaQueueRecord(
        value,
        scope,
        expectedScopeKey,
        control.epoch,
      );
    } catch {
      store.delete(record.id);
      await transactionDone(transaction);
      return null;
    }
    if (
      Date.parse(current.expiresAt) <= Date.now() ||
      current.status === 'failed' ||
      current.status === 'superseded' ||
      !queueAttemptUnchanged(record, current)
    ) {
      if (Date.parse(current.expiresAt) <= Date.now()) {
        store.delete(current.id);
      }
      await transactionDone(transaction);
      return null;
    }
    await transactionDone(transaction);
    return current;
  }, options);
};

const queueStatusTransitions: Readonly<
  Record<OfflineQueueStatus, ReadonlySet<OfflineQueueStatus>>
> = Object.freeze({
  pending: new Set<OfflineQueueStatus>(['conflict', 'retry']),
  retry: new Set<OfflineQueueStatus>(['conflict', 'failed', 'retry']),
  conflict: new Set<OfflineQueueStatus>(),
  failed: new Set<OfflineQueueStatus>(),
  superseded: new Set<OfflineQueueStatus>(),
});

export const updateOfflineAgendaQueueRecord = async (
  record: OfflineAgendaQueueRecord,
  update: {
    readonly attempts: number;
    readonly lastProblemCode: string | null;
    readonly status: OfflineQueueStatus;
    readonly updatedAt?: Date | string;
  },
  options?: ParticipantOfflineOperationOptions,
): Promise<OfflineAgendaQueueRecord> => {
  if (!queueStatuses.has(update.status)) {
    throw new TypeError('Offline queue update status is invalid.');
  }
  const parsedScope = parseParticipantOfflineScope({
    eventId: record.eventId,
    userId: record.userId,
  });
  const parsedRecord = parseOfflineAgendaQueueRecord(
    record,
    parsedScope,
    participantOfflineScopeKey(parsedScope),
  );
  if (
    !queueStatusTransitions[parsedRecord.status].has(update.status) ||
    update.attempts !== parsedRecord.attempts + 1
  ) {
    throw new TypeError('Offline queue status transition is invalid.');
  }
  const next: OfflineAgendaQueueRecord = {
    ...parsedRecord,
    attempts: update.attempts,
    expectedVersion: parsedRecord.expectedVersion,
    lastProblemCode: update.lastProblemCode,
    status: update.status,
    updatedAt: isoNow(update.updatedAt ?? new Date()),
  };
  parseOfflineAgendaQueueRecord(
    next,
    parsedScope,
    participantOfflineScopeKey(parsedScope),
  );
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.control,
        participantOfflineStoreNames.syncQueue,
      ],
      'readwrite',
    );
    const control = await assertExpectedEpoch(
      transaction,
      options?.expectedEpoch,
    );
    const store = transaction.objectStore(
      participantOfflineStoreNames.syncQueue,
    );
    const current = parseOfflineAgendaQueueRecord(
      await requestValue<unknown>(store.get(parsedRecord.id)),
      parsedScope,
      parsedRecord.scopeKey,
      control.epoch,
    );
    if (
      current.updatedAt !== parsedRecord.updatedAt ||
      current.status !== parsedRecord.status ||
      current.attempts !== parsedRecord.attempts ||
      current.expectedVersion !== parsedRecord.expectedVersion ||
      current.ownerLeaseId !== parsedRecord.ownerLeaseId ||
      current.revocationEpoch !== parsedRecord.revocationEpoch ||
      current.action !== parsedRecord.action ||
      current.sessionId !== parsedRecord.sessionId
    ) {
      transaction.abort();
      throw new TypeError(
        'Offline queue record changed before it was updated.',
      );
    }
    if (
      !queueStatusTransitions[current.status].has(update.status) ||
      update.attempts !== current.attempts + 1
    ) {
      transaction.abort();
      throw new TypeError('Offline queue status transition is invalid.');
    }
    store.put(next);
    await transactionDone(transaction);
  }, options);
  notifyOfflineData({
    kind: 'queue',
    scopeKey: record.scopeKey,
    reason: null,
  });
  return next;
};

export const rebaseOfflineAgendaConflict = async (
  record: OfflineAgendaQueueRecord,
  expectedVersion: number,
  idempotencyKey: string,
  now: Date | string = new Date(),
  options?: ParticipantOfflineOperationOptions,
): Promise<OfflineAgendaQueueRecord> => {
  if (
    !Number.isSafeInteger(expectedVersion) ||
    expectedVersion < 1 ||
    !isUuid(idempotencyKey) ||
    idempotencyKey === record.idempotencyKey
  ) {
    throw new TypeError(
      'Conflict rebase requires a new UUID and canonical agenda version.',
    );
  }
  const scope = parseParticipantOfflineScope({
    eventId: record.eventId,
    userId: record.userId,
  });
  const expectedScopeKey = participantOfflineScopeKey(scope);
  const parsedRecord = parseOfflineAgendaQueueRecord(
    record,
    scope,
    expectedScopeKey,
  );
  const timestamp = isoNow(now);
  const rebased: OfflineAgendaQueueRecord = {
    ...parsedRecord,
    contractVersion: PARTICIPANT_OFFLINE_CONTRACT_VERSION,
    schemaVersion: PARTICIPANT_OFFLINE_DATABASE_VERSION,
    id: idempotencyKey,
    idempotencyKey,
    expectedVersion,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(
      Date.parse(timestamp) + OFFLINE_PRIVATE_RECORD_LEASE_MS,
    ).toISOString(),
    attempts: 0,
    status: 'pending',
    lastProblemCode: null,
    supersedesId: parsedRecord.id,
  };
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.control,
        participantOfflineStoreNames.syncQueue,
      ],
      'readwrite',
    );
    const control = await assertExpectedEpoch(
      transaction,
      options?.expectedEpoch,
    );
    const store = transaction.objectStore(
      participantOfflineStoreNames.syncQueue,
    );
    const current = await requestValue<unknown>(store.get(parsedRecord.id));
    const parsedCurrent = parseOfflineAgendaQueueRecord(
      current,
      scope,
      expectedScopeKey,
      control.epoch,
    );
    if (
      parsedCurrent.status !== 'conflict' ||
      parsedCurrent.updatedAt !== parsedRecord.updatedAt ||
      parsedRecord.ownerLeaseId !== control.epoch ||
      parsedRecord.revocationEpoch !== control.epoch ||
      parsedCurrent.action !== parsedRecord.action ||
      parsedCurrent.sessionId !== parsedRecord.sessionId
    ) {
      transaction.abort();
      throw new TypeError('Offline conflict changed before it was rebased.');
    }
    const collision = await requestValue<unknown>(store.get(idempotencyKey));
    if (collision !== undefined) {
      transaction.abort();
      throw new TypeError('Offline rebase UUID already exists.');
    }
    offlineAgendaConflictRebaseSchema.parse({
      conflict: toOfflineAgendaQueueContract(parsedCurrent),
      replacement: toOfflineAgendaQueueContract(rebased),
    });
    store.put({
      ...parsedCurrent,
      expiresAt: rebased.expiresAt,
      status: 'superseded',
      updatedAt: timestamp,
    } satisfies OfflineAgendaQueueRecord);
    store.add(rebased);
    await transactionDone(transaction);
  }, options);
  notifyOfflineData({
    kind: 'queue',
    scopeKey: expectedScopeKey,
    reason: null,
  });
  return rebased;
};

export const removeOfflineAgendaQueueRecord = async (
  record: Pick<
    OfflineAgendaQueueRecord,
    'eventId' | 'id' | 'scopeKey' | 'userId'
  >,
  options?: ParticipantOfflineOperationOptions,
): Promise<void> => {
  const scope = parseParticipantOfflineScope({
    eventId: record.eventId,
    userId: record.userId,
  });
  const expectedScopeKey = participantOfflineScopeKey(scope);
  if (record.scopeKey !== expectedScopeKey) {
    throw new TypeError('Offline queue removal scope is invalid.');
  }
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.control,
        participantOfflineStoreNames.syncQueue,
      ],
      'readwrite',
    );
    const control = await assertExpectedEpoch(
      transaction,
      options?.expectedEpoch,
    );
    const store = transaction.objectStore(
      participantOfflineStoreNames.syncQueue,
    );
    const current = await requestValue<unknown>(store.get(record.id));
    try {
      const parsedCurrent = parseOfflineAgendaQueueRecord(
        current,
        scope,
        expectedScopeKey,
        control.epoch,
      );
      if (parsedCurrent.supersedesId) {
        const parent = parseOfflineAgendaQueueRecord(
          await requestValue<unknown>(store.get(parsedCurrent.supersedesId)),
          scope,
          expectedScopeKey,
          control.epoch,
        );
        if (parent.status === 'superseded') {
          store.delete(parent.id);
        }
      }
    } catch {
      // Invalid or cross-owner links are quarantined by deleting only the
      // explicitly addressed record.
    }
    store.delete(record.id);
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
  options?: ParticipantOfflineOperationOptions,
): Promise<void> => {
  const scopeKey = participantOfflineScopeKey(scope);
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.agenda,
        participantOfflineStoreNames.control,
        participantOfflineStoreNames.metadata,
        participantOfflineStoreNames.syncQueue,
      ],
      'readwrite',
    );
    await assertExpectedEpoch(transaction, options?.expectedEpoch);
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
  tombstoneEpoch = createEpoch(),
): Promise<void> => {
  if (!isUuid(tombstoneEpoch)) {
    throw new TypeError('Offline wipe tombstone is invalid.');
  }
  let changed = false;
  await withDatabase(async (database) => {
    const transaction = database.transaction(
      [
        participantOfflineStoreNames.agenda,
        participantOfflineStoreNames.control,
        participantOfflineStoreNames.metadata,
        participantOfflineStoreNames.syncQueue,
      ],
      'readwrite',
    );
    const control = transaction.objectStore(
      participantOfflineStoreNames.control,
    );
    const current = await readControlRecord(control);
    if (current.epoch === tombstoneEpoch) {
      await transactionDone(transaction);
      return;
    }
    changed = true;
    transaction.objectStore(participantOfflineStoreNames.agenda).clear();
    transaction.objectStore(participantOfflineStoreNames.metadata).clear();
    transaction.objectStore(participantOfflineStoreNames.syncQueue).clear();
    control.put({
      key: PARTICIPANT_OFFLINE_EPOCH_KEY,
      epoch: tombstoneEpoch,
      changedAt: new Date().toISOString(),
      reason,
    } satisfies ParticipantOfflineControlRecord);
    await transactionDone(transaction);
  }, options);
  if (changed) notifyOfflineData({ kind: 'wipe', scopeKey: null, reason });
};
