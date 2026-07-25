import { describe, expect, it } from 'vitest';

import {
  identityBootstrapResponseSchema,
  identityCachePolicy,
  identityOnboardingRequestSchema,
  identityOnboardingResponseSchema,
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
  },
  {
    id: '01910000-0000-7000-8000-000000000202',
    type: 'privacy_notice',
    version: 'mock-v1',
    title: 'Syntetické informace o soukromí',
    publication: 'synthetic_preview',
    publishedAt: null,
    previewText: 'Syntetický náhled pro testování.',
  },
  {
    id: '01910000-0000-7000-8000-000000000203',
    type: 'networking_consent',
    version: 'mock-v1',
    title: 'Syntetický networking souhlas',
    publication: 'synthetic_preview',
    publishedAt: null,
    previewText: 'Syntetický náhled pro testování.',
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
  onboarding: { status: 'profile_required' },
  legalDocuments: documents,
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
} as const;

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
});
