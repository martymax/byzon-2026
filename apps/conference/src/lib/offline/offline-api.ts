import {
  offlineAgendaReplayPreflightRequestSchema,
  offlineAgendaReplayPreflightSchema,
  offlineOwnerLeaseSchema,
  offlineProblemSchema,
  type OfflineAgendaReplayPreflightRequest,
} from '@byzon/domain/contracts';

import { defineApiEndpoint, type ApiPort } from '@/lib/api/endpoint';

export const participantOfflineLeaseEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: offlineOwnerLeaseSchema,
  problemSchema: offlineProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const participantOfflineReplayPreflightEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: offlineAgendaReplayPreflightRequestSchema,
  successSchema: offlineAgendaReplayPreflightSchema,
  problemSchema: offlineProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'OFFLINE_LEASE_REVOKED',
    'STALE_VERSION',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});

export const requestParticipantOfflineLease = (
  api: ApiPort,
  signal?: AbortSignal,
) =>
  api.request(participantOfflineLeaseEndpoint, {
    path: '/api/v1/me/offline-lease',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export const requestParticipantOfflineReplayPreflight = (
  api: ApiPort,
  body: OfflineAgendaReplayPreflightRequest,
  signal?: AbortSignal,
) =>
  api.request(participantOfflineReplayPreflightEndpoint, {
    path: '/api/v1/me/offline-replay-preflight',
    body: offlineAgendaReplayPreflightRequestSchema.parse(body),
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
