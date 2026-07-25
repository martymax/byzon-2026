import { z } from 'zod';

import { defineApiProblemSchema, sessionExpiredProblemSchema } from './base.js';

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const safeDisplayTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, 'Text must not be blank')
    .refine(
      (value) => !/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(value),
      'Text contains unsafe control characters',
    );
const safeVersionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Invalid document version');

export const identityCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  vary: Object.freeze(['authorization', 'cookie'] as const),
  offline: 'forbidden-before-cs-offline-01',
  offlineMutation: 'forbidden',
  browserPersistence: 'forbidden',
} as const);

export const identityDataModeSchema = z.enum(['live', 'synthetic_preview']);
export type IdentityDataMode = z.infer<typeof identityDataModeSchema>;

export const identityEventPhaseSchema = z.enum([
  'draft',
  'activation_open',
  'live',
  'ended',
  'archived',
]);

export const identityRoleSchema = z.enum([
  'participant',
  'speaker',
  'organizer_admin',
  'checkin_operator',
  'moderator',
  'room_operator',
]);

export const identityEmailSchema = z
  .email()
  .max(320)
  .refine(
    (value) => !/[\u0000-\u001F\u007F]/.test(value),
    'Email contains unsafe control characters',
  );

const canonicalNameSchema = safeDisplayTextSchema(128).refine(
  (value) => value === value.trim(),
  'Name must be canonical',
);

export const identityProfileSchema = z.strictObject({
  firstName: canonicalNameSchema,
  lastName: canonicalNameSchema,
  contactEmail: identityEmailSchema
    .refine((value) => value === value.trim(), 'Email must be canonical')
    .refine(
      (value) => value === value.toLowerCase(),
      'Email must be lowercase',
    ),
});

export type IdentityProfile = z.infer<typeof identityProfileSchema>;

export const identityLegalDocumentTypeSchema = z.enum([
  'terms',
  'privacy_notice',
  'networking_consent',
]);

export type IdentityLegalDocumentType = z.infer<
  typeof identityLegalDocumentTypeSchema
>;

export const identityLegalDocumentSchema = z.strictObject({
  id: uuidSchema,
  type: identityLegalDocumentTypeSchema,
  version: safeVersionSchema,
  title: safeDisplayTextSchema(160),
  publication: z.enum(['published', 'synthetic_preview']),
  publishedAt: dateTimeSchema.nullable(),
  previewText: safeDisplayTextSchema(2_048),
});

export type IdentityLegalDocument = z.infer<typeof identityLegalDocumentSchema>;

export const identityOnboardingStateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('profile_required') }),
  z.strictObject({
    status: z.literal('blocked_missing_legal_documents'),
    missingTypes: z
      .array(identityLegalDocumentTypeSchema)
      .min(1)
      .max(3)
      .refine(
        (types) => new Set(types).size === types.length,
        'Missing legal document types must be unique',
      ),
  }),
  z.strictObject({
    status: z.literal('legal_acknowledgement_required'),
    documentTypes: z
      .array(identityLegalDocumentTypeSchema)
      .min(1)
      .max(3)
      .refine(
        (types) => new Set(types).size === types.length,
        'Required legal document types must be unique',
      ),
  }),
  z.strictObject({ status: z.literal('networking_choice_required') }),
  z.strictObject({
    status: z.literal('complete'),
    completedAt: dateTimeSchema,
  }),
]);

export type IdentityOnboardingState = z.infer<
  typeof identityOnboardingStateSchema
>;

export const identityAccessSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('pending_activation') }),
  z.strictObject({ state: z.literal('active') }),
  z.strictObject({
    state: z.literal('suspended'),
    supportReference: safeDisplayTextSchema(64),
  }),
  z.strictObject({
    state: z.literal('revoked'),
    supportReference: safeDisplayTextSchema(64),
  }),
]);

export const identityBootstrapResponseSchema = z
  .strictObject({
    dataMode: identityDataModeSchema,
    event: z.strictObject({
      id: uuidSchema,
      slug: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      name: safeDisplayTextSchema(160),
      phase: identityEventPhaseSchema,
      timezone: safeDisplayTextSchema(128),
    }),
    user: z.strictObject({
      id: uuidSchema,
      email: identityEmailSchema,
    }),
    membership: z.strictObject({
      access: identityAccessSchema,
      roles: z
        .array(identityRoleSchema)
        .max(6)
        .refine(
          (roles) => new Set(roles).size === roles.length,
          'Roles must be unique',
        ),
    }),
    profile: identityProfileSchema.nullable(),
    onboarding: identityOnboardingStateSchema,
    legalDocuments: z.array(identityLegalDocumentSchema).max(3),
    features: z.strictObject({
      networking: z.boolean(),
      reservations: z.boolean(),
      announcements: z.boolean(),
    }),
    networking: z.strictObject({
      enabled: z.boolean().nullable(),
      deletesAt: dateTimeSchema.nullable(),
    }),
    unreadCounts: z.strictObject({
      announcements: z.number().int().min(0).max(999),
    }),
    privacy: z.strictObject({
      exportRequest: z.enum(['available', 'pending', 'unavailable']),
      deletionRequest: z.enum(['available', 'pending', 'unavailable']),
    }),
  })
  .superRefine((response, context) => {
    const ids = response.legalDocuments.map(({ id }) => id);
    const types = response.legalDocuments.map(({ type }) => type);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['legalDocuments'],
        message: 'Legal document IDs must be unique',
      });
    }
    if (new Set(types).size !== types.length) {
      context.addIssue({
        code: 'custom',
        path: ['legalDocuments'],
        message: 'Legal document types must be unique',
      });
    }
    if (
      response.dataMode === 'live' &&
      response.legalDocuments.some(
        ({ publication }) => publication !== 'published',
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['legalDocuments'],
        message: 'Live bootstrap cannot expose synthetic legal documents',
      });
    }
    if (
      response.legalDocuments.some(
        ({ publication, publishedAt }) =>
          (publication === 'published') !== Boolean(publishedAt),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['legalDocuments'],
        message: 'Legal publication state must match publishedAt',
      });
    }

    const documentTypes = new Set(types);
    const onboarding = response.onboarding;
    if (
      response.membership.access.state === 'active' &&
      response.membership.roles.length === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['membership', 'roles'],
        message: 'Active membership requires at least one role',
      });
    }
    if (
      response.membership.access.state !== 'active' &&
      response.membership.roles.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['membership', 'roles'],
        message: 'Inactive membership cannot grant event roles',
      });
    }
    if (onboarding.status === 'profile_required') {
      if (response.profile !== null) {
        context.addIssue({
          code: 'custom',
          path: ['profile'],
          message: 'Profile-required onboarding cannot already have a profile',
        });
      }
      if (response.networking.enabled !== null) {
        context.addIssue({
          code: 'custom',
          path: ['networking', 'enabled'],
          message:
            'Profile-required onboarding cannot have a networking choice',
        });
      }
    } else if (response.profile === null) {
      context.addIssue({
        code: 'custom',
        path: ['profile'],
        message: 'Onboarding state requires a profile',
      });
    }

    if (onboarding.status === 'blocked_missing_legal_documents') {
      onboarding.missingTypes.forEach((type, index) => {
        if (documentTypes.has(type)) {
          context.addIssue({
            code: 'custom',
            path: ['onboarding', 'missingTypes', index],
            message: 'A missing legal document cannot be present',
          });
        }
      });
    } else {
      for (const requiredType of ['terms', 'privacy_notice'] as const) {
        if (!documentTypes.has(requiredType)) {
          context.addIssue({
            code: 'custom',
            path: ['legalDocuments'],
            message: `Onboarding requires ${requiredType}`,
          });
        }
      }
    }

    if (onboarding.status === 'legal_acknowledgement_required') {
      onboarding.documentTypes.forEach((type, index) => {
        if (!documentTypes.has(type)) {
          context.addIssue({
            code: 'custom',
            path: ['onboarding', 'documentTypes', index],
            message: 'Required legal document must be present',
          });
        }
      });
      if (
        onboarding.documentTypes.includes('networking_consent') &&
        (response.networking.enabled !== true ||
          response.features.networking !== true)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['onboarding', 'documentTypes'],
          message:
            'Networking acknowledgement requires an enabled feature and opt-in',
        });
      }
    }

    if (
      (onboarding.status === 'networking_choice_required' ||
        onboarding.status === 'complete') &&
      response.networking.enabled === null
    ) {
      if (onboarding.status === 'complete') {
        context.addIssue({
          code: 'custom',
          path: ['networking', 'enabled'],
          message: 'Completed onboarding needs an explicit networking choice',
        });
      }
    }
    if (
      onboarding.status === 'networking_choice_required' &&
      response.networking.enabled !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['networking', 'enabled'],
        message: 'Networking choice must still be unset',
      });
    }
    if (response.networking.enabled && !response.features.networking) {
      context.addIssue({
        code: 'custom',
        path: ['networking', 'enabled'],
        message: 'Networking cannot be enabled when the feature is disabled',
      });
    }
  });

export type IdentityBootstrapResponse = z.infer<
  typeof identityBootstrapResponseSchema
>;

const networkingChoiceSchema = z.discriminatedUnion('enabled', [
  z.strictObject({ enabled: z.literal(false) }),
  z.strictObject({
    enabled: z.literal(true),
    consentDocumentId: uuidSchema,
    consentAccepted: z.literal(true),
  }),
]);

export const identityOnboardingRequestSchema = z
  .strictObject({
    profile: identityProfileSchema,
    legal: z.strictObject({
      termsDocumentId: uuidSchema,
      termsAccepted: z.literal(true),
      privacyNoticeDocumentId: uuidSchema,
      privacyAcknowledged: z.literal(true),
    }),
    networking: networkingChoiceSchema,
  })
  .superRefine((request, context) => {
    const documentIds = [
      request.legal.termsDocumentId,
      request.legal.privacyNoticeDocumentId,
      ...(request.networking.enabled
        ? [request.networking.consentDocumentId]
        : []),
    ];
    if (new Set(documentIds).size !== documentIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['legal'],
        message: 'Each legal decision must target a distinct document',
      });
    }
  });

export type IdentityOnboardingRequest = z.infer<
  typeof identityOnboardingRequestSchema
>;

export const identityOnboardingResponseSchema = z
  .strictObject({
    state: z.literal('complete'),
    continueTo: z.literal('/app'),
    completedAt: dateTimeSchema,
    profile: identityProfileSchema,
    networkingEnabled: z.boolean(),
    acknowledgements: z
      .array(
        z.strictObject({
          documentId: uuidSchema,
          type: identityLegalDocumentTypeSchema,
          decision: z.enum(['accepted', 'acknowledged']),
          version: safeVersionSchema,
        }),
      )
      .min(2)
      .max(3),
  })
  .superRefine((response, context) => {
    const byType = new Map(
      response.acknowledgements.map((record) => [record.type, record]),
    );
    const documentIds = response.acknowledgements.map(
      ({ documentId }) => documentId,
    );
    if (new Set(documentIds).size !== documentIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['acknowledgements'],
        message: 'Acknowledgement document IDs must be unique',
      });
    }
    const expected = [
      ['terms', 'accepted'],
      ['privacy_notice', 'acknowledged'],
    ] as const;
    expected.forEach(([type, decision]) => {
      if (byType.get(type)?.decision !== decision) {
        context.addIssue({
          code: 'custom',
          path: ['acknowledgements'],
          message: `Missing ${decision} decision for ${type}`,
        });
      }
    });
    const networking = byType.get('networking_consent');
    if (
      response.networkingEnabled !== Boolean(networking) ||
      (networking && networking.decision !== 'accepted') ||
      byType.size !== response.acknowledgements.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['acknowledgements'],
        message: 'Networking acknowledgement must match the explicit choice',
      });
    }
  });

export type IdentityOnboardingResponse = z.infer<
  typeof identityOnboardingResponseSchema
>;

export const identitySessionActionSchema = z.enum([
  'logout_current',
  'logout_all',
  'switch_account',
]);

export type IdentitySessionAction = z.infer<typeof identitySessionActionSchema>;

export const identitySessionActionRequestSchema = z.strictObject({
  action: identitySessionActionSchema,
});

export type IdentitySessionActionRequest = z.infer<
  typeof identitySessionActionRequestSchema
>;

const sessionActionResultShape = {
  effect: z.enum(['completed', 'synthetic_preview']),
  personalData: z.strictObject({
    disposition: z.enum(['cleared', 'none_present']),
  }),
} as const;

export const identitySessionActionResponseSchema = z.discriminatedUnion(
  'action',
  [
    z.strictObject({
      ...sessionActionResultShape,
      action: z.literal('logout_current'),
      state: z.literal('signed_out'),
      continueTo: z.literal('/'),
    }),
    z.strictObject({
      ...sessionActionResultShape,
      action: z.literal('logout_all'),
      state: z.literal('all_sessions_revoked'),
      continueTo: z.literal('/'),
    }),
    z.strictObject({
      ...sessionActionResultShape,
      action: z.literal('switch_account'),
      state: z.literal('account_switch_ready'),
      continueTo: z.literal('/prihlaseni?mode=switch&returnTo=%2Fapp'),
    }),
  ],
);

export type IdentitySessionActionResponse = z.infer<
  typeof identitySessionActionResponseSchema
>;

export const identityAuthenticationRequiredProblemSchema =
  defineApiProblemSchema('AUTHENTICATION_REQUIRED', 401);
export const identityEventAccessDeniedProblemSchema = defineApiProblemSchema(
  'EVENT_ACCESS_DENIED',
  403,
);
export const identityLegalConfigurationMissingProblemSchema =
  defineApiProblemSchema('LEGAL_CONFIGURATION_MISSING', 503);
export const identityStaleLegalDocumentProblemSchema = defineApiProblemSchema(
  'STALE_LEGAL_DOCUMENT',
  409,
);
export const identityNetworkingDisabledProblemSchema = defineApiProblemSchema(
  'NETWORKING_DISABLED',
  409,
);
export const identityValidationProblemSchema = defineApiProblemSchema(
  'VALIDATION_FAILED',
  422,
);
export const identityRequestIdReusedProblemSchema = defineApiProblemSchema(
  'REQUEST_ID_REUSED',
  409,
);
export const identitySessionActionRejectedProblemSchema =
  defineApiProblemSchema('SESSION_ACTION_REJECTED', 409);
export const identityInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);

export const identityBootstrapProblemSchema = z.discriminatedUnion('code', [
  identityAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  identityEventAccessDeniedProblemSchema,
  identityInternalErrorProblemSchema,
]);

export const identityOnboardingProblemSchema = z.discriminatedUnion('code', [
  identityAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  identityEventAccessDeniedProblemSchema,
  identityLegalConfigurationMissingProblemSchema,
  identityStaleLegalDocumentProblemSchema,
  identityNetworkingDisabledProblemSchema,
  identityRequestIdReusedProblemSchema,
  identityValidationProblemSchema,
  identityInternalErrorProblemSchema,
]);

export const identitySessionActionProblemSchema = z.discriminatedUnion('code', [
  identityAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  identityRequestIdReusedProblemSchema,
  identitySessionActionRejectedProblemSchema,
  identityInternalErrorProblemSchema,
]);

export type IdentityBootstrapProblem = z.infer<
  typeof identityBootstrapProblemSchema
>;
export type IdentityOnboardingProblem = z.infer<
  typeof identityOnboardingProblemSchema
>;
export type IdentitySessionActionProblem = z.infer<
  typeof identitySessionActionProblemSchema
>;
