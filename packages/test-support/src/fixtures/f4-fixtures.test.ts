import {
  adminAnnouncementPreviewResponseSchema,
  adminAnnouncementSendResponseSchema,
  adminAnnouncementTargetListResponseSchema,
  adminAuditResponseSchema,
  adminContextResponseSchema,
  adminEventSettingsSchema,
  adminExportJobListResponseSchema,
  adminOperationsOverviewResponseSchema,
  adminReservationListResponseSchema,
  adminReservationMutationResponseSchema,
  adminReservationSessionPageSchema,
  adminSessionCapacityListResponseSchema,
  adminRoleAssignmentMutationResponseSchema,
  adminRoleAssignmentListResponseSchema,
  adminRolePersonSearchResponseSchema,
  adminRoleScopeOptionsResponseSchema,
  supportMutationResponseSchema,
  supportSearchResponseSchema,
  supportTargetTicketSearchResponseSchema,
  ticketImportApplyResponseSchema,
  ticketImportPreviewResponseSchema,
} from '@byzon/domain/contracts';
import { describe, expect, it } from 'vitest';

import {
  adminAnnouncementPreviewFixtures,
  adminAnnouncementPreviewProblemFixtures,
  adminAnnouncementSendFixtures,
  adminAnnouncementSendProblemFixtures,
  adminAnnouncementTargetFixtures,
  adminAnnouncementTargetProblemFixtures,
  adminAuditFixtures,
  adminContextFixtures,
  adminEventSettingsFixtures,
  adminExportFixtures,
  adminExportJobListFixtures,
  adminFixtureIds,
  adminMutationProblemFixtures,
  adminOperationsOverviewFixtures,
  adminReservationFixtures,
  adminReservationMutationFixtures,
  adminReservationSessionFixtures,
  adminSessionCapacityFixtures,
  adminRoleAssignmentFixtures,
  adminRoleAssignmentListFixtures,
  adminRolePersonSearchFixtures,
  adminRoleScopeOptionsFixtures,
  supportMutationFixtures,
  supportMutationProblemFixtures,
  supportSearchFixtures,
  supportSearchProblemFixtures,
  supportTargetTicketSearchFixtures,
  supportTargetTicketSearchProblemFixtures,
  ticketImportApplyFixtures,
  ticketImportApplyProblemFixtures,
  ticketImportPreviewFixtures,
  ticketImportPreviewProblemFixtures,
} from './index.js';

describe('F4 canonical fixture sets', () => {
  it('validates clean/conflict/unknown ticket import paths', () => {
    for (const fixture of Object.values(ticketImportPreviewFixtures)) {
      expect(ticketImportPreviewResponseSchema.parse(fixture)).toEqual(fixture);
    }
    for (const fixture of Object.values(ticketImportApplyFixtures)) {
      expect(ticketImportApplyResponseSchema.parse(fixture)).toEqual(fixture);
    }

    expect(ticketImportPreviewFixtures.clean?.summary).toMatchObject({
      conflict: 0,
      unknown: 0,
    });
    expect(ticketImportPreviewFixtures.conflict?.summary.conflict).toBe(1);
    expect(ticketImportPreviewFixtures.unknown?.summary.unknown).toBe(1);
    expect(ticketImportApplyFixtures.idempotent_replay?.outcome).toBe(
      'already_applied',
    );
    expect(ticketImportPreviewProblemFixtures.unsupported_format?.code).toBe(
      'IMPORT_UNSUPPORTED_FORMAT',
    );
    expect(ticketImportApplyProblemFixtures.stale).toMatchObject({
      code: 'IMPORT_PREVIEW_STALE',
      currentPreviewVersion: 4,
    });
  });

  it('validates bounded support search/mutations and problems', () => {
    for (const fixture of Object.values(supportSearchFixtures)) {
      expect(supportSearchResponseSchema.parse(fixture)).toEqual(fixture);
    }
    for (const fixture of Object.values(supportMutationFixtures)) {
      expect(supportMutationResponseSchema.parse(fixture)).toEqual(fixture);
    }
    for (const fixture of Object.values(supportTargetTicketSearchFixtures)) {
      expect(supportTargetTicketSearchResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }

    expect(supportSearchFixtures.no_match?.matches).toHaveLength(0);
    expect(supportSearchFixtures.single_match?.matches).toHaveLength(1);
    expect(supportSearchFixtures.ambiguous?.matches).toHaveLength(2);
    expect(
      supportTargetTicketSearchFixtures.ambiguous?.candidates,
    ).toHaveLength(2);
    expect(supportTargetTicketSearchProblemFixtures.stale?.code).toBe(
      'STALE_VERSION',
    );
    expect(supportMutationFixtures.idempotent_replay?.outcome).toBe(
      'already_applied',
    );
    expect(supportSearchProblemFixtures.rate_limited?.code).toBe(
      'SUPPORT_RATE_LIMITED',
    );
    expect(supportMutationProblemFixtures.invalid_transition?.code).toBe(
      'SUPPORT_INVALID_TRANSITION',
    );
  });

  it('validates server-derived admin contexts and operational snapshots', () => {
    for (const fixture of Object.values(adminContextFixtures)) {
      expect(adminContextResponseSchema.parse(fixture)).toEqual(fixture);
    }
    for (const fixture of Object.values(adminOperationsOverviewFixtures)) {
      expect(adminOperationsOverviewResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }
    for (const fixture of Object.values(adminRoleAssignmentFixtures)) {
      expect(adminRoleAssignmentMutationResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }
    for (const fixture of Object.values(adminRoleAssignmentListFixtures)) {
      expect(adminRoleAssignmentListResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }
    for (const fixture of Object.values(adminRolePersonSearchFixtures)) {
      expect(adminRolePersonSearchResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }
    for (const fixture of Object.values(adminRoleScopeOptionsFixtures)) {
      expect(adminRoleScopeOptionsResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }
    for (const fixture of Object.values(adminReservationFixtures)) {
      expect(adminReservationListResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }
    for (const fixture of Object.values(adminReservationSessionFixtures)) {
      expect(adminReservationSessionPageSchema.parse(fixture)).toEqual(fixture);
    }
    for (const fixture of Object.values(adminSessionCapacityFixtures)) {
      expect(adminSessionCapacityListResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }
    for (const fixture of Object.values(adminReservationMutationFixtures)) {
      expect(adminReservationMutationResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }
    for (const fixture of Object.values(adminAuditFixtures)) {
      expect(adminAuditResponseSchema.parse(fixture)).toEqual(fixture);
    }
    for (const fixture of Object.values(adminEventSettingsFixtures)) {
      expect(adminEventSettingsSchema.parse(fixture)).toEqual(fixture);
    }
    for (const fixture of Object.values(adminExportJobListFixtures)) {
      expect(adminExportJobListResponseSchema.parse(fixture)).toEqual(fixture);
    }

    expect(adminContextFixtures.room_operator?.actor.assignedSessions).toEqual([
      { sessionId: adminFixtureIds.session, title: 'Růst bez zkratek' },
    ]);
    expect(adminReservationFixtures.assigned_session_only?.items).toHaveLength(
      1,
    );
    expect(adminExportFixtures.queued?.state).toBe('queued');
    expect(
      adminExportJobListFixtures.mixed?.items.filter(
        ({ downloadPath }) => downloadPath !== null,
      ),
    ).toHaveLength(1);
    expect(adminMutationProblemFixtures.self_lockout?.code).toBe(
      'SELF_LOCKOUT_GUARD',
    );
  });

  it('validates immutable admin announcement preview/send and failures', () => {
    for (const fixture of Object.values(adminAnnouncementTargetFixtures)) {
      expect(adminAnnouncementTargetListResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }
    for (const fixture of Object.values(adminAnnouncementPreviewFixtures)) {
      expect(adminAnnouncementPreviewResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }
    for (const fixture of Object.values(adminAnnouncementSendFixtures)) {
      expect(adminAnnouncementSendResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }

    expect(
      adminAnnouncementPreviewFixtures.session_audience?.audience
        .recipientCount,
    ).toBe(37);
    expect(adminAnnouncementSendFixtures.idempotent_replay?.outcome).toBe(
      'already_sent',
    );
    expect(adminAnnouncementPreviewProblemFixtures.empty_audience?.code).toBe(
      'ANNOUNCEMENT_EMPTY_AUDIENCE',
    );
    expect(adminAnnouncementSendProblemFixtures.stale_preview).toMatchObject({
      code: 'ANNOUNCEMENT_PREVIEW_STALE',
      currentPreviewVersion: 3,
    });
    expect(adminAnnouncementTargetProblemFixtures.permission?.code).toBe(
      'EVENT_ACCESS_DENIED',
    );
  });

  it('contains no canonical mock state, raw ticket credential or actor input', () => {
    const serialized = JSON.stringify({
      imports: ticketImportPreviewFixtures,
      support: supportSearchFixtures,
      admin: {
        operations: adminOperationsOverviewFixtures,
        reservations: adminReservationFixtures,
        audit: adminAuditFixtures,
      },
      announcements: adminAnnouncementPreviewFixtures,
    });

    expect(serialized).not.toContain('mock_');
    expect(serialized).not.toContain('ticketCode');
    expect(serialized).not.toContain('credential');
    expect(serialized).not.toContain('actorRole');
    expect(serialized).not.toContain('assignedSessionIds');
  });
});
