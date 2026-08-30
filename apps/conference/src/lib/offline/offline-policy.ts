import {
  OFFLINE_CONTRACT_VERSION,
  OFFLINE_OWNER_LEASE_MAX_MS,
  OFFLINE_QUEUE_MAX_ATTEMPTS as CONTRACT_OFFLINE_QUEUE_MAX_ATTEMPTS,
  offlineFeatureGateDefaults,
  offlineFeatureGateSchema,
  participantAgendaMutationRequestSchema,
  participantAgendaResponseSchema,
  type OfflineFeatureGate,
  type ParticipantAgendaMutationRequest,
  type ParticipantAgendaResponse,
} from '@byzon/domain/contracts';

export const PARTICIPANT_OFFLINE_DATABASE_VERSION = 4;
export const PARTICIPANT_OFFLINE_CONTRACT_VERSION = OFFLINE_CONTRACT_VERSION;
export const PARTICIPANT_OFFLINE_DATABASE_NAME = 'byzon-participant-offline-v2';
export const PUBLIC_CONTENT_STALE_AFTER_MS = 5 * 60 * 1_000;
export const OFFLINE_QUEUE_MAX_ATTEMPTS = CONTRACT_OFFLINE_QUEUE_MAX_ATTEMPTS;
export const OFFLINE_PRIVATE_RECORD_LEASE_MS = OFFLINE_OWNER_LEASE_MAX_MS;
export const OFFLINE_AGENDA_SYNC_EVENT = 'byzon:offline-sync-requested';
export const PARTICIPANT_OFFLINE_EPOCH_KEY = 'participant-private-epoch';

export const participantOfflineStoreNames = Object.freeze({
  agenda: 'agenda',
  control: 'control',
  metadata: 'metadata',
  syncQueue: 'syncQueue',
} as const);

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const eventSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ParticipantOfflineScope {
  readonly eventId: string;
  readonly userId: string;
}

export type ApprovedOfflineAgendaAction = 'add' | 'remove';

export interface ApprovedOfflineAgendaMutation {
  readonly action: ApprovedOfflineAgendaAction;
  readonly expectedVersion: number;
  readonly sessionId: string;
}

export type PublicCacheFreshness = 'fresh' | 'stale';

export const participantOfflineFeatureGate = (): OfflineFeatureGate =>
  offlineFeatureGateSchema.parse(offlineFeatureGateDefaults);

export const participantOfflineServerLeaseRequired = (): boolean =>
  process.env.NODE_ENV !== 'test' &&
  !(
    process.env.NODE_ENV === 'development' &&
    typeof document !== 'undefined' &&
    document.documentElement.dataset.byzonMockMode === 'active'
  );

export const offlineParticipantAgendaCacheAvailable = (): boolean =>
  participantOfflineFeatureGate().personalAgendaCache;

export const offlineAgendaReplayAvailable = (): boolean =>
  participantOfflineFeatureGate().agendaMutationReplay;

export const isUuid = (value: string): boolean => uuidPattern.test(value);

export const parseParticipantOfflineScope = (
  scope: ParticipantOfflineScope,
): ParticipantOfflineScope => {
  if (!isUuid(scope.eventId) || !isUuid(scope.userId)) {
    throw new TypeError(
      'Offline scope requires canonical event and user UUIDs.',
    );
  }
  return Object.freeze({ eventId: scope.eventId, userId: scope.userId });
};

export const participantOfflineScopeKey = (
  scope: ParticipantOfflineScope,
): string => {
  const parsed = parseParticipantOfflineScope(scope);
  return `${parsed.eventId}:${parsed.userId}`;
};

export const parseApprovedOfflineAgendaMutation = (
  input: unknown,
): ApprovedOfflineAgendaMutation => {
  const parsed = participantAgendaMutationRequestSchema.parse(input);
  if (parsed.action !== 'add' && parsed.action !== 'remove') {
    throw new TypeError(
      'Only agenda add/remove mutations are approved for the offline queue.',
    );
  }
  return Object.freeze({
    action: parsed.action,
    expectedVersion: parsed.expectedVersion,
    sessionId: parsed.sessionId,
  });
};

export const isApprovedOfflineAgendaMutation = (
  input: ParticipantAgendaMutationRequest,
): input is ParticipantAgendaMutationRequest & {
  readonly action: ApprovedOfflineAgendaAction;
} => input.action === 'add' || input.action === 'remove';

export const parseScopedAgendaSnapshot = (
  scope: ParticipantOfflineScope,
  snapshot: unknown,
): ParticipantAgendaResponse => {
  const parsedScope = parseParticipantOfflineScope(scope);
  const parsed = participantAgendaResponseSchema.parse(snapshot);
  if (
    parsed.eventId !== parsedScope.eventId ||
    parsed.userId !== parsedScope.userId
  ) {
    throw new TypeError('Agenda snapshot does not match its offline owner.');
  }
  return parsed;
};

export const publicContentPath = (eventSlug: string): string => {
  if (
    eventSlug.length < 1 ||
    eventSlug.length > 128 ||
    !eventSlugPattern.test(eventSlug)
  ) {
    throw new TypeError('Public content requires a bounded canonical slug.');
  }
  return `/api/v1/public/events/${eventSlug}/content`;
};

export const publicCacheFreshness = (
  storedAt: string,
  now = Date.now(),
): PublicCacheFreshness => {
  const stored = Date.parse(storedAt);
  if (!Number.isFinite(stored) || !Number.isFinite(now) || stored > now) {
    return 'stale';
  }
  return now - stored > PUBLIC_CONTENT_STALE_AFTER_MS ? 'stale' : 'fresh';
};

export const toAgendaMutationRequest = (
  mutation: ApprovedOfflineAgendaMutation,
): ParticipantAgendaMutationRequest =>
  mutation.action === 'add'
    ? {
        action: 'add',
        expectedVersion: mutation.expectedVersion,
        sessionId: mutation.sessionId,
      }
    : {
        action: 'remove',
        expectedVersion: mutation.expectedVersion,
        sessionId: mutation.sessionId,
      };
