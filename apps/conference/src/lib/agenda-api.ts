import {
  participantAgendaMutationProblemSchema,
  participantAgendaMutationRequestSchema,
  participantAgendaMutationResponseSchema,
  participantAgendaProblemSchema,
  participantAgendaResponseSchema,
} from '@byzon/domain/contracts';
import type { z } from 'zod';

import { defineApiEndpoint, type ApiPort } from './api/endpoint';
import { createFetchApiClient } from './api/fetch-client';

export const participantAgendaEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: participantAgendaResponseSchema,
  problemSchema: participantAgendaProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'AGENDA_DISABLED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const participantAgendaMutationEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: participantAgendaMutationRequestSchema,
  successSchema: participantAgendaMutationResponseSchema,
  problemSchema: participantAgendaMutationProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'AGENDA_DISABLED',
    'INTERNAL_ERROR',
    'SESSION_NOT_FOUND',
    'TICKET_INACTIVE',
    'CAPACITY_FULL',
    'RESERVATION_CLOSED',
    'OFFER_EXPIRED',
    'STALE_VERSION',
    'VALIDATION_FAILED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const browserAgendaApi = createFetchApiClient();

export type ParticipantAgendaMutationInput = z.input<
  typeof participantAgendaMutationRequestSchema
>;

export const requestParticipantAgenda = (api: ApiPort, signal?: AbortSignal) =>
  api.request(participantAgendaEndpoint, {
    path: '/api/v1/me/agenda',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export const mutateParticipantAgenda = (
  api: ApiPort,
  body: ParticipantAgendaMutationInput,
  idempotencyKey: string,
  signal?: AbortSignal,
) => {
  const request = participantAgendaMutationRequestSchema.parse(body);
  return api
    .request(participantAgendaMutationEndpoint, {
      path: '/api/v1/me/agenda/actions',
      body: request,
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    })
    .then((result) => {
      if (!result.ok || result.kind !== 'success') return result;
      const mutation = result.data.mutation;
      const versionCorrelated =
        mutation.outcome === 'applied'
          ? result.data.version > request.expectedVersion
          : result.data.version >= request.expectedVersion;
      const correlated =
        versionCorrelated &&
        mutation.sessionId === request.sessionId &&
        mutation.action === request.action &&
        (request.action === 'accept_offer' || request.action === 'decline_offer'
          ? mutation.action === request.action &&
            mutation.offerId === request.offerId
          : request.action === 'registration_estimate'
            ? mutation.action === request.action &&
              mutation.registered === request.registered
            : true);
      if (correlated) return result;
      return {
        ok: false as const,
        kind: 'failure' as const,
        status: result.status,
        failure: {
          kind: 'invalid_response' as const,
          requestId: result.metadata.requestId,
        },
        metadata: result.metadata,
      };
    });
};
