import {
  activationClaimProblemSchema,
  activationClaimRequestSchema,
  activationClaimResponseSchema,
  activationIdentityProblemSchema,
  activationIdentityRequestSchema,
  activationIdentityResponseSchema,
  activationLandingProblemSchema,
  activationLandingResponseSchema,
  activationLinkProblemSchema,
  activationLinkRequestSchema,
  activationLinkResponseSchema,
  activationRecoveryProblemSchema,
  activationRecoveryRequestSchema,
  activationRecoveryResponseSchema,
  type ActivationClaimRequest,
  type ActivationIdentityRequest,
  type ActivationRecoveryRequest,
} from '@byzon/domain/contracts';

import { defineApiEndpoint, type ApiPort } from './api/endpoint';
import { createFetchApiClient } from './api/fetch-client';

export const activationLandingEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: activationLandingResponseSchema,
  problemSchema: activationLandingProblemSchema,
  problemCodes: ['ACTIVATION_CLOSED', 'AUTH_SESSION_EXPIRED', 'INTERNAL_ERROR'],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const activationClaimEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: activationClaimRequestSchema,
  successSchema: activationClaimResponseSchema,
  problemSchema: activationClaimProblemSchema,
  problemCodes: [
    'CLAIM_REJECTED',
    'ACTIVATION_CLOSED',
    'CLAIM_RATE_LIMITED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const activationIdentityEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: activationIdentityRequestSchema,
  successSchema: activationIdentityResponseSchema,
  problemSchema: activationIdentityProblemSchema,
  problemCodes: [
    'ACTIVATION_FLOW_EXPIRED',
    'CLAIM_RATE_LIMITED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const activationLinkEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: activationLinkRequestSchema,
  successSchema: activationLinkResponseSchema,
  problemSchema: activationLinkProblemSchema,
  problemCodes: [
    'ACTIVATION_LINK_REJECTED',
    'ACTIVATION_FLOW_EXPIRED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const activationRecoveryEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: activationRecoveryRequestSchema,
  successSchema: activationRecoveryResponseSchema,
  problemSchema: activationRecoveryProblemSchema,
  problemCodes: [
    'CLAIM_RATE_LIMITED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const browserActivationApi = createFetchApiClient();

export const requestActivationLanding = (api: ApiPort, signal?: AbortSignal) =>
  api.request(activationLandingEndpoint, {
    path: '/api/v1/activation',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export const submitActivationClaim = (
  api: ApiPort,
  body: ActivationClaimRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  api.request(activationClaimEndpoint, {
    path: '/api/v1/activation/claims',
    body,
    idempotencyKey,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export const submitActivationIdentity = (
  api: ApiPort,
  body: ActivationIdentityRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  api.request(activationIdentityEndpoint, {
    path: '/api/v1/activation/identity',
    body,
    idempotencyKey,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export const consumeActivationLink = (
  api: ApiPort,
  token: string,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  api.request(activationLinkEndpoint, {
    path: '/api/v1/activation/link',
    body: activationLinkRequestSchema.parse({ token }),
    idempotencyKey,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export const submitActivationRecovery = (
  api: ApiPort,
  body: ActivationRecoveryRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  api.request(activationRecoveryEndpoint, {
    path: '/api/v1/activation/recovery',
    body,
    idempotencyKey,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
