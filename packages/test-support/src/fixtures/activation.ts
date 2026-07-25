import {
  activationClaimProblemSchema,
  activationClaimResponseSchema,
  activationIdentityProblemSchema,
  activationIdentityResponseSchema,
  activationLandingProblemSchema,
  activationLandingResponseSchema,
  activationLinkProblemSchema,
  activationLinkResponseSchema,
  activationRecoveryProblemSchema,
  activationRecoveryResponseSchema,
  problemTypeForCode,
  type ActivationMethod,
} from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';
import { contentFixtureIds } from './content.js';

export const activationFixtureFlowId = 'flow.synthetic.2026';
export const activationFixtureCode = 'TST-OPAQUE-2026';
export const activationFixtureToken = 'link.synthetic.activation.2026';

const event = {
  id: contentFixtureIds.event,
  name: 'BYZON 2026',
  dateLabel: '18.–19. září 2026',
  locationLabel: 'České Budějovice',
  phase: 'activation_open' as const,
};

const openAvailability = {
  state: 'open' as const,
  methods: [
    'manual_code',
    'camera_scan',
    'recovery_link',
  ] satisfies ActivationMethod[],
};

export const activationLandingFixtures = defineFixtureSet({
  name: 'activation.landing',
  schema: activationLandingResponseSchema,
  fixtures: {
    anonymous: {
      event,
      availability: openAvailability,
      flow: { state: 'anonymous' },
    },
    in_progress: {
      event,
      availability: openAvailability,
      flow: {
        state: 'claim_in_progress',
        flowId: activationFixtureFlowId,
        expiresAt: '2026-07-25T13:00:00.000Z',
        nextStep: 'identity',
        membershipCreated: false,
        sessionCreated: false,
      },
    },
    activated: {
      event,
      availability: openAvailability,
      flow: { state: 'activated', continueTo: '/app' },
    },
    suspended: {
      event,
      availability: openAvailability,
      flow: {
        state: 'suspended',
        supportReference: 'MOCK-SUSPENDED-2026',
      },
    },
    closed_before: {
      event: { ...event, phase: 'draft' },
      availability: {
        state: 'closed',
        reason: 'not_open_yet',
        methods: [],
      },
      flow: { state: 'anonymous' },
    },
    closed_ended: {
      event: { ...event, phase: 'ended' },
      availability: {
        state: 'closed',
        reason: 'event_ended',
        methods: [],
      },
      flow: { state: 'anonymous' },
    },
    closed_archived: {
      event: { ...event, phase: 'archived' },
      availability: {
        state: 'closed',
        reason: 'event_archived',
        methods: [],
      },
      flow: { state: 'anonymous' },
    },
  },
});

export const activationClaimFixtures = defineFixtureSet({
  name: 'activation.claim',
  schema: activationClaimResponseSchema,
  fixtures: {
    identity_required: {
      state: 'identity_required',
      flowId: activationFixtureFlowId,
      expiresAt: '2026-07-25T13:00:00.000Z',
      membershipCreated: false,
      sessionCreated: false,
    },
    recovery_required: {
      state: 'recovery_required',
      flowId: activationFixtureFlowId,
      expiresAt: '2026-07-25T13:00:00.000Z',
      membershipCreated: false,
      sessionCreated: false,
    },
  },
});

export const activationIdentityFixtures = defineFixtureSet({
  name: 'activation.identity',
  schema: activationIdentityResponseSchema,
  fixtures: {
    link_sent: {
      state: 'link_sent',
      flowId: activationFixtureFlowId,
      expiresAt: '2026-07-25T13:05:00.000Z',
      resendAfterSeconds: 60,
      membershipCreated: false,
      sessionCreated: false,
    },
  },
});

export const activationLinkFixtures = defineFixtureSet({
  name: 'activation.link',
  schema: activationLinkResponseSchema,
  fixtures: {
    onboarding_required: {
      state: 'onboarding_required',
      continueTo: '/onboarding',
    },
    active: {
      state: 'active',
      continueTo: '/app',
    },
  },
});

export const activationRecoveryFixtures = defineFixtureSet({
  name: 'activation.recovery',
  schema: activationRecoveryResponseSchema,
  fixtures: {
    accepted: {
      accepted: true,
      resendAfterSeconds: 60,
    },
  },
});

interface ActivationProblemStatus {
  readonly ACTIVATION_CLOSED: 409;
  readonly ACTIVATION_FLOW_EXPIRED: 410;
  readonly ACTIVATION_LINK_REJECTED: 400;
  readonly AUTH_SESSION_EXPIRED: 401;
  readonly CLAIM_RATE_LIMITED: 429;
  readonly CLAIM_REJECTED: 400;
  readonly INTERNAL_ERROR: 500;
}

const problem = <Code extends keyof ActivationProblemStatus>(
  code: Code,
  status: ActivationProblemStatus[Code],
) => ({
  type: problemTypeForCode(code),
  title: 'Activation fixture problem',
  status,
  code,
  detail: 'Synthetic activation fixture failure.',
  requestId: 'fixture-activation-0001',
});

export const activationLandingProblemFixtures = defineFixtureSet({
  name: 'activation.landing-problem',
  schema: activationLandingProblemSchema,
  fixtures: {
    closed: problem('ACTIVATION_CLOSED', 409),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const activationClaimProblemFixtures = defineFixtureSet({
  name: 'activation.claim-problem',
  schema: activationClaimProblemSchema,
  fixtures: {
    rejected: problem('CLAIM_REJECTED', 400),
    closed: problem('ACTIVATION_CLOSED', 409),
    rate_limited: problem('CLAIM_RATE_LIMITED', 429),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const activationIdentityProblemFixtures = defineFixtureSet({
  name: 'activation.identity-problem',
  schema: activationIdentityProblemSchema,
  fixtures: {
    expired: problem('ACTIVATION_FLOW_EXPIRED', 410),
    rate_limited: problem('CLAIM_RATE_LIMITED', 429),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const activationLinkProblemFixtures = defineFixtureSet({
  name: 'activation.link-problem',
  schema: activationLinkProblemSchema,
  fixtures: {
    rejected: problem('ACTIVATION_LINK_REJECTED', 400),
    expired: problem('ACTIVATION_FLOW_EXPIRED', 410),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const activationRecoveryProblemFixtures = defineFixtureSet({
  name: 'activation.recovery-problem',
  schema: activationRecoveryProblemSchema,
  fixtures: {
    rate_limited: problem('CLAIM_RATE_LIMITED', 429),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});
