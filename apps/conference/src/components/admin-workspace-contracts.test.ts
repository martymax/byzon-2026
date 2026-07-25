import { describe, expect, it } from 'vitest';

import {
  announcementSendRequestSchema,
  applySupportMutation,
  applyTicketImportPreview,
  canAccessAdminSection,
  canApplyTicketImport,
  createAnnouncementPreview,
  sendAnnouncementPreview,
  supportMutationRequestSchema,
  ticketImportApplyRequestSchema,
  ticketImportPreviewSchema,
} from './admin-workspace-contracts';
import {
  adminDemoScope,
  demoImportPreview,
  demoImportPreviewWithUnknown,
  demoSupportRecords,
} from './admin-workspace-demo-data';

describe('F4 validated mocked admin contracts', () => {
  it('enforces role and event section scopes without a global superadmin', () => {
    expect(canAccessAdminSection('organizer_admin', 'import')).toBe(true);
    expect(canAccessAdminSection('support_operator', 'support')).toBe(true);
    expect(canAccessAdminSection('support_operator', 'import')).toBe(false);
    expect(canAccessAdminSection('room_operator', 'reservations')).toBe(true);
    expect(canAccessAdminSection('room_operator', 'support')).toBe(false);
    expect(canAccessAdminSection('participant', 'overview')).toBe(false);
  });

  it('rejects a summary that does not match the immutable import rows', () => {
    expect(() =>
      ticketImportPreviewSchema.parse({
        ...demoImportPreview,
        summary: { ...demoImportPreview.summary, new: 99 },
      }),
    ).toThrow();
  });

  it('blocks every apply when a preview contains an unknown source state', () => {
    expect(canApplyTicketImport(demoImportPreviewWithUnknown)).toBe(false);
    expect(() =>
      ticketImportApplyRequestSchema.parse({
        eventId: adminDemoScope.eventId,
        previewId: demoImportPreviewWithUnknown.previewId,
        previewVersion: demoImportPreviewWithUnknown.previewVersion,
        expectedImpact: demoImportPreviewWithUnknown.summary,
        reason: 'Syntetické ověření blokace.',
        idempotencyKey: 'mock-import-unknown-0001',
      }),
    ).toThrow();
  });

  it('applies only an exact immutable import preview and reports conflicts', () => {
    const request = ticketImportApplyRequestSchema.parse({
      eventId: adminDemoScope.eventId,
      previewId: demoImportPreview.previewId,
      previewVersion: demoImportPreview.previewVersion,
      expectedImpact: demoImportPreview.summary,
      reason: 'Syntetický nácvik bezpečného importu.',
      idempotencyKey: 'mock-import-apply-0001',
    });

    const report = applyTicketImportPreview(demoImportPreview, request);
    expect(report).toMatchObject({
      state: 'mock_applied',
      applied: 2,
      unchanged: 1,
      skippedConflicts: 1,
      previewVersion: demoImportPreview.previewVersion,
    });
    expect(() =>
      applyTicketImportPreview(demoImportPreview, {
        ...request,
        previewVersion: 'mock-import-stale-version',
      }),
    ).toThrow('IMPORT_PREVIEW_STALE');
  });

  it('requires a support reason, target, version and event correlation', () => {
    const record = demoSupportRecords[0]!;
    expect(() =>
      supportMutationRequestSchema.parse({
        eventId: record.eventId,
        participantId: record.participantId,
        action: 'transfer',
        reason: '',
        targetTicketReference: null,
        expectedVersion: record.version,
        idempotencyKey: 'mock-support-invalid-0001',
      }),
    ).toThrow();

    const request = supportMutationRequestSchema.parse({
      eventId: record.eventId,
      participantId: record.participantId,
      action: 'block',
      reason: 'Syntetický bezpečnostní nácvik.',
      targetTicketReference: null,
      expectedVersion: record.version,
      idempotencyKey: 'mock-support-block-0001',
    });
    const response = applySupportMutation(record, request);
    expect(response.record).toMatchObject({
      ticketState: 'blocked',
      version: record.version + 1,
    });
    expect(response.audit).toMatchObject({
      category: 'support',
      outcome: 'succeeded',
      resultingVersion: record.version + 1,
    });
    expect(() =>
      applySupportMutation(record, {
        ...request,
        expectedVersion: record.version + 1,
      }),
    ).toThrow('SUPPORT_STALE_VERSION');
  });

  it('sends only the exact immutable in-app announcement preview', () => {
    const preview = createAnnouncementPreview(adminDemoScope.eventId, {
      title: 'Změna sálu',
      bodyText: 'Workshop se přesouvá do sálu Vltava.',
      severity: 'important',
      audience: { kind: 'session', sessionId: 'session-growth-2026' },
    });
    const request = announcementSendRequestSchema.parse({
      eventId: adminDemoScope.eventId,
      previewId: preview.previewId,
      previewVersion: preview.previewVersion,
      reason: 'Informování přímo dotčené skupiny.',
      idempotencyKey: 'mock-announcement-send-0001',
    });

    expect(sendAnnouncementPreview(preview, request)).toMatchObject({
      state: 'sent_in_app_mock',
      recipientCount: 37,
      audit: { category: 'announcement', outcome: 'succeeded' },
    });
    expect(() =>
      sendAnnouncementPreview(preview, {
        ...request,
        previewVersion: 'mock-ann-version-stale',
      }),
    ).toThrow('ANNOUNCEMENT_PREVIEW_STALE');
  });
});
