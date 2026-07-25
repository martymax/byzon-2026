import {
  CHECKIN_SEARCH_MAX_LENGTH,
  CHECKIN_SEARCH_MIN_LENGTH,
  checkinBootstrapResponseSchema,
  checkinConfirmProblemSchema,
  checkinConfirmRequestSchema,
  checkinConfirmResponseSchema,
  checkinLookupProblemSchema,
  checkinLookupRequestSchema,
  checkinLookupResponseSchema,
  checkinReadProblemSchema,
  checkinSearchQuerySchema,
  checkinSearchResponseSchema,
  checkinStatsResponseSchema,
  checkinUndoProblemSchema,
  checkinUndoRequestSchema,
  checkinUndoResponseSchema,
  type CheckinConfirmRequest,
  type CheckinLookupRequest,
  type CheckinUndoRequest,
} from '@byzon/domain/contracts/check-in';

import { defineApiEndpoint, type ApiPort } from './api/endpoint';
import { createFetchApiClient } from './api/fetch-client';

export const checkinBootstrapEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: checkinBootstrapResponseSchema,
  problemSchema: checkinReadProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'CHECKIN_PERMISSION_DENIED',
    'CHECKIN_DEVICE_REVOKED',
    'CHECKIN_NOT_FOUND',
    'VALIDATION_FAILED',
    'CHECKIN_RATE_LIMITED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const checkinLookupEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: checkinLookupRequestSchema,
  successSchema: checkinLookupResponseSchema,
  problemSchema: checkinLookupProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'CHECKIN_PERMISSION_DENIED',
    'CHECKIN_DEVICE_REVOKED',
    'CHECKIN_NOT_FOUND',
    'VALIDATION_FAILED',
    'CHECKIN_RATE_LIMITED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});

export const checkinSearchEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: checkinSearchResponseSchema,
  problemSchema: checkinReadProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'CHECKIN_PERMISSION_DENIED',
    'CHECKIN_DEVICE_REVOKED',
    'CHECKIN_NOT_FOUND',
    'VALIDATION_FAILED',
    'CHECKIN_RATE_LIMITED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const checkinConfirmEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: checkinConfirmRequestSchema,
  successSchema: checkinConfirmResponseSchema,
  problemSchema: checkinConfirmProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'CHECKIN_PERMISSION_DENIED',
    'CHECKIN_DEVICE_REVOKED',
    'VALIDATION_FAILED',
    'CHECKIN_RATE_LIMITED',
    'CHECKIN_LOOKUP_EXPIRED',
    'CHECKIN_TICKET_STATE_CHANGED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const checkinUndoEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: checkinUndoRequestSchema,
  successSchema: checkinUndoResponseSchema,
  problemSchema: checkinUndoProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'CHECKIN_PERMISSION_DENIED',
    'CHECKIN_DEVICE_REVOKED',
    'CHECKIN_NOT_FOUND',
    'VALIDATION_FAILED',
    'CHECKIN_RATE_LIMITED',
    'CHECKIN_UNDO_FORBIDDEN',
    'CHECKIN_UNDO_WINDOW_EXPIRED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const checkinStatsEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: checkinStatsResponseSchema,
  problemSchema: checkinReadProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'CHECKIN_PERMISSION_DENIED',
    'CHECKIN_DEVICE_REVOKED',
    'CHECKIN_NOT_FOUND',
    'VALIDATION_FAILED',
    'CHECKIN_RATE_LIMITED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const browserCheckinApi = createFetchApiClient();

export const requestCheckinBootstrap = (api: ApiPort, signal?: AbortSignal) =>
  api.request(checkinBootstrapEndpoint, {
    path: '/api/v1/check-in/context',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export const requestCheckinLookup = (
  api: ApiPort,
  body: CheckinLookupRequest,
  signal?: AbortSignal,
) =>
  api.request(checkinLookupEndpoint, {
    path: '/api/v1/check-in/lookup',
    body,
    ...(signal ? { signal } : {}),
  });

export const requestCheckinSearch = (
  api: ApiPort,
  query: string,
  signal?: AbortSignal,
) => {
  const canonicalQuery = checkinSearchQuerySchema.parse(query);
  const parameters = new URLSearchParams({
    q: canonicalQuery,
    limit: '5',
  });
  return api.request(checkinSearchEndpoint, {
    path: `/api/v1/check-in/search?${parameters.toString()}`,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
};

export const requestCheckinConfirm = (
  api: ApiPort,
  body: CheckinConfirmRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  api.request(checkinConfirmEndpoint, {
    path: '/api/v1/check-in/confirm',
    body,
    idempotencyKey,
    ...(signal ? { signal } : {}),
  });

export const requestCheckinUndo = (
  api: ApiPort,
  checkinId: string,
  body: CheckinUndoRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  api.request(checkinUndoEndpoint, {
    path: `/api/v1/check-in/${encodeURIComponent(checkinId)}/undo`,
    body,
    idempotencyKey,
    ...(signal ? { signal } : {}),
  });

export const checkinSearchInputBounds = Object.freeze({
  minimum: CHECKIN_SEARCH_MIN_LENGTH,
  maximum: CHECKIN_SEARCH_MAX_LENGTH,
} as const);
