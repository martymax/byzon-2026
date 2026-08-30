import {
  problemTypeForCode,
  ticketImportApplyProblemSchema,
  ticketImportApplyResponseSchema,
  ticketImportPreviewProblemSchema,
  ticketImportPreviewResponseSchema,
  type TicketImportRow,
} from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';

export const ticketImportFixtureIds = Object.freeze({
  event: '019fb000-0000-7000-8000-000000000001',
  cleanPreview: '019fb000-0000-7000-8000-000000000002',
  conflictPreview: '019fb000-0000-7000-8000-000000000003',
  unknownPreview: '019fb000-0000-7000-8000-000000000004',
  simpleShopPreview: '019fb000-0000-7000-8000-000000000012',
  rowNew: '019fb000-0000-7000-8000-000000000005',
  rowUnchanged: '019fb000-0000-7000-8000-000000000006',
  rowChanged: '019fb000-0000-7000-8000-000000000007',
  rowConflict: '019fb000-0000-7000-8000-000000000008',
  rowUnknown: '019fb000-0000-7000-8000-000000000009',
  rowUnpaid: '019fb000-0000-7000-8000-000000000013',
  rowCancelled: '019fb000-0000-7000-8000-000000000014',
  batch: '019fb000-0000-7000-8000-000000000010',
  audit: '019fb000-0000-7000-8000-000000000011',
} as const);

const cleanRows = [
  {
    rowId: ticketImportFixtureIds.rowNew,
    sourceRowNumber: 2,
    referenceSuffix: 'T001',
    displayName: 'Syntetický účastník',
    maskedContact: 's•••@example.test',
    sourceStatus: 'paid',
    status: 'new',
    incomingState: 'active',
    currentState: null,
    issues: [],
  },
  {
    rowId: ticketImportFixtureIds.rowUnchanged,
    sourceRowNumber: 3,
    referenceSuffix: 'T002',
    displayName: 'Testovací návštěvník',
    maskedContact: 't•••@example.test',
    sourceStatus: 'paid',
    status: 'unchanged',
    incomingState: 'active',
    currentState: 'active',
    issues: [],
  },
  {
    rowId: ticketImportFixtureIds.rowChanged,
    sourceRowNumber: 4,
    referenceSuffix: 'T003',
    displayName: 'Ukázkový host',
    maskedContact: 'u•••@example.test',
    sourceStatus: 'cancelled',
    status: 'status_changed',
    incomingState: 'cancelled',
    currentState: 'active',
    issues: [],
  },
] satisfies TicketImportRow[];

const conflictRow = {
  rowId: ticketImportFixtureIds.rowConflict,
  sourceRowNumber: 5,
  referenceSuffix: 'T004',
  displayName: 'Konfliktní příklad',
  maskedContact: 'k•••@example.test',
  sourceStatus: 'paid',
  status: 'conflict',
  incomingState: 'active',
  currentState: 'blocked',
  issues: [
    {
      code: 'state_conflict',
      message: 'Syntetický zdroj odporuje současnému stavu.',
    },
  ],
} satisfies TicketImportRow;

const unknownRow = {
  rowId: ticketImportFixtureIds.rowUnknown,
  sourceRowNumber: 6,
  referenceSuffix: 'T005',
  displayName: 'Neznámý příklad',
  maskedContact: 'n•••@example.test',
  sourceStatus: 'unknown',
  status: 'unknown',
  incomingState: null,
  currentState: null,
  issues: [
    {
      code: 'unknown_status',
      message: 'Syntetický zdroj obsahuje neznámý stav.',
    },
  ],
} satisfies TicketImportRow;

const summary = (rows: readonly TicketImportRow[]) => ({
  total: rows.length,
  new: rows.filter(({ status }) => status === 'new').length,
  unchanged: rows.filter(({ status }) => status === 'unchanged').length,
  statusChanged: rows.filter(({ status }) => status === 'status_changed')
    .length,
  conflict: rows.filter(({ status }) => status === 'conflict').length,
  unknown: rows.filter(({ status }) => status === 'unknown').length,
});

const previewBase = {
  eventId: ticketImportFixtureIds.event,
  previewVersion: 3,
  source: {
    kind: 'file' as const,
    fileName: 'synthetic-tickets.csv',
    mediaType: 'text/csv' as const,
    byteSize: 4_280,
  },
  createdAt: '2026-07-25T12:00:00.000+02:00',
  expiresAt: '2026-07-25T12:30:00.000+02:00',
};

const simpleShopRows = [
  {
    ...cleanRows[0]!,
    sourceRowNumber: 2,
    displayName: 'Účastník •A1B2C3',
    maskedContact: 'kontakt •••',
    referenceSuffix: 'A1B2C3',
  },
  {
    ...unknownRow,
    rowId: ticketImportFixtureIds.rowUnpaid,
    sourceRowNumber: 4,
    displayName: 'Účastník •D4E5F6',
    maskedContact: 'kontakt •••',
    referenceSuffix: 'D4E5F6',
    sourceStatus: 'unpaid' as const,
  },
  {
    ...unknownRow,
    rowId: ticketImportFixtureIds.rowCancelled,
    sourceRowNumber: 5,
    displayName: 'Účastník •789ABC',
    maskedContact: 'kontakt •••',
    referenceSuffix: '789ABC',
    sourceStatus: 'cancelled' as const,
  },
] satisfies TicketImportRow[];

export const ticketImportPreviewFixtures = defineFixtureSet({
  name: 'ticket-import.preview',
  schema: ticketImportPreviewResponseSchema,
  fixtures: {
    clean: {
      ...previewBase,
      previewId: ticketImportFixtureIds.cleanPreview,
      rows: cleanRows,
      summary: summary(cleanRows),
    },
    conflict: {
      ...previewBase,
      previewId: ticketImportFixtureIds.conflictPreview,
      rows: [...cleanRows, conflictRow],
      summary: summary([...cleanRows, conflictRow]),
    },
    unknown: {
      ...previewBase,
      previewId: ticketImportFixtureIds.unknownPreview,
      rows: [...cleanRows, unknownRow],
      summary: summary([...cleanRows, unknownRow]),
    },
    simpleshop_readonly: {
      eventId: ticketImportFixtureIds.event,
      previewId: ticketImportFixtureIds.simpleShopPreview,
      previewVersion: 1,
      source: {
        kind: 'simpleshop_api',
        productId: 143_958,
        formKey: '0MnNQ',
        strict: true,
        pageCount: 1,
        sourceRows: 4,
        ticketRows: 3,
        ignoredSummaryRows: 1,
        multipleQuantitySummaryRows: 1,
        observedStatuses: {
          paid: 1,
          unpaid: 1,
          cancelled: 1,
          refunded: 0,
          unknown: 0,
        },
        codeShape: {
          count: 3,
          minByteLength: 6,
          maxByteLength: 6,
          characterClasses: ['digit', 'upper_ascii'],
        },
      },
      createdAt: '2026-07-25T12:00:00.000+02:00',
      expiresAt: '2026-07-25T12:20:00.000+02:00',
      rows: simpleShopRows,
      summary: summary(simpleShopRows),
    },
  },
});

const applyResponse = {
  eventId: ticketImportFixtureIds.event,
  batchId: ticketImportFixtureIds.batch,
  previewId: ticketImportFixtureIds.cleanPreview,
  previewVersion: 3,
  result: {
    created: 1,
    statusChanged: 1,
    unchanged: 1,
  },
  completedAt: '2026-07-25T12:05:00.000+02:00',
  audit: { auditId: ticketImportFixtureIds.audit },
};

export const ticketImportApplyFixtures = defineFixtureSet({
  name: 'ticket-import.apply',
  schema: ticketImportApplyResponseSchema,
  fixtures: {
    applied: {
      ...applyResponse,
      outcome: 'applied',
    },
    idempotent_replay: {
      ...applyResponse,
      outcome: 'already_applied',
    },
  },
});

interface TicketImportProblemStatus {
  readonly AUTHENTICATION_REQUIRED: 401;
  readonly AUTH_SESSION_EXPIRED: 401;
  readonly EVENT_ACCESS_DENIED: 403;
  readonly IMPORT_UNSUPPORTED_FORMAT: 415;
  readonly IMPORT_VALIDATION_FAILED: 422;
  readonly IMPORT_SOURCE_UNAVAILABLE: 502;
  readonly IMPORT_SOURCE_TIMEOUT: 504;
  readonly IMPORT_SOURCE_INVALID: 502;
  readonly RATE_LIMITED: 429;
  readonly IMPORT_BATCH_NOT_FOUND: 404;
  readonly IMPORT_PREVIEW_BLOCKED: 409;
  readonly IDEMPOTENCY_KEY_REUSED: 409;
  readonly IDEMPOTENCY_IN_PROGRESS: 409;
  readonly INTERNAL_ERROR: 500;
}

const problem = <Code extends keyof TicketImportProblemStatus>(
  code: Code,
  status: TicketImportProblemStatus[Code],
) => ({
  type: problemTypeForCode(code),
  title: 'Synthetic ticket import problem',
  status,
  code,
  detail: 'Synthetic ticket import request could not be completed.',
  requestId: 'fixture-ticket-import-0001',
});

export const ticketImportPreviewProblemFixtures = defineFixtureSet({
  name: 'ticket-import.preview-problem',
  schema: ticketImportPreviewProblemSchema,
  fixtures: {
    authentication: problem('AUTHENTICATION_REQUIRED', 401),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    permission: problem('EVENT_ACCESS_DENIED', 403),
    unsupported_format: problem('IMPORT_UNSUPPORTED_FORMAT', 415),
    validation: problem('IMPORT_VALIDATION_FAILED', 422),
    source_unavailable: problem('IMPORT_SOURCE_UNAVAILABLE', 502),
    source_timeout: problem('IMPORT_SOURCE_TIMEOUT', 504),
    source_invalid: problem('IMPORT_SOURCE_INVALID', 502),
    rate_limited: problem('RATE_LIMITED', 429),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const ticketImportApplyProblemFixtures = defineFixtureSet({
  name: 'ticket-import.apply-problem',
  schema: ticketImportApplyProblemSchema,
  fixtures: {
    permission: problem('EVENT_ACCESS_DENIED', 403),
    not_found: problem('IMPORT_BATCH_NOT_FOUND', 404),
    blocked: problem('IMPORT_PREVIEW_BLOCKED', 409),
    stale: {
      type: problemTypeForCode('IMPORT_PREVIEW_STALE'),
      title: 'Synthetic ticket import problem',
      status: 409,
      code: 'IMPORT_PREVIEW_STALE',
      detail: 'Synthetic ticket import preview is stale.',
      requestId: 'fixture-ticket-import-0002',
      currentPreviewVersion: 4,
    },
    key_reused: problem('IDEMPOTENCY_KEY_REUSED', 409),
    in_progress: problem('IDEMPOTENCY_IN_PROGRESS', 409),
  },
});
