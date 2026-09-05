import { z } from 'zod';

import { defineApiProblemSchema, sessionExpiredProblemSchema } from './base.js';
import { identityEmailSchema, identityPhoneSchema } from './identity.js';

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const cleanText = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => value === value.trim(), 'Text must be canonical')
    .refine(
      (value) => !/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(value),
      'Text contains unsafe control characters',
    );

export const todayHuntingSchema = z.enum([
  'know_how',
  'team',
  'investors',
  'business_partners',
  'suppliers',
  'clients',
]);
export const networkingVisibilitySchema = z.enum(['hidden', 'directory']);
export const networkingTodayHuntingSchema = z
  .array(todayHuntingSchema)
  .max(6)
  .refine(
    (values) => new Set(values).size === values.length,
    'Values must be unique',
  );
export const networkingLinkedinSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(url.hostname)
    );
  }, 'LinkedIn URL must use HTTPS on linkedin.com');
export const networkingParticipantNumberSchema = z
  .string()
  .regex(/^[0-9]{1,8}$/, 'Participant number must contain 1 to 8 digits');

export const networkingSettingsSchema = z.strictObject({
  eventId: uuidSchema,
  userId: uuidSchema,
  version: z.number().int().positive(),
  networkingEnabled: z.boolean(),
  introduction: cleanText(1_000),
  company: cleanText(160),
  jobTitle: cleanText(160),
  participantNumber: networkingParticipantNumberSchema.nullable(),
  todayHunting: networkingTodayHuntingSchema,
  contactEmail: identityEmailSchema,
  phone: identityPhoneSchema.nullable(),
  linkedinUrl: networkingLinkedinSchema.nullable(),
  emailVisibility: networkingVisibilitySchema,
  phoneVisibility: networkingVisibilitySchema,
  linkedinVisibility: networkingVisibilitySchema,
  updatedAt: dateTimeSchema,
});

export const networkingSettingsUpdateRequestSchema = z
  .strictObject({
    expectedVersion: z.number().int().positive(),
    networkingEnabled: z.boolean(),
    introduction: cleanText(1_000),
    company: cleanText(160),
    jobTitle: cleanText(160),
    participantNumber: networkingParticipantNumberSchema.nullable(),
    todayHunting: networkingTodayHuntingSchema,
    contactEmail: identityEmailSchema,
    phone: identityPhoneSchema.nullable(),
    linkedinUrl: networkingLinkedinSchema.nullable(),
    emailVisibility: networkingVisibilitySchema,
    phoneVisibility: networkingVisibilitySchema,
    linkedinVisibility: networkingVisibilitySchema,
  })
  .superRefine((settings, context) => {
    const expected = settings.networkingEnabled ? 'directory' : 'hidden';
    for (const field of [
      'emailVisibility',
      'phoneVisibility',
      'linkedinVisibility',
    ] as const) {
      if (settings[field] !== expected) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message:
            'All completed public-profile fields share the explicit networking opt-in visibility',
        });
      }
    }
  });

export const networkingDirectoryProfileSchema = z.strictObject({
  profileId: uuidSchema,
  displayName: cleanText(257).min(1),
  company: cleanText(160),
  jobTitle: cleanText(160),
  introduction: cleanText(1_000),
  participantNumber: networkingParticipantNumberSchema.nullable(),
  todayHunting: networkingTodayHuntingSchema,
  contacts: z.strictObject({
    email: identityEmailSchema.nullable(),
    phone: identityPhoneSchema.nullable(),
    linkedinUrl: networkingLinkedinSchema.nullable(),
  }),
});

export const networkingDirectoryQuerySchema = z.strictObject({
  q: cleanText(100).optional(),
  participantNumber: networkingParticipantNumberSchema.optional(),
  todayHunting: todayHuntingSchema.optional(),
  cursor: uuidSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const networkingDirectoryResponseSchema = z.strictObject({
  eventId: uuidSchema,
  items: z.array(networkingDirectoryProfileSchema).max(50),
  pageInfo: z.strictObject({
    hasMore: z.boolean(),
    nextCursor: uuidSchema.nullable(),
  }),
});

export const networkingAuthenticationRequiredProblemSchema =
  defineApiProblemSchema('AUTHENTICATION_REQUIRED', 401);
export const networkingAccessDeniedProblemSchema = defineApiProblemSchema(
  'EVENT_ACCESS_DENIED',
  403,
);
export const networkingDisabledProblemSchema = defineApiProblemSchema(
  'NETWORKING_DISABLED',
  409,
);
export const networkingStaleVersionProblemSchema = defineApiProblemSchema(
  'STALE_VERSION',
  409,
);
export const networkingParticipantNumberTakenProblemSchema =
  defineApiProblemSchema('PARTICIPANT_NUMBER_TAKEN', 409);
export const networkingNotFoundProblemSchema = defineApiProblemSchema(
  'PROFILE_NOT_FOUND',
  404,
);
export const networkingValidationProblemSchema = defineApiProblemSchema(
  'VALIDATION_FAILED',
  422,
);
export const networkingInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);
export const networkingProblemSchema = z.discriminatedUnion('code', [
  networkingAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  networkingAccessDeniedProblemSchema,
  networkingDisabledProblemSchema,
  networkingStaleVersionProblemSchema,
  networkingParticipantNumberTakenProblemSchema,
  networkingNotFoundProblemSchema,
  networkingValidationProblemSchema,
  networkingInternalErrorProblemSchema,
]);

export type NetworkingSettings = z.infer<typeof networkingSettingsSchema>;
export type NetworkingSettingsUpdateRequest = z.infer<
  typeof networkingSettingsUpdateRequestSchema
>;
export type NetworkingDirectoryProfile = z.infer<
  typeof networkingDirectoryProfileSchema
>;
