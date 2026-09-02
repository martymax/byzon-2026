import { z } from 'zod';

import {
  defineApiProblemSchema,
  idempotencyInProgressProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyKeySchema,
  sessionExpiredProblemSchema,
} from './base.js';

export const TICKET_IMPORT_MAX_FILE_BYTES = 10_000_000;
export const TICKET_IMPORT_MAX_PREVIEW_ROWS = 500;
export const SIMPLESHOP_TICKET_PRODUCT_ID = 143_958;
export const SIMPLESHOP_TICKET_FORM_KEY = '0MnNQ';

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

const reasonSchema = z
  .string()
  .min(8)
  .max(500)
  .refine((value) => value.trim().length >= 8, {
    message: 'Reason must contain at least eight visible characters',
  })
  .refine((value) => !unsafeMultilineTextPattern.test(value), {
    message: 'Reason contains unsafe control characters or markup',
  });

/**
 * CS-IMPORT-01 is an online-only P3/S workflow. Raw files are quarantined on
 * the server and neither files nor previews may enter browser persistence or a
 * shared/service-worker cache.
 */
export const ticketImportCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  browserPersistence: 'forbidden',
  rawFileStorage: 'private-quarantine-only',
  previewMutation: 'online-only',
  applyIdempotency: 'required',
} as const);

export const ticketImportMediaTypeSchema = z.enum([
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

export type TicketImportMediaType = z.infer<typeof ticketImportMediaTypeSchema>;

const safeFileNameSchema = z
  .string()
  .min(1)
  .max(180)
  .refine(
    (value) =>
      value === value.trim() &&
      !unsafeInlineTextPattern.test(value) &&
      !/[\\/]/.test(value),
    'File name contains path, control, bidi or markup characters',
  );

const optionalContactTextSchema = (maximum: number) =>
  safeInlineTextSchema(maximum).nullable();

export const ticketImportIdentitySourceSchema = z.enum([
  'named_participant',
  'single_paid_ticket_buyer',
  'manual_review',
]);

export type TicketImportIdentitySource = z.infer<
  typeof ticketImportIdentitySourceSchema
>;

export const ticketImportFileSourceSchema = z
  .strictObject({
    kind: z.literal('file'),
    fileName: safeFileNameSchema,
    mediaType: ticketImportMediaTypeSchema,
    byteSize: z.number().int().positive().max(TICKET_IMPORT_MAX_FILE_BYTES),
  })
  .superRefine((source, context) => {
    const extension = source.fileName.toLocaleLowerCase('en-US');
    const matchesMediaType =
      (source.mediaType === 'text/csv' && extension.endsWith('.csv')) ||
      (source.mediaType ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' &&
        extension.endsWith('.xlsx'));
    if (!matchesMediaType) {
      context.addIssue({
        code: 'custom',
        path: ['mediaType'],
        message: 'Detected media type must match the safe file extension',
      });
    }
  });

const simpleShopObservedStatusesSchema = z.strictObject({
  paid: z.number().int().nonnegative(),
  unpaid: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  refunded: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});

const simpleShopCodeShapeSchema = z.strictObject({
  count: z.number().int().positive().max(TICKET_IMPORT_MAX_PREVIEW_ROWS),
  minByteLength: z.number().int().positive().max(512),
  maxByteLength: z.number().int().positive().max(512),
  characterClasses: z
    .array(
      z.enum([
        'digit',
        'upper_ascii',
        'lower_ascii',
        'hyphen',
        'whitespace',
        'other_ascii',
        'non_ascii',
      ]),
    )
    .max(7),
});

export const ticketImportSimpleShopSourceSchema = z
  .strictObject({
    kind: z.literal('simpleshop_api'),
    productId: z.literal(SIMPLESHOP_TICKET_PRODUCT_ID),
    formKey: z.literal(SIMPLESHOP_TICKET_FORM_KEY),
    strict: z.literal(true),
    pageCount: z.literal(1),
    sourceRows: z.number().int().positive().max(10_000),
    ticketRows: z.number().int().positive().max(TICKET_IMPORT_MAX_PREVIEW_ROWS),
    ignoredSummaryRows: z.number().int().nonnegative().max(10_000),
    multipleQuantitySummaryRows: z.number().int().nonnegative().max(10_000),
    observedStatuses: simpleShopObservedStatusesSchema,
    codeShape: simpleShopCodeShapeSchema,
  })
  .superRefine((source, context) => {
    if (source.sourceRows !== source.ticketRows + source.ignoredSummaryRows) {
      context.addIssue({
        code: 'custom',
        path: ['sourceRows'],
        message: 'Source row counts must reconcile',
      });
    }
    const statusTotal = Object.values(source.observedStatuses).reduce(
      (total, count) => total + count,
      0,
    );
    if (statusTotal !== source.ticketRows) {
      context.addIssue({
        code: 'custom',
        path: ['observedStatuses'],
        message: 'Observed status counts must match ticket rows',
      });
    }
    if (source.codeShape.count !== source.ticketRows) {
      context.addIssue({
        code: 'custom',
        path: ['codeShape', 'count'],
        message: 'Ticket-code shape count must match ticket rows',
      });
    }
    if (source.codeShape.minByteLength > source.codeShape.maxByteLength) {
      context.addIssue({
        code: 'custom',
        path: ['codeShape'],
        message: 'Ticket-code length range is invalid',
      });
    }
  });

export const ticketImportSourceSchema = z.union([
  ticketImportFileSourceSchema,
  ticketImportSimpleShopSourceSchema,
]);

export type TicketImportSource = z.infer<typeof ticketImportSourceSchema>;

export const ticketImportPreviewRequestSchema = z.strictObject({
  source: z.literal('simpleshop'),
});

export type TicketImportPreviewRequest = z.infer<
  typeof ticketImportPreviewRequestSchema
>;

export const ticketImportRowStatusSchema = z.enum([
  'new',
  'unchanged',
  'status_changed',
  'excluded',
  'conflict',
  'unknown',
]);

export type TicketImportRowStatus = z.infer<typeof ticketImportRowStatusSchema>;

export const ticketImportTicketStateSchema = z.enum([
  'active',
  'blocked',
  'cancelled',
  'refunded',
]);

export type TicketImportTicketState = z.infer<
  typeof ticketImportTicketStateSchema
>;

export const ticketImportSourceStatusSchema = z.enum([
  'paid',
  'unpaid',
  'cancelled',
  'refunded',
  'unknown',
]);

export type TicketImportSourceStatus = z.infer<
  typeof ticketImportSourceStatusSchema
>;

export const ticketImportIssueCodeSchema = z.enum([
  'duplicate_source_reference',
  'duplicate_existing_reference',
  'missing_reference',
  'missing_status',
  'unknown_status',
  'source_status_excluded',
  'source_status_review_required',
  'state_conflict',
  'participant_identity_manual_review',
]);

export type TicketImportIssueCode = z.infer<typeof ticketImportIssueCodeSchema>;

const ticketImportIssueSchema = z.strictObject({
  code: ticketImportIssueCodeSchema,
  message: safeInlineTextSchema(240),
});

export const ticketImportRowSchema = z
  .strictObject({
    rowId: uuidSchema,
    sourceRowNumber: z.number().int().positive().max(1_000_000),
    referenceSuffix: z.string().regex(/^[A-Za-z0-9]{2,8}$/),
    sourceTicketId: z.string().regex(/^\d{1,64}$/),
    sourceOrderId: z.string().regex(/^\d{1,64}$/),
    orderTicketCount: z
      .number()
      .int()
      .positive()
      .max(TICKET_IMPORT_MAX_PREVIEW_ROWS),
    orderTicketPosition: z
      .number()
      .int()
      .positive()
      .max(TICKET_IMPORT_MAX_PREVIEW_ROWS),
    purchasedOn: z.string().date(),
    discountCoupon: optionalContactTextSchema(100),
    contactName: optionalContactTextSchema(160),
    contactEmail: z.email().max(320).nullable(),
    contactCompany: optionalContactTextSchema(160),
    contactPosition: optionalContactTextSchema(160),
    contactPhone: optionalContactTextSchema(64),
    identitySource: ticketImportIdentitySourceSchema,
    sourceStatus: ticketImportSourceStatusSchema,
    status: ticketImportRowStatusSchema,
    incomingState: ticketImportTicketStateSchema.nullable(),
    currentState: ticketImportTicketStateSchema.nullable(),
    issues: z.array(ticketImportIssueSchema).max(8),
  })
  .superRefine((row, context) => {
    const addStateIssue = (message: string): void => {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message,
      });
    };

    if (row.identitySource !== 'manual_review' && row.contactEmail === null) {
      context.addIssue({
        code: 'custom',
        path: ['contactEmail'],
        message: 'Resolved participant identity requires an email address',
      });
    }
    if (row.orderTicketPosition > row.orderTicketCount) {
      context.addIssue({
        code: 'custom',
        path: ['orderTicketPosition'],
        message: 'Order ticket position cannot exceed the order ticket count',
      });
    }
    if (
      row.identitySource === 'manual_review' &&
      !row.issues.some(
        ({ code }) => code === 'participant_identity_manual_review',
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['issues'],
        message: 'Manual participant identity requires a review issue',
      });
    }

    switch (row.status) {
      case 'new':
        if (row.incomingState === null || row.currentState !== null) {
          addStateIssue('A new row needs only an incoming state');
        }
        break;
      case 'unchanged':
        if (
          row.incomingState === null ||
          row.currentState === null ||
          row.incomingState !== row.currentState
        ) {
          addStateIssue('An unchanged row needs equal incoming/current states');
        }
        break;
      case 'status_changed':
        if (
          row.incomingState === null ||
          row.currentState === null ||
          row.incomingState === row.currentState
        ) {
          addStateIssue(
            'A status-changed row needs different incoming/current states',
          );
        }
        break;
      case 'excluded':
        if (
          row.incomingState !== null ||
          row.currentState !== null ||
          row.sourceStatus === 'paid' ||
          row.sourceStatus === 'unknown' ||
          !row.issues.some(({ code }) => code === 'source_status_excluded')
        ) {
          addStateIssue(
            'An excluded row needs a known ineligible source state and no ticket state',
          );
        }
        break;
      case 'conflict':
        if (row.issues.length === 0) {
          addStateIssue('A conflict row needs at least one issue');
        }
        break;
      case 'unknown':
        if (
          row.incomingState !== null ||
          !row.issues.some(({ code }) => code === 'unknown_status')
        ) {
          addStateIssue(
            'An unknown row needs no incoming state and an unknown-status issue',
          );
        }
        break;
    }
  });

export type TicketImportRow = z.infer<typeof ticketImportRowSchema>;

export const ticketImportSummarySchema = z.strictObject({
  total: z.number().int().positive().max(TICKET_IMPORT_MAX_PREVIEW_ROWS),
  new: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  statusChanged: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  conflict: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});

export type TicketImportSummary = z.infer<typeof ticketImportSummarySchema>;

const summaryForRows = (
  rows: readonly TicketImportRow[],
): TicketImportSummary => ({
  total: rows.length,
  new: rows.filter(({ status }) => status === 'new').length,
  unchanged: rows.filter(({ status }) => status === 'unchanged').length,
  statusChanged: rows.filter(({ status }) => status === 'status_changed')
    .length,
  excluded: rows.filter(({ status }) => status === 'excluded').length,
  conflict: rows.filter(({ status }) => status === 'conflict').length,
  unknown: rows.filter(({ status }) => status === 'unknown').length,
});

export const ticketImportPreviewResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    previewId: uuidSchema,
    previewVersion: versionSchema,
    source: ticketImportSourceSchema,
    createdAt: dateTimeSchema,
    expiresAt: dateTimeSchema,
    rows: z
      .array(ticketImportRowSchema)
      .min(1)
      .max(TICKET_IMPORT_MAX_PREVIEW_ROWS),
    summary: ticketImportSummarySchema,
  })
  .superRefine((preview, context) => {
    if (Date.parse(preview.expiresAt) <= Date.parse(preview.createdAt)) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Import preview expiry must follow creation',
      });
    }

    const expected = summaryForRows(preview.rows);
    for (const key of Object.keys(expected) as (keyof TicketImportSummary)[]) {
      if (preview.summary[key] !== expected[key]) {
        context.addIssue({
          code: 'custom',
          path: ['summary', key],
          message: 'Import summary must match immutable preview rows',
        });
      }
    }

    const rowIds = preview.rows.map(({ rowId }) => rowId);
    if (new Set(rowIds).size !== rowIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['rows'],
        message: 'Import preview row IDs must be unique',
      });
    }
    const rowsByOrder = new Map<string, typeof preview.rows>();
    for (const row of preview.rows) {
      const group = rowsByOrder.get(row.sourceOrderId) ?? [];
      group.push(row);
      rowsByOrder.set(row.sourceOrderId, group);
    }
    for (const [orderId, rows] of rowsByOrder) {
      const expectedPositions = rows.map((_, index) => index + 1);
      const actualPositions = rows
        .map(({ orderTicketPosition }) => orderTicketPosition)
        .sort((left, right) => left - right);
      if (
        rows.some(({ orderTicketCount }) => orderTicketCount !== rows.length) ||
        actualPositions.some(
          (position, index) => position !== expectedPositions[index],
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['rows'],
          message: `Order ${orderId} ticket counts and positions must reconcile`,
        });
      }
    }
    if (
      preview.source.kind === 'simpleshop_api' &&
      preview.source.ticketRows !== preview.rows.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['source', 'ticketRows'],
        message: 'SimpleShop ticket count must match preview rows',
      });
    }
  });

export type TicketImportPreviewResponse = z.infer<
  typeof ticketImportPreviewResponseSchema
>;

export const isTicketImportRowSelectable = (row: TicketImportRow): boolean =>
  row.status === 'new';

export const canApplyTicketImportPreview = (
  preview: TicketImportPreviewResponse,
): boolean => preview.rows.some(isTicketImportRowSelectable);

const selectedTicketImportRowIdsSchema = z
  .array(uuidSchema)
  .min(1)
  .max(TICKET_IMPORT_MAX_PREVIEW_ROWS)
  .superRefine((rowIds, context) => {
    if (new Set(rowIds).size !== rowIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Selected import row IDs must be unique',
      });
    }
  });

export const ticketImportApplyRequestSchema = z.strictObject({
  eventId: uuidSchema,
  previewId: uuidSchema,
  previewVersion: versionSchema,
  expectedImpact: ticketImportSummarySchema,
  selectedRowIds: selectedTicketImportRowIdsSchema,
  reason: reasonSchema,
});

export type TicketImportApplyRequest = z.infer<
  typeof ticketImportApplyRequestSchema
>;

/**
 * The idempotency key is transport metadata, never part of the mutation body.
 */
export const ticketImportApplyHeadersSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});

export type TicketImportApplyHeaders = z.infer<
  typeof ticketImportApplyHeadersSchema
>;

export const ticketImportApplyResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    batchId: uuidSchema,
    previewId: uuidSchema,
    previewVersion: versionSchema,
    selectedRowIds: selectedTicketImportRowIdsSchema,
    outcome: z.enum(['applied', 'already_applied']),
    result: z.strictObject({
      created: z.number().int().nonnegative(),
      statusChanged: z.number().int().nonnegative(),
      unchanged: z.number().int().nonnegative(),
    }),
    completedAt: dateTimeSchema,
    audit: z.strictObject({
      auditId: uuidSchema,
    }),
  })
  .superRefine((response, context) => {
    if (
      response.result.created +
        response.result.statusChanged +
        response.result.unchanged !==
      response.selectedRowIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Import result must account for every selected row',
      });
    }
  });

export type TicketImportApplyResponse = z.infer<
  typeof ticketImportApplyResponseSchema
>;

export const ticketImportAuthenticationRequiredProblemSchema =
  defineApiProblemSchema('AUTHENTICATION_REQUIRED', 401);
export const ticketImportEventAccessDeniedProblemSchema =
  defineApiProblemSchema('EVENT_ACCESS_DENIED', 403);
export const ticketImportBatchNotFoundProblemSchema = defineApiProblemSchema(
  'IMPORT_BATCH_NOT_FOUND',
  404,
);
export const ticketImportUnsupportedFormatProblemSchema =
  defineApiProblemSchema('IMPORT_UNSUPPORTED_FORMAT', 415);
export const ticketImportValidationProblemSchema = defineApiProblemSchema(
  'IMPORT_VALIDATION_FAILED',
  422,
);
export const ticketImportPreviewBlockedProblemSchema = defineApiProblemSchema(
  'IMPORT_PREVIEW_BLOCKED',
  409,
);
export const ticketImportStalePreviewProblemSchema = defineApiProblemSchema(
  'IMPORT_PREVIEW_STALE',
  409,
).extend({
  currentPreviewVersion: versionSchema,
});
export const ticketImportInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);
export const ticketImportSourceUnavailableProblemSchema =
  defineApiProblemSchema('IMPORT_SOURCE_UNAVAILABLE', 502);
export const ticketImportSourceTimeoutProblemSchema = defineApiProblemSchema(
  'IMPORT_SOURCE_TIMEOUT',
  504,
);
export const ticketImportSourceInvalidProblemSchema = defineApiProblemSchema(
  'IMPORT_SOURCE_INVALID',
  502,
);
export const ticketImportRateLimitedProblemSchema = defineApiProblemSchema(
  'RATE_LIMITED',
  429,
);
export const ticketImportIdempotencyKeyRequiredProblemSchema =
  defineApiProblemSchema('IDEMPOTENCY_KEY_REQUIRED', 400);
export const ticketImportIdempotencyKeyInvalidProblemSchema =
  defineApiProblemSchema('IDEMPOTENCY_KEY_INVALID', 400);

const ticketImportReadProblems = [
  ticketImportAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  ticketImportEventAccessDeniedProblemSchema,
  ticketImportBatchNotFoundProblemSchema,
  ticketImportValidationProblemSchema,
  ticketImportInternalErrorProblemSchema,
] as const;

export const ticketImportReadProblemSchema = z.discriminatedUnion(
  'code',
  ticketImportReadProblems,
);

export const ticketImportPreviewProblemSchema = z.discriminatedUnion('code', [
  ticketImportAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  ticketImportEventAccessDeniedProblemSchema,
  ticketImportUnsupportedFormatProblemSchema,
  ticketImportValidationProblemSchema,
  ticketImportRateLimitedProblemSchema,
  ticketImportSourceUnavailableProblemSchema,
  ticketImportSourceTimeoutProblemSchema,
  ticketImportSourceInvalidProblemSchema,
  ticketImportInternalErrorProblemSchema,
]);

export const ticketImportApplyProblemSchema = z.discriminatedUnion('code', [
  ...ticketImportReadProblems,
  ticketImportPreviewBlockedProblemSchema,
  ticketImportStalePreviewProblemSchema,
  ticketImportRateLimitedProblemSchema,
  ticketImportSourceUnavailableProblemSchema,
  ticketImportSourceTimeoutProblemSchema,
  ticketImportSourceInvalidProblemSchema,
  ticketImportIdempotencyKeyRequiredProblemSchema,
  ticketImportIdempotencyKeyInvalidProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
]);

export type TicketImportReadProblem = z.infer<
  typeof ticketImportReadProblemSchema
>;
export type TicketImportPreviewProblem = z.infer<
  typeof ticketImportPreviewProblemSchema
>;
export type TicketImportApplyProblem = z.infer<
  typeof ticketImportApplyProblemSchema
>;
