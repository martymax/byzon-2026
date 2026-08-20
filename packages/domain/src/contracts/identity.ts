import { z } from 'zod';

import {
  defineApiProblemSchema,
  idempotencyInProgressProblemSchema,
  idempotencyKeyReusedProblemSchema,
  sessionExpiredProblemSchema,
} from './base.js';

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
export const identityProfileVersionSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);
export type IdentityProfileVersion = z.infer<
  typeof identityProfileVersionSchema
>;
const safeLegalTextSchema = z
  .string()
  .min(1)
  .max(32_768)
  .refine((value) => value.trim().length > 0, 'Legal text must not be blank')
  .refine(
    (value) =>
      !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(
        value,
      ),
    'Legal text contains unsafe control characters',
  )
  .refine(
    (value) => !/[<>]/.test(value),
    'Legal text must not contain HTML markup',
  );
const safeLegalHttpsUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.username === '' &&
        url.password === '' &&
        url.hostname !== ''
      );
    } catch {
      return false;
    }
  }, 'Legal document URL must be credential-free HTTPS');

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

const canonicalEmailSchema = identityEmailSchema
  .refine((value) => value === value.trim(), 'Email must be canonical')
  .refine((value) => value === value.toLowerCase(), 'Email must be lowercase');

const canonicalNameSchema = safeDisplayTextSchema(128).refine(
  (value) => value === value.trim(),
  'Name must be canonical',
);

export const identityPhoneSchema = z
  .string()
  .min(9)
  .max(16)
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must use international E.164 format');

export const identityProfileSchema = z.strictObject({
  firstName: canonicalNameSchema,
  lastName: canonicalNameSchema,
  contactEmail: canonicalEmailSchema,
  phone: identityPhoneSchema.nullable().optional(),
});

export type IdentityProfile = z.infer<typeof identityProfileSchema>;

export const identityLegalDocumentTypeSchema = z.enum([
  'terms',
  'privacy_notice',
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
  content: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('inline'),
      text: safeLegalTextSchema,
    }),
    z.strictObject({
      kind: z.literal('external'),
      url: safeLegalHttpsUrlSchema,
    }),
  ]),
});

export type IdentityLegalDocument = z.infer<typeof identityLegalDocumentSchema>;

export const identityLegalAcknowledgementDecisionSchema = z.enum([
  'accepted',
  'acknowledged',
]);

export type IdentityLegalAcknowledgementDecision = z.infer<
  typeof identityLegalAcknowledgementDecisionSchema
>;

export const identityLegalAcknowledgementSchema = z.strictObject({
  documentId: uuidSchema,
  type: identityLegalDocumentTypeSchema,
  decision: identityLegalAcknowledgementDecisionSchema,
  version: safeVersionSchema,
  acknowledgedAt: dateTimeSchema,
});

export type IdentityLegalAcknowledgement = z.infer<
  typeof identityLegalAcknowledgementSchema
>;

export const identityProfileManagementSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('missing') }),
  z.strictObject({
    state: z.literal('editable'),
    version: identityProfileVersionSchema,
  }),
  z.strictObject({ state: z.literal('read_only') }),
  z.strictObject({ state: z.literal('removed') }),
]);

export type IdentityProfileManagement = z.infer<
  typeof identityProfileManagementSchema
>;

export const identityPrivacyRequestStatusSchema = z.enum([
  'available',
  'pending',
  'completed',
  'rejected',
  'unavailable',
]);

export type IdentityPrivacyRequestStatus = z.infer<
  typeof identityPrivacyRequestStatusSchema
>;

export const identityOnboardingStateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('profile_required') }),
  z.strictObject({
    status: z.literal('blocked_missing_legal_documents'),
    missingTypes: z
      .array(identityLegalDocumentTypeSchema)
      .min(1)
      .max(2)
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
      .max(2)
      .refine(
        (types) => new Set(types).size === types.length,
        'Required legal document types must be unique',
      ),
  }),
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
      startsAt: dateTimeSchema,
      endsAt: dateTimeSchema,
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
    profileManagement: identityProfileManagementSchema,
    onboarding: identityOnboardingStateSchema,
    legalDocuments: z.array(identityLegalDocumentSchema).max(2),
    legalAcknowledgements: z.array(identityLegalAcknowledgementSchema).max(2),
    features: z.strictObject({
      reservations: z.boolean(),
      announcements: z.boolean(),
    }),
    unreadCounts: z.strictObject({
      announcements: z.number().int().min(0).max(999),
    }),
    privacy: z.strictObject({
      deletionRequest: identityPrivacyRequestStatusSchema,
    }),
    supportEmail: canonicalEmailSchema,
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
      Date.parse(response.event.startsAt) >= Date.parse(response.event.endsAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['event', 'endsAt'],
        message: 'Event end must follow its start',
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
    const documentById = new Map(
      response.legalDocuments.map((document) => [document.id, document]),
    );
    const acknowledgementIds = response.legalAcknowledgements.map(
      ({ documentId }) => documentId,
    );
    const acknowledgementTypes = response.legalAcknowledgements.map(
      ({ type }) => type,
    );
    if (new Set(acknowledgementIds).size !== acknowledgementIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['legalAcknowledgements'],
        message: 'Legal acknowledgement document IDs must be unique',
      });
    }
    if (new Set(acknowledgementTypes).size !== acknowledgementTypes.length) {
      context.addIssue({
        code: 'custom',
        path: ['legalAcknowledgements'],
        message: 'Legal acknowledgement types must be unique',
      });
    }
    response.legalAcknowledgements.forEach((acknowledgement, index) => {
      const document = documentById.get(acknowledgement.documentId);
      if (!document) {
        context.addIssue({
          code: 'custom',
          path: ['legalAcknowledgements', index, 'documentId'],
          message:
            'Legal acknowledgement must reference a current legal document',
        });
        return;
      }
      if (
        document.type !== acknowledgement.type ||
        document.version !== acknowledgement.version
      ) {
        context.addIssue({
          code: 'custom',
          path: ['legalAcknowledgements', index],
          message:
            'Legal acknowledgement must match the referenced document version',
        });
      }
      if (
        document?.publishedAt &&
        Date.parse(acknowledgement.acknowledgedAt) <
          Date.parse(document.publishedAt)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['legalAcknowledgements', index, 'acknowledgedAt'],
          message: 'Legal acknowledgement cannot precede document publication',
        });
      }
      const expectedDecision =
        acknowledgement.type === 'privacy_notice' ? 'acknowledged' : 'accepted';
      if (acknowledgement.decision !== expectedDecision) {
        context.addIssue({
          code: 'custom',
          path: ['legalAcknowledgements', index, 'decision'],
          message: `Legal acknowledgement for ${acknowledgement.type} must be ${expectedDecision}`,
        });
      }
    });

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
    if (
      response.event.phase === 'archived' &&
      response.profileManagement.state !== 'read_only' &&
      response.profileManagement.state !== 'removed'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['profileManagement'],
        message:
          'Archived events can expose only a read-only or removed profile',
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
      if (response.profileManagement.state !== 'missing') {
        context.addIssue({
          code: 'custom',
          path: ['profileManagement'],
          message: 'Profile-required onboarding must expose a missing profile',
        });
      }
    } else if (
      response.profile === null &&
      response.profileManagement.state !== 'removed'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['profile'],
        message: 'Onboarding state requires a profile',
      });
    }
    if (
      response.profile === null &&
      !['missing', 'removed'].includes(response.profileManagement.state)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['profileManagement'],
        message: 'Profile management state requires an existing profile',
      });
    }
    if (
      response.profile !== null &&
      !['editable', 'read_only'].includes(response.profileManagement.state)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['profileManagement'],
        message: 'Existing profile must be editable or read-only',
      });
    }
    if (
      (response.profileManagement.state === 'removed') !==
      (response.privacy.deletionRequest === 'completed')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['privacy', 'deletionRequest'],
        message:
          'Completed deletion status must match a removed profile management state',
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
    }

    if (onboarding.status === 'complete') {
      const acknowledgementByType = new Map(
        response.legalAcknowledgements.map((record) => [record.type, record]),
      );
      for (const [type, decision] of [
        ['terms', 'accepted'],
        ['privacy_notice', 'acknowledged'],
      ] as const) {
        const currentDocument = response.legalDocuments.find(
          (document) => document.type === type,
        );
        const acknowledgement = acknowledgementByType.get(type);
        if (
          !currentDocument ||
          acknowledgement?.documentId !== currentDocument.id ||
          acknowledgement.version !== currentDocument.version ||
          acknowledgement.decision !== decision
        ) {
          context.addIssue({
            code: 'custom',
            path: ['legalAcknowledgements'],
            message: `Onboarding state requires the current ${type} acknowledgement`,
          });
        }
      }
    }
  });

export type IdentityBootstrapResponse = z.infer<
  typeof identityBootstrapResponseSchema
>;

export const identityProfileUpdateRequestSchema = z.strictObject({
  expectedVersion: identityProfileVersionSchema,
  profile: identityProfileSchema,
});

export type IdentityProfileUpdateRequest = z.infer<
  typeof identityProfileUpdateRequestSchema
>;

export const identityProfileUpdateResponseSchema = z.strictObject({
  eventId: uuidSchema,
  userId: uuidSchema,
  profile: identityProfileSchema,
  profileManagement: z.strictObject({
    state: z.literal('editable'),
    version: identityProfileVersionSchema,
  }),
  updatedAt: dateTimeSchema,
});

export type IdentityProfileUpdateResponse = z.infer<
  typeof identityProfileUpdateResponseSchema
>;

export const identityPrivacyRequestKindSchema = z.literal('data_deletion');

export type IdentityPrivacyRequestKind = z.infer<
  typeof identityPrivacyRequestKindSchema
>;

export const identityPrivacyRequestRequestSchema = z.strictObject({
  kind: identityPrivacyRequestKindSchema,
});

export type IdentityPrivacyRequestRequest = z.infer<
  typeof identityPrivacyRequestRequestSchema
>;

const identityPrivacyRequestBaseShape = {
  id: uuidSchema,
  kind: identityPrivacyRequestKindSchema,
  requestedAt: dateTimeSchema,
} as const;

export const identityPrivacyRequestPendingRecordSchema = z.strictObject({
  ...identityPrivacyRequestBaseShape,
  state: z.literal('pending'),
});

export const identityPrivacyRequestRecordSchema = z
  .discriminatedUnion('state', [
    identityPrivacyRequestPendingRecordSchema,
    z.strictObject({
      ...identityPrivacyRequestBaseShape,
      state: z.literal('completed'),
      resolvedAt: dateTimeSchema,
    }),
    z.strictObject({
      ...identityPrivacyRequestBaseShape,
      state: z.literal('rejected'),
      resolvedAt: dateTimeSchema,
      supportReference: safeDisplayTextSchema(64),
    }),
  ])
  .superRefine((request, context) => {
    if (
      request.state !== 'pending' &&
      Date.parse(request.resolvedAt) < Date.parse(request.requestedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['resolvedAt'],
        message: 'Privacy request resolution cannot precede its creation',
      });
    }
  });

export type IdentityPrivacyRequestRecord = z.infer<
  typeof identityPrivacyRequestRecordSchema
>;

export const identityPrivacyRequestResponseSchema = z.strictObject({
  eventId: uuidSchema,
  userId: uuidSchema,
  request: identityPrivacyRequestPendingRecordSchema,
});

export type IdentityPrivacyRequestResponse = z.infer<
  typeof identityPrivacyRequestResponseSchema
>;

export const identityOnboardingRequestSchema = z
  .strictObject({
    profile: identityProfileSchema,
    legal: z.strictObject({
      termsDocumentId: uuidSchema,
      termsAccepted: z.literal(true),
      privacyNoticeDocumentId: uuidSchema,
      privacyAcknowledged: z.literal(true),
    }),
  })
  .superRefine((request, context) => {
    const documentIds = [
      request.legal.termsDocumentId,
      request.legal.privacyNoticeDocumentId,
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
    acknowledgements: z
      .array(
        z.strictObject({
          documentId: uuidSchema,
          type: identityLegalDocumentTypeSchema,
          decision: z.enum(['accepted', 'acknowledged']),
          version: safeVersionSchema,
        }),
      )
      .length(2),
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
    if (byType.size !== response.acknowledgements.length) {
      context.addIssue({
        code: 'custom',
        path: ['acknowledgements'],
        message: 'Acknowledgement types must be unique',
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
export const identityProfileNotFoundProblemSchema = defineApiProblemSchema(
  'PROFILE_NOT_FOUND',
  404,
);
export const identityProfileNotEditableProblemSchema = defineApiProblemSchema(
  'PROFILE_NOT_EDITABLE',
  409,
);
export const identityStaleProfileVersionProblemSchema = defineApiProblemSchema(
  'STALE_VERSION',
  409,
).extend({
  currentVersion: identityProfileVersionSchema,
});
export const identityPrivacyRequestUnavailableProblemSchema =
  defineApiProblemSchema('PRIVACY_REQUEST_UNAVAILABLE', 409);
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
  identityRequestIdReusedProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
  identityValidationProblemSchema,
  identityInternalErrorProblemSchema,
]);

export const identitySessionActionProblemSchema = z.discriminatedUnion('code', [
  identityAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  identityRequestIdReusedProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
  identitySessionActionRejectedProblemSchema,
  identityInternalErrorProblemSchema,
]);

export const identityProfileUpdateProblemSchema = z.discriminatedUnion('code', [
  identityAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  identityEventAccessDeniedProblemSchema,
  identityProfileNotFoundProblemSchema,
  identityProfileNotEditableProblemSchema,
  identityStaleProfileVersionProblemSchema,
  identityValidationProblemSchema,
  identityInternalErrorProblemSchema,
]);

export const identityPrivacyRequestProblemSchema = z.discriminatedUnion(
  'code',
  [
    identityAuthenticationRequiredProblemSchema,
    sessionExpiredProblemSchema,
    identityEventAccessDeniedProblemSchema,
    identityPrivacyRequestUnavailableProblemSchema,
    idempotencyKeyReusedProblemSchema,
    idempotencyInProgressProblemSchema,
    identityValidationProblemSchema,
    identityInternalErrorProblemSchema,
  ],
);

export type IdentityBootstrapProblem = z.infer<
  typeof identityBootstrapProblemSchema
>;
export type IdentityOnboardingProblem = z.infer<
  typeof identityOnboardingProblemSchema
>;
export type IdentitySessionActionProblem = z.infer<
  typeof identitySessionActionProblemSchema
>;
export type IdentityProfileUpdateProblem = z.infer<
  typeof identityProfileUpdateProblemSchema
>;
export type IdentityPrivacyRequestProblem = z.infer<
  typeof identityPrivacyRequestProblemSchema
>;
