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

export const supportMutationProblemSchema = z.discriminatedUnion('code', [
  ...supportReadProblems,
  supportRecordNotFoundProblemSchema,
  supportTargetNotFoundProblemSchema,
  supportStaleVersionProblemSchema,
  supportInvalidTransitionProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
]);

export type SupportSearchProblem = z.infer<typeof supportSearchProblemSchema>;
export type SupportMutationProblem = z.infer<
  typeof supportMutationProblemSchema
>;
