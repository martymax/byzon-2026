import { participantAgendaResponseSchema } from '@byzon/domain/contracts';
import {
  agendaFixtureIds,
  participantAgendaFixtures,
  participantAgendaMutationFixtures,
} from '@byzon/test-support/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFetchApiClient } from '../../lib/api/fetch-client';
import {
  discardFailedOfflineAgendaQueue,
  EMPTY_OFFLINE_AGENDA_QUEUE,
  queueApprovedOfflineAgendaMutation,
  readOfflineAgendaQueueSummary,
  retryOfflineAgendaConflict,
  syncOfflineAgendaQueue,
} from '../../lib/offline/offline-agenda';
import {
  ParticipantOfflineEpochChangedError,
  enqueueOfflineAgendaMutation,
  listOfflineAgendaQueue,
  openParticipantOfflineDatabase,
  readOfflineAgendaSnapshot,
  readParticipantOfflineEpoch,
  subscribeToParticipantOfflineData,
  updateOfflineAgendaQueueRecord,
  wipeAllParticipantOfflineData,
  wipeParticipantOfflineScope,
  writeOfflineAgendaSnapshot,
} from '../../lib/offline/offline-database';
import {
  PARTICIPANT_OFFLINE_DATABASE_VERSION,
  participantOfflineStoreNames,
} from '../../lib/offline/offline-policy';
import {
  PRIVATE_RESOURCE_BROADCAST_CHANNEL,
  invalidateParticipantPrivateResources,
  subscribeToPrivateResourceInvalidation,
} from '../../lib/private-resource-events';

const scope = {
  eventId: agendaFixtureIds.event,
  userId: agendaFixtureIds.user,
} as const;
const otherScope = {
  eventId: '01930000-0000-7000-8000-0000000000e1',
  userId: '01930000-0000-7000-8000-0000000000e2',
} as const;

const otherSnapshot = participantAgendaResponseSchema.parse({
  ...participantAgendaFixtures.empty!,
  eventId: otherScope.eventId,
  userId: otherScope.userId,
});

const deleteDatabase = (name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new TypeError(`Test database ${name} remained open.`));
  });

const createMalformedVersionOne = (name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(participantOfflineStoreNames.agenda, {
        keyPath: 'wrongOwnerKey',
      });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
  });

const requestResult = <Value,>(request: IDBRequest<Value>): Promise<Value> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const requestPath = (input: RequestInfo | URL): string =>
  new URL(
    input instanceof Request ? input.url : input.toString(),
    'https://byzon.invalid',
  ).pathname;

const replayPreflightResponse = (
  offlineEpoch: string,
  requestId: string,
): Response => {
  const issuedAt = new Date();
  return Response.json(
    {
      contractVersion: 1,
      eventId: scope.eventId,
      userId: scope.userId,
      ownerLeaseId: offlineEpoch,
      revocationEpoch: offlineEpoch,
      agendaVersion: participantAgendaFixtures.happy!.version,
      issuedAt: issuedAt.toISOString(),
      validUntil: new Date(issuedAt.getTime() + 30_000).toISOString(),
    },
    {
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
      },
    },
  );
};

const createSeededVersionTwo = (name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      const control = database.createObjectStore(
        participantOfflineStoreNames.control,
        { keyPath: 'key' },
      );
      const agenda = database.createObjectStore(
        participantOfflineStoreNames.agenda,
        { keyPath: 'scopeKey' },
      );
      const metadata = database.createObjectStore(
        participantOfflineStoreNames.metadata,
        { keyPath: 'scopeKey' },
      );
      const queue = database.createObjectStore(
        participantOfflineStoreNames.syncQueue,
        { keyPath: 'id' },
      );
      control.put({ key: 'participant-private-epoch', epoch: 'legacy' });
      agenda.put({ scopeKey: 'legacy-scope', privateValue: 'legacy-agenda' });
      metadata.put({
        scopeKey: 'legacy-scope',
        privateValue: 'legacy-metadata',
      });
      queue.put({ id: 'legacy-queue', scopeKey: 'legacy-scope' });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });

const readRawQueueRecord = async (id: string): Promise<unknown> => {
  const database = await openParticipantOfflineDatabase();
  try {
    const transaction = database.transaction(
      participantOfflineStoreNames.syncQueue,
      'readonly',
    );
    const request = transaction
      .objectStore(participantOfflineStoreNames.syncQueue)
      .get(id);
    const value = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await transactionDone(transaction);
    return value;
  } finally {
    database.close();
  }
};

const addUnknownQueueField = async (id: string): Promise<void> => {
  const database = await openParticipantOfflineDatabase();
  try {
    const transaction = database.transaction(
      participantOfflineStoreNames.syncQueue,
      'readwrite',
    );
    const store = transaction.objectStore(
      participantOfflineStoreNames.syncQueue,
    );
    const request = store.get(id);
    request.onsuccess = () => {
      store.put({
        ...(request.result as Record<string, unknown>),
        participantEmail: 'must-not-be-replayed@example.test',
      });
    };
    await transactionDone(transaction);
  } finally {
    database.close();
  }
};

afterEach(async () => {
  await wipeAllParticipantOfflineData('user_request');
});

describe('participant offline IndexedDB', () => {
  it('keeps snapshots and queues isolated by event and user', async () => {
    await Promise.all([
      writeOfflineAgendaSnapshot(scope, participantAgendaFixtures.happy!),
      writeOfflineAgendaSnapshot(otherScope, otherSnapshot),
    ]);

    const [owned, other] = await Promise.all([
      readOfflineAgendaSnapshot(scope),
      readOfflineAgendaSnapshot(otherScope),
    ]);
    expect(owned?.snapshot.userId).toBe(scope.userId);
    expect(other?.snapshot.userId).toBe(otherScope.userId);
    expect(other?.snapshot.items).toHaveLength(0);

    const queued = await enqueueOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      '01930000-0000-7000-8000-0000000000a1',
    );
    expect(queued).toMatchObject({
      action: 'remove',
      scopeKey: `${scope.eventId}:${scope.userId}`,
      status: 'pending',
    });
    expect(await listOfflineAgendaQueue(otherScope)).toHaveLength(0);

    await expect(
      enqueueOfflineAgendaMutation(
        scope,
        {
          action: 'reserve',
          expectedVersion: participantAgendaFixtures.happy!.version,
          sessionId: agendaFixtureIds.reservedSession,
        },
        '01930000-0000-7000-8000-0000000000a2',
      ),
    ).rejects.toThrow('Only agenda add/remove');
  });

  it('rejects idempotency reuse and wipes only the selected owner scope', async () => {
    const key = '01930000-0000-7000-8000-0000000000b1';
    await Promise.all([
      writeOfflineAgendaSnapshot(scope, participantAgendaFixtures.happy!),
      writeOfflineAgendaSnapshot(otherScope, otherSnapshot),
    ]);
    await enqueueOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      key,
    );
    await expect(
      enqueueOfflineAgendaMutation(
        otherScope,
        {
          action: 'add',
          expectedVersion: otherSnapshot.version,
          sessionId: agendaFixtureIds.savedSession,
        },
        key,
      ),
    ).rejects.toThrow('idempotency key was reused');

    await wipeParticipantOfflineScope(scope, 'switch_account');
    expect(await readOfflineAgendaSnapshot(scope)).toBeNull();
    expect(await listOfflineAgendaQueue(scope)).toHaveLength(0);
    expect((await readOfflineAgendaSnapshot(otherScope))?.snapshot).toEqual(
      otherSnapshot,
    );
  });

  it('recovers an incompatible migration by clearing only its local database', async () => {
    const name = `byzon-offline-migration-${crypto.randomUUID()}`;
    await createMalformedVersionOne(name);
    const wipes: string[] = [];
    const unsubscribe = subscribeToParticipantOfflineData((event) => {
      if (event.reason) wipes.push(event.reason);
    });

    try {
      const database = await openParticipantOfflineDatabase({ name });
      expect(database.version).toBe(PARTICIPANT_OFFLINE_DATABASE_VERSION);
      expect([...database.objectStoreNames].sort()).toEqual(
        Object.values(participantOfflineStoreNames).sort(),
      );
      database.close();
      expect(wipes).toContain('migration_failure');
    } finally {
      unsubscribe();
      await deleteDatabase(name);
    }
  });

  it('atomically drops every private v2 store while rotating the v3 epoch', async () => {
    const name = `byzon-offline-v2-${crypto.randomUUID()}`;
    await createSeededVersionTwo(name);
    try {
      const database = await openParticipantOfflineDatabase({ name });
      const transaction = database.transaction(
        [
          participantOfflineStoreNames.agenda,
          participantOfflineStoreNames.control,
          participantOfflineStoreNames.metadata,
          participantOfflineStoreNames.syncQueue,
        ],
        'readonly',
      );
      const [agendaCount, metadataCount, queueCount, controls] =
        await Promise.all([
          requestResult(
            transaction
              .objectStore(participantOfflineStoreNames.agenda)
              .count(),
          ),
          requestResult(
            transaction
              .objectStore(participantOfflineStoreNames.metadata)
              .count(),
          ),
          requestResult(
            transaction
              .objectStore(participantOfflineStoreNames.syncQueue)
              .count(),
          ),
          requestResult<unknown[]>(
            transaction
              .objectStore(participantOfflineStoreNames.control)
              .getAll(),
          ),
        ]);
      await transactionDone(transaction);
      database.close();

      expect({ agendaCount, metadataCount, queueCount }).toEqual({
        agendaCount: 0,
        metadataCount: 0,
        queueCount: 0,
      });
      expect(controls).toMatchObject([
        {
          key: 'participant-private-epoch',
          reason: 'schema_created',
        },
      ]);
      expect((controls[0] as { epoch?: unknown }).epoch).not.toBe('legacy');
    } finally {
      await deleteDatabase(name);
    }
  });

  it('replays one approved mutation with its UUID and canonical server result', async () => {
    const offlineEpoch = await readParticipantOfflineEpoch();
    await writeOfflineAgendaSnapshot(
      scope,
      participantAgendaFixtures.happy!,
      new Date(),
      { expectedEpoch: offlineEpoch },
    );
    const idempotencyKey = '01930000-0000-7000-8000-0000000000c1';
    await queueApprovedOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      idempotencyKey,
      offlineEpoch,
    );
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method =
          init?.method ?? (_input instanceof Request ? _input.method : 'GET');
        if (method === 'GET') {
          return Response.json(participantAgendaFixtures.happy!, {
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'offline-owner-preflight-0001',
            },
          });
        }
        if (requestPath(_input) === '/api/v1/me/offline-replay-preflight') {
          return replayPreflightResponse(
            offlineEpoch,
            'offline-replay-preflight-0001',
          );
        }
        expect(method).toBe('POST');
        const headers =
          init?.headers ??
          (_input instanceof Request ? _input.headers : undefined);
        expect(new Headers(headers).get('idempotency-key')).toBe(
          idempotencyKey,
        );
        return Response.json(participantAgendaMutationFixtures.removed!, {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'offline-sync-component-0001',
          },
        });
      },
    );

    const result = await syncOfflineAgendaQueue(
      scope,
      createFetchApiClient({ fetch, maxRetries: 0 }),
      offlineEpoch,
    );

    expect(result.processed).toBe(1);
    expect(result.summary).toEqual(EMPTY_OFFLINE_AGENDA_QUEUE);
    expect(result.canonical?.version).toBe(
      participantAgendaMutationFixtures.removed!.version,
    );
    expect(await readOfflineAgendaQueueSummary(scope)).toEqual(
      EMPTY_OFFLINE_AGENDA_QUEUE,
    );
    expect((await readOfflineAgendaSnapshot(scope))?.snapshot.items).toEqual(
      [],
    );
  });

  it('fences stale writes after a logout tombstone rotates the epoch', async () => {
    const staleEpoch = await readParticipantOfflineEpoch();
    await wipeAllParticipantOfflineData('logout');

    await expect(
      writeOfflineAgendaSnapshot(
        scope,
        participantAgendaFixtures.happy!,
        new Date(),
        { expectedEpoch: staleEpoch },
      ),
    ).rejects.toBeInstanceOf(ParticipantOfflineEpochChangedError);
    expect(await readOfflineAgendaSnapshot(scope)).toBeNull();
  });

  it('fences a stale invalid-snapshot scope wipe from a replacement epoch', async () => {
    const staleEpoch = await readParticipantOfflineEpoch();
    await wipeAllParticipantOfflineData('logout');
    const replacementEpoch = await readParticipantOfflineEpoch();
    await writeOfflineAgendaSnapshot(
      scope,
      participantAgendaFixtures.happy!,
      new Date(),
      { expectedEpoch: replacementEpoch },
    );

    await expect(
      wipeParticipantOfflineScope(scope, 'migration_failure', {
        expectedEpoch: staleEpoch,
      }),
    ).rejects.toBeInstanceOf(ParticipantOfflineEpochChangedError);
    expect(
      (
        await readOfflineAgendaSnapshot(scope, {
          expectedEpoch: replacementEpoch,
        })
      )?.snapshot,
    ).toEqual(participantAgendaFixtures.happy);
  });

  it('quarantines a queue record with any unknown persisted field', async () => {
    const offlineEpoch = await readParticipantOfflineEpoch();
    const id = '01930000-0000-7000-8000-0000000000d1';
    await queueApprovedOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      id,
      offlineEpoch,
    );
    await addUnknownQueueField(id);

    expect(
      await listOfflineAgendaQueue(scope, {
        expectedEpoch: offlineEpoch,
      }),
    ).toHaveLength(0);
    expect(await readRawQueueRecord(id)).toBeUndefined();
  });

  it('rebases a conflict onto a new UUID and supersedes the old attempt', async () => {
    const offlineEpoch = await readParticipantOfflineEpoch();
    const oldId = '01930000-0000-7000-8000-0000000000d2';
    const newId = '01930000-0000-7000-8000-0000000000d3';
    const queued = await queueApprovedOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      oldId,
      offlineEpoch,
    );
    const conflict = await updateOfflineAgendaQueueRecord(
      queued,
      {
        attempts: 1,
        expectedVersion: participantAgendaFixtures.happy!.version + 99,
        lastProblemCode: 'AGENDA_VERSION_CONFLICT',
        status: 'conflict',
      } as unknown as Parameters<typeof updateOfflineAgendaQueueRecord>[1],
      { expectedEpoch: offlineEpoch },
    );
    expect(conflict.expectedVersion).toBe(
      participantAgendaFixtures.happy!.version,
    );
    await expect(
      updateOfflineAgendaQueueRecord(
        conflict,
        {
          attempts: 2,
          lastProblemCode: 'TRANSPORT',
          status: 'retry',
        },
        { expectedEpoch: offlineEpoch },
      ),
    ).rejects.toThrow('status transition is invalid');

    await retryOfflineAgendaConflict(
      scope,
      participantAgendaFixtures.happy!.version + 1,
      offlineEpoch,
      () => newId,
    );

    expect(
      await listOfflineAgendaQueue(scope, { expectedEpoch: offlineEpoch }),
    ).toMatchObject([
      {
        id: newId,
        idempotencyKey: newId,
        expectedVersion: participantAgendaFixtures.happy!.version + 1,
        status: 'pending',
        supersedesId: oldId,
      },
    ]);
    expect(await readRawQueueRecord(oldId)).toMatchObject({
      id: oldId,
      status: 'superseded',
    });
  });

  it('terminalizes the retry budget and never posts a failed record again', async () => {
    const offlineEpoch = await readParticipantOfflineEpoch();
    const queued = await queueApprovedOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      '01930000-0000-7000-8000-0000000000d4',
      offlineEpoch,
    );
    let retryRecord = queued;
    for (let attempts = 1; attempts <= 4; attempts += 1) {
      retryRecord = await updateOfflineAgendaQueueRecord(
        retryRecord,
        {
          attempts,
          lastProblemCode: 'TRANSPORT',
          status: 'retry',
        },
        { expectedEpoch: offlineEpoch },
      );
    }
    let postCount = 0;
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method =
          init?.method ?? (_input instanceof Request ? _input.method : 'GET');
        if (method === 'GET') {
          return Response.json(participantAgendaFixtures.happy!, {
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'offline-owner-preflight-0002',
            },
          });
        }
        postCount += 1;
        throw new TypeError('Synthetic transport failure.');
      },
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });

    const first = await syncOfflineAgendaQueue(scope, api, offlineEpoch);
    expect(first.summary).toMatchObject({ conflict: 0, failed: 1 });
    expect(
      await listOfflineAgendaQueue(scope, { expectedEpoch: offlineEpoch }),
    ).toMatchObject([{ attempts: 5, status: 'failed' }]);

    await syncOfflineAgendaQueue(scope, api, offlineEpoch);
    expect(postCount).toBe(1);

    expect(await discardFailedOfflineAgendaQueue(scope, offlineEpoch)).toEqual(
      EMPTY_OFFLINE_AGENDA_QUEUE,
    );
    await queueApprovedOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      '01930000-0000-7000-8000-0000000000d7',
      offlineEpoch,
    );
    expect(
      await readOfflineAgendaQueueSummary(scope, offlineEpoch),
    ).toMatchObject({ failed: 0, pending: 1, total: 1 });
  });

  it('atomically discards an expired replay candidate and never POSTs it', async () => {
    const offlineEpoch = await readParticipantOfflineEpoch();
    const id = '01930000-0000-7000-8000-0000000000d8';
    await enqueueOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      id,
      '2020-01-01T00:00:00.000Z',
      { expectedEpoch: offlineEpoch },
    );
    let postCount = 0;
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method =
          init?.method ?? (_input instanceof Request ? _input.method : 'GET');
        if (method === 'POST') postCount += 1;
        return Response.json(participantAgendaFixtures.happy!, {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'offline-expired-preflight-0001',
          },
        });
      },
    );

    const result = await syncOfflineAgendaQueue(
      scope,
      createFetchApiClient({ fetch, maxRetries: 0 }),
      offlineEpoch,
    );

    expect(result.processed).toBe(0);
    expect(result.summary).toEqual(EMPTY_OFFLINE_AGENDA_QUEUE);
    expect(postCount).toBe(0);
    expect(await readRawQueueRecord(id)).toBeUndefined();
  });

  it('fails owner preflight closed and does not POST under another principal', async () => {
    const offlineEpoch = await readParticipantOfflineEpoch();
    await queueApprovedOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      '01930000-0000-7000-8000-0000000000d5',
      offlineEpoch,
    );
    let postCount = 0;
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method =
          init?.method ?? (_input instanceof Request ? _input.method : 'GET');
        if (method === 'POST') postCount += 1;
        return Response.json(otherSnapshot, {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'offline-owner-preflight-0003',
          },
        });
      },
    );

    const result = await syncOfflineAgendaQueue(
      scope,
      createFetchApiClient({ fetch, maxRetries: 0 }),
      offlineEpoch,
    );

    expect(result).toMatchObject({
      blocked: 'owner_unverified',
      invalidation: 'permission',
      processed: 0,
    });
    expect(postCount).toBe(0);
    expect(await listOfflineAgendaQueue(scope)).toHaveLength(0);
  });

  it('aborts a delayed replay and prevents resurrection after cleanup', async () => {
    const offlineEpoch = await readParticipantOfflineEpoch();
    await queueApprovedOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      '01930000-0000-7000-8000-0000000000d6',
      offlineEpoch,
    );
    let resolvePost: ((response: Response) => void) | undefined;
    let postStarted = false;
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const method =
          init?.method ?? (_input instanceof Request ? _input.method : 'GET');
        if (method === 'GET') {
          return Response.json(participantAgendaFixtures.happy!, {
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'offline-owner-preflight-0004',
            },
          });
        }
        if (requestPath(_input) === '/api/v1/me/offline-replay-preflight') {
          return replayPreflightResponse(
            offlineEpoch,
            'offline-replay-preflight-0002',
          );
        }
        postStarted = true;
        return new Promise<Response>((resolve) => {
          resolvePost = resolve;
        });
      },
    );
    const synchronization = syncOfflineAgendaQueue(
      scope,
      createFetchApiClient({ fetch, maxRetries: 0 }),
      offlineEpoch,
    );
    await vi.waitFor(() => expect(postStarted).toBe(true));

    await invalidateParticipantPrivateResources('session_expired', 'logout');
    resolvePost?.(
      Response.json(participantAgendaMutationFixtures.removed!, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'offline-sync-component-0002',
        },
      }),
    );

    await expect(synchronization).rejects.toBeInstanceOf(
      ParticipantOfflineEpochChangedError,
    );
    expect(await readOfflineAgendaSnapshot(scope)).toBeNull();
    expect(await listOfflineAgendaQueue(scope)).toHaveLength(0);
  });

  it('masks and durably wipes private data after a cross-tab broadcast', async () => {
    const offlineEpoch = await readParticipantOfflineEpoch();
    await writeOfflineAgendaSnapshot(
      scope,
      participantAgendaFixtures.happy!,
      new Date(),
      { expectedEpoch: offlineEpoch },
    );
    const listener = vi.fn();
    const unsubscribe = subscribeToPrivateResourceInvalidation(listener);
    const channel = new BroadcastChannel(PRIVATE_RESOURCE_BROADCAST_CHANNEL);
    try {
      channel.postMessage({
        type: 'participant-private-invalidation',
        id: crypto.randomUUID(),
        reason: 'session_expired',
        wipeReason: 'logout',
      });
      await vi.waitFor(() =>
        expect(listener).toHaveBeenCalledWith('session_expired'),
      );
      await vi.waitFor(async () =>
        expect(await readOfflineAgendaSnapshot(scope)).toBeNull(),
      );
    } finally {
      channel.close();
      unsubscribe();
    }
  });
});
