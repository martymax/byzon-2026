import {
  identityBootstrapProblemSchema,
  identityBootstrapResponseSchema,
  identityOnboardingProblemSchema,
  identityOnboardingRequestSchema,
  identityOnboardingResponseSchema,
  identityPrivacyRequestProblemSchema,
  identityPrivacyRequestRequestSchema,
  identityPrivacyRequestResponseSchema,
  identityProfileUpdateProblemSchema,
  identityProfileUpdateRequestSchema,
  identityProfileUpdateResponseSchema,
  identitySessionActionProblemSchema,
  identitySessionActionRequestSchema,
  identitySessionActionResponseSchema,
  type IdentityOnboardingRequest,
  type IdentitySessionAction,
} from '@byzon/domain/contracts';
import type { z } from 'zod';

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

export const identityProfileUpdateEndpoint = defineApiEndpoint({
  method: 'PATCH',
  requestSchema: identityProfileUpdateRequestSchema,
  successSchema: identityProfileUpdateResponseSchema,
  problemSchema: identityProfileUpdateProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'PROFILE_NOT_FOUND',
    'PROFILE_NOT_EDITABLE',
    'STALE_VERSION',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});

export const identityPrivacyRequestEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: identityPrivacyRequestRequestSchema,
  successSchema: identityPrivacyRequestResponseSchema,
  problemSchema: identityPrivacyRequestProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'PRIVACY_REQUEST_UNAVAILABLE',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
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

export type IdentityProfileUpdateInput = z.input<
  typeof identityProfileUpdateRequestSchema
>;

export const updateIdentityProfile = (
  api: ApiPort,
  body: IdentityProfileUpdateInput,
  signal?: AbortSignal,
) =>
  api.request(identityProfileUpdateEndpoint, {
    path: '/api/v1/me/profile',
    body,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export type IdentityPrivacyRequestInput = z.input<
  typeof identityPrivacyRequestRequestSchema
>;

export const submitIdentityPrivacyRequest = (
  api: ApiPort,
  body: IdentityPrivacyRequestInput,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  api.request(identityPrivacyRequestEndpoint, {
    path: '/api/v1/me/privacy-requests',
    body,
    idempotencyKey,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
