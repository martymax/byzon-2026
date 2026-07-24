import {
  participantContentProblemSchema,
  participantContentResponseSchema,
  participantProgramProblemSchema,
  participantProgramResponseSchema,
} from '@byzon/domain/contracts';

import { defineApiEndpoint, type ApiPort } from './api/endpoint';
import { createFetchApiClient } from './api/fetch-client';

export const participantProgramEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: participantProgramResponseSchema,
  problemSchema: participantProgramProblemSchema,
  problemCodes: [
    'INVALID_EVENT_ID',
    'INVALID_PROGRAM_FILTERS',
    'AUTHENTICATION_REQUIRED',
    'PROGRAM_NOT_FOUND',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const participantContentEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: participantContentResponseSchema,
  problemSchema: participantContentProblemSchema,
  problemCodes: [
    'INVALID_EVENT_ID',
    'AUTHENTICATION_REQUIRED',
    'CONTENT_NOT_FOUND',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const browserContentApi = createFetchApiClient();

export const requestParticipantProgram = (
  api: ApiPort,
  eventId: string,
  signal?: AbortSignal,
) =>
  api.request(participantProgramEndpoint, {
    path: `/api/v1/events/${encodeURIComponent(eventId)}/program`,
    ...(signal ? { signal } : {}),
  });

export const requestParticipantContent = (
  api: ApiPort,
  eventId: string,
  signal?: AbortSignal,
) =>
  api.request(participantContentEndpoint, {
    path: `/api/v1/events/${encodeURIComponent(eventId)}/content`,
    ...(signal ? { signal } : {}),
  });
