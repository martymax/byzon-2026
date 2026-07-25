import {
  participantTicketProblemSchema,
  participantTicketResponseSchema,
} from '@byzon/domain/contracts';

import { defineApiEndpoint, type ApiPort } from './api/endpoint';
import { createFetchApiClient } from './api/fetch-client';

export const participantTicketEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: participantTicketResponseSchema,
  problemSchema: participantTicketProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'TICKET_NOT_FOUND',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const browserTicketApi = createFetchApiClient();

export const requestParticipantTicket = (api: ApiPort, signal?: AbortSignal) =>
  api.request(participantTicketEndpoint, {
    path: '/api/v1/me/ticket',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
