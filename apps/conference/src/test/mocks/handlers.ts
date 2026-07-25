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
  participantContentProblemSchema,
  participantContentResponseSchema,
  participantProgramProblemSchema,
  participantProgramResponseSchema,
  participantTicketResponseSchema,
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
  activationLinkFixtures,
  activationLinkProblemFixtures,
  activationRecoveryFixtures,
  activationRecoveryProblemFixtures,
  announcementFixtureIds,
  contentFixtureIds,
  identityBootstrapFixtures,
  identityBootstrapProblemFixtures,
  identityFixtureIds,
  identityOnboardingFixtures,
  identityOnboardingProblemFixtures,
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
  participantProgramFixtures,
  participantProgramProblemFixtures,
  participantTicketFixtures,
} from '@byzon/test-support/fixtures';
import { http, type RequestHandler } from 'msw';

import { mockJsonResponse, mockProblemResponse } from './response';

interface MockActivationState {
  claimed: boolean;
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
      outcome: 'active' | 'onboarding_required';
      tokenFingerprint: string;
    }
  >;
  consumedLinkFingerprints: Set<string>;
  sessionActions: Map<
    string,
    {
      action: 'logout_current' | 'logout_all' | 'switch_account';
    }
  >;
  onboardingRequests: Map<
    string,
    {
      fingerprint: string;
      networkingEnabled: boolean;
      profile: {
        firstName: string;
        lastName: string;
        contactEmail: string;
      };
    }
  >;
  onboarding?: {
    networkingEnabled: boolean;
    profile: {
      firstName: string;
      lastName: string;
      contactEmail: string;
    };
  };
}

interface MockAnnouncementState {
  featureEnabled: boolean;
  eventAccess: boolean;
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

const defaultRecipientAnnouncementIds = Object.freeze([
  announcementFixtureIds.critical,
  announcementFixtureIds.important,
  announcementFixtureIds.information,
]);

const mockActivationState: MockActivationState = {
  claimed: false,
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
  eventAccess: true,
  recipientAnnouncementIds: new Set(defaultRecipientAnnouncementIds),
  readAtById: new Map([
    [
      announcementFixtureIds.information,
      participantAnnouncementReadFixtures.already_read!.readAt,
    ],
  ]),
  readRequests: new Map(),
};

export const resetMockActivationState = (): void => {
  mockActivationState.claimed = false;
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

export const resetMockAnnouncementState = (): void => {
  mockAnnouncementState.featureEnabled = true;
  mockAnnouncementState.eventAccess = true;
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
    mockAnnouncementState.eventAccess = options.eventAccess;
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

/**
 * Development preview uses the same success contracts and synthetic fixtures
 * as component tests. Failure-state variants stay explicit in tests instead
 * of adding production-looking query switches to the API.
 */
export const mockHandlers: readonly RequestHandler[] = Object.freeze([
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
    const accepted =
      parsed.success &&
      /^(?:link|recovery-app|recovery-onboarding):[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.data.token,
      );
    const tokenFingerprint = parsed.success
      ? await opaqueFingerprint(parsed.data.token)
      : undefined;
    if (
      !accepted ||
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
      return mockJsonResponse(
        activationLinkResponseSchema,
        activationLinkFixtures[previous.outcome],
        {
          fixtureName: 'activation.mock.link-replay',
          cacheControl: 'private, no-store',
        },
      );
    }
    if (mockActivationState.consumedLinkFingerprints.has(tokenFingerprint)) {
      return mockProblemResponse(
        activationLinkProblemSchema,
        activationLinkProblemFixtures.rejected,
        { fixtureName: 'activation.mock.link-already-consumed' },
      );
    }
    mockActivationState.claimed = false;
    mockActivationState.signedOut = false;
    const outcome = parsed.data.token.startsWith('recovery-app:')
      ? 'active'
      : 'onboarding_required';
    mockActivationState.linkConsumptions.set(idempotencyKey.data, {
      outcome,
      tokenFingerprint,
    });
    mockActivationState.consumedLinkFingerprints.add(tokenFingerprint);
    return mockJsonResponse(
      activationLinkResponseSchema,
      activationLinkFixtures[outcome],
      {
        fixtureName: 'activation.mock.link',
        cacheControl: 'private, no-store',
      },
    );
  }),
  http.get('*/api/v1/me/bootstrap', () => {
    if (mockActivationState.signedOut) {
      return mockProblemResponse(
        identityBootstrapProblemSchema,
        identityBootstrapProblemFixtures.authentication,
        { fixtureName: 'identity.mock.bootstrap-signed-out' },
      );
    }
    const completion = mockActivationState.onboarding;
    const fixture = completion
      ? {
          ...identityBootstrapFixtures.complete,
          profile: completion.profile,
          networking: {
            ...identityBootstrapFixtures.complete!.networking,
            enabled: completion.networkingEnabled,
          },
        }
      : identityBootstrapFixtures.profile_required;
    return mockJsonResponse(
      identityBootstrapResponseSchema,
      {
        ...fixture,
        unreadCounts: {
          ...fixture!.unreadCounts,
          announcements: canonicalAnnouncementUnreadCount(),
        },
      },
      {
        fixtureName: 'identity.mock.bootstrap',
        cacheControl: 'private, no-store',
        vary: ['authorization', 'cookie'],
      },
    );
  }),
  http.post('*/api/v1/me/onboarding', async ({ request }) => {
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
    if (mockActivationState.signedOut) {
      return mockProblemResponse(
        identityOnboardingProblemSchema,
        identityOnboardingProblemFixtures.authentication,
        { fixtureName: 'identity.mock.onboarding-signed-out' },
      );
    }
    const exactDocuments =
      parsed.data.legal.termsDocumentId === identityFixtureIds.terms &&
      parsed.data.legal.privacyNoticeDocumentId ===
        identityFixtureIds.privacyNotice &&
      (!parsed.data.networking.enabled ||
        parsed.data.networking.consentDocumentId ===
          identityFixtureIds.networkingConsent);
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
    if (previous && previous.fingerprint !== fingerprint) {
      return mockProblemResponse(
        identityOnboardingProblemSchema,
        identityOnboardingProblemFixtures.idempotency_key_reused,
        { fixtureName: 'identity.mock.onboarding-key-reused' },
      );
    }
    const record = previous ?? {
      fingerprint,
      networkingEnabled: parsed.data.networking.enabled,
      profile: parsed.data.profile,
    };
    if (!previous) {
      mockActivationState.onboardingRequests.set(idempotencyKey.data, record);
      mockActivationState.onboarding = {
        networkingEnabled: record.networkingEnabled,
        profile: record.profile,
      };
    }
    const completion = record.networkingEnabled
      ? identityOnboardingFixtures.opted_in
      : identityOnboardingFixtures.opted_out;
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
    if (previous && previous.action !== parsed.data.action) {
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
      });
      mockActivationState.claimed = false;
      mockActivationState.signedOut = true;
      mockActivationState.claims.clear();
      mockActivationState.identities.clear();
      mockActivationState.recoveries.clear();
      delete mockActivationState.onboarding;
      mockActivationState.onboardingRequests.clear();
      mockActivationState.linkConsumptions.clear();
      mockActivationState.consumedLinkFingerprints.clear();
      resetMockAnnouncementState();
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
  http.get('*/api/v1/me/announcements', ({ request }) => {
    if (mockActivationState.signedOut) {
      return mockProblemResponse(
        participantAnnouncementInboxProblemSchema,
        participantAnnouncementInboxProblemFixtures.authentication,
        { fixtureName: 'announcements.mock.inbox-authentication' },
      );
    }
    if (!mockAnnouncementState.eventAccess) {
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
      if (mockActivationState.signedOut) {
        return mockProblemResponse(
          participantAnnouncementDetailProblemSchema,
          participantAnnouncementDetailProblemFixtures.authentication,
          { fixtureName: 'announcements.mock.detail-authentication' },
        );
      }
      if (!mockAnnouncementState.eventAccess) {
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
      if (mockActivationState.signedOut) {
        return mockProblemResponse(
          participantAnnouncementReadProblemSchema,
          participantAnnouncementReadProblemFixtures.authentication,
          { fixtureName: 'announcements.mock.read-authentication' },
        );
      }
      if (!mockAnnouncementState.eventAccess) {
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
  http.get('*/api/v1/me/ticket', () =>
    mockJsonResponse(
      participantTicketResponseSchema,
      participantTicketFixtures.valid,
      {
        fixtureName: 'ticket.mock.participant',
        cacheControl: 'private, no-store',
        vary: ['authorization', 'cookie'],
      },
    ),
  ),
]);
