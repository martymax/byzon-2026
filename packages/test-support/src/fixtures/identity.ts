import {
  identityBootstrapProblemSchema,
  identityBootstrapResponseSchema,
  identityOnboardingProblemSchema,
  identityOnboardingResponseSchema,
  problemTypeForCode,
} from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';
import { contentFixtureIds } from './content.js';

export const identityFixtureIds = Object.freeze({
  user: '01910000-0000-7000-8000-000000000301',
  terms: '01910000-0000-7000-8000-000000000201',
  privacyNotice: '01910000-0000-7000-8000-000000000202',
  networkingConsent: '01910000-0000-7000-8000-000000000203',
} as const);

export const identityFixtureProfile = Object.freeze({
  firstName: 'Alex',
  lastName: 'Novák',
  contactEmail: 'alex@example.test',
} as const);

export const identityLegalDocuments = Object.freeze([
  {
    id: identityFixtureIds.terms,
    type: 'terms',
    version: 'synthetic-v1',
    title: 'Podmínky používání – syntetický náhled',
    publication: 'synthetic_preview',
    publishedAt: null,
    previewText:
      'Toto je syntetický text pouze pro ověření rozhraní. Nejde o schválené podmínky BYZON 2026.',
  },
  {
    id: identityFixtureIds.privacyNotice,
    type: 'privacy_notice',
    version: 'synthetic-v1',
    title: 'Informace o soukromí – syntetický náhled',
    publication: 'synthetic_preview',
    publishedAt: null,
    previewText:
      'Tento syntetický náhled popisuje pouze testovací průchod. Nejde o schválenou informaci o zpracování osobních údajů.',
  },
  {
    id: identityFixtureIds.networkingConsent,
    type: 'networking_consent',
    version: 'synthetic-v1',
    title: 'Networking – syntetický náhled',
    publication: 'synthetic_preview',
    publishedAt: null,
    previewText:
      'Dobrovolný networking se v náhledu simuluje. Volba je oddělená a lze zvolit pokračování bez networkingu.',
  },
] as const);

const bootstrapBase = {
  dataMode: 'synthetic_preview' as const,
  event: {
    id: contentFixtureIds.event,
    slug: 'byzon-2026',
    name: 'BYZON 2026',
    phase: 'activation_open' as const,
    timezone: 'Europe/Prague',
  },
  user: {
    id: identityFixtureIds.user,
    email: identityFixtureProfile.contactEmail,
  },
  membership: {
    access: { state: 'pending_activation' as const },
    roles: [],
  },
  profile: null,
  onboarding: { status: 'profile_required' as const },
  legalDocuments: [...identityLegalDocuments],
  features: {
    networking: true,
    reservations: true,
    announcements: true,
  },
  networking: {
    enabled: null,
    deletesAt: '2026-10-19T21:59:59.000+02:00',
  },
  unreadCounts: { announcements: 2 },
  privacy: {
    exportRequest: 'available' as const,
    deletionRequest: 'available' as const,
  },
};

export const identityBootstrapFixtures = defineFixtureSet({
  name: 'identity.bootstrap',
  schema: identityBootstrapResponseSchema,
  fixtures: {
    profile_required: bootstrapBase,
    legal_required: {
      ...bootstrapBase,
      profile: identityFixtureProfile,
      onboarding: {
        status: 'legal_acknowledgement_required',
        documentTypes: ['terms', 'privacy_notice'],
      },
    },
    networking_choice: {
      ...bootstrapBase,
      profile: identityFixtureProfile,
      onboarding: { status: 'networking_choice_required' },
    },
    complete: {
      ...bootstrapBase,
      profile: identityFixtureProfile,
      onboarding: {
        status: 'complete',
        completedAt: '2026-07-25T12:00:00.000Z',
      },
      networking: {
        ...bootstrapBase.networking,
        enabled: false,
      },
    },
    blocked_unpublished: {
      ...bootstrapBase,
      profile: identityFixtureProfile,
      onboarding: {
        status: 'blocked_missing_legal_documents',
        missingTypes: ['terms'],
      },
      legalDocuments: identityLegalDocuments.filter(
        ({ type }) => type !== 'terms',
      ),
    },
    suspended: {
      ...bootstrapBase,
      membership: {
        ...bootstrapBase.membership,
        access: {
          state: 'suspended',
          supportReference: 'MOCK-SUSPENDED-2026',
        },
      },
    },
  },
});

const completionBase = {
  state: 'complete' as const,
  continueTo: '/app' as const,
  completedAt: '2026-07-25T12:00:00.000Z',
  profile: identityFixtureProfile,
  acknowledgements: [
    {
      documentId: identityFixtureIds.terms,
      type: 'terms' as const,
      decision: 'accepted' as const,
      version: 'synthetic-v1',
    },
    {
      documentId: identityFixtureIds.privacyNotice,
      type: 'privacy_notice' as const,
      decision: 'acknowledged' as const,
      version: 'synthetic-v1',
    },
  ],
};

export const identityOnboardingFixtures = defineFixtureSet({
  name: 'identity.onboarding',
  schema: identityOnboardingResponseSchema,
  fixtures: {
    opted_out: {
      ...completionBase,
      networkingEnabled: false,
    },
    opted_in: {
      ...completionBase,
      networkingEnabled: true,
      acknowledgements: [
        ...completionBase.acknowledgements,
        {
          documentId: identityFixtureIds.networkingConsent,
          type: 'networking_consent',
          decision: 'accepted',
          version: 'synthetic-v1',
        },
      ],
    },
  },
});

interface IdentityProblemStatus {
  readonly AUTHENTICATION_REQUIRED: 401;
  readonly AUTH_SESSION_EXPIRED: 401;
  readonly EVENT_ACCESS_DENIED: 403;
  readonly INTERNAL_ERROR: 500;
  readonly LEGAL_CONFIGURATION_MISSING: 503;
  readonly NETWORKING_DISABLED: 409;
  readonly REQUEST_ID_REUSED: 409;
  readonly STALE_LEGAL_DOCUMENT: 409;
  readonly VALIDATION_FAILED: 422;
}

const problem = <Code extends keyof IdentityProblemStatus>(
  code: Code,
  status: IdentityProblemStatus[Code],
) => ({
  type: problemTypeForCode(code),
  title: 'Identity fixture problem',
  status,
  code,
  detail: 'Synthetic identity fixture failure.',
  requestId: 'fixture-identity-0001',
});

export const identityBootstrapProblemFixtures = defineFixtureSet({
  name: 'identity.bootstrap-problem',
  schema: identityBootstrapProblemSchema,
  fixtures: {
    authentication: problem('AUTHENTICATION_REQUIRED', 401),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    permission: problem('EVENT_ACCESS_DENIED', 403),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const identityOnboardingProblemFixtures = defineFixtureSet({
  name: 'identity.onboarding-problem',
  schema: identityOnboardingProblemSchema,
  fixtures: {
    authentication: problem('AUTHENTICATION_REQUIRED', 401),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    permission: problem('EVENT_ACCESS_DENIED', 403),
    missing_legal: problem('LEGAL_CONFIGURATION_MISSING', 503),
    stale_legal: problem('STALE_LEGAL_DOCUMENT', 409),
    networking_disabled: problem('NETWORKING_DISABLED', 409),
    request_id_reused: problem('REQUEST_ID_REUSED', 409),
    validation: problem('VALIDATION_FAILED', 422),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});
