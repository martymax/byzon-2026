import { z } from 'zod';

import { idempotencyKeySchema } from './base.js';

const uuidSchema = z.string().uuid();
const versionSchema = z.number().int().positive();
const dateTimeSchema = z.string().datetime({ offset: true });
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
    message: 'Mutation reason must contain eight visible characters',
  })
  .refine((value) => !unsafeMultilineTextPattern.test(value), {
    message: 'Mutation reason contains unsafe characters or markup',
  });

const maskedContactSchema = safeInlineTextSchema(120).refine(
  (value) =>
    /[*•…]/.test(value) &&
    !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value),
  'Moderator contact must remain masked',
);

export const adminEngagementFeaturesSchema = z.strictObject({
  networkingEnabled: z.boolean(),
  questionsEnabled: z.boolean(),
  ratingsEnabled: z.boolean(),
});

export type AdminEngagementFeatures = z.infer<
  typeof adminEngagementFeaturesSchema
>;

export const adminModeratorCandidateSchema = z.strictObject({
  userId: uuidSchema,
  displayName: safeInlineTextSchema(160),
  maskedContact: maskedContactSchema,
});

export type AdminModeratorCandidate = z.infer<
  typeof adminModeratorCandidateSchema
>;

export const adminModeratorAssignmentSchema = z.strictObject({
  assignmentId: uuidSchema,
  userId: uuidSchema,
  displayName: safeInlineTextSchema(160),
  maskedContact: maskedContactSchema,
});

export type AdminModeratorAssignment = z.infer<
  typeof adminModeratorAssignmentSchema
>;

export const adminEngagementSessionSchema = z
  .strictObject({
    sessionId: uuidSchema,
    title: safeInlineTextSchema(512),
    startsAt: dateTimeSchema,
    status: z.enum(['draft', 'published', 'cancelled', 'archived']),
    questionsEnabled: z.boolean(),
    version: versionSchema,
    moderators: z.array(adminModeratorAssignmentSchema).max(10),
  })
  .superRefine((session, context) => {
    if (
      new Set(session.moderators.map(({ assignmentId }) => assignmentId))
        .size !== session.moderators.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['moderators'],
        message: 'Moderator assignments must be unique',
      });
    }
  });

export type AdminEngagementSession = z.infer<
  typeof adminEngagementSessionSchema
>;

/**
 * CS-ADMIN-ENGAGEMENT-01 is an online-only operational snapshot. Candidate
 * contacts are masked and no response may be persisted in browser storage.
 */
export const adminEngagementCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  browserPersistence: 'forbidden',
  sharedCache: 'forbidden',
  mutation: 'online-only',
  mutationIdempotency: 'required',
} as const);

export const adminEngagementOverviewSchema = z
  .strictObject({
    eventId: uuidSchema,
    settingsVersion: versionSchema,
    assignmentsVersion: versionSchema,
    features: adminEngagementFeaturesSchema,
    sessions: z.array(adminEngagementSessionSchema).max(300),
    moderatorCandidates: z.array(adminModeratorCandidateSchema).max(2_000),
  })
  .superRefine((overview, context) => {
    if (
      new Set(overview.sessions.map(({ sessionId }) => sessionId)).size !==
      overview.sessions.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sessions'],
        message: 'Session IDs must be unique',
      });
    }
    if (
      new Set(overview.moderatorCandidates.map(({ userId }) => userId)).size !==
      overview.moderatorCandidates.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['moderatorCandidates'],
        message: 'Moderator candidates must be unique',
      });
    }
  });

export type AdminEngagementOverview = z.infer<
  typeof adminEngagementOverviewSchema
>;

export const adminEngagementMutationRequestSchema = z.discriminatedUnion(
  'action',
  [
    z.strictObject({
      action: z.literal('update_features'),
      expectedSettingsVersion: versionSchema,
      features: adminEngagementFeaturesSchema,
      reason: mutationReasonSchema,
    }),
    z.strictObject({
      action: z.literal('set_session_questions'),
      sessionId: uuidSchema,
      expectedSessionVersion: versionSchema,
      enabled: z.boolean(),
      reason: mutationReasonSchema,
    }),
    z.strictObject({
      action: z.literal('assign_moderator'),
      sessionId: uuidSchema,
      userId: uuidSchema,
      expectedAssignmentsVersion: versionSchema,
      reason: mutationReasonSchema,
    }),
    z.strictObject({
      action: z.literal('remove_moderator'),
      sessionId: uuidSchema,
      userId: uuidSchema,
      expectedAssignmentsVersion: versionSchema,
      reason: mutationReasonSchema,
    }),
  ],
);

export type AdminEngagementMutationRequest = z.infer<
  typeof adminEngagementMutationRequestSchema
>;

export const adminEngagementMutationHeadersSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});

export const adminEngagementMutationResponseSchema = z.discriminatedUnion(
  'action',
  [
    z.strictObject({
      action: z.literal('update_features'),
      eventId: uuidSchema,
      outcome: z.enum(['updated', 'already_applied']),
      settingsVersion: versionSchema,
      features: adminEngagementFeaturesSchema,
      changedAt: dateTimeSchema,
      audit: z.strictObject({ auditId: uuidSchema }),
    }),
    z.strictObject({
      action: z.literal('set_session_questions'),
      eventId: uuidSchema,
      outcome: z.enum(['updated', 'already_applied']),
      session: z.strictObject({
        sessionId: uuidSchema,
        questionsEnabled: z.boolean(),
        version: versionSchema,
      }),
      changedAt: dateTimeSchema,
      audit: z.strictObject({ auditId: uuidSchema }),
    }),
    z.strictObject({
      action: z.enum(['assign_moderator', 'remove_moderator']),
      eventId: uuidSchema,
      outcome: z.enum(['updated', 'already_applied']),
      assignmentsVersion: versionSchema,
      assignment: z
        .strictObject({
          sessionId: uuidSchema,
          userId: uuidSchema,
          displayName: safeInlineTextSchema(160),
          maskedContact: maskedContactSchema,
        })
        .nullable(),
      changedAt: dateTimeSchema,
      audit: z.strictObject({ auditId: uuidSchema }),
    }),
  ],
);

export type AdminEngagementMutationResponse = z.infer<
  typeof adminEngagementMutationResponseSchema
>;
