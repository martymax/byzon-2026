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
export const questionOriginalSchema = z.strictObject({
  questionId: uuidSchema,
  authorName: cleanText(1, 257),
  text: cleanText(1, 1_000),
  submittedAt: dateTimeSchema,
});
export const moderatorQuestionSchema = questionOriginalSchema.extend({
  answeredAt: dateTimeSchema.nullable().default(null),
  moderationVersion: z.number().int().positive().default(1),
  originals: z.array(questionOriginalSchema).default([]),
});
export const questionModerationRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('answer'),
    questionId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    answered: z.boolean(),
  }),
  z.strictObject({
    action: z.literal('delete'),
    questionId: uuidSchema,
    expectedVersion: z.number().int().positive(),
  }),
  z
    .strictObject({
      action: z.literal('merge'),
      questionId: uuidSchema,
      expectedVersion: z.number().int().positive(),
      sourceId: uuidSchema,
      sourceVersion: z.number().int().positive(),
    })
    .refine(
      (value) => value.questionId !== value.sourceId,
      'Choose different questions',
    ),
]);
export const questionModerationResponseSchema = z.strictObject({
  questionId: uuidSchema,
});
export type QuestionModerationRequest = z.infer<
  typeof questionModerationRequestSchema
>;
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

export const questionModeSchema = z.enum(['disabled', 'moderated_follow_up']);
export const questionStateSchema = z.enum([
  'unsupported',
  'disabled',
  'scheduled',
  'open',
  'closed',
]);
export const questionSessionSchema = z.strictObject({
  id: uuidSchema,
  title: cleanText(1, 512),
  startsAt: dateTimeSchema,
  endsAt: dateTimeSchema,
  roomName: cleanText(1, 256).nullable(),
});
export const questionContextSchema = z.strictObject({
  eventId: uuidSchema,
  serverTime: dateTimeSchema,
  session: questionSessionSchema,
  state: questionStateSchema,
  canSubmit: z.boolean(),
  canReadOwn: z.boolean(),
});
export const questionAnswerSchema = z.strictObject({
  id: uuidSchema,
  text: cleanText(1, 4_000),
  speakerName: cleanText(1, 257),
  publishedAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  version: z.number().int().positive(),
});
export const ownQuestionSchema = z.strictObject({
  answeredAt: dateTimeSchema.nullable().default(null),
  questionId: uuidSchema,
  sessionId: uuidSchema,
  sessionTitle: cleanText(1, 512),
  text: cleanText(1, 1_000),
  submittedAt: dateTimeSchema,
  answer: questionAnswerSchema.nullable(),
});
export const questionPageQuerySchema = moderatorQuestionFeedQuerySchema;
export const ownQuestionsQuerySchema = z
  .strictObject({
    sessionId: uuidSchema.optional(),
    ...moderatorQuestionFeedQuerySchema.shape,
  })
  .superRefine((query, context) => {
    if ((query.after === undefined) !== (query.cursor === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'Cursor and timestamp are required together',
      });
    }
  });
export const ownQuestionsSchema = z.strictObject({
  eventId: uuidSchema,
  items: z.array(ownQuestionSchema).max(100),
  nextCursor: uuidSchema.nullable(),
  serverTime: dateTimeSchema,
});
export const questionSessionListSchema = z.strictObject({
  eventId: uuidSchema,
  serverTime: dateTimeSchema,
  sessions: z
    .array(
      questionSessionSchema.extend({
        state: questionStateSchema,
        questionCount: z.number().int().nonnegative(),
        unansweredCount: z.number().int().nonnegative(),
      }),
    )
    .max(300),
});
export const speakerQuestionSchema = z.strictObject({
  answeredAt: dateTimeSchema.nullable().optional(),
  questionId: uuidSchema,
  text: cleanText(1, 1_000),
  submittedAt: dateTimeSchema,
  answer: questionAnswerSchema.nullable(),
  canEdit: z.boolean(),
});
export const speakerQuestionFeedSchema = z.strictObject({
  eventId: uuidSchema,
  session: questionSessionSchema,
  serverTime: dateTimeSchema,
  items: z.array(speakerQuestionSchema).max(100),
  nextCursor: uuidSchema.nullable(),
});
export const speakerQuestionQuerySchema = z
  .strictObject({
    ...moderatorQuestionFeedQuerySchema.shape,
    status: z.enum(['unanswered', 'answered', 'all']).optional(),
  })
  .superRefine((query, context) => {
    if ((query.after === undefined) !== (query.cursor === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'Cursor and timestamp are required together',
      });
    }
  });
export const questionAnswerPublishSchema = z.strictObject({
  text: cleanText(1, 4_000),
  expectedVersion: z.literal(0),
});
export const questionAnswerEditSchema = z.strictObject({
  text: cleanText(1, 4_000),
  expectedVersion: z.number().int().positive(),
});
export const questionFollowUpProblemSchema = z.discriminatedUnion('code', [
  ...questionsProblemSchema.options,
  defineApiProblemSchema('QUESTIONS_UNSUPPORTED', 409),
  defineApiProblemSchema('QUESTIONS_NOT_OPEN', 409),
  defineApiProblemSchema('QUESTIONS_CLOSED', 409),
  defineApiProblemSchema('QUESTION_FOLLOW_UPS_DISABLED', 409),
  defineApiProblemSchema('QUESTION_ANSWER_CONFLICT', 409),
  defineApiProblemSchema('QUESTION_MODERATION_CONFLICT', 409),
  defineApiProblemSchema('QUESTION_ACCESS_DENIED', 403),
  defineApiProblemSchema('QUESTION_NOT_FOUND', 404),
]);
export type QuestionContext = z.infer<typeof questionContextSchema>;
export type QuestionSession = z.infer<typeof questionSessionSchema>;
export type OwnQuestions = z.infer<typeof ownQuestionsSchema>;
export type QuestionSessionList = z.infer<typeof questionSessionListSchema>;
export type SpeakerQuestionFeed = z.infer<typeof speakerQuestionFeedSchema>;
export type QuestionAnswer = z.infer<typeof questionAnswerSchema>;

export const questionAnswerMutationResponseSchema = z.strictObject({
  answerId: uuidSchema,
  version: z.number().int().positive(),
});
