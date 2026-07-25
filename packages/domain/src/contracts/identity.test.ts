import { describe, expect, it } from 'vitest';

import { problemTypeForCode } from './base.js';
import {
  identityBootstrapResponseSchema,
  identityCachePolicy,
  identityLegalDocumentSchema,
  identityOnboardingRequestSchema,
  identityOnboardingResponseSchema,
  identityPrivacyRequestProblemSchema,
  identityPrivacyRequestRequestSchema,
  identityPrivacyRequestResponseSchema,
  identityProfileUpdateProblemSchema,
  identityProfileUpdateRequestSchema,
  identityProfileUpdateResponseSchema,
  identitySessionActionRequestSchema,
  identitySessionActionResponseSchema,
} from './identity.js';

const documents = [
  {
    id: '01910000-0000-7000-8000-000000000201',
    type: 'terms',
    version: 'mock-v1',
    title: 'Syntetické podmínky',
    publication: 'synthetic_preview',
    publishedAt: null,
    previewText: 'Syntetický náhled pro testování.',
    content: {
      kind: 'inline',
      text: 'Úplný syntetický text podmínek pro testování.',
    },
  },
  {
    id: '01910000-0000-7000-8000-000000000202',
    type: 'privacy_notice',
    version: 'mock-v1',
    title: 'Syntetické informace o soukromí',
    publication: 'synthetic_preview',
    publishedAt: null,
    previewText: 'Syntetický náhled pro testování.',
    content: {
      kind: 'inline',
      text: 'Úplný syntetický text informace o soukromí pro testování.',
    },
  },
  {
    id: '01910000-0000-7000-8000-000000000203',
    type: 'networking_consent',
    version: 'mock-v1',
    title: 'Syntetický networking souhlas',
    publication: 'synthetic_preview',
    publishedAt: null,
    previewText: 'Syntetický náhled pro testování.',
    content: {
      kind: 'inline',
      text: 'Úplný syntetický text networkingového souhlasu pro testování.',
    },
  },
] as const;

const bootstrap = {
  dataMode: 'synthetic_preview',
  event: {
    id: '01910000-0000-7000-8000-000000000101',
    slug: 'byzon-2026',
    name: 'BYZON 2026',
    phase: 'activation_open',
    timezone: 'Europe/Prague',
    startsAt: '2026-10-16T08:00:00.000+02:00',
    endsAt: '2026-10-18T18:00:00.000+02:00',
  },
  user: {
    id: '01910000-0000-7000-8000-000000000301',
    email: 'alex@example.test',
  },
  membership: {
    access: { state: 'active' },
    roles: ['participant'],
  },
  profile: null,
  profileManagement: { state: 'missing' },
  onboarding: { status: 'profile_required' },
  legalDocuments: documents,
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
  unreadCounts: { announcements: 0 },
  privacy: {
    exportRequest: 'available',
    deletionRequest: 'available',
  },
  supportEmail: 'podpora@example.test',
} as const;

const profile = {
  firstName: 'Alex',
  lastName: 'Novák',
  contactEmail: 'alex@example.test',
} as const;

const legalAcknowledgements = [
  {
    documentId: documents[0].id,
    type: 'terms',
    decision: 'accepted',
    version: 'mock-v1',
    acknowledgedAt: '2026-07-25T12:00:00.000Z',
  },
  {
    documentId: documents[1].id,
    type: 'privacy_notice',
    decision: 'acknowledged',
    version: 'mock-v1',
    acknowledgedAt: '2026-07-25T12:00:01.000Z',
  },
] as const;

const problem = (code: string, status: number) => ({
  type: problemTypeForCode(code),
  title: 'Synthetic identity problem',
  status,
  code,
  detail: 'The synthetic request could not be completed.',
  requestId: 'identity-test-0001',
});

describe('CS-BOOT-01 identity and onboarding contract', () => {
  it('validates a private synthetic onboarding bootstrap', () => {
    expect(identityBootstrapResponseSchema.parse(bootstrap)).toEqual(bootstrap);
    expect(identityCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      vary: ['authorization', 'cookie'],
      offline: 'forbidden-before-cs-offline-01',
      offlineMutation: 'forbidden',
      browserPersistence: 'forbidden',
    });
  });

  it('rejects synthetic legal previews in live data', () => {
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...bootstrap,
        dataMode: 'live',
      }).success,
    ).toBe(false);
    for (const state of ['suspended', 'revoked'] as const) {
      expect(
        identityBootstrapResponseSchema.safeParse({
          ...bootstrap,
          membership: {
            access: {
              state,
              supportReference: `MOCK-${state.toUpperCase()}-2026`,
            },
            roles: ['participant'],
          },
        }).success,
      ).toBe(false);
    }
  });

  it('rejects inconsistent profile, legal and networking states', () => {
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...bootstrap,
        profile: {
          firstName: 'Alex',
          lastName: 'Novák',
          contactEmail: 'alex@example.test',
        },
      }).success,
    ).toBe(false);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...bootstrap,
        legalDocuments: documents.slice(1),
      }).success,
    ).toBe(false);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...bootstrap,
        networking: {
          ...bootstrap.networking,
          enabled: true,
        },
        features: {
          ...bootstrap.features,
          networking: false,
        },
      }).success,
    ).toBe(false);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...bootstrap,
        membership: {
          access: { state: 'pending_activation' },
          roles: ['participant'],
        },
      }).success,
    ).toBe(false);
  });

  it('correlates event dates, profile management, deletion and legal records', () => {
    const complete = {
      ...bootstrap,
      profile,
      profileManagement: { state: 'editable', version: 1 },
      onboarding: {
        status: 'complete',
        completedAt: '2026-07-25T12:00:02.000Z',
      },
      legalAcknowledgements,
      networking: {
        ...bootstrap.networking,
        enabled: false,
      },
    } as const;
    expect(identityBootstrapResponseSchema.parse(complete)).toEqual(complete);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...complete,
        event: { ...complete.event, phase: 'archived' },
      }).success,
    ).toBe(false);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...complete,
        event: { ...complete.event, phase: 'archived' },
        profileManagement: { state: 'read_only' },
      }).success,
    ).toBe(true);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...complete,
        event: {
          ...complete.event,
          endsAt: complete.event.startsAt,
        },
      }).success,
    ).toBe(false);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...complete,
        legalAcknowledgements: [
          {
            ...legalAcknowledgements[0],
            documentId: '01910000-0000-7000-8000-000000000299',
          },
          legalAcknowledgements[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...complete,
        profileManagement: { state: 'removed' },
      }).success,
    ).toBe(false);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...complete,
        privacy: {
          ...complete.privacy,
          deletionRequest: 'completed',
        },
      }).success,
    ).toBe(false);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...complete,
        legalAcknowledgements: [
          legalAcknowledgements[0],
          {
            ...legalAcknowledgements[1],
            version: 'stale-v0',
          },
        ],
      }).success,
    ).toBe(false);

    const removed = {
      ...complete,
      profile: null,
      profileManagement: { state: 'removed' },
      privacy: {
        ...complete.privacy,
        deletionRequest: 'completed',
      },
    } as const;
    expect(identityBootstrapResponseSchema.parse(removed)).toEqual(removed);
  });

  it('requires full safe legal content or a credential-free HTTPS URL', () => {
    const external = {
      ...documents[0],
      publication: 'published',
      publishedAt: '2026-07-25T10:00:00.000Z',
      content: {
        kind: 'external',
        url: 'https://legal.example.test/byzon/terms-v1',
      },
    } as const;
    expect(identityLegalDocumentSchema.parse(external)).toEqual(external);

    for (const url of [
      'not-url',
      'http://legal.example.test/terms',
      'javascript:alert(1)',
      'https://user:secret@legal.example.test/terms',
    ]) {
      expect(
        identityLegalDocumentSchema.safeParse({
          ...external,
          content: { kind: 'external', url },
        }).success,
      ).toBe(false);
    }
    for (const text of ['   ', '<strong>Podmínky</strong>', 'Text\u202e']) {
      expect(
        identityLegalDocumentSchema.safeParse({
          ...documents[0],
          content: { kind: 'inline', text },
        }).success,
      ).toBe(false);
    }
    expect(
      identityLegalDocumentSchema.safeParse({
        ...documents[0],
        content: { ...documents[0].content, unknown: true },
      }).success,
    ).toBe(false);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...bootstrap,
        supportEmail: 'Support@Example.test',
      }).success,
    ).toBe(false);
    expect(
      identityBootstrapResponseSchema.safeParse({
        ...bootstrap,
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it('defines a strict optimistic profile update and stale-version problem', () => {
    const request = {
      expectedVersion: 1,
      profile: {
        ...profile,
        firstName: 'Alexandr',
      },
    } as const;
    const response = {
      eventId: bootstrap.event.id,
      userId: bootstrap.user.id,
      profile: request.profile,
      profileManagement: {
        state: 'editable',
        version: 2,
      },
      updatedAt: '2026-07-25T12:15:00.000Z',
    } as const;
    expect(identityProfileUpdateRequestSchema.parse(request)).toEqual(request);
    expect(identityProfileUpdateResponseSchema.parse(response)).toEqual(
      response,
    );
    expect(
      identityProfileUpdateRequestSchema.safeParse({
        ...request,
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      identityProfileUpdateRequestSchema.safeParse({
        ...request,
        profile: { ...request.profile, contactEmail: 'ALEX@example.test' },
      }).success,
    ).toBe(false);
    expect(
      identityProfileUpdateRequestSchema.safeParse({
        ...request,
        role: 'organizer_admin',
      }).success,
    ).toBe(false);
    expect(
      identityProfileUpdateResponseSchema.safeParse({
        ...response,
        profileManagement: { state: 'read_only' },
      }).success,
    ).toBe(false);

    const stale = {
      ...problem('STALE_VERSION', 409),
      currentVersion: 2,
    };
    expect(identityProfileUpdateProblemSchema.parse(stale)).toEqual(stale);
    expect(
      identityProfileUpdateProblemSchema.safeParse({
        ...stale,
        currentVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      identityProfileUpdateProblemSchema.safeParse(
        problem('STALE_VERSION', 409),
      ).success,
    ).toBe(false);
    expect(
      identityProfileUpdateProblemSchema.safeParse({
        ...stale,
        type: problemTypeForCode('PROFILE_NOT_EDITABLE'),
      }).success,
    ).toBe(false);
    expect(
      identityProfileUpdateProblemSchema.safeParse({
        ...stale,
        secret: 'must-not-pass',
      }).success,
    ).toBe(false);
  });

  it('defines canonical idempotent privacy request outcomes and exact problems', () => {
    const request = { kind: 'data_export' } as const;
    const response = {
      eventId: bootstrap.event.id,
      userId: bootstrap.user.id,
      request: {
        id: '01910000-0000-7000-8000-000000000401',
        kind: 'data_export',
        state: 'pending',
        requestedAt: '2026-07-25T12:20:00.000Z',
      },
    } as const;
    expect(identityPrivacyRequestRequestSchema.parse(request)).toEqual(request);
    expect(identityPrivacyRequestResponseSchema.parse(response)).toEqual(
      response,
    );
    expect(identityPrivacyRequestResponseSchema.parse(response)).toEqual(
      identityPrivacyRequestResponseSchema.parse(structuredClone(response)),
    );
    expect(
      identityPrivacyRequestResponseSchema.safeParse({
        ...response,
        request: {
          ...response.request,
          state: 'completed',
          resolvedAt: '2026-07-25T12:21:00.000Z',
        },
      }).success,
    ).toBe(false);
    expect(
      identityPrivacyRequestRequestSchema.safeParse({
        ...request,
        reason: 'free-form PII must not cross the boundary',
      }).success,
    ).toBe(false);
    expect(
      identityPrivacyRequestRequestSchema.safeParse({
        kind: 'account_copy',
      }).success,
    ).toBe(false);
    expect(
      identityPrivacyRequestResponseSchema.safeParse({
        ...response,
        request: {
          ...response.request,
          state: 'completed',
          resolvedAt: '2026-07-24T12:20:00.000Z',
        },
      }).success,
    ).toBe(false);
    expect(
      identityPrivacyRequestResponseSchema.safeParse({
        ...response,
        request: {
          ...response.request,
          email: 'alex@example.test',
        },
      }).success,
    ).toBe(false);

    for (const [code, status] of [
      ['PRIVACY_REQUEST_UNAVAILABLE', 409],
      ['IDEMPOTENCY_KEY_REUSED', 409],
      ['IDEMPOTENCY_IN_PROGRESS', 409],
    ] as const) {
      expect(
        identityPrivacyRequestProblemSchema.parse(problem(code, status)).code,
      ).toBe(code);
    }
    expect(
      identityPrivacyRequestProblemSchema.safeParse({
        ...problem('IDEMPOTENCY_KEY_REUSED', 409),
        idempotencyKey: 'secret-key',
      }).success,
    ).toBe(false);
    expect(
      identityPrivacyRequestProblemSchema.safeParse(
        problem('PRIVACY_REQUEST_REJECTED', 409),
      ).success,
    ).toBe(false);
  });

  it('requires explicit legal decisions and a separate networking choice', () => {
    const request = {
      profile: {
        firstName: 'Alex',
        lastName: 'Novák',
        contactEmail: 'alex@example.test',
      },
      legal: {
        termsDocumentId: documents[0].id,
        termsAccepted: true,
        privacyNoticeDocumentId: documents[1].id,
        privacyAcknowledged: true,
      },
      networking: { enabled: false },
    } as const;
    expect(identityOnboardingRequestSchema.parse(request)).toEqual(request);
    expect(
      identityOnboardingRequestSchema.safeParse({
        ...request,
        legal: { ...request.legal, termsAccepted: false },
      }).success,
    ).toBe(false);
    expect(
      identityOnboardingRequestSchema.safeParse({
        ...request,
        profile: { ...request.profile, firstName: ' Alex ' },
      }).success,
    ).toBe(false);
    expect(
      identityOnboardingRequestSchema.safeParse({
        ...request,
        networking: { enabled: true },
      }).success,
    ).toBe(false);

    expect(
      identityBootstrapResponseSchema.safeParse({
        ...bootstrap,
        profile,
        profileManagement: { state: 'editable', version: 1 },
        onboarding: {
          status: 'legal_acknowledgement_required',
          documentTypes: ['networking_consent'],
        },
        networking: {
          ...bootstrap.networking,
          enabled: true,
        },
      }).success,
    ).toBe(true);
  });

  it('correlates completion acknowledgements with networking choice', () => {
    const completion = {
      state: 'complete',
      continueTo: '/app',
      completedAt: '2026-07-25T12:00:00.000Z',
      profile: {
        firstName: 'Alex',
        lastName: 'Novák',
        contactEmail: 'alex@example.test',
      },
      networkingEnabled: false,
      acknowledgements: [
        {
          documentId: documents[0].id,
          type: 'terms',
          decision: 'accepted',
          version: 'mock-v1',
        },
        {
          documentId: documents[1].id,
          type: 'privacy_notice',
          decision: 'acknowledged',
          version: 'mock-v1',
        },
      ],
    } as const;
    expect(identityOnboardingResponseSchema.parse(completion)).toEqual(
      completion,
    );
    expect(
      identityOnboardingResponseSchema.safeParse({
        ...completion,
        networkingEnabled: true,
      }).success,
    ).toBe(false);
    expect(
      identityOnboardingResponseSchema.safeParse({
        ...completion,
        acknowledgements: [
          completion.acknowledgements[0],
          {
            ...completion.acknowledgements[1],
            documentId: completion.acknowledgements[0].documentId,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('keeps session actions explicit and same-origin', () => {
    expect(
      identitySessionActionRequestSchema.parse({
        action: 'switch_account',
      }),
    ).toEqual({ action: 'switch_account' });
    expect(
      identitySessionActionResponseSchema.parse({
        action: 'switch_account',
        state: 'account_switch_ready',
        effect: 'synthetic_preview',
        personalData: { disposition: 'none_present' },
        continueTo: '/prihlaseni?mode=switch&returnTo=%2Fapp',
      }),
    ).toMatchObject({
      action: 'switch_account',
      state: 'account_switch_ready',
    });
    expect(
      identitySessionActionResponseSchema.safeParse({
        action: 'switch_account',
        state: 'account_switch_ready',
        effect: 'synthetic_preview',
        personalData: { disposition: 'none_present' },
        continueTo: 'https://attacker.example/',
      }).success,
    ).toBe(false);
  });
});
