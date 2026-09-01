import { describe, expect, it } from 'vitest';

import {
  canApplyTicketImportPreview,
  problemTypeForCode,
  ticketImportApplyHeadersSchema,
  ticketImportApplyProblemSchema,
  ticketImportApplyRequestSchema,
  ticketImportCachePolicy,
  ticketImportPreviewResponseSchema,
} from './index.js';

const ids = {
  event: '019fa000-0000-7000-8000-000000000001',
  preview: '019fa000-0000-7000-8000-000000000002',
  rowNew: '019fa000-0000-7000-8000-000000000003',
  rowUnchanged: '019fa000-0000-7000-8000-000000000004',
  rowConflict: '019fa000-0000-7000-8000-000000000005',
  rowUnknown: '019fa000-0000-7000-8000-000000000006',
} as const;

const source = {
  kind: 'file' as const,
  fileName: 'synthetic-tickets.csv',
  mediaType: 'text/csv' as const,
  byteSize: 4_096,
};

const newRow = {
  rowId: ids.rowNew,
  sourceRowNumber: 2,
  referenceSuffix: 'T001',
  sourceTicketId: '7000001',
  sourceOrderId: '8000001',
  contactName: 'Syntetický účastník',
  contactEmail: 'synteticky@example.test',
  contactCompany: 'Example s.r.o.',
  contactPosition: 'CEO',
  contactPhone: '+420777111222',
  identitySource: 'named_participant' as const,
  sourceStatus: 'paid' as const,
  status: 'new' as const,
  incomingState: 'active' as const,
  currentState: null,
  issues: [],
};

const unchangedRow = {
  rowId: ids.rowUnchanged,
  sourceRowNumber: 3,
  referenceSuffix: 'T002',
  sourceTicketId: '7000002',
  sourceOrderId: '8000002',
  contactName: 'Testovací návštěvník',
  contactEmail: 'navstevnik@example.test',
  contactCompany: null,
  contactPosition: null,
  contactPhone: null,
  identitySource: 'named_participant' as const,
  sourceStatus: 'paid' as const,
  status: 'unchanged' as const,
  incomingState: 'active' as const,
  currentState: 'active' as const,
  issues: [],
};

const preview = {
  eventId: ids.event,
  previewId: ids.preview,
  previewVersion: 3,
  source,
  createdAt: '2026-07-25T12:00:00.000+02:00',
  expiresAt: '2026-07-25T12:30:00.000+02:00',
  rows: [newRow, unchangedRow],
  summary: {
    total: 2,
    new: 1,
    unchanged: 1,
    statusChanged: 0,
    conflict: 0,
    unknown: 0,
  },
};

describe('CS-IMPORT-01 contracts', () => {
  it('validates an immutable clean preview and private cache policy', () => {
    const parsed = ticketImportPreviewResponseSchema.parse(preview);

    expect(canApplyTicketImportPreview(parsed)).toBe(true);
    expect(ticketImportCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      browserPersistence: 'forbidden',
      rawFileStorage: 'private-quarantine-only',
      previewMutation: 'online-only',
      applyIdempotency: 'required',
    });
    expect(
      ticketImportPreviewResponseSchema.safeParse({
        ...preview,
        source: {
          ...source,
          vendorColumns: ['SimpleShop state'],
        },
      }).success,
    ).toBe(false);
    expect(
      ticketImportPreviewResponseSchema.safeParse({
        ...preview,
        rows: [{ ...newRow, maskedContact: 's•••@example.test' }, unchangedRow],
      }).success,
    ).toBe(false);
  });

  it('fails closed when summary, conflict or unknown status is present', () => {
    expect(
      ticketImportPreviewResponseSchema.safeParse({
        ...preview,
        summary: { ...preview.summary, new: 2 },
      }).success,
    ).toBe(false);

    const conflict = ticketImportPreviewResponseSchema.parse({
      ...preview,
      rows: [
        ...preview.rows,
        {
          ...newRow,
          rowId: ids.rowConflict,
          sourceRowNumber: 4,
          status: 'conflict',
          incomingState: 'active',
          currentState: 'blocked',
          issues: [
            {
              code: 'state_conflict',
              message: 'Syntetický stav je v konfliktu.',
            },
          ],
        },
      ],
      summary: {
        ...preview.summary,
        total: 3,
        new: 1,
        conflict: 1,
      },
    });
    const unknown = ticketImportPreviewResponseSchema.parse({
      ...preview,
      rows: [
        ...preview.rows,
        {
          ...newRow,
          rowId: ids.rowUnknown,
          sourceRowNumber: 5,
          sourceStatus: 'unknown',
          status: 'unknown',
          incomingState: null,
          currentState: null,
          issues: [
            {
              code: 'unknown_status',
              message: 'Syntetický stav není známý.',
            },
          ],
        },
      ],
      summary: {
        ...preview.summary,
        total: 3,
        new: 1,
        unknown: 1,
      },
    });

    expect(canApplyTicketImportPreview(conflict)).toBe(false);
    expect(canApplyTicketImportPreview(unknown)).toBe(false);
    expect(
      ticketImportApplyRequestSchema.safeParse({
        eventId: ids.event,
        previewId: ids.preview,
        previewVersion: 3,
        expectedImpact: conflict.summary,
        reason: 'Potvrzený syntetický import.',
      }).success,
    ).toBe(false);
  });

  it('validates the bounded SimpleShop source envelope and never enables apply', () => {
    const simpleShopPreview = ticketImportPreviewResponseSchema.parse({
      ...preview,
      source: {
        kind: 'simpleshop_api',
        productId: 143_958,
        formKey: '0MnNQ',
        strict: true,
        pageCount: 1,
        sourceRows: 3,
        ticketRows: 2,
        ignoredSummaryRows: 1,
        multipleQuantitySummaryRows: 1,
        observedStatuses: {
          paid: 2,
          unpaid: 0,
          cancelled: 0,
          refunded: 0,
          unknown: 0,
        },
        codeShape: {
          count: 2,
          minByteLength: 6,
          maxByteLength: 6,
          characterClasses: ['digit', 'upper_ascii'],
        },
      },
    });

    expect(canApplyTicketImportPreview(simpleShopPreview)).toBe(false);
    expect(
      ticketImportPreviewResponseSchema.safeParse({
        ...simpleShopPreview,
        source: {
          ...simpleShopPreview.source,
          pageCount: 2,
        },
      }).success,
    ).toBe(false);
  });

  it('keeps idempotency and actor authority outside the mutation body', () => {
    const request = {
      eventId: ids.event,
      previewId: ids.preview,
      previewVersion: 3,
      expectedImpact: preview.summary,
      reason: 'Potvrzený syntetický import.',
    };

    expect(ticketImportApplyRequestSchema.parse(request)).toEqual(request);
    expect(
      ticketImportApplyHeadersSchema.parse({
        idempotencyKey: 'ticket-import-apply-0001',
      }),
    ).toEqual({ idempotencyKey: 'ticket-import-apply-0001' });
    expect(
      ticketImportApplyRequestSchema.safeParse({
        ...request,
        actorRole: 'organizer_admin',
        idempotencyKey: 'ticket-import-apply-0001',
      }).success,
    ).toBe(false);
  });

  it('enumerates stale, blocked and idempotency apply failures', () => {
    const stale = {
      type: problemTypeForCode('IMPORT_PREVIEW_STALE'),
      title: 'Import preview is stale',
      status: 409,
      code: 'IMPORT_PREVIEW_STALE',
      detail: 'Reload the canonical import preview.',
      requestId: 'request-ticket-import-0001',
      currentPreviewVersion: 4,
    };

    expect(ticketImportApplyProblemSchema.parse(stale)).toEqual(stale);
    expect(
      ticketImportApplyProblemSchema.safeParse({
        ...stale,
        code: 'UNSUPPORTED_VENDOR_COLUMN',
        type: problemTypeForCode('UNSUPPORTED_VENDOR_COLUMN'),
      }).success,
    ).toBe(false);
  });
});
