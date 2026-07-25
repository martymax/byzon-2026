import {
  identityBootstrapProblemSchema,
  identityBootstrapResponseSchema,
  identityOnboardingProblemSchema,
  identityOnboardingRequestSchema,
  identityOnboardingResponseSchema,
  identitySessionActionProblemSchema,
  identitySessionActionRequestSchema,
  identitySessionActionResponseSchema,
  type IdentityOnboardingRequest,
  type IdentitySessionAction,
} from '@byzon/domain/contracts';

import { defineApiEndpoint, type ApiPort } from './api/endpoint';
import { createFetchApiClient } from './api/fetch-client';

export const identityBootstrapEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: identityBootstrapResponseSchema,
  problemSchema: identityBootstrapProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const identityOnboardingEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: identityOnboardingRequestSchema,
  successSchema: identityOnboardingResponseSchema,
  problemSchema: identityOnboardingProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'LEGAL_CONFIGURATION_MISSING',
    'STALE_LEGAL_DOCUMENT',
    'NETWORKING_DISABLED',
    'REQUEST_ID_REUSED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const identitySessionActionEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: identitySessionActionRequestSchema,
  successSchema: identitySessionActionResponseSchema,
  problemSchema: identitySessionActionProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'REQUEST_ID_REUSED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
    'SESSION_ACTION_REJECTED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const browserIdentityApi = createFetchApiClient();

export const requestIdentityBootstrap = (api: ApiPort, signal?: AbortSignal) =>
  api.request(identityBootstrapEndpoint, {
    path: '/api/v1/me/bootstrap',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export const submitIdentityOnboarding = (
  api: ApiPort,
  body: IdentityOnboardingRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  api.request(identityOnboardingEndpoint, {
    path: '/api/v1/me/onboarding',
    body,
    idempotencyKey,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export const submitIdentitySessionAction = (
  api: ApiPort,
  action: IdentitySessionAction,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  api.request(identitySessionActionEndpoint, {
    path: '/api/v1/me/session-action',
    body: identitySessionActionRequestSchema.parse({ action }),
    idempotencyKey,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
