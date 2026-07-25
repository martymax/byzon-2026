import { describe, expect, it } from 'vitest';

import {
  OFFLINE_CONTRACT_VERSION,
  OFFLINE_QUEUE_MAX_ATTEMPTS,
  offlineAgendaConflictRebaseSchema,
  offlineAgendaQueueRecordSchema,
  offlineAgendaReplayEnvelopeSchema,
  offlineCachePolicy,
  offlineFeatureGateDefaults,
  offlineFeatureGateSchema,
  offlineOwnerLeaseSchema,
  offlineParticipantAgendaCacheSchema,
  offlinePublicSnapshotSchema,
} from './offline.js';

const ids = {
  event: '01930000-0000-7000-8000-000000000001',
  user: '01930000-0000-7000-8000-000000000002',
  session: '01930000-0000-7000-8000-000000000003',
  lease: '01930000-0000-7000-8000-000000000004',
  epoch: '01930000-0000-7000-8000-000000000005',
  first: '01930000-0000-7000-8000-000000000006',
  next: '01930000-0000-7000-8000-000000000007',
} as const;

const lease = {
  contractVersion: OFFLINE_CONTRACT_VERSION,
  leaseId: ids.lease,
  eventId: ids.event,
  userId: ids.user,
  revocationEpoch: ids.epoch,
  issuedAt: '2026-09-18T06:00:00.000Z',
  refreshAfter: '2026-09-18T12:00:00.000Z',
  expiresAt: '2026-09-19T06:00:00.000Z',
};

const conflict = {
  contractVersion: OFFLINE_CONTRACT_VERSION,
  id: ids.first,
  idempotencyKey: ids.first,
  eventId: ids.event,
  userId: ids.user,
  ownerLeaseId: ids.lease,
  revocationEpoch: ids.epoch,
  action: 'remove' as const,
  sessionId: ids.session,
  expectedVersion: 7,
  createdAt: '2026-09-18T06:05:00.000Z',
  updatedAt: '2026-09-18T06:06:00.000Z',
  expiresAt: '2026-09-19T06:00:00.000Z',
  attempts: 1,
  status: 'conflict' as const,
  lastProblemCode: 'AGENDA_VERSION_CONFLICT',
  supersedesId: null,
};

describe('CS-OFFLINE-01 canonical contracts', () => {
  it('keeps private caches owner-bound and public caches anonymous', () => {
    expect(offlineCachePolicy.public).toMatchObject({
      credentials: 'omit',
      storage: 'service-worker-cache',
    });
    expect(offlineCachePolicy.private).toMatchObject({
      cacheControl: 'private, no-store',
      serviceWorker: 'forbidden',
      ownerBinding: 'event-user-lease-and-revocation-epoch',
    });
    expect(offlineCachePolicy.replay.approvedActions).toEqual([
      'add',
      'remove',
    ]);
  });

  it('defaults personal persistence and replay to fail-closed', () => {
    expect(offlineFeatureGateSchema.parse(offlineFeatureGateDefaults)).toEqual(
      offlineFeatureGateDefaults,
    );
    expect(offlineFeatureGateDefaults).toMatchObject({
      personalAgendaCache: false,
      agendaMutationReplay: false,
      ownerLease: 'disabled',
      ownerBoundReplay: 'disabled',
    });
    expect(
      offlineFeatureGateSchema.safeParse({
        ...offlineFeatureGateDefaults,
        agendaMutationReplay: true,
      }).success,
    ).toBe(false);
  });

  it('requires a bounded event/user/revocation owner lease', () => {
    expect(offlineOwnerLeaseSchema.parse(lease)).toEqual(lease);
    expect(
      offlineOwnerLeaseSchema.safeParse({
        ...lease,
        userId: ids.event,
        expiresAt: '2026-09-20T06:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      offlineOwnerLeaseSchema.safeParse({ ...lease, authorization: 'secret' })
        .success,
    ).toBe(false);
  });

  it('allowlists and correlates anonymous public snapshots', () => {
    const snapshot = {
      contractVersion: OFFLINE_CONTRACT_VERSION,
      kind: 'bootstrap',
      eventId: ids.event,
      eventSlug: 'byzon-2026',
      publicationVersion: 3,
      storedAt: '2026-09-18T06:00:00.000Z',
      expiresAt: '2026-09-19T06:00:00.000Z',
      payload: {
        version: 3,
        publishedAt: '2026-09-18T05:55:00.000Z',
        event: {
          id: ids.event,
          slug: 'byzon-2026',
          name: 'BYZON 2026',
          timezone: 'Europe/Prague',
          startsAt: '2026-09-18T06:00:00.000Z',
          endsAt: '2026-09-19T20:00:00.000Z',
        },
      },
    } as const;

    expect(offlinePublicSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      offlinePublicSnapshotSchema.safeParse({
        ...snapshot,
        payload: {
          ...snapshot.payload,
          privateAdminNote: 'must-not-enter-cache',
        },
      }).success,
    ).toBe(false);
    expect(
      offlinePublicSnapshotSchema.safeParse({
        ...snapshot,
        eventSlug: 'another-event',
      }).success,
    ).toBe(false);
  });

  it('binds personal agenda data to its owner lease and revocation epoch', () => {
    const snapshot = {
      contractVersion: OFFLINE_CONTRACT_VERSION,
      kind: 'participant-agenda',
      eventId: ids.event,
      userId: ids.user,
      agendaVersion: 7,
      publicationVersion: 3,
      revocationEpoch: ids.epoch,
      storedAt: '2026-09-18T06:05:00.000Z',
      expiresAt: lease.expiresAt,
      lease,
      snapshot: {
        eventId: ids.event,
        userId: ids.user,
        eventTimezone: 'Europe/Prague',
        serverNow: '2026-09-18T06:05:00.000Z',
        version: 7,
        publicationVersion: 3,
        items: [],
        calendarExport: { state: 'unavailable', reason: 'empty' },
      },
    } as const;

    expect(offlineParticipantAgendaCacheSchema.parse(snapshot)).toEqual(
      snapshot,
    );
    expect(
      offlineParticipantAgendaCacheSchema.safeParse({
        ...snapshot,
        userId: ids.event,
      }).success,
    ).toBe(false);
    expect(
      offlineParticipantAgendaCacheSchema.safeParse({
        ...snapshot,
        revocationEpoch: ids.first,
      }).success,
    ).toBe(false);
  });

  it('accepts only strict add/remove records and terminalizes max attempts', () => {
    expect(offlineAgendaQueueRecordSchema.parse(conflict)).toEqual(conflict);
    expect(
      offlineAgendaQueueRecordSchema.safeParse({
        ...conflict,
        action: 'reserve',
      }).success,
    ).toBe(false);
    expect(
      offlineAgendaQueueRecordSchema.safeParse({
        ...conflict,
        status: 'retry',
        attempts: OFFLINE_QUEUE_MAX_ATTEMPTS,
      }).success,
    ).toBe(false);
    expect(
      offlineAgendaQueueRecordSchema.safeParse({
        ...conflict,
        payload: { email: 'must-not-be-stored@example.test' },
      }).success,
    ).toBe(false);
  });

  it('requires a new idempotency UUID when rebasing a conflict', () => {
    const replacement = {
      ...conflict,
      id: ids.next,
      idempotencyKey: ids.next,
      expectedVersion: 8,
      createdAt: '2026-09-18T06:07:00.000Z',
      updatedAt: '2026-09-18T06:07:00.000Z',
      attempts: 0,
      status: 'pending' as const,
      lastProblemCode: null,
      supersedesId: ids.first,
    };
    expect(
      offlineAgendaConflictRebaseSchema.parse({ conflict, replacement }),
    ).toEqual({ conflict, replacement });
    expect(
      offlineAgendaConflictRebaseSchema.safeParse({
        conflict,
        replacement: {
          ...replacement,
          id: ids.first,
          idempotencyKey: ids.first,
        },
      }).success,
    ).toBe(false);
  });

  it('binds every replay POST to a fresh matching owner preflight', () => {
    const record = {
      ...conflict,
      attempts: 0,
      status: 'pending' as const,
      lastProblemCode: null,
    };
    const preflight = {
      contractVersion: OFFLINE_CONTRACT_VERSION,
      eventId: ids.event,
      userId: ids.user,
      ownerLeaseId: ids.lease,
      revocationEpoch: ids.epoch,
      agendaVersion: conflict.expectedVersion,
      issuedAt: '2026-09-18T06:06:00.000Z',
      validUntil: '2026-09-18T06:10:00.000Z',
    } as const;
    expect(
      offlineAgendaReplayEnvelopeSchema.parse({
        preflight,
        record,
      }),
    ).toEqual({ preflight, record });
    expect(
      offlineAgendaReplayEnvelopeSchema.safeParse({
        preflight: { ...preflight, userId: ids.event },
        record,
      }).success,
    ).toBe(false);
  });
});
