import * as testSupport from '@byzon/test-support';
import * as fixtures from '@byzon/test-support/fixtures';
import { describe, expect, it } from 'vitest';

describe('test-support public exports', () => {
  it('exposes the harness and fixtures through declared package subpaths', () => {
    expect(testSupport.defineFixtureFactory).toBeTypeOf('function');
    expect(fixtures.baseProblemFixture.code).toBe('INTERNAL_ERROR');
    expect(fixtures.activationLandingFixtures.anonymous?.flow.state).toBe(
      'anonymous',
    );
    expect(fixtures.fixtureContextMatrix).toHaveLength(35);
    expect(fixtures.participantProgramFixtures.happy?.version).toBe(3);
    expect(fixtures.participantAgendaFixtures.happy?.items).toHaveLength(3);
    expect(
      fixtures.participantAgendaMutationFixtures.idempotent_replay?.mutation
        .outcome,
    ).toBe('already_applied');
    expect(
      fixtures.participantAgendaMutationFixtures.reserved_with_conflict
        ?.timeConflict,
    ).toMatchObject({
      conflictingSessions: [{}],
    });
    expect(fixtures.participantTicketFixtures.valid?.ticket.status).toBe(
      'valid',
    );
    expect(
      fixtures.identityBootstrapFixtures.complete?.profileManagement,
    ).toEqual({
      state: 'editable',
      version: 1,
    });
    expect(
      fixtures.identityProfileUpdateFixtures.updated?.profileManagement.version,
    ).toBe(2);
    expect(
      fixtures.identityPrivacyRequestFixtures.deletion_pending?.request,
    ).toMatchObject({
      kind: 'data_deletion',
      state: 'pending',
    });
    expect(
      fixtures.participantAnnouncementInboxFixtures.happy?.items[0]?.severity,
    ).toBe('critical');
    expect(
      fixtures.participantAnnouncementDetailFixtures.unread?.announcement
        .readAt,
    ).toBeNull();
    expect(fixtures.participantAnnouncementReadFixtures.success?.state).toBe(
      'read',
    );
    expect(fixtures.ticketImportPreviewFixtures.clean?.summary.conflict).toBe(
      0,
    );
    expect(fixtures.supportSearchFixtures.single_match?.outcome).toBe(
      'single_match',
    );
    expect(fixtures.adminContextFixtures.organizer?.event.id).toBe(
      fixtures.adminFixtureIds.event,
    );
    expect(
      fixtures.adminAnnouncementSendFixtures.idempotent_replay?.outcome,
    ).toBe('already_sent');
  });
});
