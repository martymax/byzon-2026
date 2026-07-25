import {
  identityBootstrapProblemSchema,
  identityBootstrapResponseSchema,
  identityOnboardingProblemSchema,
  identityOnboardingResponseSchema,
  identityPrivacyRequestProblemSchema,
  identityPrivacyRequestResponseSchema,
  identityProfileUpdateProblemSchema,
  identityProfileUpdateResponseSchema,
  identitySessionActionProblemSchema,
  identitySessionActionResponseSchema,
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
    content: {
      kind: 'inline',
      text: 'Syntetické podmínky slouží pouze k ověření uživatelského průchodu.\n\nNejde o schválený právní dokument BYZON 2026.',
    },
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
    content: {
      kind: 'inline',
      text: 'Syntetická informace o soukromí popisuje pouze testovací zpracování dat.\n\nNejde o schválený právní dokument BYZON 2026.',
    },
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
    content: {
      kind: 'inline',
      text: 'Syntetický networkingový souhlas slouží pouze k testování dobrovolné volby.\n\nNejde o schválený právní dokument BYZON 2026.',
    },
  },
] as const);

export const identityLegalAcknowledgements = Object.freeze([
  {
    documentId: identityFixtureIds.terms,
    type: 'terms',
    decision: 'accepted',
    version: 'synthetic-v1',
    acknowledgedAt: '2026-07-25T12:00:00.000Z',
  },
  {
    documentId: identityFixtureIds.privacyNotice,
    type: 'privacy_notice',
    decision: 'acknowledged',
    version: 'synthetic-v1',
    acknowledgedAt: '2026-07-25T12:00:01.000Z',
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
    startsAt: '2026-10-16T08:00:00.000+02:00',
    endsAt: '2026-10-18T18:00:00.000+02:00',
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
  profileManagement: { state: 'missing' as const },
  onboarding: { status: 'profile_required' as const },
  legalDocuments: [...identityLegalDocuments],
  legalAcknowledgements: [],
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
  supportEmail: 'podpora@example.test',
};

export const identityBootstrapFixtures = defineFixtureSet({
  name: 'identity.bootstrap',
  schema: identityBootstrapResponseSchema,
  fixtures: {
    profile_required: bootstrapBase,
    legal_required: {
      ...bootstrapBase,
      profile: identityFixtureProfile,
      profileManagement: { state: 'editable', version: 1 },
      onboarding: {
        status: 'legal_acknowledgement_required',
        documentTypes: ['terms', 'privacy_notice'],
      },
    },
    networking_choice: {
      ...bootstrapBase,
      profile: identityFixtureProfile,
      profileManagement: { state: 'editable', version: 1 },
      onboarding: { status: 'networking_choice_required' },
      legalAcknowledgements: [...identityLegalAcknowledgements],
    },
    complete: {
      ...bootstrapBase,
      profile: identityFixtureProfile,
      profileManagement: { state: 'editable', version: 1 },
      onboarding: {
        status: 'complete',
        completedAt: '2026-07-25T12:00:00.000Z',
      },
      networking: {
        ...bootstrapBase.networking,
        enabled: false,
      },
      legalAcknowledgements: [...identityLegalAcknowledgements],
    },
    blocked_unpublished: {
      ...bootstrapBase,
      profile: identityFixtureProfile,
      profileManagement: { state: 'editable', version: 1 },
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
    read_only: {
      ...bootstrapBase,
      event: {
        ...bootstrapBase.event,
        phase: 'archived',
      },
      membership: {
        access: { state: 'active' },
        roles: ['participant'],
      },
      profile: identityFixtureProfile,
      profileManagement: { state: 'read_only' },
      onboarding: {
        status: 'complete',
        completedAt: '2026-07-25T12:00:00.000Z',
      },
      legalAcknowledgements: [...identityLegalAcknowledgements],
      networking: {
        ...bootstrapBase.networking,
        enabled: false,
      },
      privacy: {
        exportRequest: 'completed',
        deletionRequest: 'unavailable',
      },
    },
    removed: {
      ...bootstrapBase,
      membership: {
        access: { state: 'active' },
        roles: ['participant'],
      },
      profile: null,
      profileManagement: { state: 'removed' },
      onboarding: {
        status: 'complete',
        completedAt: '2026-07-25T12:00:00.000Z',
      },
      legalAcknowledgements: [...identityLegalAcknowledgements],
      networking: {
        ...bootstrapBase.networking,
        enabled: false,
      },
      privacy: {
        exportRequest: 'unavailable',
        deletionRequest: 'completed',
      },
    },
  },
});

export const identityProfileUpdateFixtures = defineFixtureSet({
  name: 'identity.profile-update',
  schema: identityProfileUpdateResponseSchema,
  fixtures: {
    updated: {
      eventId: contentFixtureIds.event,
      userId: identityFixtureIds.user,
      profile: {
        ...identityFixtureProfile,
        firstName: 'Alexandr',
      },
      profileManagement: {
        state: 'editable',
        version: 2,
      },
      updatedAt: '2026-07-25T12:15:00.000Z',
    },
  },
});

export const identityPrivacyRequestFixtures = defineFixtureSet({
  name: 'identity.privacy-request',
  schema: identityPrivacyRequestResponseSchema,
  fixtures: {
    export_pending: {
      eventId: contentFixtureIds.event,
      userId: identityFixtureIds.user,
      request: {
        id: '01910000-0000-7000-8000-000000000401',
        kind: 'data_export',
        state: 'pending',
        requestedAt: '2026-07-25T12:20:00.000Z',
      },
    },
    deletion_pending: {
      eventId: contentFixtureIds.event,
      userId: identityFixtureIds.user,
      request: {
        id: '01910000-0000-7000-8000-000000000402',
        kind: 'data_deletion',
        state: 'pending',
        requestedAt: '2026-07-25T12:25:00.000Z',
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

const syntheticSessionEffect = {
  effect: 'synthetic_preview' as const,
  personalData: { disposition: 'none_present' as const },
};

export const identitySessionActionFixtures = defineFixtureSet({
  name: 'identity.session-action',
  schema: identitySessionActionResponseSchema,
  fixtures: {
    logout_current: {
      ...syntheticSessionEffect,
      action: 'logout_current',
      state: 'signed_out',
      continueTo: '/',
    },
    logout_all: {
      ...syntheticSessionEffect,
      action: 'logout_all',
      state: 'all_sessions_revoked',
      continueTo: '/',
    },
    switch_account: {
      ...syntheticSessionEffect,
      action: 'switch_account',
      state: 'account_switch_ready',
      continueTo: '/prihlaseni?mode=switch&returnTo=%2Fapp',
    },
  },
});

interface IdentityProblemStatus {
  readonly AUTHENTICATION_REQUIRED: 401;
  readonly AUTH_SESSION_EXPIRED: 401;
  readonly EVENT_ACCESS_DENIED: 403;
  readonly IDEMPOTENCY_IN_PROGRESS: 409;
  readonly IDEMPOTENCY_KEY_REUSED: 409;
  readonly INTERNAL_ERROR: 500;
  readonly LEGAL_CONFIGURATION_MISSING: 503;
  readonly NETWORKING_DISABLED: 409;
  readonly PRIVACY_REQUEST_UNAVAILABLE: 409;
  readonly PROFILE_NOT_EDITABLE: 409;
  readonly PROFILE_NOT_FOUND: 404;
  readonly REQUEST_ID_REUSED: 409;
  readonly SESSION_ACTION_REJECTED: 409;
  readonly STALE_LEGAL_DOCUMENT: 409;
  readonly STALE_VERSION: 409;
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
    idempotency_key_reused: problem('IDEMPOTENCY_KEY_REUSED', 409),
    idempotency_in_progress: problem('IDEMPOTENCY_IN_PROGRESS', 409),
    validation: problem('VALIDATION_FAILED', 422),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const identitySessionActionProblemFixtures = defineFixtureSet({
  name: 'identity.session-action-problem',
  schema: identitySessionActionProblemSchema,
  fixtures: {
    authentication: problem('AUTHENTICATION_REQUIRED', 401),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    request_id_reused: problem('REQUEST_ID_REUSED', 409),
    idempotency_key_reused: problem('IDEMPOTENCY_KEY_REUSED', 409),
    idempotency_in_progress: problem('IDEMPOTENCY_IN_PROGRESS', 409),
    rejected: problem('SESSION_ACTION_REJECTED', 409),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const identityProfileUpdateProblemFixtures = defineFixtureSet({
  name: 'identity.profile-update-problem',
  schema: identityProfileUpdateProblemSchema,
  fixtures: {
    authentication: problem('AUTHENTICATION_REQUIRED', 401),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    permission: problem('EVENT_ACCESS_DENIED', 403),
    not_found: problem('PROFILE_NOT_FOUND', 404),
    not_editable: problem('PROFILE_NOT_EDITABLE', 409),
    stale: {
      ...problem('STALE_VERSION', 409),
      currentVersion: 2,
    },
    validation: problem('VALIDATION_FAILED', 422),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const identityPrivacyRequestProblemFixtures = defineFixtureSet({
  name: 'identity.privacy-request-problem',
  schema: identityPrivacyRequestProblemSchema,
  fixtures: {
    authentication: problem('AUTHENTICATION_REQUIRED', 401),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    permission: problem('EVENT_ACCESS_DENIED', 403),
    unavailable: problem('PRIVACY_REQUEST_UNAVAILABLE', 409),
    key_reused: problem('IDEMPOTENCY_KEY_REUSED', 409),
    in_progress: problem('IDEMPOTENCY_IN_PROGRESS', 409),
    validation: problem('VALIDATION_FAILED', 422),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});
