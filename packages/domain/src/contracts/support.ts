import { z } from 'zod';

import {
  defineApiProblemSchema,
  idempotencyInProgressProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyKeySchema,
  sessionExpiredProblemSchema,
} from './base.js';

export const SUPPORT_SEARCH_MIN_LENGTH = 2;
export const SUPPORT_SEARCH_MAX_LENGTH = 80;
export const SUPPORT_SEARCH_RESULT_LIMIT = 5;

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const versionSchema = z.number().int().positive();
const unsafeInlineTextPattern =
  /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069<>]/;
const unsafeMultilineTextPattern =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069<>]/;

const safeInlineTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, {
      message: 'Text must not be blank',
    })
    .refine((value) => !unsafeInlineTextPattern.test(value), {
      message: 'Text contains unsafe control characters or markup',
    });

const mutationReasonSchema = z
  .string()
  .min(8)
  .max(500)
  .refine((value) => value.trim().length >= 8, {
    message: 'Support mutation reason must contain eight visible characters',
  })
  .refine((value) => !unsafeMultilineTextPattern.test(value), {
    message: 'Support mutation reason contains unsafe characters or markup',
  });

const maskedContactSchema = safeInlineTextSchema(120).refine(
  (value) =>
    /[*•…]/.test(value) &&
    !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value),
  'Support contact must remain masked',
);

/**
 * CS-SUPPORT-01 carries operational PII. It is online-only and must be
 * synchronously discarded after permission loss, logout or event switch.
 */
export const supportCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  browserPersistence: 'forbidden',
  sharedCache: 'forbidden',
  searchMutation: 'none',
  supportMutation: 'online-only',
  mutationIdempotency: 'required',
} as const);

export const supportSearchQuerySchema = z.strictObject({
  query: z
    .string()
    .trim()
    .min(SUPPORT_SEARCH_MIN_LENGTH)
    .max(SUPPORT_SEARCH_MAX_LENGTH)
    .refine((value) => !unsafeInlineTextPattern.test(value), {
      message: 'Search query contains unsafe characters',
    }),
  limit: z.number().int().min(1).max(SUPPORT_SEARCH_RESULT_LIMIT).optional(),
});

export type SupportSearchQuery = z.infer<typeof supportSearchQuerySchema>;

export const supportActionSchema = z.enum([
  'resend',
  'reassign',
  'block',
  'reactivate',
  'transfer',
]);

export type SupportAction = z.infer<typeof supportActionSchema>;

export const supportTicketStateSchema = z.enum([
  'active',
  'blocked',
  'cancelled',
  'refunded',
]);

export type SupportTicketState = z.infer<typeof supportTicketStateSchema>;

export const supportAccessStateSchema = z.enum([
  'claimed',
  'not_claimed',
  'recovery_pending',
]);

export type SupportAccessState = z.infer<typeof supportAccessStateSchema>;

export const supportRecordSchema = z
  .strictObject({
    eventId: uuidSchema,
    participantId: uuidSchema,
    ticketId: uuidSchema,
    displayName: safeInlineTextSchema(160),
    maskedContact: maskedContactSchema,
    referenceSuffix: z.string().regex(/^[A-Za-z0-9]{2,8}$/),
    ticketState: supportTicketStateSchema,
    accessState: supportAccessStateSchema,
    version: versionSchema,
    availableActions: z.array(supportActionSchema).max(5),
  })
  .superRefine((record, context) => {
    if (
      new Set(record.availableActions).size !== record.availableActions.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['availableActions'],
        message: 'Available support actions must be unique',
      });
    }
    if (
      (record.ticketState === 'blocked') !==
      record.availableActions.includes('reactivate')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['availableActions'],
        message:
          'Only blocked tickets expose reactivate, and blocked tickets must expose it',
      });
    }
    if (
      record.ticketState !== 'active' &&
      record.availableActions.includes('block')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['availableActions'],
        message: 'Only active tickets can expose block',
      });
    }
  });

export type SupportRecord = z.infer<typeof supportRecordSchema>;

export const adminParticipantNetworkingStateSchema = z.enum([
  'enabled',
  'disabled',
  'moderated',
]);

export type AdminParticipantNetworkingState = z.infer<
  typeof adminParticipantNetworkingStateSchema
>;

export const adminParticipantInvitationStatusSchema = z.enum([
  'not_sent',
  'sent',
  'accepted',
]);

export type AdminParticipantInvitationStatus = z.infer<
  typeof adminParticipantInvitationStatusSchema
>;

export const adminParticipantInvitationSchema = z.strictObject({
  status: adminParticipantInvitationStatusSchema,
  lastSentAt: dateTimeSchema.nullable(),
});

export const adminParticipantListRequestSchema = z.strictObject({
  query: z
    .string()
    .trim()
    .max(SUPPORT_SEARCH_MAX_LENGTH)
    .refine((value) => !unsafeInlineTextPattern.test(value), {
      message: 'Search query contains unsafe characters',
    })
    .default(''),
  ticketStates: z
    .array(supportTicketStateSchema)
    .max(4)
    .refine((values) => new Set(values).size === values.length)
    .default([]),
  networkingStates: z
    .array(adminParticipantNetworkingStateSchema)
    .max(3)
    .refine((values) => new Set(values).size === values.length)
    .default([]),
  limit: z.number().int().min(1).max(100).default(100),
  offset: z.number().int().min(0).max(10_000).default(0),
});

export type AdminParticipantListRequest = z.infer<
  typeof adminParticipantListRequestSchema
>;

export const adminParticipantListItemSchema = z.strictObject({
  eventId: uuidSchema,
  participantId: uuidSchema,
  ticketId: uuidSchema,
  displayName: safeInlineTextSchema(257),
  contactEmail: z.string().email().max(320),
  company: z.string().max(160),
  jobTitle: z.string().max(160),
  referenceSuffix: z.string().regex(/^[A-Za-z0-9]{2,16}$/),
  ticketState: supportTicketStateSchema,
  accessState: supportAccessStateSchema,
  networkingState: adminParticipantNetworkingStateSchema,
  invitation: adminParticipantInvitationSchema,
  checkedIn: z.boolean(),
  reservationCount: z.number().int().nonnegative(),
  profileVersion: versionSchema,
  ticketVersion: versionSchema,
  updatedAt: dateTimeSchema,
  availableActions: z.array(supportActionSchema).max(5),
});

export type AdminParticipantListItem = z.infer<
  typeof adminParticipantListItemSchema
>;

export const adminParticipantListResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    generatedAt: dateTimeSchema,
    items: z.array(adminParticipantListItemSchema).max(100),
    pageInfo: z.strictObject({
      total: z.number().int().nonnegative(),
      offset: z.number().int().nonnegative(),
      hasMore: z.boolean(),
    }),
    summary: z.strictObject({
      total: z.number().int().nonnegative(),
      active: z.number().int().nonnegative(),
      networkingEnabled: z.number().int().nonnegative(),
      checkedIn: z.number().int().nonnegative(),
    }),
  })
  .superRefine((response, context) => {
    if (
      response.items.some(({ eventId }) => eventId !== response.eventId) ||
      new Set(response.items.map(({ participantId }) => participantId)).size !==
        response.items.length ||
      response.pageInfo.hasMore !==
        response.pageInfo.offset + response.items.length <
          response.pageInfo.total
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Participant list must be event-scoped and consistently paged',
      });
    }
  });

export type AdminParticipantListResponse = z.infer<
  typeof adminParticipantListResponseSchema
>;

export const adminParticipantReservationSchema = z.strictObject({
  reservationId: uuidSchema,
  sessionId: uuidSchema,
  title: safeInlineTextSchema(160),
  startsAt: dateTimeSchema,
  status: z.enum(['confirmed', 'cancelled']),
  source: safeInlineTextSchema(32),
});

export const adminParticipantDetailSchema = z.strictObject({
  eventId: uuidSchema,
  participantId: uuidSchema,
  ticketId: uuidSchema,
  firstName: safeInlineTextSchema(128),
  lastName: safeInlineTextSchema(128),
  contactEmail: z.string().email().max(320),
  phone: z.string().max(16).nullable(),
  company: z.string().max(160),
  jobTitle: z.string().max(160),
  introduction: z.string().max(1_000),
  linkedinUrl: z.string().url().max(2_048).nullable(),
  todayHunting: z
    .array(
      z.enum([
        'know_how',
        'team',
        'investors',
        'business_partners',
        'suppliers',
        'clients',
      ]),
    )
    .max(6),
  networkingEnabled: z.boolean(),
  moderationStatus: z.enum(['visible', 'hidden']),
  onboardingCompleted: z.boolean(),
  membershipStatus: z.enum(['active', 'suspended', 'revoked']),
  invitation: adminParticipantInvitationSchema,
  ticket: z.strictObject({
    source: z.enum(['ticket', 'simpleshop']),
    referenceSuffix: z.string().regex(/^[A-Za-z0-9]{2,16}$/),
    externalId: z.string().max(256).nullable(),
    orderExternalId: z.string().max(256).nullable(),
    state: supportTicketStateSchema,
    claimedAt: dateTimeSchema.nullable(),
    version: versionSchema,
    availableActions: z.array(supportActionSchema).max(5),
  }),
  checkIn: z.strictObject({ occurredAt: dateTimeSchema }).nullable(),
  reservations: z.array(adminParticipantReservationSchema).max(100),
  profileVersion: versionSchema,
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
});

export type AdminParticipantDetail = z.infer<
  typeof adminParticipantDetailSchema
>;

export const adminParticipantInviteRequestSchema = z.strictObject({
  participantId: uuidSchema,
});

export type AdminParticipantInviteRequest = z.infer<
  typeof adminParticipantInviteRequestSchema
>;

export const adminParticipantInviteResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    participantId: uuidSchema,
    outcome: z.enum(['sent', 'already_sent']),
    sentAt: dateTimeSchema,
    invitation: adminParticipantInvitationSchema,
    audit: z.strictObject({ auditId: uuidSchema }),
  })
  .superRefine((response, context) => {
    if (
      response.invitation.status === 'not_sent' ||
      response.invitation.lastSentAt !== response.sentAt
    ) {
      context.addIssue({
        code: 'custom',
        path: ['invitation'],
        message: 'A sent invitation must expose its delivery timestamp',
      });
    }
  });

export type AdminParticipantInviteResponse = z.infer<
  typeof adminParticipantInviteResponseSchema
>;

const adminParticipantProfileFields = {
  firstName: safeInlineTextSchema(128),
  lastName: safeInlineTextSchema(128),
  contactEmail: z.string().trim().toLowerCase().email().max(320),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .nullable(),
  company: z.string().trim().max(160),
  jobTitle: z.string().trim().max(160),
  introduction: z.string().trim().max(1_000),
  linkedinUrl: z
    .string()
    .url()
    .max(2_048)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'https:' && /(^|\.)linkedin\.com$/i.test(url.hostname)
      );
    })
    .nullable(),
  todayHunting: z
    .array(
      z.enum([
        'know_how',
        'team',
        'investors',
        'business_partners',
        'suppliers',
        'clients',
      ]),
    )
    .max(6)
    .refine((values) => new Set(values).size === values.length),
  networkingEnabled: z.boolean(),
  moderationStatus: z.enum(['visible', 'hidden']),
} as const;

export const adminParticipantCreateRequestSchema = z.strictObject({
  reason: mutationReasonSchema,
  profile: z.strictObject({
    firstName: adminParticipantProfileFields.firstName,
    lastName: adminParticipantProfileFields.lastName,
    contactEmail: adminParticipantProfileFields.contactEmail,
    phone: adminParticipantProfileFields.phone,
    company: adminParticipantProfileFields.company,
    jobTitle: adminParticipantProfileFields.jobTitle,
  }),
});

export type AdminParticipantCreateRequest = z.infer<
  typeof adminParticipantCreateRequestSchema
>;

export const adminParticipantUpdateRequestSchema = z.strictObject({
  participantId: uuidSchema,
  expectedProfileVersion: versionSchema,
  reason: mutationReasonSchema,
  profile: z.strictObject(adminParticipantProfileFields),
});

export type AdminParticipantUpdateRequest = z.infer<
  typeof adminParticipantUpdateRequestSchema
>;

export const adminParticipantUpdateResponseSchema = z.strictObject({
  eventId: uuidSchema,
  outcome: z.enum(['updated', 'already_applied']),
  detail: adminParticipantDetailSchema,
  changedAt: dateTimeSchema,
  audit: z.strictObject({ auditId: uuidSchema }),
});

export type AdminParticipantUpdateResponse = z.infer<
  typeof adminParticipantUpdateResponseSchema
>;

export const adminParticipantCreateResponseSchema = z.strictObject({
  eventId: uuidSchema,
  outcome: z.enum(['created', 'already_applied']),
  detail: adminParticipantDetailSchema,
  createdAt: dateTimeSchema,
  audit: z.strictObject({ auditId: uuidSchema }),
});

export type AdminParticipantCreateResponse = z.infer<
  typeof adminParticipantCreateResponseSchema
>;

const supportSearchBaseShape = {
  eventId: uuidSchema,
  limitedTo: z.literal(SUPPORT_SEARCH_RESULT_LIMIT),
} as const;

export const supportSearchResponseSchema = z
  .discriminatedUnion('outcome', [
    z.strictObject({
      ...supportSearchBaseShape,
      outcome: z.literal('no_match'),
      matches: z.tuple([]),
    }),
    z.strictObject({
      ...supportSearchBaseShape,
      outcome: z.literal('single_match'),
      matches: z.tuple([supportRecordSchema]),
    }),
    z.strictObject({
      ...supportSearchBaseShape,
      outcome: z.literal('ambiguous'),
      matches: z
        .array(supportRecordSchema)
        .min(2)
        .max(SUPPORT_SEARCH_RESULT_LIMIT)
        .superRefine((records, context) => {
          const participantIds = records.map(
            ({ participantId }) => participantId,
          );
          if (new Set(participantIds).size !== participantIds.length) {
            context.addIssue({
              code: 'custom',
              message: 'Ambiguous support results must be distinct',
            });
          }
        }),
    }),
  ])
  .superRefine((response, context) => {
    if (response.matches.some(({ eventId }) => eventId !== response.eventId)) {
      context.addIssue({
        code: 'custom',
        path: ['matches'],
        message: 'Support matches must belong to the response event',
      });
    }
  });

export type SupportSearchResponse = z.infer<typeof supportSearchResponseSchema>;

/**
 * A target picker accepts a human reference, never a ticket UUID. The source
 * identity/version are carried only to bind the result to the record currently
 * being reviewed and to fail closed when that record changed meanwhile.
 */
export const supportTargetTicketSearchRequestSchema = z.strictObject({
  sourceTicketId: uuidSchema,
  sourceExpectedVersion: versionSchema,
  reference: supportSearchQuerySchema.shape.query,
  limit: z.literal(SUPPORT_SEARCH_RESULT_LIMIT).optional(),
});

export type SupportTargetTicketSearchRequest = z.infer<
  typeof supportTargetTicketSearchRequestSchema
>;

export const supportTargetTicketCandidateSchema = z.strictObject({
  eventId: uuidSchema,
  ticketId: uuidSchema,
  maskedContact: maskedContactSchema,
  referenceSuffix: z.string().regex(/^[A-Za-z0-9]{2,8}$/),
  ticketState: supportTicketStateSchema,
  accessState: supportAccessStateSchema,
  version: versionSchema,
});

export type SupportTargetTicketCandidate = z.infer<
  typeof supportTargetTicketCandidateSchema
>;

const supportTargetTicketSearchBaseShape = {
  eventId: uuidSchema,
  sourceTicketId: uuidSchema,
  sourceVersion: versionSchema,
  limitedTo: z.literal(SUPPORT_SEARCH_RESULT_LIMIT),
} as const;

export const supportTargetTicketSearchResponseSchema = z
  .discriminatedUnion('outcome', [
    z.strictObject({
      ...supportTargetTicketSearchBaseShape,
      outcome: z.literal('no_match'),
      candidates: z.tuple([]),
    }),
    z.strictObject({
      ...supportTargetTicketSearchBaseShape,
      outcome: z.literal('single_match'),
      candidates: z.tuple([supportTargetTicketCandidateSchema]),
    }),
    z.strictObject({
      ...supportTargetTicketSearchBaseShape,
      outcome: z.literal('ambiguous'),
      candidates: z
        .array(supportTargetTicketCandidateSchema)
        .min(2)
        .max(SUPPORT_SEARCH_RESULT_LIMIT),
    }),
  ])
  .superRefine((response, context) => {
    if (
      response.candidates.some(
        ({ eventId, ticketId }) =>
          eventId !== response.eventId || ticketId === response.sourceTicketId,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message:
          'Target candidates must belong to the event and differ from the source ticket',
      });
    }
    const ticketIds = response.candidates.map(({ ticketId }) => ticketId);
    if (new Set(ticketIds).size !== ticketIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['candidates'],
        message: 'Target ticket candidates must be distinct',
      });
    }
  });

export type SupportTargetTicketSearchResponse = z.infer<
  typeof supportTargetTicketSearchResponseSchema
>;

export const supportMutationRequestSchema = z
  .strictObject({
    participantId: uuidSchema,
    ticketId: uuidSchema,
    action: supportActionSchema,
    expectedVersion: versionSchema,
    reason: mutationReasonSchema,
    targetTicketId: uuidSchema.nullable(),
  })
  .superRefine((request, context) => {
    const needsTarget =
      request.action === 'reassign' || request.action === 'transfer';
    if (needsTarget !== (request.targetTicketId !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['targetTicketId'],
        message:
          'Target ticket is required only for reassign and transfer actions',
      });
    }
    if (request.targetTicketId === request.ticketId) {
      context.addIssue({
        code: 'custom',
        path: ['targetTicketId'],
        message: 'Target ticket must differ from the current ticket',
      });
    }
  });

export type SupportMutationRequest = z.infer<
  typeof supportMutationRequestSchema
>;

/**
 * Idempotency is request metadata and deliberately absent from the JSON body.
 * Actor role and event scope are always derived from the authenticated route.
 */
export const supportMutationHeadersSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});

export type SupportMutationHeaders = z.infer<
  typeof supportMutationHeadersSchema
>;

export const supportMutationResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    record: supportRecordSchema,
    outcome: z.enum(['applied', 'already_applied']),
    changedAt: dateTimeSchema,
    audit: z.strictObject({
      auditId: uuidSchema,
    }),
  })
  .superRefine((response, context) => {
    if (response.record.eventId !== response.eventId) {
      context.addIssue({
        code: 'custom',
        path: ['record', 'eventId'],
        message: 'Support mutation record must match the response event',
      });
    }
  });

export type SupportMutationResponse = z.infer<
  typeof supportMutationResponseSchema
>;

export const supportAuthenticationRequiredProblemSchema =
  defineApiProblemSchema('AUTHENTICATION_REQUIRED', 401);
export const supportEventAccessDeniedProblemSchema = defineApiProblemSchema(
  'EVENT_ACCESS_DENIED',
  403,
);
export const supportRecordNotFoundProblemSchema = defineApiProblemSchema(
  'SUPPORT_RECORD_NOT_FOUND',
  404,
);
export const supportTargetNotFoundProblemSchema = defineApiProblemSchema(
  'SUPPORT_TARGET_NOT_FOUND',
  404,
);
export const supportStaleVersionProblemSchema = defineApiProblemSchema(
  'STALE_VERSION',
  409,
).extend({
  currentVersion: versionSchema,
});
export const supportInvalidTransitionProblemSchema = defineApiProblemSchema(
  'SUPPORT_INVALID_TRANSITION',
  409,
);
export const supportRateLimitedProblemSchema = defineApiProblemSchema(
  'SUPPORT_RATE_LIMITED',
  429,
);
export const supportValidationProblemSchema = defineApiProblemSchema(
  'VALIDATION_FAILED',
  422,
);
export const supportInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);
export const participantInvitationDeliveryUnavailableProblemSchema =
  defineApiProblemSchema('INVITATION_DELIVERY_UNAVAILABLE', 503);

const supportReadProblems = [
  supportAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  supportEventAccessDeniedProblemSchema,
  supportRateLimitedProblemSchema,
  supportValidationProblemSchema,
  supportInternalErrorProblemSchema,
] as const;

export const supportSearchProblemSchema = z.discriminatedUnion(
  'code',
  supportReadProblems,
);

export const adminParticipantReadProblemSchema = z.discriminatedUnion('code', [
  ...supportReadProblems,
  supportRecordNotFoundProblemSchema,
]);

export const supportTargetTicketSearchProblemSchema = z.discriminatedUnion(
  'code',
  [
    ...supportReadProblems,
    supportRecordNotFoundProblemSchema,
    supportStaleVersionProblemSchema,
  ],
);

export const supportMutationProblemSchema = z.discriminatedUnion('code', [
  ...supportReadProblems,
  supportRecordNotFoundProblemSchema,
  supportTargetNotFoundProblemSchema,
  supportStaleVersionProblemSchema,
  supportInvalidTransitionProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
]);

export const adminParticipantInviteProblemSchema = z.discriminatedUnion(
  'code',
  [
    ...supportReadProblems,
    supportRecordNotFoundProblemSchema,
    supportInvalidTransitionProblemSchema,
    participantInvitationDeliveryUnavailableProblemSchema,
    idempotencyKeyReusedProblemSchema,
    idempotencyInProgressProblemSchema,
  ],
);

export type SupportSearchProblem = z.infer<typeof supportSearchProblemSchema>;
export type AdminParticipantReadProblem = z.infer<
  typeof adminParticipantReadProblemSchema
>;
export type SupportTargetTicketSearchProblem = z.infer<
  typeof supportTargetTicketSearchProblemSchema
>;
export type SupportMutationProblem = z.infer<
  typeof supportMutationProblemSchema
>;
export type AdminParticipantInviteProblem = z.infer<
  typeof adminParticipantInviteProblemSchema
>;
