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
  idempotencyKeySchema,
  identityBootstrapResponseSchema,
  identityOnboardingProblemSchema,
  identityOnboardingRequestSchema,
  identityOnboardingResponseSchema,
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
  activationIdentityFixtures,
  activationIdentityProblemFixtures,
  activationLandingFixtures,
  activationLinkFixtures,
  activationLinkProblemFixtures,
  contentFixtureIds,
  identityBootstrapFixtures,
  identityFixtureIds,
  identityOnboardingFixtures,
  identityOnboardingProblemFixtures,
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
  linkConsumptionKey?: string;
  onboarding?: {
    fingerprint: string;
    idempotencyKey: string;
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
};

export const resetMockActivationState = (): void => {
  mockActivationState.claimed = false;
  delete mockActivationState.linkConsumptionKey;
  delete mockActivationState.onboarding;
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
    const acceptedCameraCode =
      parsed.success &&
      parsed.data.method === 'camera_scan' &&
      /^camera:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.data.code,
      );
    const acceptedManualCode =
      parsed.success &&
      parsed.data.method === 'manual_code' &&
      parsed.data.code === activationFixtureCode;
    if (
      !parsed.success ||
      !idempotencyKey.success ||
      (!acceptedManualCode && !acceptedCameraCode)
    ) {
      return mockProblemResponse(
        activationClaimProblemSchema,
        activationClaimProblemFixtures.rejected,
        { fixtureName: 'activation.mock.claim-rejected' },
      );
    }

    mockActivationState.claimed = true;
    delete mockActivationState.linkConsumptionKey;
    return mockJsonResponse(
      activationClaimResponseSchema,
      activationClaimFixtures.identity_required,
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
    if (
      !parsed.success ||
      !idempotencyKey.success ||
      !mockActivationState.claimed ||
      parsed.data.flowId !== activationFixtureFlowId
    ) {
      return mockProblemResponse(
        activationIdentityProblemSchema,
        activationIdentityProblemFixtures.expired,
        { fixtureName: 'activation.mock.identity-expired' },
      );
    }
    return mockJsonResponse(
      activationIdentityResponseSchema,
      activationIdentityFixtures.link_sent,
      {
        fixtureName: 'activation.mock.identity',
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
      /^link:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        parsed.data.token,
      );
    const replay =
      idempotencyKey.success &&
      mockActivationState.linkConsumptionKey === idempotencyKey.data;
    const alreadyConsumed =
      mockActivationState.linkConsumptionKey !== undefined;
    if (!accepted || !idempotencyKey.success || (alreadyConsumed && !replay)) {
      return mockProblemResponse(
        activationLinkProblemSchema,
        activationLinkProblemFixtures.rejected,
        { fixtureName: 'activation.mock.link-rejected' },
      );
    }
    mockActivationState.claimed = false;
    mockActivationState.linkConsumptionKey = idempotencyKey.data;
    return mockJsonResponse(
      activationLinkResponseSchema,
      activationLinkFixtures.onboarding_required,
      {
        fixtureName: 'activation.mock.link',
        cacheControl: 'private, no-store',
      },
    );
  }),
  http.get('*/api/v1/me/bootstrap', () => {
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

    const fingerprint = JSON.stringify(parsed.data);
    const previous = mockActivationState.onboarding;
    if (
      previous?.idempotencyKey === idempotencyKey.data &&
      previous.fingerprint !== fingerprint
    ) {
      return mockProblemResponse(
        identityOnboardingProblemSchema,
        identityOnboardingProblemFixtures.request_id_reused,
        { fixtureName: 'identity.mock.onboarding-key-reused' },
      );
    }
    const networkingEnabled = parsed.data.networking.enabled;
    if (!previous || previous.idempotencyKey !== idempotencyKey.data) {
      mockActivationState.onboarding = {
        fingerprint,
        idempotencyKey: idempotencyKey.data,
        networkingEnabled,
        profile: parsed.data.profile,
      };
    }
    const completion = networkingEnabled
      ? identityOnboardingFixtures.opted_in
      : identityOnboardingFixtures.opted_out;
    return mockJsonResponse(
      identityOnboardingResponseSchema,
      {
        ...completion,
        profile: parsed.data.profile,
      },
      {
        fixtureName: 'identity.mock.onboarding',
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
