import { participantAgendaResponseSchema } from '@byzon/domain/contracts';
import {
  agendaFixtureIds,
  participantAgendaFixtures,
  participantAgendaMutationFixtures,
} from '@byzon/test-support/fixtures';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFetchApiClient } from '../../lib/api/fetch-client';
import {
  EMPTY_OFFLINE_AGENDA_QUEUE,
  queueApprovedOfflineAgendaMutation,
  readOfflineAgendaQueueSummary,
  syncOfflineAgendaQueue,
} from '../../lib/offline/offline-agenda';
import {
  enqueueOfflineAgendaMutation,
  listOfflineAgendaQueue,
  openParticipantOfflineDatabase,
  readOfflineAgendaSnapshot,
  subscribeToParticipantOfflineData,
  wipeAllParticipantOfflineData,
  wipeParticipantOfflineScope,
  writeOfflineAgendaSnapshot,
} from '../../lib/offline/offline-database';
import {
  PARTICIPANT_OFFLINE_DATABASE_VERSION,
  participantOfflineStoreNames,
} from '../../lib/offline/offline-policy';

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

  it('replays one approved mutation with its UUID and canonical server result', async () => {
    await writeOfflineAgendaSnapshot(scope, participantAgendaFixtures.happy!);
    const idempotencyKey = '01930000-0000-7000-8000-0000000000c1';
    await queueApprovedOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      idempotencyKey,
    );
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('idempotency-key')).toBe(
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
});
