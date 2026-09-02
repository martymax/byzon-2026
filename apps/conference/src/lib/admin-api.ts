import {
  adminEngagementMutationRequestSchema,
  adminEngagementMutationResponseSchema,
  adminEngagementOverviewSchema,
  type AdminEngagementMutationRequest,
  type AdminEngagementMutationResponse,
} from '@byzon/domain/contracts/admin-engagement';
import {
  adminAuditQuerySchema,
  adminAuditResponseSchema,
  adminContextResponseSchema,
  adminEventSettingsSchema,
  adminEventSettingsUpdateRequestSchema,
  adminEventSettingsUpdateResponseSchema,
  adminExportProblemSchema,
  adminExportJobListResponseSchema,
  adminExportRequestSchema,
  adminExportResponseSchema,
  adminMutationProblemSchema,
  adminOperationsOverviewResponseSchema,
  adminReadProblemSchema,
  adminReservationListResponseSchema,
  adminReservationMutationRequestSchema,
  adminReservationMutationResponseSchema,
  adminReservationSessionPageSchema,
  adminReservationSessionQuerySchema,
  adminSessionCapacityListResponseSchema,
  adminSessionCapacityMutationRequestSchema,
  adminSessionCapacityMutationResponseSchema,
  adminRoleAssignmentListResponseSchema,
  adminRoleAssignmentMutationRequestSchema,
  adminRoleAssignmentMutationResponseSchema,
  adminRolePersonSearchRequestSchema,
  adminRolePersonSearchResponseSchema,
  adminRoleScopeOptionsRequestSchema,
  adminRoleScopeOptionsResponseSchema,
  type AdminAuditQuery,
  type AdminEventSettingsUpdateRequest,
  type AdminExportRequest,
  type AdminExportJobListQuery,
  type AdminReservationMutationRequest,
  type AdminReservationMutationResponse,
  type AdminReservationSessionQuery,
  type AdminSessionCapacityMutationRequest,
  type AdminSessionCapacityMutationResponse,
  type AdminRoleAssignmentMutationRequest,
  type AdminRoleAssignmentMutationResponse,
  type AdminRoleAssignmentListQuery,
  type AdminRolePersonSearchRequest,
  type AdminRoleScopeOptionsRequest,
} from '@byzon/domain/contracts/admin';
import {
  adminAnnouncementPreviewProblemSchema,
  adminAnnouncementPreviewRequestSchema,
  adminAnnouncementPreviewResponseSchema,
  adminAnnouncementSendProblemSchema,
  adminAnnouncementSendRequestSchema,
  adminAnnouncementSendResponseSchema,
  adminAnnouncementTargetListResponseSchema,
  adminAnnouncementTargetProblemSchema,
  type AdminAnnouncementPreviewRequest,
  type AdminAnnouncementSendRequest,
  type ApiProblem,
} from '@byzon/domain/contracts';
import {
  SUPPORT_SEARCH_RESULT_LIMIT,
  adminParticipantDetailSchema,
  adminParticipantInviteProblemSchema,
  adminParticipantInviteRequestSchema,
  adminParticipantInviteResponseSchema,
  adminParticipantListRequestSchema,
  adminParticipantListResponseSchema,
  adminParticipantReadProblemSchema,
  adminParticipantUpdateRequestSchema,
  adminParticipantUpdateResponseSchema,
  supportMutationProblemSchema,
  supportMutationRequestSchema,
  supportMutationResponseSchema,
  supportSearchProblemSchema,
  supportSearchQuerySchema,
  supportSearchResponseSchema,
  type AdminParticipantListRequest,
  type AdminParticipantInviteRequest,
  type AdminParticipantUpdateRequest,
  type SupportMutationRequest,
  type SupportMutationResponse,
} from '@byzon/domain/contracts/support';
import {
  ticketImportApplyProblemSchema,
  ticketImportApplyRequestSchema,
  ticketImportApplyResponseSchema,
  ticketImportPreviewRequestSchema,
  ticketImportPreviewProblemSchema,
  ticketImportPreviewResponseSchema,
  type TicketImportApplyRequest,
} from '@byzon/domain/contracts/ticket-import';

import {
  defineApiEndpoint,
  type ApiPort,
  type ApiResult,
} from './api/endpoint';
import { createFetchApiClient } from './api/fetch-client';

const adminReadProblemCodes = [
  'AUTHENTICATION_REQUIRED',
  'AUTH_SESSION_EXPIRED',
  'EVENT_ACCESS_DENIED',
  'ADMIN_RESOURCE_NOT_FOUND',
  'VALIDATION_FAILED',
  'INTERNAL_ERROR',
] as const;

const adminMutationProblemCodes = [
  ...adminReadProblemCodes,
  'STALE_VERSION',
  'ADMIN_INVALID_TRANSITION',
  'LAST_ADMINISTRATOR_GUARD',
  'SELF_LOCKOUT_GUARD',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_IN_PROGRESS',
] as const;

export const adminContextEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminContextResponseSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const adminOperationsOverviewEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminOperationsOverviewResponseSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const adminEngagementOverviewEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminEngagementOverviewSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const adminEngagementMutationEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: adminEngagementMutationRequestSchema,
  successSchema: adminEngagementMutationResponseSchema,
  problemSchema: adminMutationProblemSchema,
  problemCodes: adminMutationProblemCodes,
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const adminTicketImportPreviewEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: ticketImportPreviewRequestSchema,
  successSchema: ticketImportPreviewResponseSchema,
  problemSchema: ticketImportPreviewProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'IMPORT_VALIDATION_FAILED',
    'IMPORT_SOURCE_UNAVAILABLE',
    'IMPORT_SOURCE_TIMEOUT',
    'IMPORT_SOURCE_INVALID',
    'RATE_LIMITED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});

export const adminTicketImportApplyEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: ticketImportApplyRequestSchema,
  successSchema: ticketImportApplyResponseSchema,
  problemSchema: ticketImportApplyProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'IMPORT_BATCH_NOT_FOUND',
    'IMPORT_VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'IMPORT_PREVIEW_BLOCKED',
    'IMPORT_PREVIEW_STALE',
    'IMPORT_SOURCE_UNAVAILABLE',
    'IMPORT_SOURCE_TIMEOUT',
    'IMPORT_SOURCE_INVALID',
    'RATE_LIMITED',
    'IDEMPOTENCY_KEY_REQUIRED',
    'IDEMPOTENCY_KEY_INVALID',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const adminSupportSearchEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: supportSearchQuerySchema,
  successSchema: supportSearchResponseSchema,
  problemSchema: supportSearchProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'SUPPORT_RATE_LIMITED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});

export const adminSupportMutationEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: supportMutationRequestSchema,
  successSchema: supportMutationResponseSchema,
  problemSchema: supportMutationProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'SUPPORT_RATE_LIMITED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'SUPPORT_RECORD_NOT_FOUND',
    'SUPPORT_TARGET_NOT_FOUND',
    'STALE_VERSION',
    'SUPPORT_INVALID_TRANSITION',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const adminParticipantListEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: adminParticipantListRequestSchema,
  successSchema: adminParticipantListResponseSchema,
  problemSchema: supportSearchProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'SUPPORT_RATE_LIMITED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});

export const adminParticipantDetailEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminParticipantDetailSchema,
  problemSchema: adminParticipantReadProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'SUPPORT_RATE_LIMITED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'SUPPORT_RECORD_NOT_FOUND',
  ],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const adminParticipantUpdateEndpoint = defineApiEndpoint({
  method: 'PATCH',
  requestSchema: adminParticipantUpdateRequestSchema,
  successSchema: adminParticipantUpdateResponseSchema,
  problemSchema: supportMutationProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'SUPPORT_RATE_LIMITED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'SUPPORT_RECORD_NOT_FOUND',
    'STALE_VERSION',
    'SUPPORT_INVALID_TRANSITION',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const adminParticipantInviteEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: adminParticipantInviteRequestSchema,
  successSchema: adminParticipantInviteResponseSchema,
  problemSchema: adminParticipantInviteProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'SUPPORT_RATE_LIMITED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'SUPPORT_RECORD_NOT_FOUND',
    'SUPPORT_INVALID_TRANSITION',
    'INVITATION_DELIVERY_UNAVAILABLE',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const adminAnnouncementPreviewEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: adminAnnouncementPreviewRequestSchema,
  successSchema: adminAnnouncementPreviewResponseSchema,
  problemSchema: adminAnnouncementPreviewProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'ANNOUNCEMENTS_DISABLED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'ANNOUNCEMENT_EMPTY_AUDIENCE',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});

export const adminAnnouncementTargetsEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminAnnouncementTargetListResponseSchema,
  problemSchema: adminAnnouncementTargetProblemSchema,
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

export const adminAnnouncementSendEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: adminAnnouncementSendRequestSchema,
  successSchema: adminAnnouncementSendResponseSchema,
  problemSchema: adminAnnouncementSendProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'ANNOUNCEMENTS_DISABLED',
    'VALIDATION_FAILED',
    'INTERNAL_ERROR',
    'ANNOUNCEMENT_EMPTY_AUDIENCE',
    'ANNOUNCEMENT_PREVIEW_STALE',
    'ANNOUNCEMENT_PREVIEW_EXPIRED',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const adminRoleAssignmentEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: adminRoleAssignmentMutationRequestSchema,
  successSchema: adminRoleAssignmentMutationResponseSchema,
  problemSchema: adminMutationProblemSchema,
  problemCodes: adminMutationProblemCodes,
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const adminRoleAssignmentListEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminRoleAssignmentListResponseSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const adminRolePersonSearchEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: adminRolePersonSearchRequestSchema,
  successSchema: adminRolePersonSearchResponseSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});

export const adminRoleScopeOptionsEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: adminRoleScopeOptionsRequestSchema,
  successSchema: adminRoleScopeOptionsResponseSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});

export const adminExportEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: adminExportRequestSchema,
  successSchema: adminExportResponseSchema,
  problemSchema: adminExportProblemSchema,
  problemCodes: [
    ...adminReadProblemCodes,
    'EXPORT_UNAVAILABLE',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENCY_IN_PROGRESS',
  ],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const adminExportJobListEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminExportJobListResponseSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const adminReservationsEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminReservationListResponseSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const adminReservationSessionsEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminReservationSessionPageSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const adminReservationMutationEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: adminReservationMutationRequestSchema,
  successSchema: adminReservationMutationResponseSchema,
  problemSchema: adminMutationProblemSchema,
  problemCodes: adminMutationProblemCodes,
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const adminSessionCapacitiesEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminSessionCapacityListResponseSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const adminSessionCapacityMutationEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: adminSessionCapacityMutationRequestSchema,
  successSchema: adminSessionCapacityMutationResponseSchema,
  problemSchema: adminMutationProblemSchema,
  problemCodes: adminMutationProblemCodes,
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const adminAuditEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminAuditResponseSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const adminEventSettingsEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema: adminEventSettingsSchema,
  problemSchema: adminReadProblemSchema,
  problemCodes: adminReadProblemCodes,
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

export const adminEventSettingsUpdateEndpoint = defineApiEndpoint({
  method: 'PUT',
  requestSchema: adminEventSettingsUpdateRequestSchema,
  successSchema: adminEventSettingsUpdateResponseSchema,
  problemSchema: adminMutationProblemSchema,
  problemCodes: adminMutationProblemCodes,
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

export const browserAdminApi = createFetchApiClient();

const eventPath = (eventId: string, suffix: string): string =>
  `/api/v1/admin/events/${encodeURIComponent(eventId)}${suffix}`;

const correlated = <Success, Problem extends ApiProblem>(
  result: ApiResult<Success, Problem>,
  accepts: (data: Success) => boolean,
): ApiResult<Success, Problem> => {
  if (!result.ok || result.kind !== 'success' || accepts(result.data)) {
    return result;
  }
  return {
    ok: false,
    kind: 'failure',
    status: result.status,
    failure: {
      kind: 'invalid_response',
      requestId: result.metadata.requestId,
    },
    metadata: result.metadata,
  };
};

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const matchesSupportMutation = (
  data: SupportMutationResponse,
  body: SupportMutationRequest,
): boolean => {
  const expectedTicketId =
    body.action === 'reassign' || body.action === 'transfer'
      ? body.targetTicketId
      : body.ticketId;
  if (
    data.record.participantId !== body.participantId ||
    data.record.ticketId !== expectedTicketId ||
    data.record.version !== body.expectedVersion + 1
  ) {
    return false;
  }
  switch (body.action) {
    case 'block':
      return data.record.ticketState === 'blocked';
    case 'reactivate':
      return data.record.ticketState === 'active';
    case 'reassign':
    case 'transfer':
      return data.record.ticketId === body.targetTicketId;
    case 'resend':
      return data.record.ticketId === body.ticketId;
  }
};

const matchesRoleAssignmentMutation = (
  data: AdminRoleAssignmentMutationResponse,
  body: AdminRoleAssignmentMutationRequest,
): boolean => {
  if (data.assignmentsVersion !== body.expectedVersion + 1) return false;

  if (body.action === 'revoke') {
    return (
      (data.outcome === 'revoked' || data.outcome === 'already_applied') &&
      data.assignment === null
    );
  }

  return (
    (data.outcome === 'granted' || data.outcome === 'already_applied') &&
    data.assignment !== null &&
    data.assignment.operatorId === body.operatorId &&
    data.assignment.role === body.role &&
    sameJson(data.assignment.scope, body.scope)
  );
};

const matchesReservationMutation = (
  data: AdminReservationMutationResponse,
  body: AdminReservationMutationRequest,
): boolean => {
  if (
    data.record.reservationId !== body.reservationId ||
    data.record.version !== body.expectedVersion + 1
  ) {
    return false;
  }

  return body.action === 'capacity_override'
    ? data.record.state === 'reserved' && data.record.capacity === body.capacity
    : data.record.state === 'cancelled';
};

const matchesSessionCapacityMutation = (
  data: AdminSessionCapacityMutationResponse,
  body: AdminSessionCapacityMutationRequest,
): boolean =>
  data.record.sessionId === body.sessionId &&
  data.record.version === body.expectedVersion + 1 &&
  data.record.capacity === body.capacity;

export const requestAdminContext = (api: ApiPort, signal?: AbortSignal) =>
  api.request(adminContextEndpoint, {
    path: '/api/v1/admin/context',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });

export const requestAdminOperationsOverview = async (
  api: ApiPort,
  eventId: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminOperationsOverviewEndpoint, {
      path: eventPath(eventId, '/operations'),
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );

export const requestAdminEngagementOverview = async (
  api: ApiPort,
  eventId: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminEngagementOverviewEndpoint, {
      path: eventPath(eventId, '/engagement'),
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );

const matchesEngagementMutation = (
  data: AdminEngagementMutationResponse,
  body: AdminEngagementMutationRequest,
): boolean => {
  if (data.action !== body.action) return false;
  if (body.action === 'update_features' && data.action === 'update_features') {
    return (
      data.settingsVersion === body.expectedSettingsVersion + 1 &&
      sameJson(data.features, body.features)
    );
  }
  if (
    body.action === 'set_session_questions' &&
    data.action === 'set_session_questions'
  ) {
    return (
      data.session.sessionId === body.sessionId &&
      data.session.questionsEnabled === body.enabled &&
      data.session.version === body.expectedSessionVersion + 1
    );
  }
  if (
    (body.action === 'assign_moderator' ||
      body.action === 'remove_moderator') &&
    (data.action === 'assign_moderator' || data.action === 'remove_moderator')
  ) {
    return (
      data.assignmentsVersion ===
        body.expectedAssignmentsVersion +
          (data.outcome === 'updated' ? 1 : 0) &&
      (data.assignment === null ||
        (data.assignment.sessionId === body.sessionId &&
          data.assignment.userId === body.userId))
    );
  }
  return false;
};

export const requestAdminEngagementMutation = async (
  api: ApiPort,
  eventId: string,
  body: AdminEngagementMutationRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminEngagementMutationEndpoint, {
      path: eventPath(eventId, '/engagement'),
      body,
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId && matchesEngagementMutation(data, body),
  );

export const requestAdminTicketImportApply = async (
  api: ApiPort,
  eventId: string,
  body: TicketImportApplyRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminTicketImportApplyEndpoint, {
      path: eventPath(eventId, '/ticket-imports/apply'),
      body,
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) =>
      data.eventId === eventId &&
      data.previewId === body.previewId &&
      data.previewVersion === body.previewVersion &&
      data.selectedRowIds.length === body.selectedRowIds.length &&
      data.selectedRowIds.every((rowId) => body.selectedRowIds.includes(rowId)),
  );

export const requestAdminSupportSearch = async (
  api: ApiPort,
  eventId: string,
  query: string,
  signal?: AbortSignal,
) => {
  const validated = supportSearchQuerySchema.parse({
    query,
    limit: SUPPORT_SEARCH_RESULT_LIMIT,
  });
  return correlated(
    await api.request(adminSupportSearchEndpoint, {
      path: eventPath(eventId, '/support/search'),
      body: validated,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );
};

export const requestAdminSupportMutation = async (
  api: ApiPort,
  eventId: string,
  body: SupportMutationRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminSupportMutationEndpoint, {
      path: eventPath(eventId, '/support/actions'),
      body,
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) =>
      data.eventId === eventId &&
      data.record.eventId === eventId &&
      matchesSupportMutation(data, body),
  );

export const requestAdminParticipantList = async (
  api: ApiPort,
  eventId: string,
  request: AdminParticipantListRequest,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminParticipantListEndpoint, {
      path: eventPath(eventId, '/participants/list'),
      body: adminParticipantListRequestSchema.parse(request),
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );

export const requestAdminParticipantDetail = async (
  api: ApiPort,
  eventId: string,
  participantId: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminParticipantDetailEndpoint, {
      path: eventPath(
        eventId,
        `/participants/${encodeURIComponent(participantId)}`,
      ),
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId && data.participantId === participantId,
  );

export const requestAdminParticipantUpdate = async (
  api: ApiPort,
  eventId: string,
  participantId: string,
  body: AdminParticipantUpdateRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminParticipantUpdateEndpoint, {
      path: eventPath(
        eventId,
        `/participants/${encodeURIComponent(participantId)}`,
      ),
      body: adminParticipantUpdateRequestSchema.parse(body),
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) =>
      data.eventId === eventId &&
      data.detail.participantId === participantId &&
      body.participantId === participantId,
  );

export const requestAdminParticipantInvite = async (
  api: ApiPort,
  eventId: string,
  participantId: string,
  body: AdminParticipantInviteRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminParticipantInviteEndpoint, {
      path: eventPath(
        eventId,
        `/participants/${encodeURIComponent(participantId)}/invite`,
      ),
      body: adminParticipantInviteRequestSchema.parse(body),
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) =>
      data.eventId === eventId &&
      data.participantId === participantId &&
      body.participantId === participantId,
  );

export const requestAdminAnnouncementPreview = async (
  api: ApiPort,
  eventId: string,
  body: AdminAnnouncementPreviewRequest,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminAnnouncementPreviewEndpoint, {
      path: eventPath(eventId, '/announcements/preview'),
      body,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId && sameJson(data.draft, body.draft),
  );

export const requestAdminAnnouncementTargets = async (
  api: ApiPort,
  eventId: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminAnnouncementTargetsEndpoint, {
      path: eventPath(eventId, '/announcements/targets'),
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );

export const requestAdminAnnouncementSend = async (
  api: ApiPort,
  eventId: string,
  body: AdminAnnouncementSendRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminAnnouncementSendEndpoint, {
      path: eventPath(eventId, '/announcements/send'),
      body,
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) =>
      data.eventId === eventId &&
      data.previewId === body.previewId &&
      data.previewVersion === body.previewVersion,
  );

export const requestAdminRoleAssignment = async (
  api: ApiPort,
  eventId: string,
  body: AdminRoleAssignmentMutationRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminRoleAssignmentEndpoint, {
      path: eventPath(eventId, '/role-assignments'),
      body,
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) =>
      data.eventId === eventId &&
      (data.assignment === null || data.assignment.eventId === eventId) &&
      matchesRoleAssignmentMutation(data, body),
  );

export const requestAdminRoleAssignments = async (
  api: ApiPort,
  eventId: string,
  query: AdminRoleAssignmentListQuery,
  signal?: AbortSignal,
) => {
  const parameters = new URLSearchParams();
  Object.entries(query).forEach(([name, value]) => {
    if (value !== undefined) parameters.set(name, value);
  });
  const suffix = parameters.size > 0 ? `?${parameters.toString()}` : '';
  return correlated(
    await api.request(adminRoleAssignmentListEndpoint, {
      path: `${eventPath(eventId, '/role-assignments')}${suffix}`,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );
};

export const requestAdminRolePeople = async (
  api: ApiPort,
  eventId: string,
  body: AdminRolePersonSearchRequest,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminRolePersonSearchEndpoint, {
      path: eventPath(eventId, '/role-assignments/search'),
      body,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );

export const requestAdminRoleScopes = async (
  api: ApiPort,
  eventId: string,
  body: AdminRoleScopeOptionsRequest,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminRoleScopeOptionsEndpoint, {
      path: eventPath(eventId, '/role-assignments/scope-options'),
      body,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId && data.role === body.role,
  );

export const requestAdminExport = async (
  api: ApiPort,
  eventId: string,
  body: AdminExportRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminExportEndpoint, {
      path: eventPath(eventId, '/exports'),
      body,
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId && data.report === body.report,
  );

export const requestAdminExportJobs = async (
  api: ApiPort,
  eventId: string,
  query: AdminExportJobListQuery,
  signal?: AbortSignal,
) => {
  const parameters = new URLSearchParams();
  Object.entries(query).forEach(([name, value]) => {
    if (value !== undefined) parameters.set(name, String(value));
  });
  const suffix = parameters.size > 0 ? `?${parameters.toString()}` : '';
  return correlated(
    await api.request(adminExportJobListEndpoint, {
      path: `${eventPath(eventId, '/exports')}${suffix}`,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) =>
      data.eventId === eventId &&
      data.items.every((item) => item.eventId === eventId),
  );
};

export const requestAdminReservations = async (
  api: ApiPort,
  eventId: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminReservationsEndpoint, {
      path: eventPath(eventId, '/reservations'),
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );

export const requestAdminReservationSessions = async (
  api: ApiPort,
  eventId: string,
  query: AdminReservationSessionQuery,
  signal?: AbortSignal,
) => {
  const parsed = adminReservationSessionQuerySchema.parse(query);
  const search = new URLSearchParams({ limit: String(parsed.limit) });
  if (parsed.cursor) search.set('cursor', parsed.cursor);
  return correlated(
    await api.request(adminReservationSessionsEndpoint, {
      path: `${eventPath(eventId, '/reservation-sessions')}?${search.toString()}`,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );
};

export const requestAdminReservationMutation = async (
  api: ApiPort,
  eventId: string,
  body: AdminReservationMutationRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminReservationMutationEndpoint, {
      path: eventPath(eventId, '/reservations/actions'),
      body,
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) =>
      data.eventId === eventId &&
      data.record.eventId === eventId &&
      matchesReservationMutation(data, body),
  );

export const requestAdminSessionCapacities = async (
  api: ApiPort,
  eventId: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminSessionCapacitiesEndpoint, {
      path: eventPath(eventId, '/session-capacities'),
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );

export const requestAdminSessionCapacityMutation = async (
  api: ApiPort,
  eventId: string,
  body: AdminSessionCapacityMutationRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminSessionCapacityMutationEndpoint, {
      path: eventPath(eventId, '/session-capacities/actions'),
      body,
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) =>
      data.eventId === eventId &&
      data.record.eventId === eventId &&
      matchesSessionCapacityMutation(data, body),
  );

export const requestAdminAudit = async (
  api: ApiPort,
  eventId: string,
  query: AdminAuditQuery = {},
  signal?: AbortSignal,
) => {
  const validated = adminAuditQuerySchema.parse(query);
  const parameters = new URLSearchParams();
  Object.entries(validated).forEach(([key, value]) => {
    if (value !== undefined) parameters.set(key, String(value));
  });
  const search = parameters.size > 0 ? `?${parameters.toString()}` : '';
  return correlated(
    await api.request(adminAuditEndpoint, {
      path: eventPath(eventId, `/audit${search}`),
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );
};

export const requestAdminEventSettings = async (
  api: ApiPort,
  eventId: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminEventSettingsEndpoint, {
      path: eventPath(eventId, '/settings'),
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId,
  );

export const requestAdminEventSettingsUpdate = async (
  api: ApiPort,
  eventId: string,
  body: AdminEventSettingsUpdateRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminEventSettingsUpdateEndpoint, {
      path: eventPath(eventId, '/settings'),
      body,
      idempotencyKey,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) =>
      data.eventId === eventId &&
      data.settings.eventId === eventId &&
      data.settings.version === body.expectedVersion + 1 &&
      sameJson(
        {
          registrationMode: data.settings.registrationMode,
          reservationChangesAllowed: data.settings.reservationChangesAllowed,
          supportMessage: data.settings.supportMessage,
        },
        body.settings,
      ),
  );

export const requestAdminTicketImportPreview = async (
  api: ApiPort,
  eventId: string,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminTicketImportPreviewEndpoint, {
      path: eventPath(eventId, '/ticket-imports/preview'),
      body: { source: 'simpleshop' },
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId && data.source.kind === 'simpleshop_api',
  );
