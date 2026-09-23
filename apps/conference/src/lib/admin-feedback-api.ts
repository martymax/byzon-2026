import {
  feedbackAdminOverviewSchema,
  feedbackRespondentsResponseSchema,
  feedbackRespondentDetailSchema,
  type FeedbackRespondentsQuery,
  feedbackSendRequestSchema,
  feedbackSendResponseSchema,
} from '@byzon/domain/contracts';
import {
  adminMutationProblemSchema,
  adminReadProblemSchema,
} from '@byzon/domain/contracts/admin';
import { defineApiEndpoint, type ApiPort } from './api/endpoint';

export type FeedbackRoleFilter =
  'all' | 'attendee' | 'speaker' | 'moderator' | 'partner';
export type FeedbackStatusFilter =
  'all' | 'not_started' | 'in_progress' | 'completed';
export interface FeedbackFilters {
  role: FeedbackRoleFilter;
  status: FeedbackStatusFilter;
}

const readProblemCodes = [
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'EVENT_ACCESS_DENIED',
  'ADMIN_RESOURCE_NOT_FOUND',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
] as const;

export const feedbackOverviewEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: feedbackAdminOverviewSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: readProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const feedbackSendEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: feedbackSendRequestSchema,
  successSchema: feedbackSendResponseSchema,
  problemSchema: adminMutationProblemSchema,
  problemCodes: [
    ...readProblemCodes,
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
    'INVITATION_DELIVERY_UNAVAILABLE',
    'ADMIN_INVALID_TRANSITION',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const feedbackPath = (
  eventId: string,
  filters: FeedbackFilters,
  exportCsv = false,
) => {
  const parameters = new URLSearchParams({
    role: filters.role,
    status: filters.status,
  });
  return `/api/v1/admin/events/${encodeURIComponent(eventId)}/feedback${exportCsv ? '/export' : ''}?${parameters}`;
};

export const requestFeedbackOverview = (
  api: ApiPort,
  eventId: string,
  filters: FeedbackFilters,
  signal: AbortSignal,
) =>
  api.request(feedbackOverviewEndpoint, {
    path: feedbackPath(eventId, filters),
    cache: 'no-store',
    signal,
  });

export const sendFeedbackInvitations = (
  api: ApiPort,
  eventId: string,
  body: { kind: 'invitation' | 'reminder'; participantIds: string[] },
  idempotencyKey: string,
  signal: AbortSignal,
) =>
  api.request(feedbackSendEndpoint, {
    path: `/api/v1/admin/events/${encodeURIComponent(eventId)}/feedback/send`,
    body,
    idempotencyKey,
    signal,
  });

export const feedbackRespondentsEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: feedbackRespondentsResponseSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: readProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});
export const feedbackRespondentEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: feedbackRespondentDetailSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: readProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});
export const feedbackRespondentsParameters = (
  query: FeedbackRespondentsQuery,
) => new URLSearchParams({ ...query, page: String(query.page) }).toString();
export const requestFeedbackRespondents = (
  api: ApiPort,
  eventId: string,
  query: FeedbackRespondentsQuery,
  signal: AbortSignal,
) =>
  api.request(feedbackRespondentsEndpoint, {
    path: `/api/v1/admin/events/${encodeURIComponent(eventId)}/feedback/respondents?${feedbackRespondentsParameters(query)}`,
    cache: 'no-store',
    signal,
  });
export const requestFeedbackRespondent = (
  api: ApiPort,
  eventId: string,
  participantId: string,
  signal: AbortSignal,
) =>
  api.request(feedbackRespondentEndpoint, {
    path: `/api/v1/admin/events/${encodeURIComponent(eventId)}/feedback/respondents/${encodeURIComponent(participantId)}`,
    cache: 'no-store',
    signal,
  });
