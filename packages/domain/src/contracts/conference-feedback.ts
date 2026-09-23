import { z } from 'zod';
import { eventSurveyProgramSchema } from './event-survey.js';

export const conferenceFeedbackRoleSchema = z.enum([
  'attendee',
  'speaker',
  'moderator',
  'partner',
]);
export type ConferenceFeedbackRole = z.infer<
  typeof conferenceFeedbackRoleSchema
>;
export const conferenceFeedbackStatusSchema = z.enum([
  'not_started',
  'in_progress',
  'completed',
]);
export const conferenceFeedbackStepSchema = z.enum([
  'intro',
  'overall',
  'program',
  'organization',
  'experience',
  'digital',
  'music',
  'collaboration',
  'role',
  'future',
  'about',
]);
const answer = z
  .string()
  .max(2000)
  .refine(
    (value) =>
      !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(
        value,
      ),
  );
export const conferenceFeedbackPatchSchema = z.strictObject({
  answers: z
    .record(z.string().min(1).max(80), answer)
    .refine((value) => Object.keys(value).length <= 250)
    .optional(),
  currentStep: conferenceFeedbackStepSchema.optional(),
});
export const conferenceFeedbackDataSchema = z.object({
  answers: z.record(z.string(), z.string()),
  currentStep: conferenceFeedbackStepSchema,
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  suggestedRole: conferenceFeedbackRoleSchema,
  firstName: z.string(),
  eventName: z.string(),
  program: eventSurveyProgramSchema.nullable(),
});
export const conferenceFeedbackResponseSchema = z.object({
  data: conferenceFeedbackDataSchema,
});
export type ConferenceFeedbackData = z.infer<
  typeof conferenceFeedbackDataSchema
>;
export const feedbackFilterSchema = z.strictObject({
  role: conferenceFeedbackRoleSchema.or(z.literal('all')).default('all'),
  status: conferenceFeedbackStatusSchema.or(z.literal('all')).default('all'),
});
export const feedbackSendRequestSchema = z.strictObject({
  kind: z.enum(['invitation', 'reminder']),
  participantIds: z
    .array(z.string().uuid())
    .min(1)
    .max(5000)
    .refine((ids) => new Set(ids).size === ids.length),
});
export const feedbackSendResponseSchema = z.object({
  data: z.object({
    queued: z.number().int(),
    skipped: z.number().int(),
    batchId: z.string().uuid(),
  }),
});
export const feedbackRecipientSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  suggestedRole: conferenceFeedbackRoleSchema,
  role: conferenceFeedbackRoleSchema,
  status: conferenceFeedbackStatusSchema,
  invitedAt: z.string().datetime().nullable(),
  remindedAt: z.string().datetime().nullable(),
  mailStatus: z.enum([
    'not_sent',
    'pending',
    'processing',
    'delivered',
    'failed',
    'skipped',
  ]),
  emailEnabled: z.boolean(),
});
export const feedbackQuestionReportSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['choice', 'text']),
  eligible: z.number().int(),
  answered: z.number().int(),
  notApplicable: z.number().int(),
  average: z.number().nullable(),
  options: z.array(
    z.object({ value: z.string(), label: z.string(), count: z.number().int() }),
  ),
  comments: z.array(
    z.object({
      value: z.string(),
      role: conferenceFeedbackRoleSchema,
      status: conferenceFeedbackStatusSchema,
    }),
  ),
});
export const feedbackAdminOverviewSchema = z.object({
  data: z.object({
    eventId: z.string().uuid(),
    eventName: z.string(),
    updatedAt: z.string().datetime(),
    summary: z.object({
      total: z.number().int(),
      invited: z.number().int(),
      started: z.number().int(),
      completed: z.number().int(),
      inProgress: z.number().int(),
      notStarted: z.number().int(),
      optedOut: z.number().int(),
    }),
    recipients: z.array(feedbackRecipientSchema),
    questions: z.array(feedbackQuestionReportSchema),
    roles: z.array(
      z.object({
        role: conferenceFeedbackRoleSchema,
        total: z.number().int(),
        started: z.number().int(),
        completed: z.number().int(),
      }),
    ),
  }),
});
export type FeedbackAdminOverview = z.infer<
  typeof feedbackAdminOverviewSchema
>['data'];
export type FeedbackRecipient = z.infer<typeof feedbackRecipientSchema>;
export type FeedbackQuestionReport = z.infer<
  typeof feedbackQuestionReportSchema
>;

export const feedbackRespondentsQuerySchema = z.strictObject({
  role: conferenceFeedbackRoleSchema.or(z.literal('all')).default('all'),
  status: z.enum(['all', 'in_progress', 'completed']).default('all'),
  search: z.string().trim().max(200).default(''),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  sort: z.enum(['updated', 'name']).default('updated'),
});
export const feedbackRespondentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  role: conferenceFeedbackRoleSchema,
  status: z.enum(['in_progress', 'completed']),
  answerCount: z.number().int().min(1),
  overallRating: z.string().nullable(),
  updatedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export const feedbackRespondentsResponseSchema = z.object({
  data: z.object({
    eventId: z.string().uuid(),
    items: z.array(feedbackRespondentSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  }),
});
export const feedbackRespondentDetailSchema = z.object({
  data: z.object({
    eventId: z.string().uuid(),
    respondent: feedbackRespondentSchema,
    sections: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        answers: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            value: z.string().nullable(),
          }),
        ),
      }),
    ),
  }),
});
export type FeedbackRespondentsQuery = z.infer<
  typeof feedbackRespondentsQuerySchema
>;
export type FeedbackRespondent = z.infer<typeof feedbackRespondentSchema>;
export type FeedbackRespondents = z.infer<
  typeof feedbackRespondentsResponseSchema
>['data'];
export type FeedbackRespondentDetail = z.infer<
  typeof feedbackRespondentDetailSchema
>['data'];
