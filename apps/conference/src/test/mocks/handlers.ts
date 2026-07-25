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
  idempotencyKeySchema,
  identityBootstrapProblemSchema,
  identityBootstrapResponseSchema,
  identityOnboardingProblemSchema,
  identityOnboardingRequestSchema,
  identityOnboardingResponseSchema,
  identitySessionActionProblemSchema,
  identitySessionActionRequestSchema,
  identitySessionActionResponseSchema,
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
    return mockJsonResponse(identityBootstrapResponseSchema, fixture, {
      fixtureName: 'identity.mock.bootstrap',
      cacheControl: 'private, no-store',
      vary: ['authorization', 'cookie'],
    });
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
