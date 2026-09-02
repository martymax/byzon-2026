import {
  adminEngagementMutationRequestSchema,
  adminEngagementMutationResponseSchema,
  adminEngagementOverviewSchema,
  type AdminEngagementOverview,
} from '@byzon/domain/contracts/admin-engagement';
import {
  adminAnnouncementPreviewProblemSchema,
  adminAnnouncementPreviewRequestSchema,
  adminAnnouncementPreviewResponseSchema,
  adminAnnouncementSendProblemSchema,
  adminAnnouncementSendRequestSchema,
  adminAnnouncementSendResponseSchema,
  adminAnnouncementTargetListResponseSchema,
  adminAnnouncementTargetProblemSchema,
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
  adminRoleAssignmentMutationRequestSchema,
  adminRoleAssignmentMutationResponseSchema,
  adminRoleAssignmentListResponseSchema,
  adminRolePersonSearchRequestSchema,
  adminRolePersonSearchResponseSchema,
  adminRoleScopeOptionsRequestSchema,
  adminRoleScopeOptionsResponseSchema,
  type AdminContextResponse,
  type AdminEventSettings,
  type AdminOperationsOverviewResponse,
  type AdminPermission,
  type AdminReservationRecord,
  type AdminReservationSessionItem,
  type AdminSessionCapacityRecord,
} from '@byzon/domain/contracts/admin';
import {
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
  type AdminParticipantDetail,
  type SupportRecord,
} from '@byzon/domain/contracts/support';
import {
  ticketImportApplyProblemSchema,
  ticketImportApplyRequestSchema,
  ticketImportApplyResponseSchema,
  ticketImportPreviewRequestSchema,
  ticketImportPreviewProblemSchema,
  ticketImportPreviewResponseSchema,
  type TicketImportPreviewResponse,
} from '@byzon/domain/contracts/ticket-import';
import {
  adminAnnouncementPreviewFixtures,
  adminAnnouncementPreviewProblemFixtures,
  adminAnnouncementSendFixtures,
  adminAnnouncementSendProblemFixtures,
  adminAnnouncementTargetFixtures,
  announcementFixtureIds,
} from '@byzon/test-support/fixtures';
import {
  adminAuditFixtures,
  adminContextFixtures,
  adminEngagementOverviewFixtures,
  adminEventSettingsFixtures,
  adminEventSettingsUpdateFixtures,
  adminExportFixtures,
  adminExportJobListFixtures,
  adminExportProblemFixtures,
  adminFixtureIds,
  adminMutationProblemFixtures,
  adminOperationsOverviewFixtures,
  adminReadProblemFixtures,
  adminReservationFixtures,
  adminReservationSessionFixtures,
  adminSessionCapacityFixtures,
  adminReservationMutationFixtures,
  adminSessionCapacityMutationFixtures,
  adminRoleAssignmentFixtures,
  adminRoleAssignmentListFixtures,
  adminRolePersonSearchFixtures,
  adminRoleScopeOptionsFixtures,
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
  engagement: AdminEngagementOverview;
  supportRecords: SupportRecord[];
  participantDetails: AdminParticipantDetail[];
  reservations: AdminReservationRecord[];
  reservationSessions: AdminReservationSessionItem[];
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

const participantDetailFor = (
  record: SupportRecord,
  index: number,
): AdminParticipantDetail =>
  adminParticipantDetailSchema.parse({
    eventId: adminFixtureIds.event,
    participantId: record.participantId,
    ticketId: record.ticketId,
    firstName: index === 0 ? 'Kateřina' : 'Martin',
    lastName: index === 0 ? 'Novotná' : 'Dvořák',
    contactEmail: index === 0 ? 'katerina@example.test' : 'martin@example.test',
    phone: index === 0 ? '+420777123456' : null,
    company: index === 0 ? 'Future Works' : 'Northstar Studio',
    jobTitle: index === 0 ? 'CEO' : 'Product designer',
    introduction:
      index === 0
        ? 'Propojuji technologické firmy s novými obchodními příležitostmi.'
        : 'Navrhuji digitální produkty a hledám inspirativní spolupráce.',
    linkedinUrl:
      index === 0 ? 'https://www.linkedin.com/in/katerina-novotna' : null,
    todayHunting: index === 0 ? ['business_partners', 'clients'] : ['know_how'],
    networkingEnabled: index === 0,
    moderationStatus: 'visible',
    onboardingCompleted: true,
    membershipStatus: 'active',
    invitation:
      index === 0
        ? {
            status: 'accepted',
            lastSentAt: '2026-08-20T09:55:00.000Z',
          }
        : { status: 'not_sent', lastSentAt: null },
    ticket: {
      source: 'ticket',
      referenceSuffix: record.referenceSuffix,
      externalId: `TICKET-${index + 101}`,
      orderExternalId: `ORDER-${index + 51}`,
      state: record.ticketState,
      claimedAt: '2026-08-20T10:00:00.000Z',
      version: record.version,
      availableActions: record.availableActions,
    },
    checkIn: index === 0 ? { occurredAt: '2026-10-16T07:45:00.000Z' } : null,
    reservations: [],
    profileVersion: 1,
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
  });

const initialState = (): AdminMockState => {
  const supportRecords = supportSearchFixtures.ambiguous!.matches.map(
    eventScopedSupportRecord,
  );
  return {
    persona: 'organizer',
    overview: {
      ...clone(adminOperationsOverviewFixtures.healthy!),
      eventId: adminFixtureIds.event,
    },
    engagement: clone(adminEngagementOverviewFixtures.default!),
    supportRecords,
    participantDetails: supportRecords.map(participantDetailFor),
    reservations: clone(adminReservationFixtures.list!.items),
    reservationSessions: clone(adminReservationSessionFixtures.complete!.items),
    sessionCapacities: clone(adminSessionCapacityFixtures.list!.items),
    settings: clone(adminEventSettingsFixtures.open!),
    announcementPreviewId: null,
    announcementPreviewVersion: 1,
    announcementRecipientCount: 0,
    importPreviews: new Map(),
    mutations: new Map(),
    staleScenarios: new Set(),
  };
};

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

const maxPageRequested = (request: Request): boolean => {
  if (request.headers.get('x-byzon-admin-qa') === 'max-page') return true;
  if (!request.referrer) return false;
  try {
    return new URL(request.referrer).searchParams.get('adminQa') === 'max-page';
  } catch {
    return false;
  }
};

const maxPageUuid = (group: number, index: number): string =>
  `019fd000-${group.toString(16).padStart(4, '0')}-7000-8000-${String(index).padStart(12, '0')}`;

const maxPageReservations = () => {
  const reservation = adminReservationFixtures.list!.items[0]!;
  const capacity = adminSessionCapacityFixtures.list!.items[0]!;
  const session = adminReservationSessionFixtures.complete!.items[0]!;
  return Array.from({ length: 100 }, (_, index) => {
    const serial = index + 1;
    const sessionId = maxPageUuid(1, serial);
    const sessionTitle = `Maximální testovací aktivita ${String(serial).padStart(3, '0')}`;
    return {
      reservation: {
        ...reservation,
        reservationId: maxPageUuid(2, serial),
        sessionId,
        sessionTitle,
        participantReference: `Účastník •${String(serial).padStart(3, '0')}`,
        capacity: 100,
        reservedCount: 50 + (serial % 50),
      },
      capacity: {
        ...capacity,
        sessionId,
        sessionTitle,
        capacity: 100,
        confirmedCount: 50 + (serial % 50),
      },
      session: {
        ...session,
        sessionId,
        sessionTitle,
        startsAt: new Date(
          Date.UTC(2026, 8, 18, 7, 0) + index * 60_000,
        ).toISOString(),
        roomLabel: `Sál ${String((index % 8) + 1)}`,
        capacity: 100,
        confirmedCount: 50 + (serial % 50),
        reservations: [
          {
            ...session.reservations[0]!,
            reservationId: maxPageUuid(2, serial),
            maskedParticipantReference: `Účastník •${String(serial).padStart(3, '0')}`,
          },
        ],
      },
    };
  });
};

const maxPageAuditItems = () =>
  Array.from({ length: 100 }, (_, index) => {
    const serial = index + 1;
    return {
      auditId: maxPageUuid(3, serial),
      eventId: adminFixtureIds.event,
      actorLabel: serial % 7 === 0 ? 'Systém BYZON' : 'Oprávněný uživatel',
      category: 'settings' as const,
      action: 'settings.update',
      targetReference: `akce •${String(serial).padStart(3, '0')}`,
      reason: 'Syntetický redigovaný důvod pro max-page QA.',
      outcome: 'succeeded' as const,
      createdAt: new Date(
        Date.UTC(2026, 8, 2, 12, 0) - index * 60_000,
      ).toISOString(),
      resultingVersion: 101 - serial,
      redacted: true,
    };
  });

const maxPageTicketPreview = (): TicketImportPreviewResponse => {
  const fixture = clone(ticketImportPreviewFixtures.simpleshop_readonly!);
  if (fixture.source.kind !== 'simpleshop_api') {
    throw new TypeError('Max-page ticket fixture must use SimpleShop.');
  }
  const base = fixture.rows[0]!;
  const rows = Array.from({ length: 500 }, (_, index) => {
    const serial = index + 1;
    return {
      ...base,
      rowId: maxPageUuid(4, serial),
      sourceRowNumber: serial,
      referenceSuffix: String(serial).padStart(6, '0'),
      sourceTicketId: String(7_100_000 + serial),
      sourceOrderId: String(8_100_000 + serial),
      orderTicketCount: 1,
      orderTicketPosition: 1,
      contactName: `Syntetický účastník ${serial}`,
      contactEmail: `max-page-${serial}@example.test`,
      contactCompany: 'Example test',
      contactPosition: null,
      contactPhone: null,
      discountCoupon: null,
      identitySource: 'named_participant' as const,
      sourceStatus: 'paid' as const,
      status: 'new' as const,
      incomingState: 'active' as const,
      currentState: null,
      issues: [],
    };
  });
  return ticketImportPreviewResponseSchema.parse({
    ...fixture,
    source: {
      ...fixture.source,
      sourceRows: 500,
      ticketRows: 500,
      ignoredSummaryRows: 0,
      multipleQuantitySummaryRows: 0,
      observedStatuses: {
        paid: 500,
        unpaid: 0,
        cancelled: 0,
        refunded: 0,
        unknown: 0,
      },
      codeShape: { ...fixture.source.codeShape, count: 500 },
    },
    rows,
    summary: {
      total: 500,
      new: 500,
      unchanged: 0,
      statusChanged: 0,
      excluded: 0,
      conflict: 0,
      unknown: 0,
    },
  });
};

const maxPageSupportRecords = (): readonly SupportRecord[] => {
  const base = state.supportRecords[0]!;
  return Array.from({ length: 5 }, (_, index) => {
    const serial = index + 1;
    return {
      ...base,
      participantId: maxPageUuid(5, serial),
      ticketId: maxPageUuid(6, serial),
      displayName: `Syntetický účastník ${serial}`,
      maskedContact: `s${serial}•••@example.test`,
      referenceSuffix: `M${String(serial).padStart(3, '0')}`,
    };
  });
};

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
  body: z.output<typeof adminReservationMutationRequestSchema>,
): AdminReservationRecord => ({
  ...record,
  capacity:
    body.action === 'capacity_override' ? body.capacity : record.capacity,
  version: record.version + 1,
  state: body.action === 'capacity_override' ? 'reserved' : 'cancelled',
  availableActions:
    body.action === 'capacity_override'
      ? ['capacity_override', 'cancel_reservation']
      : [],
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

  http.get('*/api/v1/admin/events/:eventId/engagement', ({ params }) => {
    const denied = authorize(
      adminReadProblemSchema,
      [
        'event:settings:manage',
        'participant:operational:read',
        'program:manage',
        'role:manage',
      ],
      'admin.mock.engagement',
    );
    if (denied) return denied;
    if (!routeMatchesEvent(params.eventId)) {
      return mockProblemResponse(
        adminReadProblemSchema,
        adminReadProblemFixtures.not_found,
        { fixtureName: 'admin.mock.engagement-not-found' },
      );
    }
    return mockJsonResponse(
      adminEngagementOverviewSchema,
      state.engagement,
      successOptions('admin.mock.engagement'),
    );
  }),

  http.post(
    '*/api/v1/admin/events/:eventId/engagement',
    async ({ params, request }) => {
      const denied = authorize(
        adminMutationProblemSchema,
        [
          'event:settings:manage',
          'participant:operational:read',
          'program:manage',
          'role:manage',
        ],
        'admin.mock.engagement-update',
      );
      if (denied) return denied;
      const body = adminEngagementMutationRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const attempt = body.success
        ? mutationResult(request, 'admin-engagement', body.data)
        : null;
      if (!routeMatchesEvent(params.eventId) || !body.success || !attempt) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.invalid_transition,
          { fixtureName: 'admin.mock.engagement-invalid' },
        );
      }
      const mutation = body.data;
      if (
        attempt.kind === 'collision' ||
        scenario(mutation.reason).includes('collision')
      ) {
        return mockProblemResponse(
          adminMutationProblemSchema,
          adminMutationProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.engagement-collision' },
        );
      }
      if (attempt.kind === 'replay') {
        return mockJsonResponse(
          adminEngagementMutationResponseSchema,
          replayResponse(attempt.response),
          successOptions('admin.mock.engagement-replay'),
        );
      }
      if (
        scenario(mutation.reason).includes('stale') &&
        !state.staleScenarios.has('engagement')
      ) {
        state.staleScenarios.add('engagement');
        return mockProblemResponse(
          adminMutationProblemSchema,
          {
            ...adminMutationProblemFixtures.stale,
            currentVersion:
              mutation.action === 'update_features'
                ? state.engagement.settingsVersion
                : mutation.action === 'set_session_questions'
                  ? (state.engagement.sessions.find(
                      ({ sessionId }) => sessionId === mutation.sessionId,
                    )?.version ?? 1)
                  : state.engagement.assignmentsVersion,
          },
          { fixtureName: 'admin.mock.engagement-stale' },
        );
      }

      let response: z.input<typeof adminEngagementMutationResponseSchema>;
      if (mutation.action === 'update_features') {
        if (
          mutation.expectedSettingsVersion !== state.engagement.settingsVersion
        ) {
          return mockProblemResponse(
            adminMutationProblemSchema,
            {
              ...adminMutationProblemFixtures.stale,
              currentVersion: state.engagement.settingsVersion,
            },
            { fixtureName: 'admin.mock.engagement-features-version' },
          );
        }
        state.engagement = adminEngagementOverviewSchema.parse({
          ...state.engagement,
          settingsVersion: state.engagement.settingsVersion + 1,
          features: mutation.features,
        });
        response = {
          action: mutation.action,
          eventId: adminFixtureIds.event,
          outcome: 'updated',
          settingsVersion: state.engagement.settingsVersion,
          features: mutation.features,
          changedAt: '2026-07-25T12:30:00.000+02:00',
          audit: { auditId: adminFixtureIds.auditMutation },
        };
      } else if (mutation.action === 'set_session_questions') {
        const session = state.engagement.sessions.find(
          ({ sessionId }) => sessionId === mutation.sessionId,
        );
        if (!session || session.version !== mutation.expectedSessionVersion) {
          return mockProblemResponse(
            adminMutationProblemSchema,
            {
              ...adminMutationProblemFixtures.stale,
              currentVersion: session?.version ?? 1,
            },
            { fixtureName: 'admin.mock.engagement-session-version' },
          );
        }
        const nextSession = {
          ...session,
          questionsEnabled: mutation.enabled,
          version: session.version + 1,
        };
        state.engagement = adminEngagementOverviewSchema.parse({
          ...state.engagement,
          sessions: state.engagement.sessions.map((item) =>
            item.sessionId === nextSession.sessionId ? nextSession : item,
          ),
        });
        response = {
          action: mutation.action,
          eventId: adminFixtureIds.event,
          outcome: 'updated',
          session: {
            sessionId: nextSession.sessionId,
            questionsEnabled: nextSession.questionsEnabled,
            version: nextSession.version,
          },
          changedAt: '2026-07-25T12:31:00.000+02:00',
          audit: { auditId: adminFixtureIds.auditMutation },
        };
      } else {
        if (
          mutation.expectedAssignmentsVersion !==
          state.engagement.assignmentsVersion
        ) {
          return mockProblemResponse(
            adminMutationProblemSchema,
            {
              ...adminMutationProblemFixtures.stale,
              currentVersion: state.engagement.assignmentsVersion,
            },
            { fixtureName: 'admin.mock.engagement-role-version' },
          );
        }
        const candidate = state.engagement.moderatorCandidates.find(
          ({ userId }) => userId === mutation.userId,
        );
        const session = state.engagement.sessions.find(
          ({ sessionId }) => sessionId === mutation.sessionId,
        );
        if (!candidate || !session) {
          return mockProblemResponse(
            adminMutationProblemSchema,
            adminMutationProblemFixtures.invalid_transition,
            { fixtureName: 'admin.mock.engagement-role-target' },
          );
        }
        const alreadyAssigned = session.moderators.some(
          ({ userId }) => userId === candidate.userId,
        );
        const alreadyApplied =
          mutation.action === 'assign_moderator'
            ? alreadyAssigned
            : !alreadyAssigned;
        const moderators =
          mutation.action === 'assign_moderator'
            ? alreadyAssigned
              ? session.moderators
              : [
                  ...session.moderators,
                  {
                    assignmentId: adminFixtureIds.assignment,
                    ...candidate,
                  },
                ]
            : session.moderators.filter(
                ({ userId }) => userId !== candidate.userId,
              );
        const assignmentsVersion =
          state.engagement.assignmentsVersion + (alreadyApplied ? 0 : 1);
        state.engagement = adminEngagementOverviewSchema.parse({
          ...state.engagement,
          assignmentsVersion,
          sessions: state.engagement.sessions.map((item) =>
            item.sessionId === session.sessionId
              ? { ...item, moderators }
              : item,
          ),
        });
        response = {
          action: mutation.action,
          eventId: adminFixtureIds.event,
          outcome: alreadyApplied ? 'already_applied' : 'updated',
          assignmentsVersion,
          assignment:
            mutation.action === 'assign_moderator'
              ? {
                  sessionId: session.sessionId,
                  userId: candidate.userId,
                  displayName: candidate.displayName,
                  maskedContact: candidate.maskedContact,
                }
              : null,
          changedAt: '2026-07-25T12:32:00.000+02:00',
          audit: { auditId: adminFixtureIds.auditMutation },
        };
      }
      const parsedResponse =
        adminEngagementMutationResponseSchema.parse(response);
      const transient = transientFailure(
        mutation.reason,
        attempt,
        'admin-engagement',
        parsedResponse,
      );
      if (transient) return transient;
      storeMutation(attempt, 'admin-engagement', parsedResponse);
      return mockJsonResponse(
        adminEngagementMutationResponseSchema,
        parsedResponse,
        successOptions('admin.mock.engagement-update'),
      );
    },
  ),

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
      state.reservationSessions = state.reservationSessions.map((session) =>
        session.sessionId === record.sessionId
          ? {
              ...session,
              capacity: body.data.capacity,
              capacityVersion: next.version,
            }
          : session,
      );
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
      const body = ticketImportPreviewRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      if (!body.success) {
        return mockProblemResponse(
          ticketImportPreviewProblemSchema,
          ticketImportPreviewProblemFixtures.validation,
          { fixtureName: 'admin.mock.import-preview-body' },
        );
      }
      const preview = ticketImportPreviewResponseSchema.parse({
        ...(maxPageRequested(request)
          ? maxPageTicketPreview()
          : clone(ticketImportPreviewFixtures.simpleshop_readonly!)),
        eventId: adminFixtureIds.event,
      });
      state.importPreviews.set(preview.previewId, {
        preview,
        scenario: body.data.source,
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
      const selectedRows = body.data.selectedRowIds.map((rowId) =>
        storedPreview.preview.rows.find((row) => row.rowId === rowId),
      );
      if (
        selectedRows.some(
          (row) =>
            !row ||
            row.status !== 'new' ||
            row.sourceStatus !== 'paid' ||
            row.issues.length > 0,
        )
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
        selectedRowIds: body.data.selectedRowIds,
        result: {
          created: selectedRows.length,
          statusChanged: 0,
          unchanged: 0,
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
    '*/api/v1/admin/events/:eventId/participants/list',
    async ({ params, request }) => {
      const denied = authorize(
        supportSearchProblemSchema,
        ['participant:operational:read'],
        'admin.mock.participant-list',
      );
      if (denied) return denied;
      const body = adminParticipantListRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      if (!routeMatchesEvent(params.eventId) || !body.success) {
        return mockProblemResponse(
          supportSearchProblemSchema,
          supportSearchProblemFixtures.validation,
          { fixtureName: 'admin.mock.participant-list-validation' },
        );
      }
      const normalizedQuery = body.data.query.toLocaleLowerCase('cs');
      const candidates = state.participantDetails.flatMap((detail) => {
        const ticket = state.supportRecords.find(
          ({ participantId }) => participantId === detail.participantId,
        );
        if (!ticket) return [];
        const networkingState =
          detail.moderationStatus === 'hidden'
            ? ('moderated' as const)
            : detail.networkingEnabled
              ? ('enabled' as const)
              : ('disabled' as const);
        const searchable = [
          detail.firstName,
          detail.lastName,
          detail.contactEmail,
          detail.company,
          detail.jobTitle,
          ticket.referenceSuffix,
        ]
          .join(' ')
          .toLocaleLowerCase('cs');
        if (
          (normalizedQuery && !searchable.includes(normalizedQuery)) ||
          (body.data.ticketStates.length > 0 &&
            !body.data.ticketStates.includes(ticket.ticketState)) ||
          (body.data.networkingStates.length > 0 &&
            !body.data.networkingStates.includes(networkingState))
        ) {
          return [];
        }
        return [
          {
            eventId: adminFixtureIds.event,
            participantId: detail.participantId,
            ticketId: detail.ticketId,
            displayName: `${detail.firstName} ${detail.lastName}`,
            contactEmail: detail.contactEmail,
            company: detail.company,
            jobTitle: detail.jobTitle,
            referenceSuffix: ticket.referenceSuffix,
            ticketState: ticket.ticketState,
            accessState: ticket.accessState,
            networkingState,
            invitation: detail.invitation,
            checkedIn: detail.checkIn !== null,
            reservationCount: detail.reservations.filter(
              ({ status }) => status === 'confirmed',
            ).length,
            profileVersion: detail.profileVersion,
            ticketVersion: ticket.version,
            updatedAt: detail.updatedAt,
            availableActions: ticket.availableActions,
          },
        ];
      });
      const page = candidates.slice(
        body.data.offset,
        body.data.offset + body.data.limit,
      );
      return mockJsonResponse(
        adminParticipantListResponseSchema,
        {
          eventId: adminFixtureIds.event,
          generatedAt: '2026-09-02T10:00:00.000Z',
          items: page,
          pageInfo: {
            total: candidates.length,
            offset: body.data.offset,
            hasMore: body.data.offset + page.length < candidates.length,
          },
          summary: {
            total: state.participantDetails.length,
            active: state.supportRecords.filter(
              ({ ticketState }) => ticketState === 'active',
            ).length,
            networkingEnabled: state.participantDetails.filter(
              ({ networkingEnabled, moderationStatus }) =>
                networkingEnabled && moderationStatus === 'visible',
            ).length,
            checkedIn: state.participantDetails.filter(
              ({ checkIn }) => checkIn !== null,
            ).length,
          },
        },
        successOptions('admin.mock.participant-list'),
      );
    },
  ),

  http.get(
    '*/api/v1/admin/events/:eventId/participants/:participantId',
    ({ params }) => {
      const denied = authorize(
        adminParticipantReadProblemSchema,
        ['participant:operational:read'],
        'admin.mock.participant-detail',
      );
      if (denied) return denied;
      const detail = state.participantDetails.find(
        ({ participantId }) => participantId === params.participantId,
      );
      const ticket = state.supportRecords.find(
        ({ participantId }) => participantId === params.participantId,
      );
      if (!routeMatchesEvent(params.eventId) || !detail || !ticket) {
        return mockProblemResponse(
          adminParticipantReadProblemSchema,
          supportMutationProblemFixtures.not_found,
          { fixtureName: 'admin.mock.participant-detail-not-found' },
        );
      }
      return mockJsonResponse(
        adminParticipantDetailSchema,
        {
          ...detail,
          ticket: {
            ...detail.ticket,
            state: ticket.ticketState,
            version: ticket.version,
            availableActions: ticket.availableActions,
          },
        },
        successOptions('admin.mock.participant-detail'),
      );
    },
  ),

  http.patch(
    '*/api/v1/admin/events/:eventId/participants/:participantId',
    async ({ params, request }) => {
      const denied = authorize(
        supportMutationProblemSchema,
        ['ticket:any:manage'],
        'admin.mock.participant-update',
      );
      if (denied) return denied;
      const body = adminParticipantUpdateRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const attempt = body.success
        ? mutationResult(request, 'participant-update', body.data)
        : null;
      const index = state.participantDetails.findIndex(
        ({ participantId }) => participantId === params.participantId,
      );
      const current = state.participantDetails[index];
      if (
        !routeMatchesEvent(params.eventId) ||
        !body.success ||
        !attempt ||
        !current ||
        body.data.participantId !== params.participantId
      ) {
        return mockProblemResponse(
          supportMutationProblemSchema,
          supportMutationProblemFixtures.not_found,
          { fixtureName: 'admin.mock.participant-update-invalid' },
        );
      }
      if (attempt.kind === 'replay') {
        return mockJsonResponse(
          adminParticipantUpdateResponseSchema,
          replayResponse(attempt.response),
          successOptions('admin.mock.participant-update-replay'),
        );
      }
      if (attempt.kind === 'collision') {
        return mockProblemResponse(
          supportMutationProblemSchema,
          supportMutationProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.participant-update-collision' },
        );
      }
      if (body.data.expectedProfileVersion !== current.profileVersion) {
        return mockProblemResponse(
          supportMutationProblemSchema,
          {
            ...supportMutationProblemFixtures.stale,
            currentVersion: current.profileVersion,
          },
          { fixtureName: 'admin.mock.participant-update-stale' },
        );
      }
      const next = adminParticipantDetailSchema.parse({
        ...current,
        ...body.data.profile,
        introduction: body.data.profile.introduction,
        profileVersion: current.profileVersion + 1,
        updatedAt: '2026-09-02T10:01:00.000Z',
      });
      state.participantDetails[index] = next;
      const supportIndex = state.supportRecords.findIndex(
        ({ participantId }) => participantId === next.participantId,
      );
      if (supportIndex >= 0) {
        state.supportRecords[supportIndex] = {
          ...state.supportRecords[supportIndex]!,
          displayName: `${next.firstName} ${next.lastName}`,
        };
      }
      const response = adminParticipantUpdateResponseSchema.parse({
        eventId: adminFixtureIds.event,
        outcome: 'updated',
        detail: next,
        changedAt: '2026-09-02T10:01:00.000Z',
        audit: supportMutationFixtures.blocked!.audit,
      });
      storeMutation(attempt, 'participant-update', response);
      return mockJsonResponse(
        adminParticipantUpdateResponseSchema,
        response,
        successOptions('admin.mock.participant-update'),
      );
    },
  ),

  http.post(
    '*/api/v1/admin/events/:eventId/participants/:participantId/invite',
    async ({ params, request }) => {
      const denied = authorize(
        adminParticipantInviteProblemSchema,
        ['ticket:any:manage'],
        'admin.mock.participant-invite',
      );
      if (denied) return denied;
      const body = adminParticipantInviteRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      const attempt = body.success
        ? mutationResult(request, 'participant-invite', body.data)
        : null;
      const index = state.participantDetails.findIndex(
        ({ participantId }) => participantId === params.participantId,
      );
      const current = state.participantDetails[index];
      if (
        !routeMatchesEvent(params.eventId) ||
        !body.success ||
        !attempt ||
        !current ||
        body.data.participantId !== params.participantId
      ) {
        return mockProblemResponse(
          adminParticipantInviteProblemSchema,
          supportMutationProblemFixtures.not_found,
          { fixtureName: 'admin.mock.participant-invite-invalid' },
        );
      }
      if (attempt.kind === 'replay') {
        return mockJsonResponse(
          adminParticipantInviteResponseSchema,
          replayResponse(attempt.response),
          successOptions('admin.mock.participant-invite-replay'),
        );
      }
      if (attempt.kind === 'collision') {
        return mockProblemResponse(
          adminParticipantInviteProblemSchema,
          supportMutationProblemFixtures.key_reused,
          { fixtureName: 'admin.mock.participant-invite-collision' },
        );
      }
      const sentAt = '2026-09-02T10:02:00.000Z';
      const invitation = {
        status:
          current.invitation.status === 'accepted'
            ? ('accepted' as const)
            : ('sent' as const),
        lastSentAt: sentAt,
      };
      state.participantDetails[index] = { ...current, invitation };
      const response = adminParticipantInviteResponseSchema.parse({
        eventId: adminFixtureIds.event,
        participantId: current.participantId,
        outcome: 'sent',
        sentAt,
        invitation,
        audit: supportMutationFixtures.blocked!.audit,
      });
      storeMutation(attempt, 'participant-invite', response);
      return mockJsonResponse(
        adminParticipantInviteResponseSchema,
        response,
        successOptions('admin.mock.participant-invite'),
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
      const response = maxPageRequested(request)
        ? {
            eventId: adminFixtureIds.event,
            limitedTo: 5 as const,
            outcome: 'ambiguous' as const,
            matches: maxPageSupportRecords(),
          }
        : currentSupportResponse(query.data.query);
      return mockJsonResponse(
        supportSearchResponseSchema,
        response,
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

  http.get('*/api/v1/admin/events/:eventId/exports', ({ params }) => {
    const denied = authorize(
      adminReadProblemSchema,
      ['personal-data:operational:export'],
      'admin.mock.export-jobs',
    );
    if (denied) return denied;
    if (!routeMatchesEvent(params.eventId)) {
      return mockProblemResponse(
        adminReadProblemSchema,
        adminReadProblemFixtures.not_found,
        { fixtureName: 'admin.mock.export-jobs-invalid' },
      );
    }
    return mockJsonResponse(
      adminExportJobListResponseSchema,
      adminExportJobListFixtures.mixed!,
      successOptions('admin.mock.export-jobs'),
    );
  }),

  http.get(
    '*/api/v1/admin/events/:eventId/announcements/targets',
    ({ params }) => {
      const denied = authorize(
        adminAnnouncementTargetProblemSchema,
        ['announcement:send'],
        'admin.mock.announcement-targets',
      );
      if (denied) return denied;
      if (!routeMatchesEvent(params.eventId)) {
        return mockProblemResponse(
          adminAnnouncementTargetProblemSchema,
          adminAnnouncementPreviewProblemFixtures.permission,
          { fixtureName: 'admin.mock.announcement-targets-event' },
        );
      }
      return mockJsonResponse(
        adminAnnouncementTargetListResponseSchema,
        {
          ...clone(adminAnnouncementTargetFixtures.available!),
          eventId: adminFixtureIds.event,
        },
        successOptions('admin.mock.announcement-targets'),
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

  http.get('*/api/v1/admin/events/:eventId/role-assignments', ({ params }) => {
    const denied = authorize(
      adminReadProblemSchema,
      ['role:manage'],
      'admin.mock.role-list',
    );
    if (denied) return denied;
    if (!routeMatchesEvent(params.eventId)) {
      return mockProblemResponse(
        adminReadProblemSchema,
        adminReadProblemFixtures.permission,
        { fixtureName: 'admin.mock.role-list-event' },
      );
    }
    return mockJsonResponse(
      adminRoleAssignmentListResponseSchema,
      adminRoleAssignmentListFixtures.list!,
      successOptions('admin.mock.role-list'),
    );
  }),

  http.post(
    '*/api/v1/admin/events/:eventId/role-assignments/search',
    async ({ params, request }) => {
      const denied = authorize(
        adminReadProblemSchema,
        ['role:manage'],
        'admin.mock.role-search',
      );
      if (denied) return denied;
      const body = adminRolePersonSearchRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      if (!routeMatchesEvent(params.eventId) || !body.success) {
        return mockProblemResponse(
          adminReadProblemSchema,
          adminReadProblemFixtures.validation,
          { fixtureName: 'admin.mock.role-search-invalid' },
        );
      }
      return mockJsonResponse(
        adminRolePersonSearchResponseSchema,
        body.data.query.toLocaleLowerCase('cs-CZ').includes('nikdo')
          ? adminRolePersonSearchFixtures.empty!
          : adminRolePersonSearchFixtures.found!,
        successOptions('admin.mock.role-search'),
      );
    },
  ),

  http.post(
    '*/api/v1/admin/events/:eventId/role-assignments/scope-options',
    async ({ params, request }) => {
      const denied = authorize(
        adminReadProblemSchema,
        ['role:manage'],
        'admin.mock.role-scopes',
      );
      if (denied) return denied;
      const body = adminRoleScopeOptionsRequestSchema.safeParse(
        await request.json().catch(() => undefined),
      );
      if (!routeMatchesEvent(params.eventId) || !body.success) {
        return mockProblemResponse(
          adminReadProblemSchema,
          adminReadProblemFixtures.validation,
          { fixtureName: 'admin.mock.role-scopes-invalid' },
        );
      }
      const fixture =
        body.data.role === 'checkin_operator'
          ? adminRoleScopeOptionsFixtures.checkin!
          : body.data.role === 'moderator'
            ? adminRoleScopeOptionsFixtures.moderator!
            : adminRoleScopeOptionsFixtures.activity_leader!;
      return mockJsonResponse(
        adminRoleScopeOptionsResponseSchema,
        fixture,
        successOptions('admin.mock.role-scopes'),
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

  http.get(
    '*/api/v1/admin/events/:eventId/reservation-sessions',
    ({ params, request }) => {
      const denied = authorize(
        adminReadProblemSchema,
        ['reservation:any:read'],
        'admin.mock.reservation-sessions',
      );
      if (denied) return denied;
      const url = new URL(request.url);
      const query = adminReservationSessionQuerySchema.safeParse({
        ...(url.searchParams.get('cursor')
          ? { cursor: url.searchParams.get('cursor') }
          : {}),
        ...(url.searchParams.get('limit')
          ? { limit: Number(url.searchParams.get('limit')) }
          : {}),
      });
      if (!routeMatchesEvent(params.eventId) || !query.success) {
        return mockProblemResponse(
          adminReadProblemSchema,
          adminReadProblemFixtures.validation,
          { fixtureName: 'admin.mock.reservation-sessions-validation' },
        );
      }
      const allItems = maxPageRequested(request)
        ? maxPageReservations().map(({ session }) => session)
        : state.reservationSessions;
      const cursorMatch = /^mock-reservation-session-(\d+)$/.exec(
        query.data.cursor ?? '',
      );
      const offset = cursorMatch ? Number(cursorMatch[1]) : 0;
      const items = allItems.slice(offset, offset + query.data.limit);
      const nextOffset = offset + items.length;
      const hasMore = nextOffset < allItems.length;
      return mockJsonResponse(
        adminReservationSessionPageSchema,
        {
          eventId: adminFixtureIds.event,
          generatedAt: '2026-09-02T12:00:00.000+02:00',
          items,
          pageInfo: {
            hasMore,
            nextCursor: hasMore
              ? `mock-reservation-session-${nextOffset}`
              : null,
          },
        },
        successOptions('admin.mock.reservation-sessions'),
      );
    },
  ),

  http.get(
    '*/api/v1/admin/events/:eventId/reservations',
    ({ params, request }) => {
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
      const items = maxPageRequested(request)
        ? maxPageReservations().map(({ reservation }) => reservation)
        : state.reservations;
      return mockJsonResponse(
        adminReservationListResponseSchema,
        {
          ...clone(adminReservationFixtures.list!),
          eventId: adminFixtureIds.event,
          items,
        },
        successOptions('admin.mock.reservations'),
      );
    },
  ),

  http.get(
    '*/api/v1/admin/events/:eventId/session-capacities',
    ({ params, request }) => {
      const denied = authorize(
        adminReadProblemSchema,
        ['reservation:any:read'],
        'admin.mock.session-capacities',
      );
      if (denied) return denied;
      if (!routeMatchesEvent(params.eventId)) {
        return mockProblemResponse(
          adminReadProblemSchema,
          adminReadProblemFixtures.not_found,
          { fixtureName: 'admin.mock.session-capacities-not-found' },
        );
      }
      const items = maxPageRequested(request)
        ? maxPageReservations().map(({ capacity }) => capacity)
        : state.sessionCapacities;
      return mockJsonResponse(
        adminSessionCapacityListResponseSchema,
        {
          ...clone(adminSessionCapacityFixtures.list!),
          eventId: adminFixtureIds.event,
          items,
        },
        successOptions('admin.mock.session-capacities'),
      );
    },
  ),

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
      let next = reservationAfter(record, body.data);
      if (body.data.action === 'capacity_override') {
        const legacyCapacity = body.data.capacity;
        const capacityIndex = state.sessionCapacities.findIndex(
          ({ sessionId }) => sessionId === record.sessionId,
        );
        const capacityRecord = state.sessionCapacities[capacityIndex];
        if (
          !capacityRecord ||
          legacyCapacity < capacityRecord.confirmedCount ||
          capacityRecord.sessionStatus === 'cancelled' ||
          capacityRecord.sessionStatus === 'archived'
        ) {
          return mockProblemResponse(
            adminMutationProblemSchema,
            adminMutationProblemFixtures.invalid_transition,
            { fixtureName: 'admin.mock.reservation-legacy-capacity-state' },
          );
        }
        state.sessionCapacities[capacityIndex] = {
          ...capacityRecord,
          capacity: legacyCapacity,
          version: capacityRecord.version + 1,
        };
        state.reservations = state.reservations.map((reservation) =>
          reservation.sessionId === record.sessionId
            ? {
                ...reservation,
                capacity: legacyCapacity,
                version: reservation.version + 1,
              }
            : reservation,
        );
        next = state.reservations[index]!;
      } else {
        state.reservations[index] = next;
        state.reservationSessions = state.reservationSessions.map((session) =>
          session.sessionId === record.sessionId
            ? {
                ...session,
                reservations: session.reservations.map((reservation) =>
                  reservation.reservationId === record.reservationId
                    ? {
                        ...reservation,
                        state: 'cancelled' as const,
                        version: next.version,
                        availableActions: [] as const,
                      }
                    : reservation,
                ),
              }
            : session,
        );
      }
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
    const items = (
      query.data.requestId === 'admin-qa-max-page'
        ? maxPageAuditItems()
        : adminAuditFixtures.page!.items
    ).filter(
      (item) =>
        (query.data.category === undefined ||
          item.category === query.data.category) &&
        (query.data.action === undefined ||
          item.action === query.data.action) &&
        (query.data.actor === undefined ||
          (query.data.actor === 'system'
            ? item.actorLabel === 'Systém BYZON'
            : item.actorLabel !== 'Systém BYZON')) &&
        (query.data.outcome === undefined ||
          item.outcome === query.data.outcome),
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
