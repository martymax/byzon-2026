import { z } from 'zod';

import {
  agendaVersionSchema,
  participantAgendaResponseSchema,
} from './agenda.js';
import {
  publicContentBootstrapResponseSchema,
  publicContentResponseSchema,
} from './content.js';

export const OFFLINE_CONTRACT_VERSION = 1 as const;
export const OFFLINE_QUEUE_MAX_ATTEMPTS = 5 as const;
export const OFFLINE_OWNER_LEASE_MAX_MS = 24 * 60 * 60 * 1_000;
export const OFFLINE_PUBLIC_CACHE_MAX_MS = 7 * 24 * 60 * 60 * 1_000;
export const OFFLINE_REPLAY_PREFLIGHT_MAX_MS = 5 * 60 * 1_000;

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const publicationVersionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const revocationEpochSchema = uuidSchema;
const eventSlugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const boundedProblemCodeSchema = z
  .string()
  .min(2)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]+$/);

const addIssue = (
  context: z.RefinementCtx,
  path: readonly PropertyKey[],
  message: string,
): void => {
  context.addIssue({ code: 'custom', path: [...path], message });
};

const validInterval = (
  start: string,
  end: string,
  maximumMs: number,
): boolean => {
  const duration = Date.parse(end) - Date.parse(start);
  return duration > 0 && duration <= maximumMs;
};

/**
 * Anonymous public data and owner-bound personal data intentionally use
 * separate caches. No authenticated response is eligible for the public
 * service-worker cache.
 */
export const offlineCachePolicy = Object.freeze({
  public: Object.freeze({
    classification: 'published-public',
    cacheControl: 'public, max-age=0, must-revalidate',
    credentials: 'omit',
    redirects: 'reject',
    storage: 'service-worker-cache',
    ownerBinding: 'event-id-and-slug',
    validation: 'strict-offline-public-snapshot-v1',
  }),
  private: Object.freeze({
    classification: 'participant-private',
    cacheControl: 'private, no-store',
    serviceWorker: 'forbidden',
    storage: 'owner-scoped-indexeddb',
    ownerBinding: 'event-user-lease-and-revocation-epoch',
    validation: 'strict-offline-participant-agenda-v1',
  }),
  replay: Object.freeze({
    approvedActions: Object.freeze(['add', 'remove'] as const),
    idempotency: 'uuid-per-attempt',
    conflictRebase: 'new-uuid-required',
    ownerPreflight: 'lease-v1-required-before-post',
    default: 'disabled',
  }),
} as const);

export const offlineFeatureGateSchema = z
  .strictObject({
    contractVersion: z.literal(OFFLINE_CONTRACT_VERSION),
    publicContentCache: z.boolean(),
    personalAgendaCache: z.boolean(),
    agendaMutationReplay: z.boolean(),
    ownerLease: z.enum(['disabled', 'lease-v1']),
    ownerBoundReplay: z.enum(['disabled', 'lease-v1']),
  })
  .superRefine((gate, context) => {
    if (gate.personalAgendaCache && gate.ownerLease !== 'lease-v1') {
      addIssue(
        context,
        ['ownerLease'],
        'Personal cache requires an owner-bound lease-v1 endpoint',
      );
    }
    if (
      gate.agendaMutationReplay &&
      (!gate.personalAgendaCache ||
        gate.ownerLease !== 'lease-v1' ||
        gate.ownerBoundReplay !== 'lease-v1')
    ) {
      addIssue(
        context,
        ['agendaMutationReplay'],
        'Replay requires personal cache and owner-bound lease-v1 preflight',
      );
    }
  });

export type OfflineFeatureGate = z.infer<typeof offlineFeatureGateSchema>;

export const offlineFeatureGateDefaults: OfflineFeatureGate = Object.freeze({
  contractVersion: OFFLINE_CONTRACT_VERSION,
  publicContentCache: true,
  personalAgendaCache: false,
  agendaMutationReplay: false,
  ownerLease: 'disabled',
  ownerBoundReplay: 'disabled',
});

export const offlineOwnerLeaseSchema = z
  .strictObject({
    contractVersion: z.literal(OFFLINE_CONTRACT_VERSION),
    leaseId: uuidSchema,
    eventId: uuidSchema,
    userId: uuidSchema,
    revocationEpoch: revocationEpochSchema,
    issuedAt: dateTimeSchema,
    refreshAfter: dateTimeSchema,
    expiresAt: dateTimeSchema,
  })
  .superRefine((lease, context) => {
    if (
      !validInterval(
        lease.issuedAt,
        lease.expiresAt,
        OFFLINE_OWNER_LEASE_MAX_MS,
      )
    ) {
      addIssue(
        context,
        ['expiresAt'],
        'Owner lease must expire within the maximum offline lease',
      );
    }
    const refresh = Date.parse(lease.refreshAfter);
    if (
      refresh < Date.parse(lease.issuedAt) ||
      refresh >= Date.parse(lease.expiresAt)
    ) {
      addIssue(
        context,
        ['refreshAfter'],
        'Lease refresh must be inside the lease interval',
      );
    }
  });

export type OfflineOwnerLease = z.infer<typeof offlineOwnerLeaseSchema>;

const publicSnapshotBase = {
  contractVersion: z.literal(OFFLINE_CONTRACT_VERSION),
  eventId: uuidSchema,
  eventSlug: eventSlugSchema,
  publicationVersion: publicationVersionSchema,
  storedAt: dateTimeSchema,
  expiresAt: dateTimeSchema,
} as const;

export const offlinePublicSnapshotSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...publicSnapshotBase,
      kind: z.literal('bootstrap'),
      payload: publicContentBootstrapResponseSchema,
    }),
    z.strictObject({
      ...publicSnapshotBase,
      kind: z.literal('content'),
      payload: publicContentResponseSchema,
    }),
  ])
  .superRefine((snapshot, context) => {
    if (
      snapshot.payload.event.id !== snapshot.eventId ||
      snapshot.payload.event.slug !== snapshot.eventSlug
    ) {
      addIssue(
        context,
        ['payload', 'event'],
        'Public snapshot event must match its cache key',
      );
    }
    if (snapshot.payload.version !== snapshot.publicationVersion) {
      addIssue(
        context,
        ['publicationVersion'],
        'Public snapshot version must match its payload',
      );
    }
    if (
      !validInterval(
        snapshot.storedAt,
        snapshot.expiresAt,
        OFFLINE_PUBLIC_CACHE_MAX_MS,
      )
    ) {
      addIssue(
        context,
        ['expiresAt'],
        'Public snapshot must have a bounded positive expiry',
      );
    }
  });

export type OfflinePublicSnapshot = z.infer<typeof offlinePublicSnapshotSchema>;

export const offlineParticipantAgendaCacheSchema = z
  .strictObject({
    contractVersion: z.literal(OFFLINE_CONTRACT_VERSION),
    kind: z.literal('participant-agenda'),
    eventId: uuidSchema,
    userId: uuidSchema,
    agendaVersion: agendaVersionSchema,
    publicationVersion: publicationVersionSchema,
    revocationEpoch: revocationEpochSchema,
    storedAt: dateTimeSchema,
    expiresAt: dateTimeSchema,
    lease: offlineOwnerLeaseSchema,
    snapshot: participantAgendaResponseSchema,
  })
  .superRefine((cached, context) => {
    if (
      cached.eventId !== cached.snapshot.eventId ||
      cached.eventId !== cached.lease.eventId ||
      cached.userId !== cached.snapshot.userId ||
      cached.userId !== cached.lease.userId
    ) {
      addIssue(
        context,
        ['snapshot'],
        'Agenda cache must match the event/user lease owner',
      );
    }
    if (
      cached.agendaVersion !== cached.snapshot.version ||
      cached.publicationVersion !== cached.snapshot.publicationVersion
    ) {
      addIssue(
        context,
        ['agendaVersion'],
        'Agenda cache versions must match its canonical snapshot',
      );
    }
    if (
      cached.revocationEpoch !== cached.lease.revocationEpoch ||
      cached.expiresAt !== cached.lease.expiresAt ||
      Date.parse(cached.storedAt) < Date.parse(cached.lease.issuedAt) ||
      Date.parse(cached.storedAt) >= Date.parse(cached.expiresAt)
    ) {
      addIssue(
        context,
        ['lease'],
        'Agenda cache must be inside the current revocation lease',
      );
    }
  });

export type OfflineParticipantAgendaCache = z.infer<
  typeof offlineParticipantAgendaCacheSchema
>;

export const offlineAgendaQueueStatusSchema = z.enum([
  'pending',
  'retry',
  'conflict',
  'failed',
  'superseded',
]);

export type OfflineAgendaQueueStatus = z.infer<
  typeof offlineAgendaQueueStatusSchema
>;

export const offlineAgendaQueueRecordSchema = z
  .strictObject({
    contractVersion: z.literal(OFFLINE_CONTRACT_VERSION),
    id: uuidSchema,
    idempotencyKey: uuidSchema,
    eventId: uuidSchema,
    userId: uuidSchema,
    ownerLeaseId: uuidSchema,
    revocationEpoch: revocationEpochSchema,
    action: z.enum(['add', 'remove']),
    sessionId: uuidSchema,
    expectedVersion: agendaVersionSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    expiresAt: dateTimeSchema,
    attempts: z.number().int().min(0).max(OFFLINE_QUEUE_MAX_ATTEMPTS),
    status: offlineAgendaQueueStatusSchema,
    lastProblemCode: boundedProblemCodeSchema.nullable(),
    supersedesId: uuidSchema.nullable(),
  })
  .superRefine((record, context) => {
    if (record.id !== record.idempotencyKey) {
      addIssue(
        context,
        ['idempotencyKey'],
        'Queue record ID must equal its one-attempt idempotency UUID',
      );
    }
    if (
      Date.parse(record.updatedAt) < Date.parse(record.createdAt) ||
      Date.parse(record.expiresAt) <= Date.parse(record.updatedAt)
    ) {
      addIssue(
        context,
        ['expiresAt'],
        'Queue record timestamps must be monotonic and unexpired',
      );
    }
    if (record.supersedesId === record.id) {
      addIssue(
        context,
        ['supersedesId'],
        'A queue attempt cannot supersede itself',
      );
    }
    if (
      (record.status === 'pending' &&
        (record.attempts !== 0 || record.lastProblemCode !== null)) ||
      (record.status === 'retry' &&
        (record.attempts < 1 ||
          record.attempts >= OFFLINE_QUEUE_MAX_ATTEMPTS ||
          record.lastProblemCode === null)) ||
      (record.status === 'conflict' &&
        (record.attempts < 1 || record.lastProblemCode === null)) ||
      (record.status === 'failed' &&
        (record.attempts !== OFFLINE_QUEUE_MAX_ATTEMPTS ||
          record.lastProblemCode === null)) ||
      (record.status === 'superseded' && record.lastProblemCode === null)
    ) {
      addIssue(
        context,
        ['status'],
        'Queue status, attempts and terminal state are inconsistent',
      );
    }
  });

export type OfflineAgendaQueueRecord = z.infer<
  typeof offlineAgendaQueueRecordSchema
>;

export const offlineAgendaConflictRebaseSchema = z
  .strictObject({
    conflict: offlineAgendaQueueRecordSchema,
    replacement: offlineAgendaQueueRecordSchema,
  })
  .superRefine(({ conflict, replacement }, context) => {
    if (conflict.status !== 'conflict' || replacement.status !== 'pending') {
      addIssue(
        context,
        ['replacement', 'status'],
        'Conflict rebase requires conflict → pending states',
      );
    }
    if (
      replacement.id === conflict.id ||
      replacement.idempotencyKey === conflict.idempotencyKey ||
      replacement.supersedesId !== conflict.id
    ) {
      addIssue(
        context,
        ['replacement', 'idempotencyKey'],
        'Conflict rebase requires a new UUID linked to the old attempt',
      );
    }
    if (
      replacement.eventId !== conflict.eventId ||
      replacement.userId !== conflict.userId ||
      replacement.ownerLeaseId !== conflict.ownerLeaseId ||
      replacement.revocationEpoch !== conflict.revocationEpoch ||
      replacement.action !== conflict.action ||
      replacement.sessionId !== conflict.sessionId ||
      replacement.expectedVersion < conflict.expectedVersion
    ) {
      addIssue(
        context,
        ['replacement'],
        'Conflict rebase must preserve owner and intent at a canonical version',
      );
    }
  });

export type OfflineAgendaConflictRebase = z.infer<
  typeof offlineAgendaConflictRebaseSchema
>;

export const offlineAgendaReplayPreflightSchema = z
  .strictObject({
    contractVersion: z.literal(OFFLINE_CONTRACT_VERSION),
    eventId: uuidSchema,
    userId: uuidSchema,
    ownerLeaseId: uuidSchema,
    revocationEpoch: revocationEpochSchema,
    agendaVersion: agendaVersionSchema,
    issuedAt: dateTimeSchema,
    validUntil: dateTimeSchema,
  })
  .refine(
    (preflight) =>
      validInterval(
        preflight.issuedAt,
        preflight.validUntil,
        OFFLINE_REPLAY_PREFLIGHT_MAX_MS,
      ),
    {
      path: ['validUntil'],
      message: 'Replay preflight must be short-lived',
    },
  );

export type OfflineAgendaReplayPreflight = z.infer<
  typeof offlineAgendaReplayPreflightSchema
>;

export const offlineAgendaReplayEnvelopeSchema = z
  .strictObject({
    preflight: offlineAgendaReplayPreflightSchema,
    record: offlineAgendaQueueRecordSchema,
  })
  .superRefine(({ preflight, record }, context) => {
    if (record.status !== 'pending' && record.status !== 'retry') {
      addIssue(
        context,
        ['record', 'status'],
        'Only pending or retry records may enter replay preflight',
      );
    }
    if (
      preflight.eventId !== record.eventId ||
      preflight.userId !== record.userId ||
      preflight.ownerLeaseId !== record.ownerLeaseId ||
      preflight.revocationEpoch !== record.revocationEpoch ||
      preflight.agendaVersion !== record.expectedVersion
    ) {
      addIssue(
        context,
        ['record'],
        'Replay record must match the fresh owner preflight exactly',
      );
    }
  });

export type OfflineAgendaReplayEnvelope = z.infer<
  typeof offlineAgendaReplayEnvelopeSchema
>;
