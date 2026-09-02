import { z } from 'zod';

import {
  defineApiProblemSchema,
  idempotencyInProgressProblemSchema,
  idempotencyKeySchema,
  idempotencyKeyReusedProblemSchema,
  opaqueCursorSchema,
  sessionExpiredProblemSchema,
} from './base.js';

const MAX_INBOX_ITEMS = 50;
const MAX_UNREAD_COUNT = 999;

/**
 * CS-ANN-01 participant payloads contain audience-scoped operational content
 * and an individual read state. They must not enter a shared cache, browser
 * persistence or a service worker. Read mutations remain online-only until
 * CS-OFFLINE-01 defines an owner-safe queue and revocation policy.
 */
export const participantAnnouncementCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  offline: 'forbidden',
  readMutation: 'online-only',
} as const);

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const unsafeInlineTextPattern =
  /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;
const unsafeBodyTextPattern =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;

const safeInlineTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, {
      message: 'Text must not be blank',
    })
    .refine((value) => !unsafeInlineTextPattern.test(value), {
      message: 'Text contains unsafe control characters',
    });

const plainBodyTextSchema = z
  .string()
  .min(1)
  .max(16_384)
  .refine((value) => value.trim().length > 0, {
    message: 'Body text must not be blank',
  })
  .refine((value) => !unsafeBodyTextPattern.test(value), {
    message: 'Body text contains unsafe control characters',
  })
  .refine((value) => !/[<>]/.test(value), {
    message: 'Body text must not contain HTML markup',
  });

export const announcementSeveritySchema = z.literal('critical');

export type AnnouncementSeverity = z.infer<typeof announcementSeveritySchema>;

export const announcementInboxFilterSchema = z.enum(['all', 'unread']);

export type AnnouncementInboxFilter = z.infer<
  typeof announcementInboxFilterSchema
>;

export const announcementInboxQuerySchema = z.strictObject({
  filter: announcementInboxFilterSchema,
  cursor: opaqueCursorSchema.optional(),
  limit: z.number().int().min(1).max(MAX_INBOX_ITEMS).optional(),
});

export type AnnouncementInboxQuery = z.infer<
  typeof announcementInboxQuerySchema
>;

export const participantAnnouncementParamsSchema = z.strictObject({
  announcementId: uuidSchema,
});

export type ParticipantAnnouncementParams = z.infer<
  typeof participantAnnouncementParamsSchema
>;

export const participantAnnouncementContextSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({
      kind: z.literal('event'),
    }),
    z.strictObject({
      kind: z.literal('session'),
      session: z.strictObject({
        id: uuidSchema,
        title: safeInlineTextSchema(512),
      }),
    }),
  ],
);

export type ParticipantAnnouncementContext = z.infer<
  typeof participantAnnouncementContextSchema
>;

const participantAnnouncementSummaryShape = {
  id: uuidSchema,
  title: safeInlineTextSchema(160),
  summary: safeInlineTextSchema(512),
  severity: announcementSeveritySchema,
  publishedAt: dateTimeSchema,
  readAt: dateTimeSchema.nullable(),
  context: participantAnnouncementContextSchema,
} as const;

const validateReadTimestamp = (
  announcement: {
    readonly publishedAt: string;
    readonly readAt: string | null;
  },
  context: z.RefinementCtx,
): void => {
  if (
    announcement.readAt !== null &&
    Date.parse(announcement.readAt) < Date.parse(announcement.publishedAt)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['readAt'],
      message: 'Read timestamp cannot precede publication',
    });
  }
};

export const participantAnnouncementSummarySchema = z
  .strictObject(participantAnnouncementSummaryShape)
  .superRefine(validateReadTimestamp);

export type ParticipantAnnouncementSummary = z.infer<
  typeof participantAnnouncementSummarySchema
>;

export const participantAnnouncementInboxResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    items: z.array(participantAnnouncementSummarySchema).max(MAX_INBOX_ITEMS),
    pageInfo: z.strictObject({
      nextCursor: opaqueCursorSchema.nullable(),
      hasMore: z.boolean(),
    }),
    unreadCount: z.number().int().nonnegative().max(MAX_UNREAD_COUNT),
  })
  .superRefine((response, context) => {
    const ids = response.items.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Announcement IDs must be unique',
      });
    }

    response.items.slice(1).forEach((item, index) => {
      const previous = response.items[index];
      if (!previous) return;

      const previousPublishedAt = Date.parse(previous.publishedAt);
      const publishedAt = Date.parse(item.publishedAt);
      if (
        publishedAt > previousPublishedAt ||
        (publishedAt === previousPublishedAt && item.id > previous.id)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index + 1, 'publishedAt'],
          message:
            'Announcements must be ordered by publishedAt and ID descending',
        });
      }
    });

    if (response.pageInfo.hasMore !== (response.pageInfo.nextCursor !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['pageInfo'],
        message: 'Pagination cursor must match hasMore',
      });
    }

    const visibleUnread = response.items.filter(
      ({ readAt }) => readAt === null,
    ).length;
    if (response.unreadCount < visibleUnread) {
      context.addIssue({
        code: 'custom',
        path: ['unreadCount'],
        message: 'Unread count cannot be lower than the visible unread items',
      });
    }
  });

export type ParticipantAnnouncementInboxResponse = z.infer<
  typeof participantAnnouncementInboxResponseSchema
>;

export const participantAnnouncementDetailSchema = z
  .strictObject({
    ...participantAnnouncementSummaryShape,
    bodyText: plainBodyTextSchema,
  })
  .superRefine(validateReadTimestamp);

export type ParticipantAnnouncementDetail = z.infer<
  typeof participantAnnouncementDetailSchema
>;

export const participantAnnouncementDetailResponseSchema = z.strictObject({
  eventId: uuidSchema,
  announcement: participantAnnouncementDetailSchema,
});

export type ParticipantAnnouncementDetailResponse = z.infer<
  typeof participantAnnouncementDetailResponseSchema
>;

export const participantAnnouncementReadResponseSchema = z.strictObject({
  eventId: uuidSchema,
  announcementId: uuidSchema,
  state: z.literal('read'),
  readAt: dateTimeSchema,
  unreadCount: z.number().int().nonnegative().max(MAX_UNREAD_COUNT),
});

export type ParticipantAnnouncementReadResponse = z.infer<
  typeof participantAnnouncementReadResponseSchema
>;

export const announcementAuthenticationRequiredProblemSchema =
  defineApiProblemSchema('AUTHENTICATION_REQUIRED', 401);
export const announcementEventAccessDeniedProblemSchema =
  defineApiProblemSchema('EVENT_ACCESS_DENIED', 403);
export const announcementsDisabledProblemSchema = defineApiProblemSchema(
  'ANNOUNCEMENTS_DISABLED',
  409,
);
export const announcementNotFoundProblemSchema = defineApiProblemSchema(
  'ANNOUNCEMENT_NOT_FOUND',
  404,
);
export const announcementValidationProblemSchema = defineApiProblemSchema(
  'VALIDATION_FAILED',
  422,
);
export const announcementInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);

const participantAnnouncementReadOnlyProblems = [
  announcementAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  announcementEventAccessDeniedProblemSchema,
  announcementsDisabledProblemSchema,
  announcementValidationProblemSchema,
  announcementInternalErrorProblemSchema,
] as const;

export const participantAnnouncementInboxProblemSchema = z.discriminatedUnion(
  'code',
  participantAnnouncementReadOnlyProblems,
);

export const participantAnnouncementDetailProblemSchema = z.discriminatedUnion(
  'code',
  [
    ...participantAnnouncementReadOnlyProblems,
    announcementNotFoundProblemSchema,
  ],
);

export const participantAnnouncementReadProblemSchema = z.discriminatedUnion(
  'code',
  [
    ...participantAnnouncementReadOnlyProblems,
    announcementNotFoundProblemSchema,
    idempotencyKeyReusedProblemSchema,
    idempotencyInProgressProblemSchema,
  ],
);

export type ParticipantAnnouncementInboxProblem = z.infer<
  typeof participantAnnouncementInboxProblemSchema
>;
export type ParticipantAnnouncementDetailProblem = z.infer<
  typeof participantAnnouncementDetailProblemSchema
>;
export type ParticipantAnnouncementReadProblem = z.infer<
  typeof participantAnnouncementReadProblemSchema
>;

/**
 * The F4/P8 admin slice is online-only. Audience snapshots may contain
 * operational aggregates and must not enter browser persistence or a shared
 * cache. The initial contract deliberately supports in-app delivery only.
 */
export const adminAnnouncementCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  browserPersistence: 'forbidden',
  sharedCache: 'forbidden',
  previewMutation: 'online-only',
  sendMutation: 'online-only',
  sendIdempotency: 'required',
  deliveryChannels: 'in-app-only',
} as const);

const adminAnnouncementBodySchema = z
  .string()
  .min(1)
  .max(4_000)
  .refine((value) => value.trim().length > 0, {
    message: 'Body text must not be blank',
  })
  .refine((value) => !unsafeBodyTextPattern.test(value), {
    message: 'Body text contains unsafe control characters',
  })
  .refine((value) => !/[<>]/.test(value), {
    message: 'Body text must not contain HTML markup',
  });

const adminAnnouncementReasonSchema = z
  .string()
  .min(8)
  .max(500)
  .refine((value) => value.trim().length >= 8, {
    message: 'Announcement send reason needs eight visible characters',
  })
  .refine((value) => !unsafeBodyTextPattern.test(value), {
    message: 'Announcement send reason contains unsafe characters',
  })
  .refine((value) => !/[<>]/.test(value), {
    message: 'Announcement send reason must not contain HTML markup',
  });

export const adminAnnouncementAudienceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('event'),
  }),
  z.strictObject({
    kind: z.literal('session'),
    sessionId: uuidSchema,
  }),
]);

export type AdminAnnouncementAudience = z.infer<
  typeof adminAnnouncementAudienceSchema
>;

export const adminAnnouncementTargetSchema = z.strictObject({
  sessionId: uuidSchema,
  title: safeInlineTextSchema(160),
  startsAt: dateTimeSchema,
  roomLabel: safeInlineTextSchema(120).nullable(),
});

export type AdminAnnouncementTarget = z.infer<
  typeof adminAnnouncementTargetSchema
>;

export const adminAnnouncementTargetListResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    options: z.array(adminAnnouncementTargetSchema).max(200),
  })
  .superRefine((response, context) => {
    const sessionIds = response.options.map(({ sessionId }) => sessionId);
    if (new Set(sessionIds).size !== sessionIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Announcement target sessions must be unique',
      });
    }
  });

export type AdminAnnouncementTargetListResponse = z.infer<
  typeof adminAnnouncementTargetListResponseSchema
>;

export const adminAnnouncementDraftSchema = z.strictObject({
  title: safeInlineTextSchema(160),
  bodyText: adminAnnouncementBodySchema,
  severity: announcementSeveritySchema,
  audience: adminAnnouncementAudienceSchema,
});

export type AdminAnnouncementDraft = z.infer<
  typeof adminAnnouncementDraftSchema
>;

export const adminAnnouncementPreviewRequestSchema = z.strictObject({
  draft: adminAnnouncementDraftSchema,
});

export type AdminAnnouncementPreviewRequest = z.infer<
  typeof adminAnnouncementPreviewRequestSchema
>;

export const adminAnnouncementPreviewResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    previewId: uuidSchema,
    previewVersion: z.number().int().positive(),
    draft: adminAnnouncementDraftSchema,
    audience: z.strictObject({
      recipientCount: z.number().int().nonnegative().max(100_000),
      excludedCount: z.number().int().nonnegative().max(100_000),
      sample: z
        .array(
          z.strictObject({
            participantReference: safeInlineTextSchema(80).refine(
              (value) => /[*•…]/.test(value),
              'Audience sample reference must remain masked',
            ),
          }),
        )
        .max(5),
    }),
    createdAt: dateTimeSchema,
    expiresAt: dateTimeSchema,
  })
  .superRefine((preview, context) => {
    if (Date.parse(preview.expiresAt) <= Date.parse(preview.createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Announcement preview expiry must follow creation',
      });
    }
    if (
      preview.audience.recipientCount === 0 &&
      preview.audience.sample.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['audience', 'sample'],
        message: 'An empty audience cannot carry a participant sample',
      });
    }
    if (preview.audience.sample.length > preview.audience.recipientCount) {
      context.addIssue({
        code: 'custom',
        path: ['audience', 'sample'],
        message: 'Audience sample cannot exceed the recipient count',
      });
    }
  });

export type AdminAnnouncementPreviewResponse = z.infer<
  typeof adminAnnouncementPreviewResponseSchema
>;

/**
 * Actor identity and role are derived from the authenticated event policy.
 * The immutable preview/version and reason are the complete JSON body.
 */
export const adminAnnouncementSendRequestSchema = z.strictObject({
  previewId: uuidSchema,
  previewVersion: z.number().int().positive(),
  reason: adminAnnouncementReasonSchema,
});

export type AdminAnnouncementSendRequest = z.infer<
  typeof adminAnnouncementSendRequestSchema
>;

export const adminAnnouncementSendHeadersSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});

export type AdminAnnouncementSendHeaders = z.infer<
  typeof adminAnnouncementSendHeadersSchema
>;

export const adminAnnouncementSendResponseSchema = z.strictObject({
  eventId: uuidSchema,
  announcementId: uuidSchema,
  previewId: uuidSchema,
  previewVersion: z.number().int().positive(),
  outcome: z.enum(['sent', 'already_sent']),
  recipientCount: z.number().int().nonnegative().max(100_000),
  sentAt: dateTimeSchema,
  audit: z.strictObject({
    auditId: uuidSchema,
  }),
});

export type AdminAnnouncementSendResponse = z.infer<
  typeof adminAnnouncementSendResponseSchema
>;

export const announcementEmptyAudienceProblemSchema = defineApiProblemSchema(
  'ANNOUNCEMENT_EMPTY_AUDIENCE',
  409,
);
export const announcementStalePreviewProblemSchema = defineApiProblemSchema(
  'ANNOUNCEMENT_PREVIEW_STALE',
  409,
).extend({
  currentPreviewVersion: z.number().int().positive(),
});
export const announcementPreviewExpiredProblemSchema = defineApiProblemSchema(
  'ANNOUNCEMENT_PREVIEW_EXPIRED',
  409,
);

const adminAnnouncementReadProblems = [
  announcementAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  announcementEventAccessDeniedProblemSchema,
  announcementsDisabledProblemSchema,
  announcementValidationProblemSchema,
  announcementInternalErrorProblemSchema,
] as const;

export const adminAnnouncementPreviewProblemSchema = z.discriminatedUnion(
  'code',
  [...adminAnnouncementReadProblems, announcementEmptyAudienceProblemSchema],
);

export const adminAnnouncementTargetProblemSchema = z.discriminatedUnion(
  'code',
  adminAnnouncementReadProblems,
);

export const adminAnnouncementSendProblemSchema = z.discriminatedUnion('code', [
  ...adminAnnouncementReadProblems,
  announcementEmptyAudienceProblemSchema,
  announcementStalePreviewProblemSchema,
  announcementPreviewExpiredProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
]);

export type AdminAnnouncementPreviewProblem = z.infer<
  typeof adminAnnouncementPreviewProblemSchema
>;
export type AdminAnnouncementTargetProblem = z.infer<
  typeof adminAnnouncementTargetProblemSchema
>;
export type AdminAnnouncementSendProblem = z.infer<
  typeof adminAnnouncementSendProblemSchema
>;
