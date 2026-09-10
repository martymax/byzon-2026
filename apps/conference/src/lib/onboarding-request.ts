import {
  identityOnboardingRequestSchema,
  type IdentityBootstrapResponse,
  type IdentityOnboardingRequest,
} from '@byzon/domain/contracts';

export interface OnboardingDraft {
  readonly firstName: string;
  readonly lastName: string;
  readonly contactEmail: string;
  readonly termsAccepted: boolean;
  readonly privacyAcknowledged: boolean;
}

export const createOnboardingRequest = (
  bootstrap: IdentityBootstrapResponse,
  draft: OnboardingDraft,
): IdentityOnboardingRequest | null => {
  if (!draft.termsAccepted || !draft.privacyAcknowledged) return null;
  const terms = bootstrap.legalDocuments.find(({ type }) => type === 'terms');
  const privacy = bootstrap.legalDocuments.find(
    ({ type }) => type === 'privacy_notice',
  );
  const parsed = identityOnboardingRequestSchema.safeParse({
    // Legal review must preserve every stored profile field, including phone.
    // Profile changes belong to the versioned profile update endpoint.
    profile: bootstrap.profile ?? {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      contactEmail: draft.contactEmail.trim().toLowerCase(),
      phone: null,
    },
    legal: {
      termsDocumentId: terms?.id,
      termsAccepted: true,
      privacyNoticeDocumentId: privacy?.id,
      privacyAcknowledged: true,
    },
  });
  return parsed.success ? parsed.data : null;
};
