import { z } from 'zod';

import {
  defineApiProblemSchema,
  idempotencyInProgressProblemSchema,
  idempotencyKeyReusedProblemSchema,
  sessionExpiredProblemSchema,
} from './base.js';

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const cleanText = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((value) => value === value.trim(), 'Text must be canonical')
    .refine(
      (value) => !/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(value),
      'Text contains unsafe control characters',
    );

export const questionSubmitRequestSchema = z.strictObject({
  text: cleanText(1, 1_000),
});
export const questionSubmitResponseSchema = z.strictObject({
  questionId: uuidSchema,
  sessionId: uuidSchema,
  submittedAt: dateTimeSchema,
});
export const moderatorQuestionSchema = z.strictObject({
  questionId: uuidSchema,
  authorName: cleanText(1, 257),
  text: cleanText(1, 1_000),
  submittedAt: dateTimeSchema,
});
export const moderatorQuestionFeedQuerySchema = z
  .strictObject({
    after: dateTimeSchema.optional(),
    cursor: uuidSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .superRefine((query, context) => {
    if ((query.after === undefined) !== (query.cursor === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'Cursor and timestamp must be supplied together',
      });
    }
  });
export const moderatorQuestionFeedSchema = z
  .strictObject({
    eventId: uuidSchema,
    sessionId: uuidSchema,
    serverTime: dateTimeSchema,
    items: z.array(moderatorQuestionSchema).max(100),
    nextCursor: uuidSchema.nullable(),
    pollAfterMs: z.number().int().min(2_000).max(30_000),
  })
  .superRefine((feed, context) => {
    feed.items.slice(1).forEach((item, index) => {
      const previous = feed.items[index];
      if (
        previous &&
        (Date.parse(item.submittedAt) < Date.parse(previous.submittedAt) ||
          (item.submittedAt === previous.submittedAt &&
            item.questionId <= previous.questionId))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index + 1],
          message: 'Questions must be strictly chronological',
        });
      }
    });
  });

export const ratingTargetTypeSchema = z.enum(['session', 'event']);
export const ratingStatusQuerySchema = z.discriminatedUnion('targetType', [
  z.strictObject({ targetType: z.literal('event') }),
  z.strictObject({ targetType: z.literal('session'), sessionId: uuidSchema }),
]);
export const ratingStatusResponseSchema = z.strictObject({
  eventId: uuidSchema,
  targetType: ratingTargetTypeSchema,
  sessionId: uuidSchema.nullable(),
  completed: z.boolean(),
});
export const ratingSubmitRequestSchema = z.discriminatedUnion('targetType', [
  z.strictObject({
    targetType: z.literal('event'),
    score: z.number().int().min(1).max(5),
    comment: cleanText(1, 2_000).nullable(),
  }),
  z.strictObject({
    targetType: z.literal('session'),
    sessionId: uuidSchema,
    score: z.number().int().min(1).max(5),
    comment: cleanText(1, 2_000).nullable(),
  }),
]);
export const ratingSubmitResponseSchema = z.strictObject({
  ratingId: uuidSchema,
  eventId: uuidSchema,
  targetType: ratingTargetTypeSchema,
  sessionId: uuidSchema.nullable(),
  completed: z.literal(true),
  submittedAt: dateTimeSchema,
});

export const questionsAuthenticationRequiredProblemSchema =
  defineApiProblemSchema('AUTHENTICATION_REQUIRED', 401);
export const questionsAccessDeniedProblemSchema = defineApiProblemSchema(
  'EVENT_ACCESS_DENIED',
  403,
);
export const questionsDisabledProblemSchema = defineApiProblemSchema(
  'QUESTIONS_DISABLED',
  409,
);
export const ratingsDisabledProblemSchema = defineApiProblemSchema(
  'RATINGS_DISABLED',
  409,
);
export const questionSessionNotFoundProblemSchema = defineApiProblemSchema(
  'SESSION_NOT_FOUND',
  404,
);
export const ratingAlreadyCompletedProblemSchema = defineApiProblemSchema(
  'RATING_ALREADY_COMPLETED',
  409,
);
export const questionsRateLimitedProblemSchema = defineApiProblemSchema(
  'RATE_LIMITED',
  429,
);
export const questionsValidationProblemSchema = defineApiProblemSchema(
  'VALIDATION_FAILED',
  422,
);
export const questionsIdempotencyKeyRequiredProblemSchema =
  defineApiProblemSchema('IDEMPOTENCY_KEY_REQUIRED', 400);
export const questionsIdempotencyKeyInvalidProblemSchema =
  defineApiProblemSchema('IDEMPOTENCY_KEY_INVALID', 400);
export const questionsInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);
export const questionsProblemSchema = z.discriminatedUnion('code', [
  questionsAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  questionsAccessDeniedProblemSchema,
  questionsDisabledProblemSchema,
  ratingsDisabledProblemSchema,
  questionSessionNotFoundProblemSchema,
  ratingAlreadyCompletedProblemSchema,
  questionsRateLimitedProblemSchema,
  questionsValidationProblemSchema,
  questionsIdempotencyKeyRequiredProblemSchema,
  questionsIdempotencyKeyInvalidProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
  questionsInternalErrorProblemSchema,
]);

export type QuestionSubmitRequest = z.infer<typeof questionSubmitRequestSchema>;
export type ModeratorQuestionFeed = z.infer<typeof moderatorQuestionFeedSchema>;
export type RatingSubmitRequest = z.infer<typeof ratingSubmitRequestSchema>;
