import { describe, expect, it } from 'vitest';

import {
  AdminMockMutationReplay,
  adminDatasetMatchesEvent,
  adminReasonSchema,
  adminReservationMutationRequestSchema,
  adminUploadFileNameSchema,
  announcementSendRequestSchema,
  applyAdminReservationMutation,
  applyOperationsMutation,
  applySupportMutation,
  applyTicketImportPreview,
  canAccessAdminSection,
  canApplyTicketImport,
  createAnnouncementPreview,
  operationsMutationRequestSchema,
  sendAnnouncementPreview,
  supportMutationRequestSchema,
  ticketImportApplyRequestSchema,
  ticketImportPreviewSchema,
} from './admin-workspace-contracts';
import {
  adminDemoScope,
  demoEventSettings,
  demoImportPreview,
  demoImportPreviewWithConflict,
  demoImportPreviewWithUnknown,
  demoOperationsOverview,
  demoReservations,
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
    expect(
      adminDatasetMatchesEvent(adminDemoScope.eventId, [
        { eventId: adminDemoScope.eventId },
      ]),
    ).toBe(true);
    expect(
      adminDatasetMatchesEvent(adminDemoScope.eventId, [
        { eventId: 'event-other-2026' },
      ]),
    ).toBe(false);
  });

  it('rejects a summary that does not match the immutable import rows', () => {
    expect(() =>
      ticketImportPreviewSchema.parse({
        ...demoImportPreview,
        summary: { ...demoImportPreview.summary, new: 99 },
      }),
    ).toThrow();
  });

  it('rejects path-like, control and bidi-spoofed upload names', () => {
    expect(adminUploadFileNameSchema.safeParse('../tickets.csv').success).toBe(
      false,
    );
    expect(
      adminUploadFileNameSchema.safeParse('tickets\u202ecod.exe.csv').success,
    ).toBe(false);
    expect(
      adminUploadFileNameSchema.safeParse('tickets\u0000.csv').success,
    ).toBe(false);
    expect(adminUploadFileNameSchema.parse('tickets-2026.csv')).toBe(
      'tickets-2026.csv',
    );
  });

  it('allows safe multiline operational text but rejects bidi controls', () => {
    expect(adminReasonSchema.parse('První řádek.\nDruhý řádek.')).toContain(
      '\n',
    );
    expect(
      adminReasonSchema.safeParse('Důvod\u202ese změnou směru').success,
    ).toBe(false);
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

  it('blocks every apply when a preview contains an unresolved conflict', () => {
    expect(canApplyTicketImport(demoImportPreviewWithConflict)).toBe(false);
    expect(() =>
      ticketImportApplyRequestSchema.parse({
        eventId: adminDemoScope.eventId,
        previewId: demoImportPreviewWithConflict.previewId,
        previewVersion: demoImportPreviewWithConflict.previewVersion,
        expectedImpact: demoImportPreviewWithConflict.summary,
        reason: 'Syntetické ověření blokace konfliktu.',
        idempotencyKey: 'mock-import-conflict-0001',
      }),
    ).toThrow();
  });

  it('applies only an exact conflict-free immutable import preview', () => {
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
      skippedConflicts: 0,
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
    const replay = new AdminMockMutationReplay();
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
    const response = applySupportMutation(record, request, replay);
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
      applySupportMutation(
        record,
        {
          ...request,
          expectedVersion: record.version + 1,
          idempotencyKey: 'mock-support-stale-0001',
        },
        replay,
      ),
    ).toThrow('SUPPORT_STALE_VERSION');
  });

  it('replays an exact support mutation after the canonical record advances', () => {
    const record = demoSupportRecords[0]!;
    const replay = new AdminMockMutationReplay();
    const request = supportMutationRequestSchema.parse({
      eventId: record.eventId,
      participantId: record.participantId,
      action: 'block',
      reason: 'Syntetický replay po neurčité odpovědi.',
      targetTicketReference: null,
      expectedVersion: record.version,
      idempotencyKey: 'mock-support-replay-0001',
    });
    const first = applySupportMutation(record, request, replay);
    const repeated = applySupportMutation(first.record, request, replay);

    expect(repeated).toEqual({ ...first, result: 'already_applied' });
    expect(() =>
      applySupportMutation(
        first.record,
        { ...request, reason: 'Jiný payload pod stejným klíčem.' },
        replay,
      ),
    ).toThrow('ADMIN_IDEMPOTENCY_KEY_REUSED');
  });

  it.each([
    ['resend', demoSupportRecords[0]!, null],
    ['reassign', demoSupportRecords[0]!, 'SYN-REASSIGNED'],
    ['block', demoSupportRecords[0]!, null],
    ['reactivate', demoSupportRecords[1]!, null],
    ['transfer', demoSupportRecords[0]!, 'SYN-TRANSFERRED'],
  ] as const)(
    'validates and audits the %s support transition',
    (action, record, targetTicketReference) => {
      const response = applySupportMutation(
        record,
        supportMutationRequestSchema.parse({
          eventId: record.eventId,
          participantId: record.participantId,
          action,
          reason: `Syntetické ověření akce ${action}.`,
          targetTicketReference,
          expectedVersion: record.version,
          idempotencyKey: `mock-support-${action}-contract`,
        }),
        new AdminMockMutationReplay(),
      );

      expect(response.audit).toMatchObject({
        action,
        category: 'support',
        outcome: 'succeeded',
      });
      expect(response.record.version).toBe(record.version + 1);
    },
  );

  it('sends only the exact immutable in-app announcement preview', async () => {
    const preview = await createAnnouncementPreview(adminDemoScope.eventId, {
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
      idempotencyKey: `mock-ann-send-${preview.previewId}`,
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

  it('does not collide previews for different same-length announcement text', async () => {
    const first = await createAnnouncementPreview(adminDemoScope.eventId, {
      title: 'AB',
      bodyText: 'CD',
      severity: 'important',
      audience: { kind: 'event' },
    });
    const second = await createAnnouncementPreview(adminDemoScope.eventId, {
      title: 'XY',
      bodyText: 'ZZ',
      severity: 'important',
      audience: { kind: 'event' },
    });

    expect(first.previewId).not.toBe(second.previewId);
    expect(first.previewVersion).not.toBe(second.previewVersion);
    expect(() =>
      sendAnnouncementPreview(second, {
        eventId: second.eventId,
        previewId: second.previewId,
        previewVersion: second.previewVersion,
        reason: 'Syntetický test kolize.',
        idempotencyKey: `mock-ann-send-${first.previewId}`,
      }),
    ).toThrow('ANNOUNCEMENT_PREVIEW_STALE');
  });

  it('enforces scoped, versioned and replay-safe operations mutations', () => {
    const replay = new AdminMockMutationReplay();
    const request = operationsMutationRequestSchema.parse({
      kind: 'assign_operator',
      eventId: adminDemoScope.eventId,
      actorRole: 'organizer_admin',
      expectedVersion: demoOperationsOverview.version,
      operatorLabel: 'Operátor #31',
      role: 'checkin_operator',
      scopeLabel: 'Hlavní vstup',
      reason: 'Syntetické přiřazení role.',
      idempotencyKey: 'mock-operations-test-0001',
    });
    const first = applyOperationsMutation(
      demoOperationsOverview,
      request,
      replay,
    );
    const replayed = applyOperationsMutation(
      demoOperationsOverview,
      request,
      replay,
    );

    expect(replayed).toEqual(first);
    expect(first.overview.assignments).toHaveLength(
      demoOperationsOverview.assignments.length + 1,
    );
    expect(() =>
      applyOperationsMutation(
        demoOperationsOverview,
        { ...request, reason: 'Jiný payload pod stejným klíčem.' },
        replay,
      ),
    ).toThrow('ADMIN_IDEMPOTENCY_KEY_REUSED');
    expect(() =>
      applyOperationsMutation(
        demoOperationsOverview,
        { ...request, expectedVersion: demoOperationsOverview.version + 1 },
        new AdminMockMutationReplay(),
      ),
    ).toThrow('ADMIN_OPERATIONS_STALE_OR_SCOPE_MISMATCH');

    const exportResponse = applyOperationsMutation(
      demoOperationsOverview,
      operationsMutationRequestSchema.parse({
        kind: 'queue_export',
        eventId: adminDemoScope.eventId,
        actorRole: 'organizer_admin',
        expectedVersion: demoOperationsOverview.version,
        reason: 'Syntetický auditovaný export.',
        idempotencyKey: 'mock-operations-export-contract',
      }),
      new AdminMockMutationReplay(),
    );
    expect(exportResponse).toMatchObject({
      result: 'queued',
      audit: { category: 'export', outcome: 'queued' },
    });
  });

  it('enforces role, assignment, event and version for reservation mutations', () => {
    const record = demoReservations[0]!;
    const request = adminReservationMutationRequestSchema.parse({
      kind: 'reservation',
      eventId: adminDemoScope.eventId,
      actorRole: 'room_operator',
      assignedSessionIds: [record.sessionId],
      reservationId: record.reservationId,
      action: 'mark_attended',
      expectedVersion: record.version,
      reason: 'Syntetické potvrzení účasti.',
      idempotencyKey: 'mock-reservation-test-0001',
    });
    if (request.kind !== 'reservation') {
      throw new TypeError('Expected a reservation mutation fixture.');
    }
    const response = applyAdminReservationMutation(
      demoReservations,
      demoEventSettings,
      request,
      new AdminMockMutationReplay(),
    );
    expect(response).toMatchObject({
      result: 'reservation_updated',
      record: { state: 'attended', version: record.version + 1 },
      audit: { category: 'attendance', outcome: 'succeeded' },
    });
    expect(() =>
      applyAdminReservationMutation(
        demoReservations,
        demoEventSettings,
        { ...request, assignedSessionIds: ['session-other-2026'] },
        new AdminMockMutationReplay(),
      ),
    ).toThrow('ADMIN_RESERVATION_FORBIDDEN');
    expect(() =>
      applyAdminReservationMutation(
        demoReservations,
        demoEventSettings,
        { ...request, expectedVersion: record.version + 1 },
        new AdminMockMutationReplay(),
      ),
    ).toThrow('ADMIN_RESERVATION_STALE_OR_NOT_FOUND');
  });

  it.each([
    ['increase_capacity', 'reserved'],
    ['cancel_reservation', 'cancelled'],
    ['mark_attended', 'attended'],
  ] as const)(
    'applies a versioned organizer reservation action: %s',
    (action, expectedState) => {
      const record = demoReservations[0]!;
      const response = applyAdminReservationMutation(
        demoReservations,
        demoEventSettings,
        adminReservationMutationRequestSchema.parse({
          kind: 'reservation',
          eventId: adminDemoScope.eventId,
          actorRole: 'organizer_admin',
          assignedSessionIds: [],
          reservationId: record.reservationId,
          action,
          expectedVersion: record.version,
          reason: `Syntetické ověření ${action}.`,
          idempotencyKey: `mock-reservation-${action}-contract`,
        }),
        new AdminMockMutationReplay(),
      );

      expect(response.record).toMatchObject({
        state: expectedState,
        version: record.version + 1,
      });
      expect(response.audit.resultingVersion).toBe(record.version + 1);
    },
  );

  it('updates settings once and replays the exact immutable request', () => {
    const replay = new AdminMockMutationReplay();
    const request = adminReservationMutationRequestSchema.parse({
      kind: 'settings',
      eventId: adminDemoScope.eventId,
      actorRole: 'organizer_admin',
      expectedVersion: demoEventSettings.version,
      next: {
        registrationMode: 'closed',
        reservationChangesAllowed: false,
        supportMessage: 'První řádek.\nDruhý řádek.',
      },
      reason: 'Syntetická auditovaná změna nastavení.',
      idempotencyKey: 'mock-settings-contract-0001',
    });
    const first = applyAdminReservationMutation(
      demoReservations,
      demoEventSettings,
      request,
      replay,
    );
    if (!first.settings) {
      throw new TypeError('Expected canonical settings response.');
    }
    const repeated = applyAdminReservationMutation(
      demoReservations,
      first.settings,
      request,
      replay,
    );

    expect(repeated).toEqual(first);
    expect(first.settings).toMatchObject({
      registrationMode: 'closed',
      version: demoEventSettings.version + 1,
    });
  });
});
