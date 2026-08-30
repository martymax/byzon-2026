import {
  activationClaimProblemSchema,
  activationClaimRequestSchema,
  activationClaimResponseSchema,
  activationIdentityProblemSchema,
  activationIdentityRequestSchema,
  activationIdentityResponseSchema,
  activationLandingResponseSchema,
  activationLinkProblemSchema,
  activationLinkRequestSchema,
  activationLinkResponseSchema,
  activationRecoveryProblemSchema,
  activationRecoveryRequestSchema,
  activationRecoveryResponseSchema,
  announcementInboxQuerySchema,
  idempotencyKeySchema,
  identityBootstrapProblemSchema,
  identityBootstrapResponseSchema,
  identityOnboardingProblemSchema,
  identityOnboardingRequestSchema,
  identityOnboardingResponseSchema,
  identityPrivacyRequestProblemSchema,
  identityPrivacyRequestRequestSchema,
  identityPrivacyRequestResponseSchema,
  identityProfileUpdateProblemSchema,
  identityProfileUpdateRequestSchema,
  identityProfileUpdateResponseSchema,
  identitySessionActionProblemSchema,
  identitySessionActionRequestSchema,
  identitySessionActionResponseSchema,
  participantAnnouncementDetailProblemSchema,
  participantAnnouncementDetailResponseSchema,
  participantAnnouncementInboxProblemSchema,
  participantAnnouncementInboxResponseSchema,
  participantAnnouncementParamsSchema,
  participantAnnouncementReadProblemSchema,
  participantAnnouncementReadResponseSchema,
  participantAgendaMutationProblemSchema,
  participantAgendaMutationRequestSchema,
  participantAgendaMutationResponseSchema,
  participantAgendaCalendar,
  participantAgendaProblemSchema,
  participantAgendaResponseSchema,
  participantContentProblemSchema,
  participantContentResponseSchema,
  participantActivationReturnToSchema,
  participantProgramProblemSchema,
  participantProgramResponseSchema,
  participantTicketProblemSchema,
  participantTicketResponseSchema,
  type ActivationLinkResponse,
  type AgendaSessionSnapshot,
  type ParticipantAgendaItem,
  type ParticipantAgendaMutationProblem,
  type ParticipantAgendaMutationResponse,
} from '@byzon/domain/contracts';
import {
  activationClaimFixtures,
  activationClaimProblemFixtures,
  activationFixtureCode,
  activationFixtureFlowId,
  activationFixtureRecoveryCode,
  activationIdentityFixtures,
  activationIdentityProblemFixtures,
  activationLandingFixtures,
  activationLinkProblemFixtures,
  activationRecoveryFixtures,
  activationRecoveryProblemFixtures,
  announcementFixtureIds,
  agendaFixtureIds,
  contentFixtureIds,
  identityBootstrapFixtures,
  identityBootstrapProblemFixtures,
  identityFixtureIds,
  identityFixtureProfile,
  identityOnboardingFixtures,
  identityOnboardingProblemFixtures,
  identityPrivacyRequestFixtures,
  identityPrivacyRequestProblemFixtures,
  identityProfileUpdateFixtures,
  identityProfileUpdateProblemFixtures,
  identitySessionActionFixtures,
  identitySessionActionProblemFixtures,
  participantContentFixtures,
  participantContentProblemFixtures,
  participantAnnouncementDetailFixtures,
  participantAnnouncementDetailProblemFixtures,
  participantAnnouncementInboxFixtures,
  participantAnnouncementInboxProblemFixtures,
  participantAnnouncementReadFixtures,
  participantAnnouncementReadProblemFixtures,
  participantAgendaFixtures,
  participantAgendaMutationProblemFixtures,
  participantAgendaProblemFixtures,
  participantProgramFixtures,
  participantProgramProblemFixtures,
  participantTicketFixtures,
  participantTicketProblemFixtures,
} from '@byzon/test-support/fixtures';
import { http, HttpResponse, type RequestHandler } from 'msw';

import { adminMockHandlers } from './admin-handlers';
import { checkinMockHandlers } from './checkin-handlers';
import { mockJsonResponse, mockProblemResponse } from './response';

export { resetMockCheckinState } from './checkin-handlers';
export { resetMockAdminState } from './admin-handlers';

interface MockActivationState {
  claimed: boolean;
  currentPrincipal: 'primary' | 'alternate';
  principalActive: boolean;
  recoveryPrincipal: 'primary' | 'alternate';
  sessionGeneration: number;
  signedOut: boolean;
  claims: Map<
    string,
    {
      fingerprint: string;
      outcome: 'identity_required' | 'recovery_required';
    }
  >;
  identities: Map<
    string,
    {
      fingerprint: string;
    }
  >;
  recoveries: Map<
    string,
    {
      fingerprint: string;
    }
  >;
  linkConsumptions: Map<
    string,
    {
      response: ActivationLinkResponse;
      tokenFingerprint: string;
    }
  >;
  consumedLinkFingerprints: Set<string>;
  sessionActions: Map<
    string,
    {
      action: 'logout_current' | 'logout_all' | 'switch_account';
      principal: 'primary' | 'alternate';
      sessionGeneration: number;
    }
  >;
  onboardingRequests: Map<
    string,
    {
      fingerprint: string;
      principal: 'primary' | 'alternate';
      profile: {
        firstName: string;
        lastName: string;
        contactEmail: string;
        phone?: string | null;
      };
      sessionGeneration: number;
    }
  >;
  onboarding?: {
    profile: {
      firstName: string;
      lastName: string;
      contactEmail: string;
      phone?: string | null;
    };
  };
}

interface MockAnnouncementState {
  featureEnabled: boolean;
  readonly recipientAnnouncementIds: Set<string>;
  readonly readAtById: Map<string, string>;
  readonly readRequests: Map<
    string,
    {
      fingerprint: string;
      response: NonNullable<
        (typeof participantAnnouncementReadFixtures)['success']
      >;
    }
  >;
}

type MockIdentityProfile = {
  firstName: string;
  lastName: string;
  contactEmail: string;
  phone?: string | null;
};

type MockPrivacyRequestKind = 'data_deletion';
type MockPrivacyRequestResponse = NonNullable<
  (typeof identityPrivacyRequestFixtures)['deletion_pending']
>;

interface MockIdentityState {
  eventAccess: boolean;
  profile: MockIdentityProfile | null;
  profileManagementState: 'missing' | 'editable' | 'read_only' | 'removed';
  profileVersion: number;
  profileUpdatedAt: string;
  readonly privacyRequests: Map<
    string,
    {
      fingerprint: string;
      response: MockPrivacyRequestResponse;
    }
  >;
  readonly privacyRequestByKind: Map<
    MockPrivacyRequestKind,
    MockPrivacyRequestResponse
  >;
}

type MockAgendaStoredResult =
  | {
      readonly kind: 'success';
      readonly response: ParticipantAgendaMutationResponse;
    }
  | {
      readonly kind: 'problem';
      readonly problem: ParticipantAgendaMutationProblem;
    };

interface MockAgendaState {
  featureEnabled: boolean;
  ticketActive: boolean;
  version: number;
  items: ParticipantAgendaItem[];
  readonly actionRequests: Map<
    string,
    {
      fingerprint: string;
      result: MockAgendaStoredResult;
    }
  >;
  readonly actionFingerprints: Map<string, string>;
  readonly inFlightActionRequests: Map<
    string,
    {
      fingerprint: string;
      result: Promise<MockAgendaStoredResult | null>;
    }
  >;
}

const defaultRecipientAnnouncementIds = Object.freeze([
  announcementFixtureIds.critical,
  announcementFixtureIds.important,
  announcementFixtureIds.information,
]);

const mockActivationState: MockActivationState = {
  claimed: false,
  currentPrincipal: 'primary',
  principalActive: false,
  recoveryPrincipal: 'primary',
  sessionGeneration: 0,
  signedOut: false,
  claims: new Map(),
  identities: new Map(),
  recoveries: new Map(),
  linkConsumptions: new Map(),
  consumedLinkFingerprints: new Set(),
  sessionActions: new Map(),
  onboardingRequests: new Map(),
};

const mockAnnouncementState: MockAnnouncementState = {
  featureEnabled: true,
  recipientAnnouncementIds: new Set(defaultRecipientAnnouncementIds),
  readAtById: new Map([
    [
      announcementFixtureIds.information,
      participantAnnouncementReadFixtures.already_read!.readAt,
    ],
  ]),
  readRequests: new Map(),
};

const mockIdentityState: MockIdentityState = {
  eventAccess: true,
  profile: { ...identityFixtureProfile },
  profileManagementState: 'editable',
  profileVersion: 1,
  profileUpdatedAt: identityProfileUpdateFixtures.updated!.updatedAt,
  privacyRequests: new Map(),
  privacyRequestByKind: new Map(),
};

const initialAgendaItems = (): ParticipantAgendaItem[] => {
  const fixtures = [
    participantAgendaFixtures.saved,
    participantAgendaFixtures.reserved,
    participantAgendaFixtures.waiting,
    participantAgendaFixtures.fifo_first_waiting,
    participantAgendaFixtures.fifo_second_waiting,
    participantAgendaFixtures.waitlist_cancelled,
    participantAgendaFixtures.full,
    participantAgendaFixtures.closed,
    participantAgendaFixtures.cancelled,
  ];
  return fixtures.flatMap((fixture) =>
    fixture ? structuredClone(fixture.items) : [],
  );
};

const mockAgendaState: MockAgendaState = {
  featureEnabled: true,
  ticketActive: true,
  version: participantAgendaFixtures.happy!.version,
  items: initialAgendaItems(),
  actionRequests: new Map(),
  actionFingerprints: new Map(),
  inFlightActionRequests: new Map(),
};

interface MockAgendaActionPause {
  readonly entered: () => void;
  readonly release: () => void;
  readonly wait: Promise<void>;
}

let nextMockAgendaActionPause: MockAgendaActionPause | null = null;

export const pauseNextMockAgendaAction = (): {
  readonly entered: Promise<void>;
  readonly release: () => void;
} => {
  let markEntered: () => void = () => undefined;
  let release: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  nextMockAgendaActionPause?.release();
  nextMockAgendaActionPause = {
    entered: markEntered,
    release,
    wait,
  };
  return { entered, release };
};

const primaryMockUser = Object.freeze({
  id: identityBootstrapFixtures.complete!.user.id,
  email: identityBootstrapFixtures.complete!.user.email,
});
const alternateMockUser = Object.freeze({
  id: '01910000-0000-7000-8000-000000000302',
  email: 'beata@example.test',
});
let mockCurrentUser = { ...primaryMockUser };

interface MockPrincipalSnapshot {
  readonly user: typeof mockCurrentUser;
  readonly identity: Omit<
    MockIdentityState,
    'eventAccess' | 'privacyRequests' | 'privacyRequestByKind'
  > & {
    readonly privacyRequests: MockIdentityState['privacyRequests'];
    readonly privacyRequestByKind: MockIdentityState['privacyRequestByKind'];
  };
  readonly announcement: {
    readonly readAtById: MockAnnouncementState['readAtById'];
    readonly readRequests: MockAnnouncementState['readRequests'];
    readonly recipientAnnouncementIds: MockAnnouncementState['recipientAnnouncementIds'];
  };
  readonly agenda: {
    readonly actionRequests: MockAgendaState['actionRequests'];
    readonly actionFingerprints: MockAgendaState['actionFingerprints'];
    readonly inFlightActionRequests: MockAgendaState['inFlightActionRequests'];
    readonly featureEnabled: boolean;
    readonly items: readonly ParticipantAgendaItem[];
    readonly ticketActive: boolean;
    readonly version: number;
  };
  readonly onboarding?: NonNullable<MockActivationState['onboarding']>;
}

const mockPrincipalSnapshots = new Map<
  MockActivationState['currentPrincipal'],
  MockPrincipalSnapshot
>();

export const resetMockIdentityState = (): void => {
  mockIdentityState.eventAccess = true;
  mockIdentityState.profile = { ...identityFixtureProfile };
  mockIdentityState.profileManagementState = 'editable';
  mockIdentityState.profileVersion = 1;
  mockIdentityState.profileUpdatedAt =
    identityProfileUpdateFixtures.updated!.updatedAt;
  mockIdentityState.privacyRequests.clear();
  mockIdentityState.privacyRequestByKind.clear();
  mockCurrentUser = { ...primaryMockUser };
  mockPrincipalSnapshots.clear();
};

export const resetMockAgendaState = (): void => {
  nextMockAgendaActionPause?.release();
  nextMockAgendaActionPause = null;
  mockAgendaState.featureEnabled = true;
  mockAgendaState.ticketActive = true;
  mockAgendaState.version = participantAgendaFixtures.happy!.version;
  mockAgendaState.items = initialAgendaItems();
  mockAgendaState.actionRequests.clear();
  mockAgendaState.actionFingerprints.clear();
  mockAgendaState.inFlightActionRequests.clear();
};

export const configureMockAgendaAccess = (options: {
  readonly eventAccess?: boolean;
  readonly featureEnabled?: boolean;
  readonly ticketActive?: boolean;
}): void => {
  if (options.eventAccess !== undefined) {
    mockIdentityState.eventAccess = options.eventAccess;
  }
  if (options.featureEnabled !== undefined) {
    mockAgendaState.featureEnabled = options.featureEnabled;
  }
  if (options.ticketActive !== undefined) {
    mockAgendaState.ticketActive = options.ticketActive;
  }
};

export const configureMockIdentityAccess = (options: {
  readonly eventAccess?: boolean;
  readonly profileManagementState?:
    'missing' | 'editable' | 'read_only' | 'removed';
}): void => {
  if (options.eventAccess !== undefined) {
    mockIdentityState.eventAccess = options.eventAccess;
  }
  if (options.profileManagementState !== undefined) {
    mockIdentityState.profileManagementState = options.profileManagementState;
    if (
      options.profileManagementState === 'missing' ||
      options.profileManagementState === 'removed'
    ) {
      mockIdentityState.profile = null;
    } else if (mockIdentityState.profile === null) {
      mockIdentityState.profile = { ...identityFixtureProfile };
    }
  }
};

export const resetMockActivationState = (): void => {
  mockActivationState.claimed = false;
  mockActivationState.currentPrincipal = 'primary';
  mockActivationState.principalActive = false;
  mockActivationState.recoveryPrincipal = 'primary';
  mockActivationState.sessionGeneration = 0;
  mockActivationState.signedOut = false;
  mockActivationState.claims.clear();
  mockActivationState.identities.clear();
  mockActivationState.recoveries.clear();
  mockActivationState.linkConsumptions.clear();
  mockActivationState.consumedLinkFingerprints.clear();
  mockActivationState.sessionActions.clear();
  mockActivationState.onboardingRequests.clear();
  delete mockActivationState.onboarding;
};

export const configureMockParticipantPrincipal = (options: {
  readonly active: boolean;
}): void => {
  mockActivationState.principalActive = options.active;
  mockActivationState.signedOut = false;
  if (options.active && mockActivationState.sessionGeneration === 0) {
    mockActivationState.sessionGeneration = 1;
  }
};

const mockParticipantSessionKey = 'byzon.mock.participant.active';

const persistedMockParticipantIsActive = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(mockParticipantSessionKey) === 'true';
  } catch {
    return false;
  }
};

const configureMockParticipantFromRequest = (request: Request): void => {
  const explicitlyActive =
    request.headers.get('x-byzon-mock-participant') === 'active';
  if (explicitlyActive && typeof window !== 'undefined') {
    try {
      window.sessionStorage.setItem(mockParticipantSessionKey, 'true');
    } catch {
      // Synthetic preview still works for the current document without storage.
    }
  }
  if (explicitlyActive || persistedMockParticipantIsActive()) {
    configureMockParticipantPrincipal({ active: true });
  }
};

const hasActiveParticipantAccess = (): boolean =>
  mockActivationState.principalActive && !mockActivationState.signedOut;

interface MockAgendaRequestContext {
  readonly principal: MockActivationState['currentPrincipal'];
  readonly sessionGeneration: number;
  readonly userId: string;
}

const captureMockAgendaRequestContext = (): MockAgendaRequestContext => ({
  principal: mockActivationState.currentPrincipal,
  sessionGeneration: mockActivationState.sessionGeneration,
  userId: mockCurrentUser.id,
});

const matchesMockAgendaRequestContext = (
  context: MockAgendaRequestContext,
): boolean =>
  hasActiveParticipantAccess() &&
  mockActivationState.currentPrincipal === context.principal &&
  mockActivationState.sessionGeneration === context.sessionGeneration &&
  mockCurrentUser.id === context.userId;

const clearMockAgendaInFlightRequest = (
  context: MockAgendaRequestContext,
  idempotencyKey: string,
): void => {
  if (mockActivationState.currentPrincipal === context.principal) {
    mockAgendaState.inFlightActionRequests.delete(idempotencyKey);
    return;
  }
  mockPrincipalSnapshots
    .get(context.principal)
    ?.agenda.inFlightActionRequests.delete(idempotencyKey);
};

const mockAgendaRequestContextFailure = (
  context: MockAgendaRequestContext,
  fixtureName: string,
) => {
  if (!matchesMockAgendaRequestContext(context)) {
    return mockProblemResponse(
      participantAgendaMutationProblemSchema,
      participantAgendaMutationProblemFixtures.authentication,
      { fixtureName: `${fixtureName}-authentication` },
    );
  }
  if (!mockIdentityState.eventAccess) {
    return mockProblemResponse(
      participantAgendaMutationProblemSchema,
      participantAgendaMutationProblemFixtures.permission,
      { fixtureName: `${fixtureName}-permission` },
    );
  }
  if (!mockAgendaState.featureEnabled) {
    return mockProblemResponse(
      participantAgendaMutationProblemSchema,
      participantAgendaMutationProblemFixtures.disabled,
      { fixtureName: `${fixtureName}-disabled` },
    );
  }
  return null;
};

export const resetMockAnnouncementState = (): void => {
  mockAnnouncementState.featureEnabled = true;
  mockAnnouncementState.recipientAnnouncementIds.clear();
  for (const announcementId of defaultRecipientAnnouncementIds) {
    mockAnnouncementState.recipientAnnouncementIds.add(announcementId);
  }
  mockAnnouncementState.readAtById.clear();
  mockAnnouncementState.readAtById.set(
    announcementFixtureIds.information,
    participantAnnouncementReadFixtures.already_read!.readAt,
  );
  mockAnnouncementState.readRequests.clear();
};

export const configureMockAnnouncementAccess = (options: {
  readonly eventAccess?: boolean;
  readonly featureEnabled?: boolean;
  readonly recipientAnnouncementIds?: readonly string[];
}): void => {
  if (options.eventAccess !== undefined) {
    mockIdentityState.eventAccess = options.eventAccess;
  }
  if (options.featureEnabled !== undefined) {
    mockAnnouncementState.featureEnabled = options.featureEnabled;
  }
  if (options.recipientAnnouncementIds !== undefined) {
    mockAnnouncementState.recipientAnnouncementIds.clear();
    for (const announcementId of options.recipientAnnouncementIds) {
      mockAnnouncementState.recipientAnnouncementIds.add(announcementId);
    }
  }
};

const captureMockPrincipal = (): MockPrincipalSnapshot => ({
  user: { ...mockCurrentUser },
  identity: {
    profile: mockIdentityState.profile
      ? { ...mockIdentityState.profile }
      : null,
    profileManagementState: mockIdentityState.profileManagementState,
    profileVersion: mockIdentityState.profileVersion,
    profileUpdatedAt: mockIdentityState.profileUpdatedAt,
    privacyRequests: new Map(mockIdentityState.privacyRequests),
    privacyRequestByKind: new Map(mockIdentityState.privacyRequestByKind),
  },
  announcement: {
    readAtById: new Map(mockAnnouncementState.readAtById),
    readRequests: new Map(mockAnnouncementState.readRequests),
    recipientAnnouncementIds: new Set(
      mockAnnouncementState.recipientAnnouncementIds,
    ),
  },
  agenda: {
    actionRequests: new Map(mockAgendaState.actionRequests),
    actionFingerprints: new Map(mockAgendaState.actionFingerprints),
    inFlightActionRequests: new Map(mockAgendaState.inFlightActionRequests),
    featureEnabled: mockAgendaState.featureEnabled,
    items: structuredClone(mockAgendaState.items),
    ticketActive: mockAgendaState.ticketActive,
    version: mockAgendaState.version,
  },
  ...(mockActivationState.onboarding
    ? {
        onboarding: {
          profile: { ...mockActivationState.onboarding.profile },
        },
      }
    : {}),
});

const createFreshMockPrincipal = (
  principal: MockActivationState['currentPrincipal'],
): MockPrincipalSnapshot => ({
  user:
    principal === 'alternate'
      ? { ...alternateMockUser }
      : { ...primaryMockUser },
  identity: {
    profile:
      principal === 'alternate'
        ? {
            firstName: 'Beáta',
            lastName: 'Svobodová',
            contactEmail: alternateMockUser.email,
            phone: null,
          }
        : { ...identityFixtureProfile },
    profileManagementState: 'editable',
    profileVersion: 1,
    profileUpdatedAt: identityProfileUpdateFixtures.updated!.updatedAt,
    privacyRequests: new Map(),
    privacyRequestByKind: new Map(),
  },
  announcement: {
    readAtById:
      principal === 'alternate'
        ? new Map()
        : new Map([
            [
              announcementFixtureIds.information,
              participantAnnouncementReadFixtures.already_read!.readAt,
            ],
          ]),
    readRequests: new Map(),
    recipientAnnouncementIds:
      principal === 'alternate'
        ? new Set([announcementFixtureIds.critical])
        : new Set(defaultRecipientAnnouncementIds),
  },
  agenda: {
    actionRequests: new Map(),
    actionFingerprints: new Map(),
    inFlightActionRequests: new Map(),
    featureEnabled: true,
    items:
      principal === 'alternate' ? [] : structuredClone(initialAgendaItems()),
    ticketActive: true,
    version:
      principal === 'alternate' ? 1 : participantAgendaFixtures.happy!.version,
  },
});

const activateMockPrincipal = (
  principal: MockActivationState['currentPrincipal'],
): void => {
  if (principal === mockActivationState.currentPrincipal) return;
  mockPrincipalSnapshots.set(
    mockActivationState.currentPrincipal,
    captureMockPrincipal(),
  );
  const next =
    mockPrincipalSnapshots.get(principal) ??
    createFreshMockPrincipal(principal);
  mockCurrentUser = { ...next.user };
  mockIdentityState.profile = next.identity.profile
    ? { ...next.identity.profile }
    : null;
  mockIdentityState.profileManagementState =
    next.identity.profileManagementState;
  mockIdentityState.profileVersion = next.identity.profileVersion;
  mockIdentityState.profileUpdatedAt = next.identity.profileUpdatedAt;
  mockIdentityState.privacyRequests.clear();
  for (const [key, value] of next.identity.privacyRequests) {
    mockIdentityState.privacyRequests.set(key, value);
  }
  mockIdentityState.privacyRequestByKind.clear();
  for (const [key, value] of next.identity.privacyRequestByKind) {
    mockIdentityState.privacyRequestByKind.set(key, value);
  }
  mockAnnouncementState.readAtById.clear();
  for (const [key, value] of next.announcement.readAtById) {
    mockAnnouncementState.readAtById.set(key, value);
  }
  mockAnnouncementState.readRequests.clear();
  for (const [key, value] of next.announcement.readRequests) {
    mockAnnouncementState.readRequests.set(key, value);
  }
  mockAnnouncementState.recipientAnnouncementIds.clear();
  for (const announcementId of next.announcement.recipientAnnouncementIds) {
    mockAnnouncementState.recipientAnnouncementIds.add(announcementId);
  }
  mockAgendaState.actionRequests.clear();
  for (const [key, value] of next.agenda.actionRequests) {
    mockAgendaState.actionRequests.set(key, value);
  }
  mockAgendaState.actionFingerprints.clear();
  for (const [key, value] of next.agenda.actionFingerprints) {
    mockAgendaState.actionFingerprints.set(key, value);
  }
  mockAgendaState.inFlightActionRequests.clear();
  for (const [key, value] of next.agenda.inFlightActionRequests) {
    mockAgendaState.inFlightActionRequests.set(key, value);
  }
  mockAgendaState.featureEnabled = next.agenda.featureEnabled;
  mockAgendaState.items = structuredClone([...next.agenda.items]);
  mockAgendaState.ticketActive = next.agenda.ticketActive;
  mockAgendaState.version = next.agenda.version;
  if (next.onboarding) {
    mockActivationState.onboarding = {
      profile: { ...next.onboarding.profile },
    };
  } else {
    delete mockActivationState.onboarding;
  }
  mockActivationState.currentPrincipal = principal;
};

const isRecipientAnnouncement = (announcementId: string): boolean =>
  mockAnnouncementState.recipientAnnouncementIds.has(announcementId);

const recipientAnnouncementItems = () =>
  participantAnnouncementInboxFixtures.happy!.items.filter(({ id }) =>
    isRecipientAnnouncement(id),
  );

const canonicalAnnouncementUnreadCount = (): number =>
  recipientAnnouncementItems().filter(
    ({ id }) => !mockAnnouncementState.readAtById.has(id),
  ).length;

const canonicalTicketForCurrentPrincipal = () => {
  const fixture = participantTicketFixtures.valid!;
  const alternate = mockActivationState.currentPrincipal === 'alternate';
  return {
    ...fixture,
    ticket: {
      ...fixture.ticket,
      holder: {
        displayName: alternate ? 'Beáta Svobodová' : 'Alex Novák',
      },
      referenceSuffix: alternate ? 'BTA6' : 'TST6',
    },
  };
};

const canonicalAgendaForCurrentPrincipal = () =>
  participantAgendaResponseSchema.parse({
    eventId: agendaFixtureIds.event,
    userId: mockCurrentUser.id,
    eventTimezone: participantAgendaFixtures.happy!.eventTimezone,
    serverNow: participantAgendaFixtures.happy!.serverNow,
    version: mockAgendaState.version,
    publicationVersion: participantAgendaFixtures.happy!.publicationVersion,
    items: structuredClone(mockAgendaState.items).sort((left, right) => {
      const byStart =
        Date.parse(left.session.startsAt) - Date.parse(right.session.startsAt);
      return byStart || left.session.id.localeCompare(right.session.id);
    }),
    calendarExport:
      mockAgendaState.items.length === 0
        ? { state: 'unavailable', reason: 'empty' }
        : {
            state: 'available',
            href: '/api/v1/me/agenda.ics',
          },
  });

const agendaItemTemplate = (
  sessionId: string,
): ParticipantAgendaItem | undefined => {
  for (const fixture of Object.values(participantAgendaFixtures)) {
    const item = fixture?.items.find(({ session }) => session.id === sessionId);
    if (item) return structuredClone(item);
  }
  return undefined;
};

const agendaItemIndex = (sessionId: string): number =>
  mockAgendaState.items.findIndex(({ session }) => session.id === sessionId);

export const selectMockAgendaConflictingSessions = (
  sessions: readonly AgendaSessionSnapshot[],
  target: AgendaSessionSnapshot,
): AgendaSessionSnapshot[] =>
  sessions
    .filter(
      (session) =>
        session.status === 'published' &&
        session.id !== target.id &&
        Date.parse(session.startsAt) < Date.parse(target.endsAt) &&
        Date.parse(session.endsAt) > Date.parse(target.startsAt),
    )
    .sort((left, right) => {
      const byStart = Date.parse(left.startsAt) - Date.parse(right.startsAt);
      return byStart || left.id.localeCompare(right.id);
    });

const savedAgendaItem = (
  item: ParticipantAgendaItem,
  capacity = item.capacity,
  action = item.action,
): ParticipantAgendaItem => ({
  day: item.day,
  session: item.session,
  capacity,
  action,
  state: 'saved',
  source: 'manual',
  savedAt: participantAgendaFixtures.happy!.serverNow,
});

type MockAgendaApplication =
  | {
      readonly kind: 'success';
      readonly outcome: 'applied' | 'already_applied';
    }
  | {
      readonly kind: 'failure';
      readonly failure:
        | 'capacity_full'
        | 'reservation_closed'
        | 'session_not_found'
        | 'ticket_inactive'
        | 'validation';
    };

const applyMockAgendaAction = (
  request: ReturnType<typeof participantAgendaMutationRequestSchema.parse>,
): MockAgendaApplication => {
  const index = agendaItemIndex(request.sessionId);
  const current = index >= 0 ? mockAgendaState.items[index] : undefined;
  const template = current ?? agendaItemTemplate(request.sessionId);
  const reservationAction = new Set([
    'reserve',
    'cancel',
    'join_waitlist',
    'leave_waitlist',
  ]).has(request.action);

  if (!template) {
    return { kind: 'failure', failure: 'session_not_found' };
  }
  if (reservationAction && !mockAgendaState.ticketActive) {
    return { kind: 'failure', failure: 'ticket_inactive' };
  }
  if (
    request.action === 'reserve' &&
    template.action.state === 'capacity_full'
  ) {
    return { kind: 'failure', failure: 'capacity_full' };
  }
  if (request.action === 'reserve' && template.action.state === 'closed') {
    return { kind: 'failure', failure: 'reservation_closed' };
  }

  let next: ParticipantAgendaItem | undefined;
  let outcome: 'applied' | 'already_applied' = 'applied';
  switch (request.action) {
    case 'add':
      if (current) {
        outcome = 'already_applied';
      } else {
        next = savedAgendaItem(template);
      }
      break;
    case 'remove':
      if (!current) {
        outcome = 'already_applied';
      } else if (current.state !== 'saved') {
        return { kind: 'failure', failure: 'validation' };
      }
      break;
    case 'reserve':
      if (current?.state === 'reserved') {
        outcome = 'already_applied';
        break;
      }
      if (current?.state === 'waitlisted') {
        return { kind: 'failure', failure: 'validation' };
      }
      if (
        template.capacity.mode !== 'reservation' ||
        template.capacity.actorAvailability.state !== 'available' ||
        template.capacity.remaining === 0
      ) {
        return { kind: 'failure', failure: 'validation' };
      }
      next = {
        day: template.day,
        session: template.session,
        capacity: {
          ...template.capacity,
          confirmed: template.capacity.confirmed + 1,
          remaining: template.capacity.remaining - 1,
          actorAvailability:
            template.capacity.remaining === 1
              ? { state: 'unavailable' }
              : template.capacity.actorAvailability,
        },
        action:
          template.capacity.remaining === 1
            ? { state: 'capacity_full' }
            : { state: 'available' },
        state: 'reserved',
        reservation: {
          id: agendaFixtureIds.reservation,
          version: 1,
          confirmedAt: participantAgendaFixtures.happy!.serverNow,
        },
      };
      break;
    case 'cancel':
      if (!current || current.state === 'saved') {
        outcome = 'already_applied';
        break;
      }
      if (
        current.state !== 'reserved' ||
        current.capacity.mode !== 'reservation'
      ) {
        return { kind: 'failure', failure: 'validation' };
      }
      next = savedAgendaItem(
        current,
        {
          ...current.capacity,
          confirmed: Math.max(0, current.capacity.confirmed - 1),
          remaining: current.capacity.remaining + 1,
          actorAvailability: { state: 'available' },
        },
        { state: 'available' },
      );
      break;
    case 'join_waitlist':
      if (
        current?.state === 'waitlisted' &&
        current.waitlist.state === 'waiting'
      ) {
        outcome = 'already_applied';
        break;
      }
      if (current?.state === 'reserved') {
        return { kind: 'failure', failure: 'validation' };
      }
      if (
        template.capacity.mode !== 'reservation' ||
        template.capacity.remaining !== 0 ||
        template.action.state !== 'capacity_full'
      ) {
        return { kind: 'failure', failure: 'validation' };
      }
      if (!template.capacity.waitlistAvailable) {
        return { kind: 'failure', failure: 'capacity_full' };
      }
      next = {
        day: template.day,
        session: template.session,
        capacity: {
          ...template.capacity,
          actorAvailability: { state: 'unavailable' },
        },
        action: { state: 'capacity_full' },
        state: 'waitlisted',
        waitlist: {
          id: agendaFixtureIds.waitlist,
          state: 'waiting',
          joinedAt: participantAgendaFixtures.happy!.serverNow,
          position: 3,
          actionsAvailable: true,
        },
      };
      break;
    case 'leave_waitlist':
      if (!current || current.state === 'saved') {
        outcome = 'already_applied';
        break;
      }
      if (current.state !== 'waitlisted') {
        return { kind: 'failure', failure: 'validation' };
      }
      next = savedAgendaItem(current);
      break;
  }

  if (outcome === 'already_applied') {
    return { kind: 'success', outcome };
  }
  if (request.action === 'remove') {
    mockAgendaState.items.splice(index, 1);
  } else if (next && index >= 0) {
    mockAgendaState.items[index] = next;
  } else if (next) {
    mockAgendaState.items.push(next);
  }
  mockAgendaState.version += 1;
  return { kind: 'success', outcome };
};

const mockStoredAgendaResultResponse = (
  result: MockAgendaStoredResult,
  fixtureName: string,
) =>
  result.kind === 'success'
    ? mockJsonResponse(
        participantAgendaMutationResponseSchema,
        result.response,
        {
          fixtureName,
          cacheControl: 'private, no-store',
          vary: ['authorization', 'cookie'],
        },
      )
    : mockProblemResponse(
        participantAgendaMutationProblemSchema,
        result.problem,
        { fixtureName },
      );

const announcementCursorForOffset = (offset: number): string =>
  `fixture-announcements-offset-${String(offset)}`;

const announcementOffsetFromCursor = (
  cursor: string | undefined,
  itemCount: number,
): number | null => {
  if (cursor === undefined) return 0;
  const match = /^fixture-announcements-offset-([1-9][0-9]?)$/.exec(cursor);
  if (!match) return null;
  const offset = Number(match[1]);
  return offset <= itemCount ? offset : null;
};

const opaqueFingerprint = async (value: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const mockLinkNoncePattern =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const legacyMockLinkPattern = new RegExp(
  `^(?:(?:link|recovery-onboarding):|recovery-app:(?:(?:primary|alternate):)?)${mockLinkNoncePattern}$`,
);
const nestedMockRecoveryLinkPattern = new RegExp(
  `^recovery-route:([A-Za-z0-9_-]{2,216}):(${mockLinkNoncePattern})$`,
);

const encodeCanonicalBase64Url = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
};

const decodeCanonicalBase64Url = (value: string): string | null => {
  if (value.length % 4 === 1) return null;
  const standard = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = standard.padEnd(
    standard.length + ((4 - (standard.length % 4)) % 4),
    '=',
  );
  try {
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return encodeCanonicalBase64Url(decoded) === value ? decoded : null;
  } catch {
    return null;
  }
};

type ParsedMockActivationLink = {
  readonly principal?: MockActivationState['currentPrincipal'];
  readonly response: ActivationLinkResponse;
};

const parseMockActivationLink = (
  token: string,
): ParsedMockActivationLink | null => {
  if (legacyMockLinkPattern.test(token)) {
    if (token.startsWith('recovery-app:')) {
      return {
        ...(token.startsWith('recovery-app:primary:')
          ? { principal: 'primary' as const }
          : token.startsWith('recovery-app:alternate:')
            ? { principal: 'alternate' as const }
            : {}),
        response: { state: 'active', continueTo: '/app' },
      };
    }
    return {
      response: {
        state: 'onboarding_required',
        continueTo: '/onboarding',
      },
    };
  }

  const nestedMatch = nestedMockRecoveryLinkPattern.exec(token);
  const payload = nestedMatch?.[1];
  if (payload === undefined) return null;
  const decoded = decodeCanonicalBase64Url(payload);
  if (decoded === null) return null;
  const destination = participantActivationReturnToSchema.safeParse(decoded);
  if (!destination.success) return null;
  return {
    response: { state: 'active', continueTo: destination.data },
  };
};

/**
 * Development preview uses the same success contracts and synthetic fixtures
 * as component tests. Failure-state variants stay explicit in tests instead
 * of adding production-looking query switches to the API.
 */
export const mockHandlers: readonly RequestHandler[] = Object.freeze([
  ...adminMockHandlers,
  ...checkinMockHandlers,
  http.get('*/api/v1/activation', () =>
    mockJsonResponse(
      activationLandingResponseSchema,
      mockActivationState.claimed
        ? activationLandingFixtures.in_progress
        : activationLandingFixtures.anonymous,
      {
        fixtureName: 'activation.mock.landing',
        cacheControl: 'private, no-store',
      },
    ),
  ),
  http.post('*/api/v1/activation/claims', async ({ request }) => {
    const body = await request.json().catch(() => undefined);
    const parsed = activationClaimRequestSchema.safeParse(body);
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get('idempotency-key'),
    );
    if (!parsed.success || !idempotencyKey.success) {
      return mockProblemResponse(
        activationClaimProblemSchema,
        activationClaimProblemFixtures.rejected,
        { fixtureName: 'activation.mock.claim-rejected' },
      );
    }
    const fingerprint = await opaqueFingerprint(JSON.stringify(parsed.data));
    const previous = mockActivationState.claims.get(idempotencyKey.data);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        return mockProblemResponse(
          activationClaimProblemSchema,
          activationClaimProblemFixtures.idempotency_key_reused,
          { fixtureName: 'activation.mock.claim-key-reused' },
        );
      }
      return mockJsonResponse(
        activationClaimResponseSchema,
        activationClaimFixtures[previous.outcome],
        {
          fixtureName: 'activation.mock.claim-replay',
          cacheControl: 'private, no-store',
        },
      );
    }
    const acceptedCameraCode =
      parsed.data.method === 'camera_scan' &&
      /^camera:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.data.code,
      );
    const acceptedManualCode =
      parsed.data.method === 'manual_code' &&
      parsed.data.code === activationFixtureCode;
    const acceptedRecoveryCode =
      parsed.data.method === 'manual_code' &&
      parsed.data.code === activationFixtureRecoveryCode;
    if (!acceptedManualCode && !acceptedRecoveryCode && !acceptedCameraCode) {
      return mockProblemResponse(
        activationClaimProblemSchema,
        activationClaimProblemFixtures.rejected,
        { fixtureName: 'activation.mock.claim-rejected' },
      );
    }

    const outcome =
      acceptedRecoveryCode || mockActivationState.onboarding
        ? 'recovery_required'
        : 'identity_required';
    mockActivationState.claimed = outcome === 'identity_required';
    mockActivationState.claims.set(idempotencyKey.data, {
      fingerprint,
      outcome,
    });
    return mockJsonResponse(
      activationClaimResponseSchema,
      activationClaimFixtures[outcome],
      {
        fixtureName: 'activation.mock.claim',
        cacheControl: 'private, no-store',
      },
    );
  }),
  http.post('*/api/v1/activation/identity', async ({ request }) => {
    const body = await request.json().catch(() => undefined);
    const parsed = activationIdentityRequestSchema.safeParse(body);
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get('idempotency-key'),
    );
    if (!parsed.success || !idempotencyKey.success) {
      return mockProblemResponse(
        activationIdentityProblemSchema,
        activationIdentityProblemFixtures.expired,
        { fixtureName: 'activation.mock.identity-expired' },
      );
    }
    const fingerprint = await opaqueFingerprint(JSON.stringify(parsed.data));
    const previous = mockActivationState.identities.get(idempotencyKey.data);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        return mockProblemResponse(
          activationIdentityProblemSchema,
          activationIdentityProblemFixtures.idempotency_key_reused,
          { fixtureName: 'activation.mock.identity-key-reused' },
        );
      }
      return mockJsonResponse(
        activationIdentityResponseSchema,
        activationIdentityFixtures.link_sent,
        {
          fixtureName: 'activation.mock.identity-replay',
          cacheControl: 'private, no-store',
        },
      );
    }
    if (
      !mockActivationState.claimed ||
      parsed.data.flowId !== activationFixtureFlowId
    ) {
      return mockProblemResponse(
        activationIdentityProblemSchema,
        activationIdentityProblemFixtures.expired,
        { fixtureName: 'activation.mock.identity-expired' },
      );
    }
    mockActivationState.identities.set(idempotencyKey.data, {
      fingerprint,
    });
    return mockJsonResponse(
      activationIdentityResponseSchema,
      activationIdentityFixtures.link_sent,
      {
        fixtureName: 'activation.mock.identity',
        cacheControl: 'private, no-store',
      },
    );
  }),
  http.post('*/api/v1/activation/recovery', async ({ request }) => {
    const body = await request.json().catch(() => undefined);
    const parsed = activationRecoveryRequestSchema.safeParse(body);
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get('idempotency-key'),
    );
    if (!parsed.success || !idempotencyKey.success) {
      return mockProblemResponse(
        activationRecoveryProblemSchema,
        activationRecoveryProblemFixtures.internal_error,
        { fixtureName: 'activation.mock.recovery-invalid' },
      );
    }
    const fingerprint = await opaqueFingerprint(JSON.stringify(parsed.data));
    const previous = mockActivationState.recoveries.get(idempotencyKey.data);
    if (previous && previous.fingerprint !== fingerprint) {
      return mockProblemResponse(
        activationRecoveryProblemSchema,
        activationRecoveryProblemFixtures.idempotency_key_reused,
        { fixtureName: 'activation.mock.recovery-key-reused' },
      );
    }
    if (!previous) {
      mockActivationState.recoveries.set(idempotencyKey.data, {
        fingerprint,
      });
    }

    return mockJsonResponse(
      activationRecoveryResponseSchema,
      activationRecoveryFixtures.accepted,
      {
        fixtureName: 'activation.mock.recovery',
        cacheControl: 'private, no-store',
      },
    );
  }),
  http.post('*/api/v1/activation/link', async ({ request }) => {
    const body = await request.json().catch(() => undefined);
    const parsed = activationLinkRequestSchema.safeParse(body);
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get('idempotency-key'),
    );
    const parsedLink = parsed.success
      ? parseMockActivationLink(parsed.data.token)
      : null;
    const tokenFingerprint = parsed.success
      ? await opaqueFingerprint(parsed.data.token)
      : undefined;
    if (
      parsedLink === null ||
      !parsed.success ||
      !idempotencyKey.success ||
      !tokenFingerprint
    ) {
      return mockProblemResponse(
        activationLinkProblemSchema,
        activationLinkProblemFixtures.rejected,
        { fixtureName: 'activation.mock.link-rejected' },
      );
    }
    const previous = mockActivationState.linkConsumptions.get(
      idempotencyKey.data,
    );
    if (previous) {
      if (previous.tokenFingerprint !== tokenFingerprint) {
        return mockProblemResponse(
          activationLinkProblemSchema,
          activationLinkProblemFixtures.idempotency_key_reused,
          { fixtureName: 'activation.mock.link-key-reused' },
        );
      }
      return mockJsonResponse(activationLinkResponseSchema, previous.response, {
        fixtureName: 'activation.mock.link-replay',
        cacheControl: 'private, no-store',
      });
    }
    if (mockActivationState.consumedLinkFingerprints.has(tokenFingerprint)) {
      return mockProblemResponse(
        activationLinkProblemSchema,
        activationLinkProblemFixtures.rejected,
        { fixtureName: 'activation.mock.link-already-consumed' },
      );
    }
    const hadOwnerContext =
      mockActivationState.principalActive ||
      mockActivationState.signedOut ||
      mockActivationState.onboarding !== undefined;
    mockActivationState.claimed = false;
    const { response } = parsedLink;
    const outcome = response.state;
    if (outcome === 'active') {
      const principal =
        parsedLink.principal ?? mockActivationState.recoveryPrincipal;
      activateMockPrincipal(principal);
    } else if (hadOwnerContext) {
      const pendingPrincipal =
        mockActivationState.currentPrincipal === 'primary'
          ? 'alternate'
          : 'primary';
      activateMockPrincipal(pendingPrincipal);
      mockActivationState.recoveryPrincipal = pendingPrincipal;
      delete mockActivationState.onboarding;
      mockIdentityState.profile = null;
      mockIdentityState.profileManagementState = 'missing';
      mockIdentityState.profileVersion = 1;
      mockIdentityState.privacyRequests.clear();
      mockIdentityState.privacyRequestByKind.clear();
    }
    mockActivationState.principalActive = outcome === 'active';
    mockActivationState.signedOut = false;
    mockActivationState.sessionGeneration += 1;
    mockActivationState.linkConsumptions.set(idempotencyKey.data, {
      response,
      tokenFingerprint,
    });
    mockActivationState.consumedLinkFingerprints.add(tokenFingerprint);
    return mockJsonResponse(activationLinkResponseSchema, response, {
      fixtureName: 'activation.mock.link',
      cacheControl: 'private, no-store',
    });
  }),
  http.get('*/api/v1/me/bootstrap', ({ request }) => {
    configureMockParticipantFromRequest(request);
    if (mockActivationState.signedOut) {
      return mockProblemResponse(
        identityBootstrapProblemSchema,
        identityBootstrapProblemFixtures.authentication,
        { fixtureName: 'identity.mock.bootstrap-signed-out' },
      );
    }
    if (!mockIdentityState.eventAccess) {
      return mockProblemResponse(
        identityBootstrapProblemSchema,
        identityBootstrapProblemFixtures.permission,
        { fixtureName: 'identity.mock.bootstrap-permission' },
      );
    }
    const completion = mockActivationState.onboarding;
    const profileManagement =
      mockIdentityState.profileManagementState === 'editable'
        ? {
            state: 'editable' as const,
            version: mockIdentityState.profileVersion,
          }
        : { state: mockIdentityState.profileManagementState };
    const retainedProfile =
      mockIdentityState.profileManagementState === 'missing' ||
      mockIdentityState.profileManagementState === 'removed'
        ? null
        : (mockIdentityState.profile ?? completion?.profile ?? null);
    const fixture = mockActivationState.principalActive
      ? {
          ...identityBootstrapFixtures.complete!,
          membership: {
            access: { state: 'active' as const },
            roles: ['participant' as const],
          },
          profile: retainedProfile,
          profileManagement,
          legalAcknowledgements:
            identityBootstrapFixtures.complete!.legalAcknowledgements,
        }
      : identityBootstrapFixtures.profile_required!;
    return mockJsonResponse(
      identityBootstrapResponseSchema,
      {
        ...fixture,
        user: { ...mockCurrentUser },
        unreadCounts: {
          ...fixture.unreadCounts,
          announcements: canonicalAnnouncementUnreadCount(),
        },
        privacy: mockActivationState.principalActive
          ? {
              deletionRequest:
                mockIdentityState.profileManagementState === 'removed'
                  ? 'completed'
                  : (mockIdentityState.privacyRequestByKind.get('data_deletion')
                      ?.request.state ?? fixture.privacy.deletionRequest),
            }
          : fixture.privacy,
      },
      {
        fixtureName: 'identity.mock.bootstrap',
        cacheControl: 'private, no-store',
        vary: ['authorization', 'cookie'],
      },
    );
  }),
  http.post('*/api/v1/me/onboarding', async ({ request }) => {
    if (mockActivationState.signedOut) {
      return mockProblemResponse(
        identityOnboardingProblemSchema,
        identityOnboardingProblemFixtures.authentication,
        { fixtureName: 'identity.mock.onboarding-signed-out' },
      );
    }
    if (!mockIdentityState.eventAccess) {
      return mockProblemResponse(
        identityOnboardingProblemSchema,
        identityOnboardingProblemFixtures.permission,
        { fixtureName: 'identity.mock.onboarding-permission' },
      );
    }
    const body = await request.json().catch(() => undefined);
    const parsed = identityOnboardingRequestSchema.safeParse(body);
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get('idempotency-key'),
    );
    if (!parsed.success || !idempotencyKey.success) {
      return mockProblemResponse(
        identityOnboardingProblemSchema,
        identityOnboardingProblemFixtures.validation,
        { fixtureName: 'identity.mock.onboarding-validation' },
      );
    }
    const exactDocuments =
      parsed.data.legal.termsDocumentId === identityFixtureIds.terms &&
      parsed.data.legal.privacyNoticeDocumentId ===
        identityFixtureIds.privacyNotice;
    if (!exactDocuments) {
      return mockProblemResponse(
        identityOnboardingProblemSchema,
        identityOnboardingProblemFixtures.stale_legal,
        { fixtureName: 'identity.mock.onboarding-stale-legal' },
      );
    }

    const fingerprint = await opaqueFingerprint(JSON.stringify(parsed.data));
    const previous = mockActivationState.onboardingRequests.get(
      idempotencyKey.data,
    );
    if (
      previous &&
      (previous.fingerprint !== fingerprint ||
        previous.principal !== mockActivationState.currentPrincipal ||
        previous.sessionGeneration !== mockActivationState.sessionGeneration)
    ) {
      return mockProblemResponse(
        identityOnboardingProblemSchema,
        identityOnboardingProblemFixtures.idempotency_key_reused,
        { fixtureName: 'identity.mock.onboarding-key-reused' },
      );
    }
    if (mockActivationState.principalActive && !previous) {
      return mockProblemResponse(
        identityOnboardingProblemSchema,
        identityOnboardingProblemFixtures.validation,
        { fixtureName: 'identity.mock.onboarding-phase' },
      );
    }
    const normalizedProfile: MockIdentityProfile = {
      ...parsed.data.profile,
      phone: parsed.data.profile.phone ?? null,
    };
    const record = previous ?? {
      fingerprint,
      principal: mockActivationState.currentPrincipal,
      profile: normalizedProfile,
      sessionGeneration: mockActivationState.sessionGeneration,
    };
    if (!previous) {
      mockActivationState.onboardingRequests.set(idempotencyKey.data, record);
      mockActivationState.onboarding = {
        profile: record.profile,
      };
      mockActivationState.principalActive = true;
      mockActivationState.signedOut = false;
      mockIdentityState.profile = { ...record.profile };
      mockIdentityState.profileManagementState = 'editable';
      mockIdentityState.profileVersion = 1;
      mockIdentityState.profileUpdatedAt =
        identityProfileUpdateFixtures.updated!.updatedAt;
      mockIdentityState.privacyRequests.clear();
      mockIdentityState.privacyRequestByKind.clear();
    }
    const completion = identityOnboardingFixtures.complete;
    return mockJsonResponse(
      identityOnboardingResponseSchema,
      {
        ...completion,
        profile: record.profile,
      },
      {
        fixtureName: 'identity.mock.onboarding',
        cacheControl: 'private, no-store',
        vary: ['authorization', 'cookie'],
      },
    );
  }),
  http.patch('*/api/v1/me/profile', async ({ request }) => {
    if (!hasActiveParticipantAccess()) {
      return mockProblemResponse(
        identityProfileUpdateProblemSchema,
        identityProfileUpdateProblemFixtures.authentication,
        { fixtureName: 'identity.mock.profile-signed-out' },
      );
    }
    if (!mockIdentityState.eventAccess) {
      return mockProblemResponse(
        identityProfileUpdateProblemSchema,
        identityProfileUpdateProblemFixtures.permission,
        { fixtureName: 'identity.mock.profile-permission' },
      );
    }

    const body = await request.json().catch(() => undefined);
    const parsed = identityProfileUpdateRequestSchema.safeParse(body);
    const url = new URL(request.url);
    if (
      !parsed.success ||
      url.search.length > 0 ||
      request.headers.has('idempotency-key') ||
      request.headers.has('if-match')
    ) {
      return mockProblemResponse(
        identityProfileUpdateProblemSchema,
        identityProfileUpdateProblemFixtures.validation,
        { fixtureName: 'identity.mock.profile-validation' },
      );
    }
    if (mockIdentityState.profileManagementState === 'missing') {
      return mockProblemResponse(
        identityProfileUpdateProblemSchema,
        identityProfileUpdateProblemFixtures.not_found,
        { fixtureName: 'identity.mock.profile-not-found' },
      );
    }
    if (mockIdentityState.profileManagementState !== 'editable') {
      return mockProblemResponse(
        identityProfileUpdateProblemSchema,
        identityProfileUpdateProblemFixtures.not_editable,
        { fixtureName: 'identity.mock.profile-not-editable' },
      );
    }
    if (mockIdentityState.profile === null) {
      return mockProblemResponse(
        identityProfileUpdateProblemSchema,
        identityProfileUpdateProblemFixtures.not_found,
        { fixtureName: 'identity.mock.profile-not-found' },
      );
    }
    if (parsed.data.expectedVersion !== mockIdentityState.profileVersion) {
      return mockProblemResponse(
        identityProfileUpdateProblemSchema,
        {
          ...identityProfileUpdateProblemFixtures.stale,
          currentVersion: mockIdentityState.profileVersion,
        },
        { fixtureName: 'identity.mock.profile-stale' },
      );
    }

    mockIdentityState.profile = {
      ...parsed.data.profile,
      phone: parsed.data.profile.phone ?? null,
    };
    mockIdentityState.profileVersion += 1;
    const fixtureUpdatedAt = Date.parse(
      identityProfileUpdateFixtures.updated!.updatedAt,
    );
    mockIdentityState.profileUpdatedAt = new Date(
      fixtureUpdatedAt +
        Math.max(0, mockIdentityState.profileVersion - 2) * 1000,
    ).toISOString();

    return mockJsonResponse(
      identityProfileUpdateResponseSchema,
      {
        ...identityProfileUpdateFixtures.updated,
        userId: mockCurrentUser.id,
        profile: mockIdentityState.profile,
        profileManagement: {
          state: 'editable',
          version: mockIdentityState.profileVersion,
        },
        updatedAt: mockIdentityState.profileUpdatedAt,
      },
      {
        fixtureName: 'identity.mock.profile',
        cacheControl: 'private, no-store',
        vary: ['authorization', 'cookie'],
      },
    );
  }),
  http.post('*/api/v1/me/privacy-requests', async ({ request }) => {
    if (!hasActiveParticipantAccess()) {
      return mockProblemResponse(
        identityPrivacyRequestProblemSchema,
        identityPrivacyRequestProblemFixtures.authentication,
        { fixtureName: 'identity.mock.privacy-signed-out' },
      );
    }
    if (!mockIdentityState.eventAccess) {
      return mockProblemResponse(
        identityPrivacyRequestProblemSchema,
        identityPrivacyRequestProblemFixtures.permission,
        { fixtureName: 'identity.mock.privacy-permission' },
      );
    }

    const body = await request.json().catch(() => undefined);
    const parsed = identityPrivacyRequestRequestSchema.safeParse(body);
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get('idempotency-key'),
    );
    const url = new URL(request.url);
    if (
      !parsed.success ||
      !idempotencyKey.success ||
      url.search.length > 0 ||
      request.headers.has('if-match')
    ) {
      return mockProblemResponse(
        identityPrivacyRequestProblemSchema,
        identityPrivacyRequestProblemFixtures.validation,
        { fixtureName: 'identity.mock.privacy-validation' },
      );
    }

    const fingerprint = await opaqueFingerprint(JSON.stringify(parsed.data));
    const previous = mockIdentityState.privacyRequests.get(idempotencyKey.data);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        return mockProblemResponse(
          identityPrivacyRequestProblemSchema,
          identityPrivacyRequestProblemFixtures.key_reused,
          { fixtureName: 'identity.mock.privacy-key-reused' },
        );
      }
      return mockJsonResponse(
        identityPrivacyRequestResponseSchema,
        previous.response,
        {
          fixtureName: 'identity.mock.privacy-replay',
          status: 202,
          cacheControl: 'private, no-store',
          vary: ['authorization', 'cookie'],
        },
      );
    }
    if (mockIdentityState.privacyRequestByKind.has(parsed.data.kind)) {
      return mockProblemResponse(
        identityPrivacyRequestProblemSchema,
        identityPrivacyRequestProblemFixtures.unavailable,
        { fixtureName: 'identity.mock.privacy-unavailable' },
      );
    }

    const response = {
      ...identityPrivacyRequestFixtures.deletion_pending!,
      userId: mockCurrentUser.id,
    };
    mockIdentityState.privacyRequests.set(idempotencyKey.data, {
      fingerprint,
      response,
    });
    mockIdentityState.privacyRequestByKind.set(parsed.data.kind, response);

    return mockJsonResponse(identityPrivacyRequestResponseSchema, response, {
      fixtureName: 'identity.mock.privacy',
      status: 202,
      cacheControl: 'private, no-store',
      vary: ['authorization', 'cookie'],
    });
  }),
  http.post('*/api/v1/me/session-action', async ({ request }) => {
    const body = await request.json().catch(() => undefined);
    const parsed = identitySessionActionRequestSchema.safeParse(body);
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get('idempotency-key'),
    );
    if (!parsed.success || !idempotencyKey.success) {
      return mockProblemResponse(
        identitySessionActionProblemSchema,
        identitySessionActionProblemFixtures.rejected,
        { fixtureName: 'identity.mock.session-action-invalid' },
      );
    }
    const previous = mockActivationState.sessionActions.get(
      idempotencyKey.data,
    );
    if (
      previous &&
      (previous.action !== parsed.data.action ||
        previous.principal !== mockActivationState.currentPrincipal ||
        previous.sessionGeneration !== mockActivationState.sessionGeneration)
    ) {
      return mockProblemResponse(
        identitySessionActionProblemSchema,
        identitySessionActionProblemFixtures.idempotency_key_reused,
        { fixtureName: 'identity.mock.session-action-key-reused' },
      );
    }
    if (!previous && mockActivationState.signedOut) {
      return mockProblemResponse(
        identitySessionActionProblemSchema,
        identitySessionActionProblemFixtures.authentication,
        { fixtureName: 'identity.mock.session-action-signed-out' },
      );
    }
    if (!previous) {
      mockActivationState.sessionActions.set(idempotencyKey.data, {
        action: parsed.data.action,
        principal: mockActivationState.currentPrincipal,
        sessionGeneration: mockActivationState.sessionGeneration,
      });
      mockPrincipalSnapshots.set(
        mockActivationState.currentPrincipal,
        captureMockPrincipal(),
      );
      mockActivationState.recoveryPrincipal =
        parsed.data.action === 'switch_account'
          ? mockActivationState.currentPrincipal === 'primary'
            ? 'alternate'
            : 'primary'
          : mockActivationState.currentPrincipal;
      mockActivationState.claimed = false;
      mockActivationState.principalActive = false;
      mockActivationState.signedOut = true;
      mockActivationState.claims.clear();
      mockActivationState.identities.clear();
      mockActivationState.recoveries.clear();
    }
    return mockJsonResponse(
      identitySessionActionResponseSchema,
      identitySessionActionFixtures[parsed.data.action],
      {
        fixtureName: 'identity.mock.session-action',
        cacheControl: 'private, no-store',
        vary: ['authorization', 'cookie'],
      },
    );
  }),
  http.get('*/api/v1/me/agenda', ({ request }) => {
    configureMockParticipantFromRequest(request);
    if (!hasActiveParticipantAccess()) {
      return mockProblemResponse(
        participantAgendaProblemSchema,
        participantAgendaProblemFixtures.authentication,
        { fixtureName: 'agenda.mock.read-authentication' },
      );
    }
    if (!mockIdentityState.eventAccess) {
      return mockProblemResponse(
        participantAgendaProblemSchema,
        participantAgendaProblemFixtures.permission,
        { fixtureName: 'agenda.mock.read-permission' },
      );
    }
    if (!mockAgendaState.featureEnabled) {
      return mockProblemResponse(
        participantAgendaProblemSchema,
        participantAgendaProblemFixtures.disabled,
        { fixtureName: 'agenda.mock.read-disabled' },
      );
    }
    if (new URL(request.url).search.length > 0) {
      return mockProblemResponse(
        participantAgendaProblemSchema,
        participantAgendaProblemFixtures.validation,
        { fixtureName: 'agenda.mock.read-validation' },
      );
    }

    return mockJsonResponse(
      participantAgendaResponseSchema,
      canonicalAgendaForCurrentPrincipal(),
      {
        fixtureName: 'agenda.mock.read',
        cacheControl: 'private, no-store',
        vary: ['authorization', 'cookie'],
      },
    );
  }),
  http.get('*/api/v1/me/agenda.ics', ({ request }) => {
    configureMockParticipantFromRequest(request);
    if (!hasActiveParticipantAccess()) {
      return mockProblemResponse(
        participantAgendaProblemSchema,
        participantAgendaProblemFixtures.authentication,
        { fixtureName: 'agenda.mock.calendar-authentication' },
      );
    }
    if (!mockIdentityState.eventAccess) {
      return mockProblemResponse(
        participantAgendaProblemSchema,
        participantAgendaProblemFixtures.permission,
        { fixtureName: 'agenda.mock.calendar-permission' },
      );
    }
    if (!mockAgendaState.featureEnabled) {
      return mockProblemResponse(
        participantAgendaProblemSchema,
        participantAgendaProblemFixtures.disabled,
        { fixtureName: 'agenda.mock.calendar-disabled' },
      );
    }
    if (new URL(request.url).search.length > 0) {
      return mockProblemResponse(
        participantAgendaProblemSchema,
        participantAgendaProblemFixtures.validation,
        { fixtureName: 'agenda.mock.calendar-validation' },
      );
    }

    return new HttpResponse(
      participantAgendaCalendar(canonicalAgendaForCurrentPrincipal()),
      {
        headers: {
          'cache-control': 'private, no-store',
          'content-disposition':
            'attachment; filename="byzon-2026-moje-agenda.ics"',
          'content-type': 'text/calendar; charset=utf-8',
          vary: 'authorization, cookie',
          'x-request-id': 'mock-request-0001',
        },
      },
    );
  }),
  http.post('*/api/v1/me/agenda/actions', async ({ request }) => {
    configureMockParticipantFromRequest(request);
    if (!hasActiveParticipantAccess()) {
      return mockProblemResponse(
        participantAgendaMutationProblemSchema,
        participantAgendaMutationProblemFixtures.authentication,
        { fixtureName: 'agenda.mock.action-authentication' },
      );
    }
    if (!mockIdentityState.eventAccess) {
      return mockProblemResponse(
        participantAgendaMutationProblemSchema,
        participantAgendaMutationProblemFixtures.permission,
        { fixtureName: 'agenda.mock.action-permission' },
      );
    }
    if (!mockAgendaState.featureEnabled) {
      return mockProblemResponse(
        participantAgendaMutationProblemSchema,
        participantAgendaMutationProblemFixtures.disabled,
        { fixtureName: 'agenda.mock.action-disabled' },
      );
    }
    const requestContext = captureMockAgendaRequestContext();

    const body = await request.json().catch(() => undefined);
    const bodyContextFailure = mockAgendaRequestContextFailure(
      requestContext,
      'agenda.mock.action-after-body',
    );
    if (bodyContextFailure) return bodyContextFailure;
    const parsed = participantAgendaMutationRequestSchema.safeParse(body);
    const idempotencyKey = idempotencyKeySchema.safeParse(
      request.headers.get('idempotency-key'),
    );
    const url = new URL(request.url);
    if (
      !parsed.success ||
      !idempotencyKey.success ||
      url.search.length > 0 ||
      request.headers.has('if-match')
    ) {
      return mockProblemResponse(
        participantAgendaMutationProblemSchema,
        participantAgendaMutationProblemFixtures.validation,
        { fixtureName: 'agenda.mock.action-validation' },
      );
    }

    const fingerprint = await opaqueFingerprint(JSON.stringify(parsed.data));
    const fingerprintContextFailure = mockAgendaRequestContextFailure(
      requestContext,
      'agenda.mock.action-after-fingerprint',
    );
    if (fingerprintContextFailure) return fingerprintContextFailure;
    const claimedFingerprint = mockAgendaState.actionFingerprints.get(
      idempotencyKey.data,
    );
    if (claimedFingerprint && claimedFingerprint !== fingerprint) {
      return mockProblemResponse(
        participantAgendaMutationProblemSchema,
        participantAgendaMutationProblemFixtures.key_reused,
        { fixtureName: 'agenda.mock.action-key-reused' },
      );
    }
    if (!claimedFingerprint) {
      mockAgendaState.actionFingerprints.set(idempotencyKey.data, fingerprint);
    }
    const previous = mockAgendaState.actionRequests.get(idempotencyKey.data);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        return mockProblemResponse(
          participantAgendaMutationProblemSchema,
          participantAgendaMutationProblemFixtures.key_reused,
          { fixtureName: 'agenda.mock.action-key-reused' },
        );
      }
      return mockStoredAgendaResultResponse(
        previous.result,
        'agenda.mock.action-replay',
      );
    }
    const inFlight = mockAgendaState.inFlightActionRequests.get(
      idempotencyKey.data,
    );
    if (inFlight) {
      if (inFlight.fingerprint !== fingerprint) {
        return mockProblemResponse(
          participantAgendaMutationProblemSchema,
          participantAgendaMutationProblemFixtures.key_reused,
          { fixtureName: 'agenda.mock.action-in-flight-key-reused' },
        );
      }
      const result = await inFlight.result;
      const replayContextFailure = mockAgendaRequestContextFailure(
        requestContext,
        'agenda.mock.action-after-in-flight',
      );
      if (replayContextFailure) return replayContextFailure;
      if (result === null) {
        return mockProblemResponse(
          participantAgendaMutationProblemSchema,
          participantAgendaMutationProblemFixtures.in_progress,
          { fixtureName: 'agenda.mock.action-in-flight-failed' },
        );
      }
      return mockStoredAgendaResultResponse(
        result,
        'agenda.mock.action-in-flight-replay',
      );
    }

    let resolveInFlight:
      ((result: MockAgendaStoredResult | null) => void) | undefined;
    let inFlightResolved = false;
    const inFlightResult = new Promise<MockAgendaStoredResult | null>(
      (resolve) => {
        resolveInFlight = resolve;
      },
    );
    mockAgendaState.inFlightActionRequests.set(idempotencyKey.data, {
      fingerprint,
      result: inFlightResult,
    });
    const actionPause = nextMockAgendaActionPause;
    nextMockAgendaActionPause = null;

    try {
      if (actionPause) {
        actionPause.entered();
        await actionPause.wait;
      }
      await Promise.resolve();
      const executionContextFailure = mockAgendaRequestContextFailure(
        requestContext,
        'agenda.mock.action-before-apply',
      );
      if (executionContextFailure) return executionContextFailure;

      const completeResult = (
        result: MockAgendaStoredResult,
        fixtureName: string,
      ) => {
        mockAgendaState.actionRequests.set(idempotencyKey.data, {
          fingerprint,
          result,
        });
        inFlightResolved = true;
        resolveInFlight?.(result);
        return mockStoredAgendaResultResponse(result, fixtureName);
      };
      const completeProblem = (candidate: unknown, fixtureName: string) =>
        completeResult(
          {
            kind: 'problem',
            problem: participantAgendaMutationProblemSchema.parse(candidate),
          },
          fixtureName,
        );

      const canonicalAgenda = canonicalAgendaForCurrentPrincipal();
      if (parsed.data.expectedVersion !== mockAgendaState.version) {
        return completeProblem(
          {
            ...participantAgendaMutationProblemFixtures.stale_version,
            currentVersion: canonicalAgenda.version,
            agenda: canonicalAgenda,
          },
          'agenda.mock.action-stale',
        );
      }

      const application = applyMockAgendaAction(parsed.data);
      if (application.kind === 'failure') {
        if (application.failure === 'capacity_full') {
          return completeProblem(
            {
              ...participantAgendaMutationProblemFixtures.capacity_full,
              sessionId: parsed.data.sessionId,
              agenda: canonicalAgenda,
            },
            'agenda.mock.action-capacity-full',
          );
        }
        if (application.failure === 'reservation_closed') {
          return completeProblem(
            {
              ...participantAgendaMutationProblemFixtures.reservation_closed,
              sessionId: parsed.data.sessionId,
              agenda: canonicalAgenda,
            },
            'agenda.mock.action-reservation-closed',
          );
        }
        if (application.failure === 'ticket_inactive') {
          return completeProblem(
            {
              ...participantAgendaMutationProblemFixtures.ticket_inactive,
              sessionId: parsed.data.sessionId,
              agenda: canonicalAgenda,
            },
            'agenda.mock.action-ticket-inactive',
          );
        }
        return completeProblem(
          application.failure === 'session_not_found'
            ? participantAgendaMutationProblemFixtures.session_not_found
            : participantAgendaMutationProblemFixtures.validation,
          `agenda.mock.action-${application.failure}`,
        );
      }

      const mutation = {
        sessionId: parsed.data.sessionId,
        action: parsed.data.action,
      };
      const successAgenda = canonicalAgendaForCurrentPrincipal();
      const targetSession = successAgenda.items.find(
        ({ session }) => session.id === parsed.data.sessionId,
      )?.session;
      const conflicts =
        targetSession &&
        (parsed.data.action === 'add' ||
          parsed.data.action === 'join_waitlist' ||
          parsed.data.action === 'reserve')
          ? selectMockAgendaConflictingSessions(
              successAgenda.items.map(({ session }) => session),
              targetSession,
            )
          : [];
      const response = participantAgendaMutationResponseSchema.parse({
        ...successAgenda,
        mutation: {
          ...mutation,
          outcome: application.outcome,
        },
        timeConflict:
          targetSession && conflicts.length > 0
            ? {
                eventId: successAgenda.eventId,
                sessionId: targetSession.id,
                targetSession,
                conflictingSessions: conflicts,
              }
            : null,
      });
      return completeResult(
        {
          kind: 'success',
          response,
        },
        'agenda.mock.action',
      );
    } finally {
      if (!inFlightResolved) resolveInFlight?.(null);
      clearMockAgendaInFlightRequest(requestContext, idempotencyKey.data);
    }
  }),
  http.get('*/api/v1/me/announcements', ({ request }) => {
    if (!hasActiveParticipantAccess()) {
      return mockProblemResponse(
        participantAnnouncementInboxProblemSchema,
        participantAnnouncementInboxProblemFixtures.authentication,
        { fixtureName: 'announcements.mock.inbox-authentication' },
      );
    }
    if (!mockIdentityState.eventAccess) {
      return mockProblemResponse(
        participantAnnouncementInboxProblemSchema,
        participantAnnouncementInboxProblemFixtures.permission,
        { fixtureName: 'announcements.mock.inbox-permission' },
      );
    }
    if (!mockAnnouncementState.featureEnabled) {
      return mockProblemResponse(
        participantAnnouncementInboxProblemSchema,
        participantAnnouncementInboxProblemFixtures.disabled,
        { fixtureName: 'announcements.mock.inbox-disabled' },
      );
    }

    const url = new URL(request.url);
    const allowedQueryKeys = new Set(['filter', 'cursor', 'limit']);
    const hasUnknownOrRepeatedQuery = [...url.searchParams.keys()].some(
      (key) =>
        !allowedQueryKeys.has(key) || url.searchParams.getAll(key).length !== 1,
    );
    const rawLimit = url.searchParams.get('limit');
    const query = announcementInboxQuerySchema.safeParse({
      filter: url.searchParams.get('filter') ?? undefined,
      ...(url.searchParams.has('cursor')
        ? { cursor: url.searchParams.get('cursor') }
        : {}),
      ...(rawLimit !== null && /^\d+$/.test(rawLimit)
        ? { limit: Number(rawLimit) }
        : rawLimit === null
          ? {}
          : { limit: rawLimit }),
    });
    if (hasUnknownOrRepeatedQuery || !query.success) {
      return mockProblemResponse(
        participantAnnouncementInboxProblemSchema,
        participantAnnouncementInboxProblemFixtures.validation,
        { fixtureName: 'announcements.mock.inbox-validation' },
      );
    }

    const allItems = recipientAnnouncementItems().map((item) => ({
      ...item,
      readAt: mockAnnouncementState.readAtById.get(item.id) ?? null,
    }));
    const filteredItems =
      query.data.filter === 'unread'
        ? allItems.filter(({ readAt }) => readAt === null)
        : allItems;
    const offset = announcementOffsetFromCursor(
      query.data.cursor,
      filteredItems.length,
    );
    if (offset === null) {
      return mockProblemResponse(
        participantAnnouncementInboxProblemSchema,
        participantAnnouncementInboxProblemFixtures.validation,
        { fixtureName: 'announcements.mock.inbox-validation' },
      );
    }
    const limit = query.data.limit ?? 50;
    const items = filteredItems.slice(offset, offset + limit);
    const hasMore = offset + items.length < filteredItems.length;
    const unreadCount = canonicalAnnouncementUnreadCount();

    return mockJsonResponse(
      participantAnnouncementInboxResponseSchema,
      {
        eventId: announcementFixtureIds.event,
        items,
        pageInfo: {
          nextCursor: hasMore
            ? announcementCursorForOffset(offset + items.length)
            : null,
          hasMore,
        },
        unreadCount,
      },
      {
        fixtureName: 'announcements.mock.inbox',
        cacheControl: 'private, no-store',
        vary: ['authorization', 'cookie'],
      },
    );
  }),
  http.get(
    '*/api/v1/me/announcements/:announcementId',
    ({ params, request }) => {
      if (!hasActiveParticipantAccess()) {
        return mockProblemResponse(
          participantAnnouncementDetailProblemSchema,
          participantAnnouncementDetailProblemFixtures.authentication,
          { fixtureName: 'announcements.mock.detail-authentication' },
        );
      }
      if (!mockIdentityState.eventAccess) {
        return mockProblemResponse(
          participantAnnouncementDetailProblemSchema,
          participantAnnouncementDetailProblemFixtures.permission,
          { fixtureName: 'announcements.mock.detail-permission' },
        );
      }
      if (!mockAnnouncementState.featureEnabled) {
        return mockProblemResponse(
          participantAnnouncementDetailProblemSchema,
          participantAnnouncementDetailProblemFixtures.disabled,
          { fixtureName: 'announcements.mock.detail-disabled' },
        );
      }

      const parsed = participantAnnouncementParamsSchema.safeParse({
        announcementId: String(params.announcementId),
      });
      if (!parsed.success || new URL(request.url).search.length > 0) {
        return mockProblemResponse(
          participantAnnouncementDetailProblemSchema,
          participantAnnouncementDetailProblemFixtures.validation,
          { fixtureName: 'announcements.mock.detail-validation' },
        );
      }

      const fixture =
        parsed.data.announcementId === announcementFixtureIds.critical
          ? participantAnnouncementDetailFixtures.critical
          : parsed.data.announcementId === announcementFixtureIds.important
            ? participantAnnouncementDetailFixtures.unread
            : parsed.data.announcementId === announcementFixtureIds.information
              ? participantAnnouncementDetailFixtures.read
              : undefined;
      if (!fixture || !isRecipientAnnouncement(parsed.data.announcementId)) {
        return mockProblemResponse(
          participantAnnouncementDetailProblemSchema,
          participantAnnouncementDetailProblemFixtures.not_found,
          { fixtureName: 'announcements.mock.detail-not-found' },
        );
      }

      return mockJsonResponse(
        participantAnnouncementDetailResponseSchema,
        {
          ...fixture,
          announcement: {
            ...fixture.announcement,
            readAt:
              mockAnnouncementState.readAtById.get(fixture.announcement.id) ??
              null,
          },
        },
        {
          fixtureName: 'announcements.mock.detail',
          cacheControl: 'private, no-store',
          vary: ['authorization', 'cookie'],
        },
      );
    },
  ),
  http.post(
    '*/api/v1/me/announcements/:announcementId/read',
    async ({ params, request }) => {
      if (!hasActiveParticipantAccess()) {
        return mockProblemResponse(
          participantAnnouncementReadProblemSchema,
          participantAnnouncementReadProblemFixtures.authentication,
          { fixtureName: 'announcements.mock.read-authentication' },
        );
      }
      if (!mockIdentityState.eventAccess) {
        return mockProblemResponse(
          participantAnnouncementReadProblemSchema,
          participantAnnouncementReadProblemFixtures.permission,
          { fixtureName: 'announcements.mock.read-permission' },
        );
      }
      if (!mockAnnouncementState.featureEnabled) {
        return mockProblemResponse(
          participantAnnouncementReadProblemSchema,
          participantAnnouncementReadProblemFixtures.disabled,
          { fixtureName: 'announcements.mock.read-disabled' },
        );
      }

      const parsed = participantAnnouncementParamsSchema.safeParse({
        announcementId: String(params.announcementId),
      });
      const idempotencyKey = idempotencyKeySchema.safeParse(
        request.headers.get('idempotency-key'),
      );
      const url = new URL(request.url);
      const body = await request.text().catch(() => undefined);
      if (
        !parsed.success ||
        !idempotencyKey.success ||
        url.search.length > 0 ||
        body !== ''
      ) {
        return mockProblemResponse(
          participantAnnouncementReadProblemSchema,
          participantAnnouncementReadProblemFixtures.validation,
          { fixtureName: 'announcements.mock.read-validation' },
        );
      }

      const announcementExistsForRecipient =
        new Set<string>([
          announcementFixtureIds.critical,
          announcementFixtureIds.important,
          announcementFixtureIds.information,
        ]).has(parsed.data.announcementId) &&
        isRecipientAnnouncement(parsed.data.announcementId);
      if (!announcementExistsForRecipient) {
        return mockProblemResponse(
          participantAnnouncementReadProblemSchema,
          participantAnnouncementReadProblemFixtures.not_found,
          { fixtureName: 'announcements.mock.read-not-found' },
        );
      }

      const fingerprint = await opaqueFingerprint(
        `${request.method}:${url.pathname}`,
      );
      const previous = mockAnnouncementState.readRequests.get(
        idempotencyKey.data,
      );
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          return mockProblemResponse(
            participantAnnouncementReadProblemSchema,
            participantAnnouncementReadProblemFixtures.key_reused,
            { fixtureName: 'announcements.mock.read-key-reused' },
          );
        }
        return mockJsonResponse(
          participantAnnouncementReadResponseSchema,
          previous.response,
          {
            fixtureName: 'announcements.mock.read-replay',
            cacheControl: 'private, no-store',
            vary: ['authorization', 'cookie'],
          },
        );
      }

      const existingReadAt = mockAnnouncementState.readAtById.get(
        parsed.data.announcementId,
      );
      const readAt =
        existingReadAt ??
        (parsed.data.announcementId === announcementFixtureIds.critical
          ? '2026-09-19T07:35:00.000Z'
          : participantAnnouncementReadFixtures.success!.readAt);
      mockAnnouncementState.readAtById.set(parsed.data.announcementId, readAt);
      const response = {
        eventId: announcementFixtureIds.event,
        announcementId: parsed.data.announcementId,
        state: 'read' as const,
        readAt,
        unreadCount: canonicalAnnouncementUnreadCount(),
      };
      mockAnnouncementState.readRequests.set(idempotencyKey.data, {
        fingerprint,
        response,
      });

      return mockJsonResponse(
        participantAnnouncementReadResponseSchema,
        response,
        {
          fixtureName: 'announcements.mock.read',
          cacheControl: 'private, no-store',
          vary: ['authorization', 'cookie'],
        },
      );
    },
  ),
  http.get('*/api/v1/events/:eventId/program', ({ params }) => {
    if (!hasActiveParticipantAccess()) {
      return mockProblemResponse(
        participantProgramProblemSchema,
        participantProgramProblemFixtures.authentication,
        { fixtureName: 'content.mock.program-authentication' },
      );
    }
    if (!mockIdentityState.eventAccess) {
      return mockProblemResponse(
        participantProgramProblemSchema,
        participantProgramProblemFixtures.permission,
        { fixtureName: 'content.mock.program-permission' },
      );
    }
    if (String(params.eventId) !== contentFixtureIds.event) {
      return mockProblemResponse(
        participantProgramProblemSchema,
        participantProgramProblemFixtures.permission,
        { fixtureName: 'content.mock.program-event-scope' },
      );
    }

    return mockJsonResponse(
      participantProgramResponseSchema,
      participantProgramFixtures.happy,
      {
        fixtureName: 'content.mock.program',
        etag: '"content-program-v3"',
        cacheControl: 'private, no-store',
        vary: ['authorization', 'cookie'],
      },
    );
  }),
  http.get('*/api/v1/events/:eventId/content', ({ params }) => {
    if (!hasActiveParticipantAccess()) {
      return mockProblemResponse(
        participantContentProblemSchema,
        participantContentProblemFixtures.authentication,
        { fixtureName: 'content.mock.directory-authentication' },
      );
    }
    if (!mockIdentityState.eventAccess) {
      return mockProblemResponse(
        participantContentProblemSchema,
        participantContentProblemFixtures.permission,
        { fixtureName: 'content.mock.directory-permission' },
      );
    }
    if (String(params.eventId) !== contentFixtureIds.event) {
      return mockProblemResponse(
        participantContentProblemSchema,
        participantContentProblemFixtures.permission,
        { fixtureName: 'content.mock.directory-event-scope' },
      );
    }

    return mockJsonResponse(
      participantContentResponseSchema,
      participantContentFixtures.happy,
      {
        fixtureName: 'content.mock.directory',
        etag: '"content-directory-v3"',
        cacheControl: 'private, no-store',
        vary: ['authorization', 'cookie'],
      },
    );
  }),
  http.get('*/api/v1/me/ticket', () => {
    if (!hasActiveParticipantAccess()) {
      return mockProblemResponse(
        participantTicketProblemSchema,
        participantTicketProblemFixtures.authentication,
        { fixtureName: 'ticket.mock.participant-authentication' },
      );
    }
    if (!mockIdentityState.eventAccess) {
      return mockProblemResponse(
        participantTicketProblemSchema,
        participantTicketProblemFixtures.permission,
        { fixtureName: 'ticket.mock.participant-permission' },
      );
    }
    return mockJsonResponse(
      participantTicketResponseSchema,
      canonicalTicketForCurrentPrincipal(),
      {
        fixtureName: 'ticket.mock.participant',
        cacheControl: 'private, no-store',
        vary: ['authorization', 'cookie'],
      },
    );
  }),
]);
