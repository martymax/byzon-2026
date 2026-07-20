export const onboardingLegalDocumentTypes = [
  'terms',
  'privacy_notice',
  'networking_consent',
] as const;

export type OnboardingLegalDocumentType =
  (typeof onboardingLegalDocumentTypes)[number];

export type OnboardingConsentDecision =
  'accepted' | 'withdrawn' | 'acknowledged';

export interface OnboardingProfile {
  firstName: string;
  lastName: string;
  contactEmail: string;
  networkingEnabled: boolean | null;
}

export interface OnboardingSnapshot {
  profile: OnboardingProfile | null;
  currentDocuments: {
    terms: string | null;
    privacyNotice: string | null;
    networkingConsent: string | null;
  };
  decisions: readonly {
    legalDocumentId: string;
    decision: OnboardingConsentDecision;
  }[];
}

export type OnboardingState =
  | { status: 'profile_required' }
  | {
      status: 'blocked_missing_legal_documents';
      missingTypes: readonly OnboardingLegalDocumentType[];
    }
  | {
      status: 'legal_acknowledgement_required';
      documentIds: readonly string[];
    }
  | { status: 'networking_choice_required' }
  | { status: 'complete' };

const hasDecision = (
  snapshot: OnboardingSnapshot,
  legalDocumentId: string,
  expected: OnboardingConsentDecision,
): boolean =>
  snapshot.decisions.some(
    (record) =>
      record.legalDocumentId === legalDocumentId &&
      record.decision === expected,
  );

export const deriveOnboardingState = (
  snapshot: OnboardingSnapshot,
): OnboardingState => {
  if (!snapshot.profile) return { status: 'profile_required' };

  const missingTypes: OnboardingLegalDocumentType[] = [];
  if (!snapshot.currentDocuments.terms) missingTypes.push('terms');
  if (!snapshot.currentDocuments.privacyNotice)
    missingTypes.push('privacy_notice');
  if (
    snapshot.profile.networkingEnabled &&
    !snapshot.currentDocuments.networkingConsent
  )
    missingTypes.push('networking_consent');
  if (missingTypes.length > 0) {
    return { status: 'blocked_missing_legal_documents', missingTypes };
  }

  const requiredDecisions = [
    [snapshot.currentDocuments.terms!, 'accepted'],
    [snapshot.currentDocuments.privacyNotice!, 'acknowledged'],
  ] as const;
  const missingDocumentIds = requiredDecisions
    .filter(
      ([documentId, decision]) => !hasDecision(snapshot, documentId, decision),
    )
    .map(([documentId]) => documentId);
  if (missingDocumentIds.length > 0) {
    return {
      status: 'legal_acknowledgement_required',
      documentIds: missingDocumentIds,
    };
  }

  if (snapshot.profile.networkingEnabled === null) {
    return { status: 'networking_choice_required' };
  }

  const networkingConsent = snapshot.currentDocuments.networkingConsent;
  if (
    snapshot.profile.networkingEnabled &&
    networkingConsent &&
    !hasDecision(snapshot, networkingConsent, 'accepted')
  ) {
    return {
      status: 'legal_acknowledgement_required',
      documentIds: [networkingConsent],
    };
  }

  return { status: 'complete' };
};

export class OnboardingValidationError extends Error {
  constructor() {
    super('Invalid onboarding profile');
    this.name = 'OnboardingValidationError';
  }
}

export interface OnboardingProfileInput {
  firstName: string;
  lastName: string;
  contactEmail: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeOnboardingProfile = (
  input: OnboardingProfileInput,
): OnboardingProfileInput => {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const contactEmail = input.contactEmail.trim().toLowerCase();
  if (
    firstName.length === 0 ||
    firstName.length > 128 ||
    lastName.length === 0 ||
    lastName.length > 128 ||
    contactEmail.length > 320 ||
    !EMAIL_PATTERN.test(contactEmail)
  ) {
    throw new OnboardingValidationError();
  }
  return { firstName, lastName, contactEmail };
};
