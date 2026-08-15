import {
  adminAuditQuerySchema,
  adminAuditResponseSchema,
  adminContextResponseSchema,
  adminEventSettingsSchema,
  adminEventSettingsUpdateRequestSchema,
  adminEventSettingsUpdateResponseSchema,
  adminExportProblemSchema,
  adminExportRequestSchema,
  adminExportResponseSchema,
  adminMutationProblemSchema,
  adminOperationsOverviewResponseSchema,
  adminReadProblemSchema,
  adminReservationListResponseSchema,
  adminReservationMutationRequestSchema,
  adminReservationMutationResponseSchema,
  adminRoleAssignmentMutationRequestSchema,
  adminRoleAssignmentMutationResponseSchema,
  type AdminAuditQuery,
  type AdminEventSettingsUpdateRequest,
  type AdminExportRequest,
  type AdminReservationMutationRequest,
  type AdminReservationMutationResponse,
  type AdminRoleAssignmentMutationRequest,
  type AdminRoleAssignmentMutationResponse,
} from '@byzon/domain/contracts/admin';
import {
  adminAnnouncementPreviewProblemSchema,
  adminAnnouncementPreviewRequestSchema,
  adminAnnouncementPreviewResponseSchema,
  adminAnnouncementSendProblemSchema,
  adminAnnouncementSendRequestSchema,
  adminAnnouncementSendResponseSchema,
  type AdminAnnouncementPreviewRequest,
  type AdminAnnouncementSendRequest,
  type ApiProblem,
} from '@byzon/domain/contracts';
import {
  SUPPORT_SEARCH_RESULT_LIMIT,
  supportMutationProblemSchema,
  supportMutationRequestSchema,
  supportMutationResponseSchema,
  supportSearchProblemSchema,
  supportSearchQuerySchema,
  supportSearchResponseSchema,
  type SupportMutationRequest,
  type SupportMutationResponse,
} from '@byzon/domain/contracts/support';
import {
  ticketImportApplyProblemSchema,
  ticketImportApplyRequestSchema,
  ticketImportApplyResponseSchema,
  ticketImportPreviewProblemSchema,
  ticketImportPreviewResponseSchema,
  ticketImportSourceSchema,
  type TicketImportApplyRequest,
  type TicketImportMediaType,
  type TicketImportSource,
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

/**
 * `requestSchema` validates the metadata that accompanies the browser `File`.
 * The narrow upload port below replaces the generated JSON body with
 * `multipart/form-data`; the normal ApiPort still performs the canonical
 * response/problem parsing.
 */
export const adminTicketImportPreviewEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: ticketImportSourceSchema,
  successSchema: ticketImportPreviewResponseSchema,
  problemSchema: ticketImportPreviewProblemSchema,
  problemCodes: [
    'AUTHENTICATION_REQUIRED',
    'AUTH_SESSION_EXPIRED',
    'EVENT_ACCESS_DENIED',
    'IMPORT_UNSUPPORTED_FORMAT',
    'IMPORT_VALIDATION_FAILED',
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

  switch (body.action) {
    case 'capacity_override':
      return data.record.capacity === body.capacity;
    case 'cancel_reservation':
      return data.record.state === 'cancelled';
  }
};

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
      data.result.created === body.expectedImpact.new &&
      data.result.statusChanged === body.expectedImpact.statusChanged &&
      data.result.unchanged === body.expectedImpact.unchanged,
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

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface AdminTicketImportUploadPort {
  readonly preview: (
    eventId: string,
    file: File,
    signal?: AbortSignal,
  ) => ReturnType<typeof requestAdminTicketImportPreview>;
}

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
};

const hasSafeCsvSignature = async (
  file: File,
  signal?: AbortSignal,
): Promise<boolean> => {
  throwIfAborted(signal);
  const bytes = new Uint8Array(
    await file.slice(0, Math.min(file.size, 4096)).arrayBuffer(),
  );
  throwIfAborted(signal);
  if (bytes.length === 0) return false;
  if (
    bytes.some(
      (byte) =>
        byte === 0 ||
        (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d),
    )
  ) {
    return false;
  }
  try {
    const sample = new TextDecoder('utf-8', { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, '');
    return (
      sample.trim().length > 0 &&
      (sample.includes(',') ||
        sample.includes(';') ||
        sample.includes('\t') ||
        /[\r\n]/.test(sample))
    );
  } catch {
    return false;
  }
};

const mediaTypeForFile = async (
  file: File,
  signal?: AbortSignal,
): Promise<TicketImportMediaType> => {
  if (file.type === 'text/csv') return 'text/csv';
  if (
    file.type ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return file.type;
  }
  if (
    file.type === '' &&
    /\.csv$/i.test(file.name) &&
    (await hasSafeCsvSignature(file, signal))
  ) {
    return 'text/csv';
  }
  throw new TypeError('Unsupported ticket import media type');
};

export const requestAdminTicketImportPreview = async (
  api: ApiPort,
  eventId: string,
  source: TicketImportSource,
  signal?: AbortSignal,
) =>
  correlated(
    await api.request(adminTicketImportPreviewEndpoint, {
      path: eventPath(eventId, '/ticket-imports/preview'),
      body: source,
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
    (data) => data.eventId === eventId && sameJson(data.source, source),
  );

export const createAdminTicketImportUploadPort = (
  fetchImplementation: FetchImplementation = globalThis.fetch.bind(globalThis),
): AdminTicketImportUploadPort => ({
  preview: async (eventId, file, signal) => {
    const mediaType = await mediaTypeForFile(file, signal);
    throwIfAborted(signal);
    const source = ticketImportSourceSchema.parse({
      fileName: file.name,
      mediaType,
      byteSize: file.size,
    });
    const multipart = new FormData();
    const uploadPart =
      file.type === source.mediaType
        ? file
        : new Blob([file], { type: source.mediaType });
    multipart.append('file', uploadPart, source.fileName);
    const multipartApi = createFetchApiClient({
      maxRetries: 0,
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.delete('content-type');
        return fetchImplementation(input, {
          ...init,
          body: multipart,
          headers,
        });
      },
    });
    return requestAdminTicketImportPreview(
      multipartApi,
      eventId,
      source,
      signal,
    );
  },
});

export const browserAdminTicketImportUpload =
  createAdminTicketImportUploadPort();
