import {
  moderatorQuestionFeedSchema,
  networkingDirectoryProfileSchema,
  networkingDirectoryResponseSchema,
  networkingProblemSchema,
  networkingSettingsSchema,
  networkingSettingsUpdateRequestSchema,
  questionSubmitRequestSchema,
  questionSubmitResponseSchema,
  questionsProblemSchema,
  ratingStatusResponseSchema,
  ratingSubmitRequestSchema,
  ratingSubmitResponseSchema,
  type NetworkingSettingsUpdateRequest,
  type QuestionSubmitRequest,
  type RatingSubmitRequest,
} from '@byzon/domain/contracts';

import { defineApiEndpoint, type ApiPort } from './api/endpoint';
import { createFetchApiClient } from './api/fetch-client';

const networkingReadProblems = [
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'EVENT_ACCESS_DENIED',
  'NETWORKING_DISABLED',
  'PROFILE_NOT_FOUND',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
] as const;
const questionProblems = [
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'EVENT_ACCESS_DENIED',
  'QUESTIONS_DISABLED',
  'RATINGS_DISABLED',
  'SESSION_NOT_FOUND',
  'RATING_ALREADY_COMPLETED',
  'RATE_LIMITED',
  'VALIDATION_FAILED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_INVALID',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
  'INTERNAL_ERROR',
] as const;

export const networkingSettingsReadEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: networkingSettingsSchema,
  problemSchema: networkingProblemSchema,
  problemCodes: networkingReadProblems,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});
export const networkingSettingsUpdateEndpoint = defineApiEndpoint({
  method: 'PATCH',
  requestSchema: networkingSettingsUpdateRequestSchema,
  successSchema: networkingSettingsSchema,
  problemSchema: networkingProblemSchema,
  problemCodes: [
    ...networkingReadProblems,
    'STALE_VERSION',
    'PARTICIPANT_NUMBER_TAKEN',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});
export const networkingDirectoryEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: networkingDirectoryResponseSchema,
  problemSchema: networkingProblemSchema,
  problemCodes: networkingReadProblems,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});
export const networkingProfileEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: networkingDirectoryProfileSchema,
  problemSchema: networkingProblemSchema,
  problemCodes: networkingReadProblems,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});
export const questionSubmitEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: questionSubmitRequestSchema,
  successSchema: questionSubmitResponseSchema,
  problemSchema: questionsProblemSchema,
  problemCodes: questionProblems,
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});
export const moderatorQuestionFeedEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: moderatorQuestionFeedSchema,
  problemSchema: questionsProblemSchema,
  problemCodes: questionProblems,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});
export const ratingStatusEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: ratingStatusResponseSchema,
  problemSchema: questionsProblemSchema,
  problemCodes: questionProblems,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});
export const ratingSubmitEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: ratingSubmitRequestSchema,
  successSchema: ratingSubmitResponseSchema,
  problemSchema: questionsProblemSchema,
  problemCodes: questionProblems,
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const browserInteractionsApi = createFetchApiClient();
export const requestNetworkingSettings = (
  api: ApiPort = browserInteractionsApi,
) =>
  api.request(networkingSettingsReadEndpoint, {
    path: '/api/v1/me/networking',
    cache: 'no-store',
  });
export const updateNetworkingSettings = (
  body: NetworkingSettingsUpdateRequest,
  api: ApiPort = browserInteractionsApi,
) =>
  api.request(networkingSettingsUpdateEndpoint, {
    path: '/api/v1/me/networking',
    body,
    cache: 'no-store',
  });
export const requestNetworkingDirectory = (
  query: string,
  api: ApiPort = browserInteractionsApi,
) =>
  api.request(networkingDirectoryEndpoint, {
    path: `/api/v1/networking/directory${query ? `?${query}` : ''}`,
    cache: 'no-store',
  });
export const requestNetworkingProfile = (
  profileId: string,
  api: ApiPort = browserInteractionsApi,
) =>
  api.request(networkingProfileEndpoint, {
    path: `/api/v1/networking/profiles/${encodeURIComponent(profileId)}`,
    cache: 'no-store',
  });
export const sendQuestion = (
  sessionId: string,
  body: QuestionSubmitRequest,
  idempotencyKey: string,
  api: ApiPort = browserInteractionsApi,
) =>
  api.request(questionSubmitEndpoint, {
    path: `/api/v1/sessions/${encodeURIComponent(sessionId)}/questions`,
    body,
    idempotencyKey,
    cache: 'no-store',
  });
export const requestModeratorQuestions = (
  sessionId: string,
  query: string,
  api: ApiPort = browserInteractionsApi,
) =>
  api.request(moderatorQuestionFeedEndpoint, {
    path: `/api/v1/moderator/sessions/${encodeURIComponent(sessionId)}/questions${query ? `?${query}` : ''}`,
    cache: 'no-store',
  });
export const requestRatingStatus = (
  targetType: 'event' | 'session',
  sessionId?: string,
  api: ApiPort = browserInteractionsApi,
) => {
  const query = new URLSearchParams({ targetType });
  if (sessionId) query.set('sessionId', sessionId);
  return api.request(ratingStatusEndpoint, {
    path: `/api/v1/me/ratings?${query}`,
    cache: 'no-store',
  });
};
export const submitRating = (
  body: RatingSubmitRequest,
  idempotencyKey: string,
  api: ApiPort = browserInteractionsApi,
) =>
  api.request(ratingSubmitEndpoint, {
    path: '/api/v1/me/ratings',
    body,
    idempotencyKey,
    cache: 'no-store',
  });
