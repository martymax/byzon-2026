import {
  adminAnnouncementPreviewProblemSchema,
  adminAnnouncementPreviewRequestSchema,
  adminAnnouncementPreviewResponseSchema,
  adminAnnouncementSendProblemSchema,
  adminAnnouncementSendRequestSchema,
  adminAnnouncementSendResponseSchema,
  idempotencyKeySchema,
  type ApiProblem,
} from '@byzon/domain/contracts';
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
  adminSessionCapacityMutationRequestSchema,
  adminSessionCapacityMutationResponseSchema,
  adminRoleAssignmentMutationRequestSchema,
  adminRoleAssignmentMutationResponseSchema,
  type AdminContextResponse,
  type AdminEventSettings,
  type AdminOperationsOverviewResponse,
  type AdminPermission,
  type AdminReservationRecord,
  type AdminSessionCapacityRecord,
} from '@byzon/domain/contracts/admin';
import {
  supportMutationProblemSchema,
  supportMutationRequestSchema,
  supportMutationResponseSchema,
  supportSearchProblemSchema,
  supportSearchQuerySchema,
  supportSearchResponseSchema,
  type SupportRecord,
} from '@byzon/domain/contracts/support';
import {
  ticketImportApplyProblemSchema,
  ticketImportApplyRequestSchema,
  ticketImportApplyResponseSchema,
  ticketImportPreviewProblemSchema,
  ticketImportPreviewResponseSchema,
  ticketImportSourceSchema,
  type TicketImportPreviewResponse,
} from '@byzon/domain/contracts/ticket-import';
import {
  adminAnnouncementPreviewFixtures,
  adminAnnouncementPreviewProblemFixtures,
  adminAnnouncementSendFixtures,
  adminAnnouncementSendProblemFixtures,
  announcementFixtureIds,
} from '@byzon/test-support/fixtures';
import {
  adminAuditFixtures,
  adminContextFixtures,
  adminEventSettingsFixtures,
  adminEventSettingsUpdateFixtures,
  adminExportFixtures,
  adminExportProblemFixtures,
  adminFixtureIds,
  adminMutationProblemFixtures,
  adminOperationsOverviewFixtures,
  adminReadProblemFixtures,
  adminReservationFixtures,
  adminReservationMutationFixtures,
  adminSessionCapacityMutationFixtures,
  adminRoleAssignmentFixtures,
} from '@byzon/test-support/fixtures/admin';
import {
  supportFixtureIds,
  supportMutationFixtures,
  supportMutationProblemFixtures,
  supportSearchFixtures,
  supportSearchProblemFixtures,
} from '@byzon/test-support/fixtures/support';
import {
  ticketImportApplyFixtures,
  ticketImportApplyProblemFixtures,
  ticketImportPreviewFixtures,
  ticketImportPreviewProblemFixtures,
} from '@byzon/test-support/fixtures/ticket-import';
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { z } from 'zod';

import {
  mockJsonResponse,
  mockProblemResponse,
  type MockJsonResponseOptions,
} from './response';

type AdminMockPersona =
  | 'organizer'
  | 'room_operator'
  | 'support_read_only'
  | 'reservation_reader'
  | 'denied'
  | 'session_expired';

interface StoredMutation {
  readonly endpoint: string;
  readonly fingerprint: string;
  readonly response: Readonly<Record<string, unknown>>;
}

interface StoredImportPreview {
  readonly preview: TicketImportPreviewResponse;
  readonly scenario: string;
}

interface AdminMockState {
  persona: AdminMockPersona;
  overview: AdminOperationsOverviewResponse;
  supportRecords: SupportRecord[];
  reservations: AdminReservationRecord[];
  sessionCapacities: AdminSessionCapacityRecord[];
  settings: AdminEventSettings;
  announcementPreviewId: string | null;
  announcementPreviewVersion: number;
  announcementRecipientCount: number;
  readonly importPreviews: Map<string, StoredImportPreview>;
  readonly mutations: Map<string, StoredMutation>;
  readonly staleScenarios: Set<string>;
}

const clone = <Value>(value: Value): Value => structuredClone(value);

const eventScopedSupportRecord = (record: SupportRecord): SupportRecord => ({
  ...clone(record),
  eventId: adminFixtureIds.event,
});

const initialState = (): AdminMockState => ({
  persona: 'organizer',
  overview: {
    ...clone(adminOperationsOverviewFixtures.healthy!),
    eventId: adminFixtureIds.event,
  },
  supportRecords: supportSearchFixtures.ambiguous!.matches.map(
    eventScopedSupportRecord,
  ),
  reservations: clone(adminReservationFixtures.list!.items),
  sessionCapacities: clone(adminReservationFixtures.list!.capacityItems),
  settings: clone(adminEventSettingsFixtures.open!),
  announcementPreviewId: null,
  announcementPreviewVersion: 1,
  announcementRecipientCount: 0,
  importPreviews: new Map(),
  mutations: new Map(),
  staleScenarios: new Set(),
});

let state = initialState();

export const resetMockAdminState = (): void => {
  state = initialState();
};

const contextForPersona = (): AdminContextResponse => {
  if (state.persona === 'room_operator') {
    return clone(adminContextFixtures.room_operator!);
  }
  const context = clone(adminContextFixtures.organizer!);
  if (state.persona === 'support_read_only') {
    return {
      ...context,
      actor: {
        ...context.actor,
        permissions: ['participant:operational:read'],
      },
    };
  }
  if (state.persona === 'reservation_reader') {
    return {
      ...context,
      actor: {
        ...context.actor,
        permissions: ['reservation:any:read'],
      },
    };
  }
  return context;
};

const permissionsForPersona = (): readonly AdminPermission[] =>
  state.persona === 'denied' || state.persona === 'session_expired'
    ? []
    : contextForPersona().actor.permissions;

const successOptions = (fixtureName: string): MockJsonResponseOptions => ({
  fixtureName,
  cacheControl: 'private, no-store',
  vary: ['authorization', 'cookie'],
});

const authorize = (
  schema: z.ZodType<ApiProblem>,
  permissions: readonly AdminPermission[],
  fixtureName: string,
): Response | null => {
  if (state.persona === 'session_expired') {
    return mockProblemResponse(
      schema,
      adminReadProblemFixtures.session_expired,
      { fixtureName: `${fixtureName}-session-expired` },
    );
  }
  const granted = permissions.some((permission) =>
    permissionsForPersona().includes(permission),
  );
  if (state.persona === 'denied' || !granted) {
    return mockProblemResponse(schema, adminReadProblemFixtures.permission, {
      fixtureName: `${fixtureName}-permission`,
    });
  }
  return null;
};

const routeMatchesEvent = (eventId: unknown): boolean =>
  String(eventId) === adminFixtureIds.event;

const mutationFingerprint = (endpoint: string, body: unknown): string =>
  `${endpoint}:${JSON.stringify(body)}`;

const readMutationKey = (request: Request): string | null => {
  const parsed = idempotencyKeySchema.safeParse(
    request.headers.get('idempotency-key'),
  );
  return parsed.success ? parsed.data : null;
};

type StoredMutationResult =
  | { readonly kind: 'new'; readonly key: string; readonly fingerprint: string }
  | { readonly kind: 'collision' }
  | {
      readonly kind: 'replay';
      readonly response: Readonly<Record<string, unknown>>;
    };

const mutationResult = (
  request: Request,
  endpoint: string,
  body: unknown,
): StoredMutationResult | null => {
  const key = readMutationKey(request);
  if (!key) return null;
  const fingerprint = mutationFingerprint(endpoint, body);
  const stored = state.mutations.get(key);
  if (!stored) return { kind: 'new', key, fingerprint };
  if (stored.endpoint !== endpoint || stored.fingerprint !== fingerprint) {
    return { kind: 'collision' };
  }
  return { kind: 'replay', response: stored.response };
};

const replayResponse = (
  response: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  const outcome = response.outcome;
  const replayOutcome =
    outcome === 'sent'
      ? 'already_sent'
      : outcome === 'queued'
        ? 'already_queued'
        : outcome === 'granted' ||
            outcome === 'revoked' ||
            outcome === 'updated' ||
            outcome === 'applied'
          ? 'already_applied'
          : outcome;
  return { ...response, outcome: replayOutcome };
};

const storeMutation = (
  attempt: Extract<StoredMutationResult, { kind: 'new' }>,
  endpoint: string,
  response: Readonly<Record<string, unknown>>,
): void => {
  state.mutations.set(attempt.key, {
    endpoint,
    fingerprint: attempt.fingerprint,
    response,
  });
};

const scenario = (value: string): string => value.toLocaleLowerCase('en-US');

const transientFailure = (
  reason: string,
  attempt: Extract<StoredMutationResult, { kind: 'new' }>,
  endpoint: string,
  response: Readonly<Record<string, unknown>>,
): Response | null => {
  if (!scenario(reason).includes('timeout')) return null;
  storeMutation(attempt, endpoint, response);
  return HttpResponse.error();
};

const currentSupportResponse = (
  query: string,
): z.input<typeof supportSearchResponseSchema> => {
  const normalized = scenario(query);
  if (normalized.includes('none')) {
    return {
      eventId: adminFixtureIds.event,
      limitedTo: 5,
      outcome: 'no_match',
      matches: [],
    };
  }
  if (normalized.includes('ambiguous')) {
    return {
      eventId: adminFixtureIds.event,
      limitedTo: 5,
      outcome: 'ambiguous',
      matches: state.supportRecords,
    };
  }
  return {
    eventId: adminFixtureIds.event,
    limitedTo: 5,
    outcome: 'single_match',
    matches: [state.supportRecords[0]!],
  };
};

const supportRecordAfter = (
  record: SupportRecord,
  body: z.output<typeof supportMutationRequestSchema>,
): SupportRecord => {
  const nextVersion = record.version + 1;
  if (body.action === 'block') {
    return {
      ...record,
      ticketState: 'blocked',
      version: nextVersion,
      availableActions: ['resend', 'reassign', 'reactivate', 'transfer'],
    };
  }
  if (body.action === 'reactivate') {
    return {
      ...record,
      ticketState: 'active',
      version: nextVersion,
      availableActions: ['resend', 'reassign', 'block', 'transfer'],
    };
  }
  return {
    ...record,
    ticketId:
      body.action === 'reassign' || body.action === 'transfer'
        ? body.targetTicketId!
        : record.ticketId,
    version: nextVersion,
  };
};

const reservationAfter = (
  record: AdminReservationRecord,
): AdminReservationRecord => ({
  ...record,
  version: record.version + 1,
  state: 'cancelled',
  availableActions: [],
});

export const adminMockHandlers: readonly RequestHandler[] = Object.freeze([
  http.get('*/api/v1/admin/context', ({ request }) => {
    const rawPersona = new URL(request.url).searchParams.get('persona');
    if (
      rawPersona &&
      ![
        'organizer',
        'room_operator',
        'support_read_only',
        'reservation_reader',
        'denied',
        'session_expired',
      ].includes(rawPersona)
    ) {
      return mockProblemResponse(
        adminReadProblemSchema,
        adminReadProblemFixtures.validation,
        { fixtureName: 'admin.mock.context-validation' },
      );
    }
    state.persona = (rawPersona ?? 'organizer') as AdminMockPersona;
    if (state.persona === 'session_expired') {
      return mockProblemResponse(
        adminReadProblemSchema,
        adminReadProblemFixtures.session_expired,
        { fixtureName: 'admin.mock.context-session-expired' },
      );
    }
    if (state.persona === 'denied') {
      return mockProblemResponse(
        adminReadProblemSchema,
        adminReadProblemFixtures.permission,
        { fixtureName: 'admin.mock.context-permission' },
      );
    }
    return mockJsonResponse(
      adminContextResponseSchema,
      contextForPersona(),
      successOptions('admin.mock.context'),
    );
  }),

  http.get('*/api/v1/admin/events/:eventId/operations', ({ params }) => {
    const denied = authorize(
      adminReadProblemSchema,
      ['operations:read'],
      'admin.mock.operations',
    );
    if (denied) return denied;
    if (!routeMatchesEvent(params.eventId)) {
      return mockProblemResponse(
        adminReadProblemSchema,
        adminReadProblemFixtures.not_found,
        { fixtureName: 'admin.mock.operations-not-found' },
      );
    }
    return mockJsonResponse(
      adminOperationsOverviewResponseSchema,
      state.overview,
      successOptions('admin.mock.operations'),
    );
  }),

  http.post(
    '*/api/v1/admin/events/:eventId/session-capacities/actions',
    async ({ params, request }) => {
      const denied = authorize(
        adminMutationProblemSchema,
        ['agenda:any:override'],
        'admin.mock.session-capacity-mutation',
      );
      if (denied) return denied;
      const body = adminSessionCapacityMutationRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const attempt = body.success
        ? mutationResult(request, 'admin-session-capacity', body.data)
        : null;
      if (!routeMatchesEvent(params.eventId) || !body.success || !attempt) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.invalid_transition,
          { fixtureName: 'admin.mock.session-capacity-invalid' },
        );
      }
      if (
        attempt.kind === 'collision' ||
        scenario(body.data.reason).includes('collision')
      ) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.session-capacity-collision' },
        );
      }
      if (attempt.kind === 'replay') {
        return mockJsonResponse(
          adminSessionCapacityMutationResponseSchema,
          replayResponse(attempt.response),
          successOptions('admin.mock.session-capacity-replay'),
        );
      }
      const index = state.sessionCapacities.findIndex(
        ({ sessionId }) => sessionId === body.data.sessionId,
      );
      const record = state.sessionCapacities[index];
      if (!record) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.invalid_transition,
          { fixtureName: 'admin.mock.session-capacity-not-found' },
        );
      }
      if (
        scenario(body.data.reason).includes('stale') &&
        !state.staleScenarios.has('session-capacity')
      ) {
        state.staleScenarios.add('session-capacity');
        state.sessionCapacities[index] = {
          ...record,
          version: record.version + 1,
        };
        return mockProblemResponse(
          adminMutationProblemSchema,
          {
            ...adminMutationProblemFixtures.stale,
            currentVersion: record.version + 1,
          },
          { fixtureName: 'admin.mock.session-capacity-stale' },
        );
      }
      if (
        body.data.expectedVersion !== record.version ||
        body.data.capacity < record.confirmedCount ||
        record.sessionStatus === 'cancelled' ||
        record.sessionStatus === 'archived'
      ) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          body.data.expectedVersion !== record.version
            ? {
                ...adminMutationProblemFixtures.stale,
                currentVersion: record.version,
              }
            : adminMutationProblemFixtures.invalid_transition,
          { fixtureName: 'admin.mock.session-capacity-state' },
        );
      }
      const next = {
        ...record,
        capacity: body.data.capacity,
        version: record.version + 1,
      };
      state.sessionCapacities[index] = next;
      state.reservations = state.reservations.map((reservation) =>
        reservation.sessionId === record.sessionId
          ? {
              ...reservation,
              capacity: body.data.capacity,
              version: reservation.version + 1,
            }
          : reservation,
      );
      const response = adminSessionCapacityMutationResponseSchema.parse({
        ...clone(adminSessionCapacityMutationFixtures.updated!),
        eventId: adminFixtureIds.event,
        record: next,
      });
      const transient = transientFailure(
        body.data.reason,
        attempt,
        'admin-session-capacity',
        response,
      );
      if (transient) return transient;
      storeMutation(attempt, 'admin-session-capacity', response);
      return mockJsonResponse(
        adminSessionCapacityMutationResponseSchema,
        response,
        successOptions('admin.mock.session-capacity'),
      );
    },
  ),

  http.post(
    '*/api/v1/admin/events/:eventId/ticket-imports/preview',
    async ({ params, request }) => {
      const denied = authorize(
        ticketImportPreviewProblemSchema,
        ['ticket:any:manage'],
        'admin.mock.import-preview',
      );
      if (denied) return denied;
      if (!routeMatchesEvent(params.eventId)) {
        return mockProblemResponse(
          ticketImportPreviewProblemSchema,
          ticketImportPreviewProblemFixtures.permission,
          { fixtureName: 'admin.mock.import-preview-event' },
        );
      }
      const contentType = request.headers.get('content-type') ?? '';
      if (!contentType.startsWith('multipart/form-data;')) {
        return mockProblemResponse(
          ticketImportPreviewProblemSchema,
          ticketImportPreviewProblemFixtures.unsupported_format,
          { fixtureName: 'admin.mock.import-preview-media' },
        );
      }
      const form = await request.formData().catch(() => null);
      const candidate = form?.get('file');
      if (
        !(candidate instanceof Blob) ||
        typeof (candidate as File).name !== 'string'
      ) {
        return mockProblemResponse(
          ticketImportPreviewProblemSchema,
          ticketImportPreviewProblemFixtures.validation,
          { fixtureName: 'admin.mock.import-preview-file' },
        );
      }
      const file = candidate as File;
      const source = ticketImportSourceSchema.safeParse({
        fileName: file.name,
        mediaType: file.type,
        byteSize: file.size,
      });
      if (!source.success) {
        return mockProblemResponse(
          ticketImportPreviewProblemSchema,
          file.size > 10_000_000
            ? ticketImportPreviewProblemFixtures.validation
            : ticketImportPreviewProblemFixtures.unsupported_format,
          { fixtureName: 'admin.mock.import-preview-source' },
        );
      }
      const fileScenario = scenario(file.name);
      if (fileScenario.includes('invalid')) {
        return mockProblemResponse(
          ticketImportPreviewProblemSchema,
          ticketImportPreviewProblemFixtures.validation,
          { fixtureName: 'admin.mock.import-preview-invalid' },
        );
      }
      const base = fileScenario.includes('conflict')
        ? ticketImportPreviewFixtures.conflict!
        : fileScenario.includes('unknown')
          ? ticketImportPreviewFixtures.unknown!
          : ticketImportPreviewFixtures.clean!;
      const preview = ticketImportPreviewResponseSchema.parse({
        ...clone(base),
        eventId: adminFixtureIds.event,
        source: source.data,
      });
      state.importPreviews.set(preview.previewId, {
        preview,
        scenario: fileScenario,
      });
      return mockJsonResponse(
        ticketImportPreviewResponseSchema,
        preview,
        successOptions('admin.mock.import-preview'),
      );
    },
  ),

  http.post(
    '*/api/v1/admin/events/:eventId/ticket-imports/apply',
    async ({ params, request }) => {
      const denied = authorize(
        ticketImportApplyProblemSchema,
        ['ticket:any:manage'],
        'admin.mock.import-apply',
      );
      if (denied) return denied;
      const body = ticketImportApplyRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const attempt = body.success
        ? mutationResult(request, 'ticket-import-apply', body.data)
        : null;
      if (
        !routeMatchesEvent(params.eventId) ||
        !body.success ||
        body.data.eventId !== adminFixtureIds.event ||
        !attempt
      ) {
        return mockProblemResponse(
          ticketImportApplyProblemSchema,
          ticketImportApplyProblemFixtures.not_found,
          { fixtureName: 'admin.mock.import-apply-invalid' },
        );
      }
      if (attempt.kind === 'collision') {
        return mockProblemResponse(
          ticketImportApplyProblemSchema,
          ticketImportApplyProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.import-apply-collision' },
        );
      }
      if (attempt.kind === 'replay') {
        return mockJsonResponse(
          ticketImportApplyResponseSchema,
          replayResponse(attempt.response),
          successOptions('admin.mock.import-apply-replay'),
        );
      }
      const storedPreview = state.importPreviews.get(body.data.previewId);
      if (
        !storedPreview ||
        storedPreview.preview.previewVersion !== body.data.previewVersion
      ) {
        return mockProblemResponse(
          ticketImportApplyProblemSchema,
          ticketImportApplyProblemFixtures.stale,
          { fixtureName: 'admin.mock.import-apply-stale-version' },
        );
      }
      if (
        JSON.stringify(storedPreview.preview.summary) !==
        JSON.stringify(body.data.expectedImpact)
      ) {
        return mockProblemResponse(
          ticketImportApplyProblemSchema,
          ticketImportApplyProblemFixtures.stale,
          { fixtureName: 'admin.mock.import-apply-impact' },
        );
      }
      if (
        storedPreview.preview.summary.conflict > 0 ||
        storedPreview.preview.summary.unknown > 0
      ) {
        return mockProblemResponse(
          ticketImportApplyProblemSchema,
          ticketImportApplyProblemFixtures.blocked,
          { fixtureName: 'admin.mock.import-apply-blocked' },
        );
      }
      if (
        storedPreview.scenario.includes('stale') &&
        !state.staleScenarios.has('import')
      ) {
        state.staleScenarios.add('import');
        return mockProblemResponse(
          ticketImportApplyProblemSchema,
          ticketImportApplyProblemFixtures.stale,
          { fixtureName: 'admin.mock.import-apply-stale' },
        );
      }
      if (storedPreview.scenario.includes('collision')) {
        return mockProblemResponse(
          ticketImportApplyProblemSchema,
          ticketImportApplyProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.import-apply-key-reused' },
        );
      }
      const response = ticketImportApplyResponseSchema.parse({
        ...clone(ticketImportApplyFixtures.applied!),
        eventId: adminFixtureIds.event,
        previewId: body.data.previewId,
        previewVersion: body.data.previewVersion,
        result: {
          created: body.data.expectedImpact.new,
          statusChanged: body.data.expectedImpact.statusChanged,
          unchanged: body.data.expectedImpact.unchanged,
        },
      });
      const transient = transientFailure(
        storedPreview.scenario,
        attempt,
        'ticket-import-apply',
        response,
      );
      if (transient) return transient;
      storeMutation(attempt, 'ticket-import-apply', response);
      return mockJsonResponse(
        ticketImportApplyResponseSchema,
        response,
        successOptions('admin.mock.import-apply'),
      );
    },
  ),

  http.post(
    '*/api/v1/admin/events/:eventId/support/search',
    async ({ params, request }) => {
      const denied = authorize(
        supportSearchProblemSchema,
        ['participant:operational:read'],
        'admin.mock.support-search',
      );
      if (denied) return denied;
      const query = supportSearchQuerySchema.safeParse(
        await request.json().catch(() => undefined),
      );
      if (!routeMatchesEvent(params.eventId) || !query.success) {
        return mockProblemResponse(
          supportSearchProblemSchema,
          supportSearchProblemFixtures.validation,
          { fixtureName: 'admin.mock.support-search-validation' },
        );
      }
      if (scenario(query.data.query).includes('error')) {
        return mockProblemResponse(
          supportSearchProblemSchema,
          supportSearchProblemFixtures.internal_error,
          { fixtureName: 'admin.mock.support-search-error' },
        );
      }
      return mockJsonResponse(
        supportSearchResponseSchema,
        currentSupportResponse(query.data.query),
        successOptions('admin.mock.support-search'),
      );
    },
  ),

  http.post(
    '*/api/v1/admin/events/:eventId/support/actions',
    async ({ params, request }) => {
      const denied = authorize(
        supportMutationProblemSchema,
        ['ticket:any:manage'],
        'admin.mock.support-mutation',
      );
      if (denied) return denied;
      const body = supportMutationRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const attempt = body.success
        ? mutationResult(request, 'support-mutation', body.data)
        : null;
      if (!routeMatchesEvent(params.eventId) || !body.success || !attempt) {
        return mockProblemResponse(
          supportMutationProblemSchema,
          supportMutationProblemFixtures.not_found,
          { fixtureName: 'admin.mock.support-mutation-invalid' },
        );
      }
      if (
        attempt.kind === 'collision' ||
        scenario(body.data.reason).includes('collision')
      ) {
        return mockProblemResponse(
          supportMutationProblemSchema,
          supportMutationProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.support-mutation-collision' },
        );
      }
      if (attempt.kind === 'replay') {
        return mockJsonResponse(
          supportMutationResponseSchema,
          replayResponse(attempt.response),
          successOptions('admin.mock.support-mutation-replay'),
        );
      }
      const index = state.supportRecords.findIndex(
        ({ participantId, ticketId }) =>
          participantId === body.data.participantId &&
          ticketId === body.data.ticketId,
      );
      const record = state.supportRecords[index];
      if (!record) {
        return mockProblemResponse(
          supportMutationProblemSchema,
          supportMutationProblemFixtures.not_found,
          { fixtureName: 'admin.mock.support-mutation-not-found' },
        );
      }
      if (
        scenario(body.data.reason).includes('stale') &&
        !state.staleScenarios.has('support')
      ) {
        state.staleScenarios.add('support');
        state.supportRecords[index] = {
          ...record,
          version: record.version + 1,
        };
        return mockProblemResponse(
          supportMutationProblemSchema,
          {
            ...supportMutationProblemFixtures.stale,
            currentVersion: record.version + 1,
          },
          { fixtureName: 'admin.mock.support-mutation-stale' },
        );
      }
      if (body.data.expectedVersion !== record.version) {
        return mockProblemResponse(
          supportMutationProblemSchema,
          {
            ...supportMutationProblemFixtures.stale,
            currentVersion: record.version,
          },
          { fixtureName: 'admin.mock.support-mutation-version' },
        );
      }
      if (!record.availableActions.includes(body.data.action)) {
        return mockProblemResponse(
          supportMutationProblemSchema,
          supportMutationProblemFixtures.invalid_transition,
          { fixtureName: 'admin.mock.support-mutation-transition' },
        );
      }
      const next = supportRecordAfter(record, body.data);
      state.supportRecords[index] = next;
      const response = supportMutationResponseSchema.parse({
        ...clone(supportMutationFixtures.blocked!),
        eventId: adminFixtureIds.event,
        record: next,
        outcome: 'applied',
      });
      const transient = transientFailure(
        body.data.reason,
        attempt,
        'support-mutation',
        response,
      );
      if (transient) return transient;
      storeMutation(attempt, 'support-mutation', response);
      return mockJsonResponse(
        supportMutationResponseSchema,
        response,
        successOptions('admin.mock.support-mutation'),
      );
    },
  ),

  http.post(
    '*/api/v1/admin/events/:eventId/announcements/preview',
    async ({ params, request }) => {
      const denied = authorize(
        adminAnnouncementPreviewProblemSchema,
        ['announcement:send'],
        'admin.mock.announcement-preview',
      );
      if (denied) return denied;
      const body = adminAnnouncementPreviewRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      if (!routeMatchesEvent(params.eventId) || !body.success) {
        return mockProblemResponse(
          adminAnnouncementPreviewProblemSchema,
          adminAnnouncementPreviewProblemFixtures.validation,
          { fixtureName: 'admin.mock.announcement-preview-validation' },
        );
      }
      if (scenario(body.data.draft.bodyText).includes('empty-problem')) {
        return mockProblemResponse(
          adminAnnouncementPreviewProblemSchema,
          adminAnnouncementPreviewProblemFixtures.empty_audience,
          { fixtureName: 'admin.mock.announcement-preview-empty' },
        );
      }
      state.announcementPreviewVersion += 1;
      const empty = scenario(body.data.draft.title).includes('empty');
      const base = empty
        ? adminAnnouncementPreviewFixtures.empty_audience!
        : adminAnnouncementPreviewFixtures.session_audience!;
      const response = adminAnnouncementPreviewResponseSchema.parse({
        ...clone(base),
        eventId: adminFixtureIds.event,
        previewVersion: state.announcementPreviewVersion,
        draft: body.data.draft,
        audience: empty
          ? { recipientCount: 0, excludedCount: 440, sample: [] }
          : base.audience,
      });
      state.announcementPreviewId = response.previewId;
      state.announcementRecipientCount = response.audience.recipientCount;
      return mockJsonResponse(
        adminAnnouncementPreviewResponseSchema,
        response,
        successOptions('admin.mock.announcement-preview'),
      );
    },
  ),

  http.post(
    '*/api/v1/admin/events/:eventId/announcements/send',
    async ({ params, request }) => {
      const denied = authorize(
        adminAnnouncementSendProblemSchema,
        ['announcement:send'],
        'admin.mock.announcement-send',
      );
      if (denied) return denied;
      const body = adminAnnouncementSendRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const attempt = body.success
        ? mutationResult(request, 'announcement-send', body.data)
        : null;
      if (!routeMatchesEvent(params.eventId) || !body.success || !attempt) {
        return mockProblemResponse(
          adminAnnouncementSendProblemSchema,
          adminAnnouncementSendProblemFixtures.preview_expired,
          { fixtureName: 'admin.mock.announcement-send-invalid' },
        );
      }
      if (
        attempt.kind === 'collision' ||
        scenario(body.data.reason).includes('collision')
      ) {
        return mockProblemResponse(
          adminAnnouncementSendProblemSchema,
          adminAnnouncementSendProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.announcement-send-collision' },
        );
      }
      if (attempt.kind === 'replay') {
        return mockJsonResponse(
          adminAnnouncementSendResponseSchema,
          replayResponse(attempt.response),
          successOptions('admin.mock.announcement-send-replay'),
        );
      }
      if (scenario(body.data.reason).includes('expired')) {
        return mockProblemResponse(
          adminAnnouncementSendProblemSchema,
          adminAnnouncementSendProblemFixtures.preview_expired,
          { fixtureName: 'admin.mock.announcement-send-expired' },
        );
      }
      if (
        body.data.previewId !== state.announcementPreviewId ||
        body.data.previewVersion !== state.announcementPreviewVersion
      ) {
        return mockProblemResponse(
          adminAnnouncementSendProblemSchema,
          {
            ...adminAnnouncementSendProblemFixtures.stale_preview,
            currentPreviewVersion: state.announcementPreviewVersion,
          },
          { fixtureName: 'admin.mock.announcement-send-version' },
        );
      }
      if (
        scenario(body.data.reason).includes('stale') &&
        !state.staleScenarios.has('announcement')
      ) {
        state.staleScenarios.add('announcement');
        return mockProblemResponse(
          adminAnnouncementSendProblemSchema,
          {
            ...adminAnnouncementSendProblemFixtures.stale_preview,
            currentPreviewVersion: body.data.previewVersion + 1,
          },
          { fixtureName: 'admin.mock.announcement-send-stale' },
        );
      }
      const response = adminAnnouncementSendResponseSchema.parse({
        ...clone(adminAnnouncementSendFixtures.sent!),
        eventId: adminFixtureIds.event,
        previewId: body.data.previewId,
        previewVersion: body.data.previewVersion,
        recipientCount: state.announcementRecipientCount,
      });
      const transient = transientFailure(
        body.data.reason,
        attempt,
        'announcement-send',
        response,
      );
      if (transient) return transient;
      storeMutation(attempt, 'announcement-send', response);
      return mockJsonResponse(
        adminAnnouncementSendResponseSchema,
        response,
        successOptions('admin.mock.announcement-send'),
      );
    },
  ),

  http.post(
    '*/api/v1/admin/events/:eventId/role-assignments',
    async ({ params, request }) => {
      const denied = authorize(
        adminMutationProblemSchema,
        ['role:manage'],
        'admin.mock.role',
      );
      if (denied) return denied;
      const body = adminRoleAssignmentMutationRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const attempt = body.success
        ? mutationResult(request, 'admin-role', body.data)
        : null;
      if (!routeMatchesEvent(params.eventId) || !body.success || !attempt) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.invalid_transition,
          { fixtureName: 'admin.mock.role-invalid' },
        );
      }
      if (
        attempt.kind === 'collision' ||
        scenario(body.data.reason).includes('collision')
      ) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.role-collision' },
        );
      }
      if (attempt.kind === 'replay') {
        return mockJsonResponse(
          adminRoleAssignmentMutationResponseSchema,
          replayResponse(attempt.response),
          successOptions('admin.mock.role-replay'),
        );
      }
      if (
        scenario(body.data.reason).includes('stale') &&
        !state.staleScenarios.has('role')
      ) {
        state.staleScenarios.add('role');
        state.overview = {
          ...state.overview,
          version: state.overview.version + 1,
        };
        return mockProblemResponse(
          adminMutationProblemSchema,
          {
            ...adminMutationProblemFixtures.stale,
            currentVersion: state.overview.version,
          },
          { fixtureName: 'admin.mock.role-stale' },
        );
      }
      if (body.data.expectedVersion !== state.overview.version) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          {
            ...adminMutationProblemFixtures.stale,
            currentVersion: state.overview.version,
          },
          { fixtureName: 'admin.mock.role-version' },
        );
      }
      const base = clone(adminRoleAssignmentFixtures.granted!);
      const response = adminRoleAssignmentMutationResponseSchema.parse({
        ...base,
        eventId: adminFixtureIds.event,
        assignmentsVersion: body.data.expectedVersion + 1,
        outcome: body.data.action === 'grant' ? 'granted' : 'revoked',
        assignment:
          body.data.action === 'grant'
            ? {
                ...base.assignment!,
                eventId: adminFixtureIds.event,
                operatorId: body.data.operatorId,
                operatorLabel: `Operátor •${body.data.operatorId.slice(-4)}`,
                role: body.data.role,
                scope: body.data.scope,
              }
            : null,
      });
      const transient = transientFailure(
        body.data.reason,
        attempt,
        'admin-role',
        response,
      );
      if (transient) return transient;
      storeMutation(attempt, 'admin-role', response);
      return mockJsonResponse(
        adminRoleAssignmentMutationResponseSchema,
        response,
        successOptions('admin.mock.role'),
      );
    },
  ),

  http.post(
    '*/api/v1/admin/events/:eventId/exports',
    async ({ params, request }) => {
      const denied = authorize(
        adminExportProblemSchema,
        ['personal-data:operational:export'],
        'admin.mock.export',
      );
      if (denied) return denied;
      const body = adminExportRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const attempt = body.success
        ? mutationResult(request, 'admin-export', body.data)
        : null;
      if (!routeMatchesEvent(params.eventId) || !body.success || !attempt) {
        return mockProblemResponse(
          adminExportProblemSchema,
          adminExportProblemFixtures.unavailable,
          { fixtureName: 'admin.mock.export-invalid' },
        );
      }
      if (
        attempt.kind === 'collision' ||
        scenario(body.data.reason).includes('collision')
      ) {
        return mockProblemResponse(
          adminExportProblemSchema,
          adminExportProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.export-collision' },
        );
      }
      if (attempt.kind === 'replay') {
        return mockJsonResponse(
          adminExportResponseSchema,
          replayResponse(attempt.response),
          successOptions('admin.mock.export-replay'),
        );
      }
      const response = adminExportResponseSchema.parse({
        ...clone(adminExportFixtures.queued!),
        eventId: adminFixtureIds.event,
        report: body.data.report,
      });
      const transient = transientFailure(
        body.data.reason,
        attempt,
        'admin-export',
        response,
      );
      if (transient) return transient;
      storeMutation(attempt, 'admin-export', response);
      return mockJsonResponse(
        adminExportResponseSchema,
        response,
        successOptions('admin.mock.export'),
      );
    },
  ),

  http.get('*/api/v1/admin/events/:eventId/reservations', ({ params }) => {
    const denied = authorize(
      adminReadProblemSchema,
      ['reservation:any:read'],
      'admin.mock.reservations',
    );
    if (denied) return denied;
    if (!routeMatchesEvent(params.eventId)) {
      return mockProblemResponse(
        adminReadProblemSchema,
        adminReadProblemFixtures.not_found,
        { fixtureName: 'admin.mock.reservations-not-found' },
      );
    }
    const items = state.reservations;
    return mockJsonResponse(
      adminReservationListResponseSchema,
      {
        ...clone(adminReservationFixtures.list!),
        eventId: adminFixtureIds.event,
        capacityItems: state.sessionCapacities,
        items,
      },
      successOptions('admin.mock.reservations'),
    );
  }),

  http.post(
    '*/api/v1/admin/events/:eventId/reservations/actions',
    async ({ params, request }) => {
      const denied = authorize(
        adminMutationProblemSchema,
        ['agenda:any:override'],
        'admin.mock.reservation-mutation',
      );
      if (denied) return denied;
      const body = adminReservationMutationRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const attempt = body.success
        ? mutationResult(request, 'admin-reservation', body.data)
        : null;
      if (!routeMatchesEvent(params.eventId) || !body.success || !attempt) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.invalid_transition,
          { fixtureName: 'admin.mock.reservation-invalid' },
        );
      }
      if (
        attempt.kind === 'collision' ||
        scenario(body.data.reason).includes('collision')
      ) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.reservation-collision' },
        );
      }
      if (attempt.kind === 'replay') {
        return mockJsonResponse(
          adminReservationMutationResponseSchema,
          replayResponse(attempt.response),
          successOptions('admin.mock.reservation-replay'),
        );
      }
      const index = state.reservations.findIndex(
        ({ reservationId }) => reservationId === body.data.reservationId,
      );
      const record = state.reservations[index];
      if (!record) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.invalid_transition,
          { fixtureName: 'admin.mock.reservation-not-found' },
        );
      }
      const actionDenied = authorize(
        adminMutationProblemSchema,
        ['agenda:any:override'],
        'admin.mock.reservation-mutation-action',
      );
      if (actionDenied) return actionDenied;
      if (
        scenario(body.data.reason).includes('stale') &&
        !state.staleScenarios.has('reservation')
      ) {
        state.staleScenarios.add('reservation');
        state.reservations[index] = { ...record, version: record.version + 1 };
        return mockProblemResponse(
          adminMutationProblemSchema,
          {
            ...adminMutationProblemFixtures.stale,
            currentVersion: record.version + 1,
          },
          { fixtureName: 'admin.mock.reservation-stale' },
        );
      }
      if (
        body.data.expectedVersion !== record.version ||
        !record.availableActions.includes(body.data.action)
      ) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          body.data.expectedVersion !== record.version
            ? {
                ...adminMutationProblemFixtures.stale,
                currentVersion: record.version,
              }
            : adminMutationProblemFixtures.invalid_transition,
          { fixtureName: 'admin.mock.reservation-state' },
        );
      }
      const next = reservationAfter(record);
      state.reservations[index] = next;
      const response = adminReservationMutationResponseSchema.parse({
        ...clone(adminReservationMutationFixtures.cancelled!),
        eventId: adminFixtureIds.event,
        record: next,
      });
      const transient = transientFailure(
        body.data.reason,
        attempt,
        'admin-reservation',
        response,
      );
      if (transient) return transient;
      storeMutation(attempt, 'admin-reservation', response);
      return mockJsonResponse(
        adminReservationMutationResponseSchema,
        response,
        successOptions('admin.mock.reservation'),
      );
    },
  ),

  http.get('*/api/v1/admin/events/:eventId/audit', ({ params, request }) => {
    const denied = authorize(
      adminReadProblemSchema,
      ['audit:read'],
      'admin.mock.audit',
    );
    if (denied) return denied;
    const url = new URL(request.url);
    const query = adminAuditQuerySchema.safeParse(
      Object.fromEntries(
        [...url.searchParams.entries()].map(([key, value]) => [
          key,
          key === 'limit' ? Number(value) : value,
        ]),
      ),
    );
    if (!routeMatchesEvent(params.eventId) || !query.success) {
      return mockProblemResponse(
        adminReadProblemSchema,
        adminReadProblemFixtures.validation,
        { fixtureName: 'admin.mock.audit-validation' },
      );
    }
    const items = adminAuditFixtures.page!.items.filter(
      ({ category }) =>
        query.data.category === undefined || category === query.data.category,
    );
    return mockJsonResponse(
      adminAuditResponseSchema,
      {
        eventId: adminFixtureIds.event,
        items,
        pageInfo: { nextCursor: null, hasMore: false },
      },
      successOptions('admin.mock.audit'),
    );
  }),

  http.get('*/api/v1/admin/events/:eventId/settings', ({ params }) => {
    const denied = authorize(
      adminReadProblemSchema,
      ['event:settings:manage'],
      'admin.mock.settings',
    );
    if (denied) return denied;
    if (!routeMatchesEvent(params.eventId)) {
      return mockProblemResponse(
        adminReadProblemSchema,
        adminReadProblemFixtures.not_found,
        { fixtureName: 'admin.mock.settings-not-found' },
      );
    }
    return mockJsonResponse(
      adminEventSettingsSchema,
      state.settings,
      successOptions('admin.mock.settings'),
    );
  }),

  http.put(
    '*/api/v1/admin/events/:eventId/settings',
    async ({ params, request }) => {
      const denied = authorize(
        adminMutationProblemSchema,
        ['event:settings:manage'],
        'admin.mock.settings-update',
      );
      if (denied) return denied;
      const body = adminEventSettingsUpdateRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const attempt = body.success
        ? mutationResult(request, 'admin-settings', body.data)
        : null;
      if (!routeMatchesEvent(params.eventId) || !body.success || !attempt) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.invalid_transition,
          { fixtureName: 'admin.mock.settings-update-invalid' },
        );
      }
      if (
        attempt.kind === 'collision' ||
        scenario(body.data.reason).includes('collision')
      ) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.settings-update-collision' },
        );
      }
      if (attempt.kind === 'replay') {
        return mockJsonResponse(
          adminEventSettingsUpdateResponseSchema,
          replayResponse(attempt.response),
          successOptions('admin.mock.settings-update-replay'),
        );
      }
      if (
        scenario(body.data.reason).includes('stale') &&
        !state.staleScenarios.has('settings')
      ) {
        state.staleScenarios.add('settings');
        state.settings = {
          ...state.settings,
          version: state.settings.version + 1,
        };
        return mockProblemResponse(
          adminMutationProblemSchema,
          {
            ...adminMutationProblemFixtures.stale,
            currentVersion: state.settings.version,
          },
          { fixtureName: 'admin.mock.settings-update-stale' },
        );
      }
      if (body.data.expectedVersion !== state.settings.version) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          {
            ...adminMutationProblemFixtures.stale,
            currentVersion: state.settings.version,
          },
          { fixtureName: 'admin.mock.settings-update-version' },
        );
      }
      state.settings = adminEventSettingsSchema.parse({
        eventId: adminFixtureIds.event,
        ...body.data.settings,
        version: state.settings.version + 1,
      });
      const response = adminEventSettingsUpdateResponseSchema.parse({
        ...clone(adminEventSettingsUpdateFixtures.updated!),
        eventId: adminFixtureIds.event,
        settings: state.settings,
      });
      const transient = transientFailure(
        body.data.reason,
        attempt,
        'admin-settings',
        response,
      );
      if (transient) return transient;
      storeMutation(attempt, 'admin-settings', response);
      return mockJsonResponse(
        adminEventSettingsUpdateResponseSchema,
        response,
        successOptions('admin.mock.settings-update'),
      );
    },
  ),
]);

// Keep fixture-only identifiers inside the mock graph while making explicit
// that admin announcement resources are correlated to the active admin event.
void announcementFixtureIds;
void supportFixtureIds;
