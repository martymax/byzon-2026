import {
  announcementInboxQuerySchema,
  participantAnnouncementDetailProblemSchema,
  participantAnnouncementDetailResponseSchema,
  participantAnnouncementInboxProblemSchema,
  participantAnnouncementInboxResponseSchema,
  participantAnnouncementParamsSchema,
  participantAnnouncementReadProblemSchema,
  participantAnnouncementReadResponseSchema,
} from '@byzon/domain/contracts';
import type { z } from 'zod';

import { defineApiEndpoint, type ApiPort } from './api/endpoint';
import { createFetchApiClient } from './api/fetch-client';

export const participantAnnouncementInboxEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: participantAnnouncementInboxResponseSchema,
  problemSchema: participantAnnouncementInboxProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'ANNOUNCEMENTS_DISABLED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const participantAnnouncementDetailEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: participantAnnouncementDetailResponseSchema,
  problemSchema: participantAnnouncementDetailProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'ANNOUNCEMENTS_DISABLED',
    'VALIDATION_FAILED',
    'ANNOUNCEMENT_NOT_FOUND',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const participantAnnouncementReadEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: null,
  successSchema: participantAnnouncementReadResponseSchema,
  problemSchema: participantAnnouncementReadProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'ANNOUNCEMENTS_DISABLED',
    'VALIDATION_FAILED',
    'ANNOUNCEMENT_NOT_FOUND',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const browserAnnouncementApi = createFetchApiClient();

type AnnouncementInboxQuery = z.input<typeof announcementInboxQuerySchema>;

const announcementPath = (announcementId: string): string => {
  const params = participantAnnouncementParamsSchema.parse({ announcementId });
  return `/api/v1/me/announcements/${encodeURIComponent(params.announcementId)}`;
};

export const requestAnnouncementInbox = (
  api: ApiPort,
  query: AnnouncementInboxQuery,
  signal?: AbortSignal,
) => {
  const parsed = announcementInboxQuerySchema.parse(query);
  const search = new URLSearchParams({ filter: parsed.filter });
  if (parsed.cursor) search.set('cursor', parsed.cursor);
  if (parsed.limit !== undefined) search.set('limit', String(parsed.limit));

  return api.request(participantAnnouncementInboxEndpoint, {
    path: `/api/v1/me/announcements?${search.toString()}`,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
};

export const requestAnnouncementDetail = (
  api: ApiPort,
  announcementId: string,
  signal?: AbortSignal,
) =>
  api.request(participantAnnouncementDetailEndpoint, {
    path: announcementPath(announcementId),
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export const markAnnouncementRead = (
  api: ApiPort,
  announcementId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  api.request(participantAnnouncementReadEndpoint, {
    path: `${announcementPath(announcementId)}/read`,
    idempotencyKey,
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
