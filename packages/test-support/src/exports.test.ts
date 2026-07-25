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
    expect(fixtures.participantTicketFixtures.valid?.ticket.status).toBe(
      'valid',
    );
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
  });
});
