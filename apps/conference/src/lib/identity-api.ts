import {
  identityBootstrapProblemSchema,
  identityBootstrapResponseSchema,
  identityOnboardingProblemSchema,
  identityOnboardingRequestSchema,
  identityOnboardingResponseSchema,
  type IdentityOnboardingRequest,
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
    'VALIDATION_FAILED',
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
