import { describe, expect, it } from 'vitest';

import {
  deriveOnboardingState,
  normalizeOnboardingProfile,
  OnboardingValidationError,
  type OnboardingSnapshot,
} from './onboarding.js';

const configuredSnapshot = (): OnboardingSnapshot => ({
  profile: {
    firstName: 'Anna',
    lastName: 'Nováková',
    contactEmail: 'anna@example.com',
  },
  currentDocuments: {
    terms: '00000000-0000-7000-8000-000000000001',
    privacyNotice: '00000000-0000-7000-8000-000000000002',
  },
  decisions: [
    {
      legalDocumentId: '00000000-0000-7000-8000-000000000001',
      decision: 'accepted',
    },
    {
      legalDocumentId: '00000000-0000-7000-8000-000000000002',
      decision: 'acknowledged',
    },
  ],
});

describe('onboarding state machine', () => {
  it('requires the event-scoped participant profile first', () => {
    expect(
      deriveOnboardingState({
        ...configuredSnapshot(),
        profile: null,
      }),
    ).toEqual({ status: 'profile_required' });
  });

  it('fails closed when required legal versions are not configured', () => {
    expect(
      deriveOnboardingState({
        ...configuredSnapshot(),
        currentDocuments: {
          terms: null,
          privacyNotice: null,
        },
      }),
    ).toEqual({
      status: 'blocked_missing_legal_documents',
      missingTypes: ['terms', 'privacy_notice'],
    });
  });

  it('requires the exact current terms and privacy versions', () => {
    const snapshot = configuredSnapshot();
    expect(
      deriveOnboardingState({
        ...snapshot,
        decisions: [snapshot.decisions[0]!],
      }),
    ).toEqual({
      status: 'legal_acknowledgement_required',
      documentIds: [snapshot.currentDocuments.privacyNotice],
    });
  });

  it('regresses to legal review when a new current version is published', () => {
    const snapshot = configuredSnapshot();
    const newTerms = '00000000-0000-7000-8000-000000000004';
    expect(
      deriveOnboardingState({
        ...snapshot,
        currentDocuments: { ...snapshot.currentDocuments, terms: newTerms },
      }),
    ).toEqual({
      status: 'legal_acknowledgement_required',
      documentIds: [newTerms],
    });
  });

  it('treats the latest withdrawn decision as no longer accepted', () => {
    const snapshot = configuredSnapshot();
    expect(
      deriveOnboardingState({
        ...snapshot,
        decisions: [
          {
            legalDocumentId: snapshot.currentDocuments.terms!,
            decision: 'withdrawn',
          },
          snapshot.decisions[1]!,
        ],
      }),
    ).toEqual({
      status: 'legal_acknowledgement_required',
      documentIds: [snapshot.currentDocuments.terms],
    });
  });

  it('completes with the profile minimum and versioned decisions', () => {
    expect(deriveOnboardingState(configuredSnapshot())).toEqual({
      status: 'complete',
    });
  });
});

describe('onboarding profile normalization', () => {
  it('trims names and normalizes the contact email', () => {
    expect(
      normalizeOnboardingProfile({
        firstName: '  Anna ',
        lastName: ' Nováková  ',
        contactEmail: ' ANNA@Example.COM ',
      }),
    ).toEqual({
      firstName: 'Anna',
      lastName: 'Nováková',
      contactEmail: 'anna@example.com',
      phone: null,
    });
  });

  it('accepts the optional phone only in canonical E.164 form', () => {
    expect(
      normalizeOnboardingProfile({
        firstName: 'Anna',
        lastName: 'Nováková',
        contactEmail: 'anna@example.com',
        phone: '+420774835456',
      }),
    ).toMatchObject({ phone: '+420774835456' });
  });

  it.each([
    '',
    '774835456',
    ' +420774835456 ',
    '+420 774 835 456',
    '+1234567',
    '+1234567890123456',
  ])('rejects non-canonical phone %j', (phone) => {
    expect(() =>
      normalizeOnboardingProfile({
        firstName: 'Anna',
        lastName: 'Nováková',
        contactEmail: 'anna@example.com',
        phone,
      }),
    ).toThrow(OnboardingValidationError);
  });

  it.each([
    { firstName: '', lastName: 'Nováková', contactEmail: 'anna@example.com' },
    { firstName: 'Anna', lastName: '', contactEmail: 'anna@example.com' },
    { firstName: 'Anna', lastName: 'Nováková', contactEmail: 'not-an-email' },
  ])('rejects incomplete or invalid required data', (input) => {
    expect(() => normalizeOnboardingProfile(input)).toThrow(
      OnboardingValidationError,
    );
  });
});
