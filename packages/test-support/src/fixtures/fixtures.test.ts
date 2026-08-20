import {
  activationClaimResponseSchema,
  activationLandingResponseSchema,
  defineApiProblemSchema,
  identityBootstrapResponseSchema,
  identityPrivacyRequestResponseSchema,
  identityProfileUpdateResponseSchema,
  participantAgendaMutationResponseSchema,
  participantAgendaResponseSchema,
  participantAnnouncementDetailResponseSchema,
  participantAnnouncementInboxResponseSchema,
  participantAnnouncementReadResponseSchema,
  participantContentResponseSchema,
  participantProgramResponseSchema,
  sessionExpiredProblemSchema,
} from '@byzon/domain/contracts';
import { describe, expect, it } from 'vitest';

import {
  activationClaimFixtures,
  activationFixtureCode,
  activationFixtureRecoveryCode,
  activationLandingFixtures,
  agendaFixtureIds,
  announcementFixtureIds,
  baseProblemFixture,
  baseProblemFixtureFactory,
  fixtureContextName,
  fixtureContextMatrix,
  fixtureEventPhases,
  fixtureEventRoles,
  identityBootstrapFixtures,
  identityPrivacyRequestFixtures,
  identityPrivacyRequestProblemFixtures,
  identityProfileUpdateFixtures,
  identityProfileUpdateProblemFixtures,
  participantContentFixtures,
  participantContentProblemFixtures,
  participantAgendaFixtures,
  participantAgendaMutationFixtures,
  participantAgendaMutationProblemFixtures,
  participantAgendaProblemFixtures,
  participantAnnouncementDetailFixtures,
  participantAnnouncementDetailProblemFixtures,
  participantAnnouncementInboxFixtures,
  participantAnnouncementInboxProblemFixtures,
  participantAnnouncementReadFixtures,
  participantAnnouncementReadProblemFixtures,
  participantProgramFixtures,
  participantProgramProblemFixtures,
  participantTicketFixtures,
  participantTicketProblemFixtures,
  selectFixtureContexts,
  sessionExpiredProblemFixture,
} from './index.js';

describe('base problem fixtures', () => {
  it('conforms to exact shared problem contracts', () => {
    expect(
      defineApiProblemSchema('INTERNAL_ERROR', 500).parse(baseProblemFixture),
    ).toEqual(baseProblemFixture);
    expect(
      sessionExpiredProblemSchema.parse(sessionExpiredProblemFixture),
    ).toEqual(sessionExpiredProblemFixture);
  });

  it('uses stable synthetic request IDs and deterministic variants', () => {
    const first = baseProblemFixtureFactory.create('repeatable');
    const second = baseProblemFixtureFactory.create('repeatable');

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain('@');
  });
});

describe('activation fixtures', () => {
  it('validates anonymous and pending flows without a real session', () => {
    expect(
      activationLandingResponseSchema.parse(
        activationLandingFixtures.anonymous,
      ),
    ).toEqual(activationLandingFixtures.anonymous);
    expect(
      activationClaimResponseSchema.parse(
        activationClaimFixtures.identity_required,
      ),
    ).toEqual(activationClaimFixtures.identity_required);
    expect(activationClaimFixtures.identity_required).toMatchObject({
      membershipCreated: false,
      sessionCreated: false,
    });
    expect(activationFixtureCode).toBe('TST-OPAQUE-2026');
    expect(activationFixtureRecoveryCode).toBe('TST-RECOVERY-2026');
  });
});

describe('content fixtures', () => {
  it('uses the production response schemas for happy and empty states', () => {
    expect(
      participantProgramResponseSchema.parse(participantProgramFixtures.happy),
    ).toEqual(participantProgramFixtures.happy);
    expect(
      participantProgramResponseSchema.parse(participantProgramFixtures.empty),
    ).toEqual(participantProgramFixtures.empty);
    expect(
      participantContentResponseSchema.parse(participantContentFixtures.happy),
    ).toEqual(participantContentFixtures.happy);
    expect(
      participantContentResponseSchema.parse(participantContentFixtures.empty),
    ).toEqual(participantContentFixtures.empty);
  });

  it('exposes deterministic permission and domain-error problem states', () => {
    expect(participantProgramProblemFixtures.permission!.code).toBe(
      'PROGRAM_NOT_FOUND',
    );
    expect(participantProgramProblemFixtures.domain_error!.code).toBe(
      'INVALID_PROGRAM_FILTERS',
    );
    expect(participantContentProblemFixtures.permission!.code).toBe(
      'CONTENT_NOT_FOUND',
    );
  });
});

describe('participant agenda fixtures', () => {
  it('keeps every agenda deep link correlated with the published program', () => {
    const publishedSessions = new Map(
      participantProgramFixtures.happy!.program.sessions.map((session) => [
        session.id,
        session,
      ]),
    );
    const agendaSessions = new Map(
      Object.values(participantAgendaFixtures)
        .flatMap((fixture) => fixture?.items ?? [])
        .map(({ session }) => [session.id, session]),
    );

    for (const [sessionId, agendaSession] of agendaSessions) {
      expect(
        publishedSessions.get(sessionId),
        `agenda session ${sessionId} must have a working program detail`,
      ).toMatchObject({
        id: agendaSession.id,
        title: agendaSession.title,
        startsAt: agendaSession.startsAt,
        endsAt: agendaSession.endsAt,
        status: agendaSession.status,
      });
    }
  });

  it('validates every personal, capacity and waitlist state', () => {
    for (const fixture of Object.values(participantAgendaFixtures)) {
      expect(participantAgendaResponseSchema.parse(fixture)).toEqual(fixture);
    }
    expect(participantAgendaFixtures.empty?.items).toHaveLength(0);
    expect(participantAgendaFixtures.saved?.items[0]?.state).toBe('saved');
    expect(participantAgendaFixtures.reserved?.items[0]?.state).toBe(
      'reserved',
    );
    expect(participantAgendaFixtures.waiting?.items[0]).toMatchObject({
      state: 'waitlisted',
      waitlist: { state: 'waiting' },
      action: { state: 'capacity_full' },
    });
    expect(participantAgendaFixtures.offered?.items[0]).toMatchObject({
      waitlist: { state: 'offered' },
      action: { state: 'available' },
      capacity: {
        held: 1,
        remaining: 0,
        actorAvailability: {
          state: 'held_for_participant',
          offerId: agendaFixtureIds.offer,
        },
      },
    });
    expect(participantAgendaFixtures.expired?.items[0]).toMatchObject({
      waitlist: { state: 'expired' },
    });
    expect(
      participantAgendaFixtures.waitlist_cancelled?.items[0],
    ).toMatchObject({
      waitlist: { state: 'cancelled' },
    });
    expect(participantAgendaFixtures.cancelled?.items[0]).toMatchObject({
      session: { status: 'cancelled' },
      action: { state: 'cancelled' },
    });
    expect(participantAgendaFixtures.full?.items[0]?.action.state).toBe(
      'capacity_full',
    );
    expect(participantAgendaFixtures.closed?.items[0]?.action.state).toBe(
      'closed',
    );
  });

  it('returns complete canonical mutation snapshots and explicit problems', () => {
    for (const fixture of Object.values(participantAgendaMutationFixtures)) {
      expect(participantAgendaMutationResponseSchema.parse(fixture)).toEqual(
        fixture,
      );
    }
    expect(participantAgendaMutationFixtures.reserved?.version).toBe(8);
    expect(
      participantAgendaMutationFixtures.idempotent_replay?.mutation.outcome,
    ).toBe('already_applied');
    expect(participantAgendaProblemFixtures.permission?.code).toBe(
      'EVENT_ACCESS_DENIED',
    );
    expect(participantAgendaProblemFixtures.rate_limited?.status).toBe(429);
    expect(
      participantAgendaMutationFixtures.reserved_with_conflict?.timeConflict,
    ).toMatchObject({
      eventId: agendaFixtureIds.event,
      conflictingSessions: [{ eventId: agendaFixtureIds.event }],
    });
    expect(
      participantAgendaMutationProblemFixtures.stale_version,
    ).toMatchObject({
      code: 'STALE_VERSION',
      currentVersion: 8,
    });
    expect(participantAgendaMutationProblemFixtures.offer_expired?.code).toBe(
      'OFFER_EXPIRED',
    );
  });

  it('contains no identity of another participant or credential data', () => {
    const serialized = JSON.stringify({
      snapshots: participantAgendaFixtures,
      mutations: participantAgendaMutationFixtures,
      problems: participantAgendaMutationProblemFixtures,
    });

    expect(serialized).not.toContain('participantEmail');
    expect(serialized).not.toContain('otherUser');
    expect(serialized).not.toContain('ticketCode');
    expect(serialized).not.toContain('"email"');
    expect(serialized).not.toContain(`${agendaFixtureIds.user}@`);
    expect(serialized).not.toContain('example.test');
  });
});

describe('identity account fixtures', () => {
  it('covers editable, read-only and removed account bootstrap states', () => {
    expect(
      identityBootstrapResponseSchema.parse(identityBootstrapFixtures.complete),
    ).toEqual(identityBootstrapFixtures.complete);
    expect(identityBootstrapFixtures.complete?.profileManagement).toEqual({
      state: 'editable',
      version: 1,
    });
    expect(identityBootstrapFixtures.read_only?.profileManagement.state).toBe(
      'read_only',
    );
    expect(identityBootstrapFixtures.removed).toMatchObject({
      profile: null,
      profileManagement: { state: 'removed' },
      privacy: { deletionRequest: 'completed' },
    });
  });

  it('exposes canonical profile and idempotent privacy outcomes', () => {
    expect(
      identityProfileUpdateResponseSchema.parse(
        identityProfileUpdateFixtures.updated,
      ),
    ).toEqual(identityProfileUpdateFixtures.updated);
    expect(
      identityPrivacyRequestResponseSchema.parse(
        identityPrivacyRequestFixtures.deletion_pending,
      ),
    ).toEqual(identityPrivacyRequestFixtures.deletion_pending);
    expect(identityPrivacyRequestFixtures.deletion_pending).toEqual(
      identityPrivacyRequestFixtures.deletion_pending,
    );
    expect(identityBootstrapFixtures.read_only?.privacy).toEqual({
      deletionRequest: 'unavailable',
    });
    expect(identityProfileUpdateProblemFixtures.stale).toMatchObject({
      code: 'STALE_VERSION',
      currentVersion: 2,
    });
    expect(identityPrivacyRequestProblemFixtures.key_reused?.code).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
  });
});

describe('participant announcement fixtures', () => {
  it('validates inbox, detail and read states against production schemas', () => {
    expect(
      participantAnnouncementInboxResponseSchema.parse(
        participantAnnouncementInboxFixtures.happy,
      ),
    ).toEqual(participantAnnouncementInboxFixtures.happy);
    expect(
      participantAnnouncementDetailResponseSchema.parse(
        participantAnnouncementDetailFixtures.critical,
      ),
    ).toEqual(participantAnnouncementDetailFixtures.critical);
    expect(
      participantAnnouncementReadResponseSchema.parse(
        participantAnnouncementReadFixtures.success,
      ),
    ).toEqual(participantAnnouncementReadFixtures.success);
  });

  it('correlates event and session context with published content fixtures', () => {
    expect(announcementFixtureIds.event).toBe(
      participantContentFixtures.happy?.eventId,
    );
    expect(
      participantAnnouncementDetailFixtures.critical?.announcement.context,
    ).toMatchObject({
      kind: 'session',
      session: { id: announcementFixtureIds.session },
    });
  });

  it('covers empty filters, long Czech content and endpoint problems', () => {
    expect(participantAnnouncementInboxFixtures.empty?.items).toHaveLength(0);
    expect(
      participantAnnouncementInboxFixtures.empty_unread?.items,
    ).toHaveLength(0);
    expect(participantAnnouncementInboxFixtures.first_page?.pageInfo).toEqual({
      nextCursor: announcementFixtureIds.nextCursor,
      hasMore: true,
    });
    expect(participantAnnouncementInboxFixtures.second_page?.pageInfo).toEqual({
      nextCursor: null,
      hasMore: false,
    });
    expect(
      participantAnnouncementInboxFixtures.long_content?.items[0]?.summary
        .length,
    ).toBeGreaterThan(450);
    expect(
      participantAnnouncementDetailFixtures.long_content?.announcement.bodyText
        .length,
    ).toBeGreaterThan(15_000);
    expect(participantAnnouncementInboxProblemFixtures.disabled?.code).toBe(
      'ANNOUNCEMENTS_DISABLED',
    );
    expect(participantAnnouncementDetailProblemFixtures.not_found?.code).toBe(
      'ANNOUNCEMENT_NOT_FOUND',
    );
    expect(
      participantAnnouncementDetailProblemFixtures.audience_denied,
    ).toEqual(participantAnnouncementDetailProblemFixtures.not_found);
    expect(participantAnnouncementReadProblemFixtures.audience_denied).toEqual(
      participantAnnouncementReadProblemFixtures.not_found,
    );
    expect(participantAnnouncementReadProblemFixtures.in_progress?.code).toBe(
      'IDEMPOTENCY_IN_PROGRESS',
    );
  });

  it('contains no audience, sender or delivery metadata', () => {
    const serialized = JSON.stringify({
      inbox: participantAnnouncementInboxFixtures,
      detail: participantAnnouncementDetailFixtures,
      read: participantAnnouncementReadFixtures,
    });

    expect(serialized).not.toContain('audience');
    expect(serialized).not.toContain('sender');
    expect(serialized).not.toContain('delivery');
    expect(serialized).not.toContain('@');
  });
});

describe('ticket fixtures', () => {
  it('contains only validated synthetic status data without a credential', () => {
    expect(participantTicketFixtures.valid?.ticket.status).toBe('valid');
    expect(participantTicketFixtures.cancelled?.ticket.status).toBe(
      'cancelled',
    );
    expect(participantTicketProblemFixtures.permission?.code).toBe(
      'TICKET_NOT_FOUND',
    );
    expect(JSON.stringify(participantTicketFixtures)).not.toContain(
      'presentationValue',
    );
    expect(JSON.stringify(participantTicketFixtures)).not.toContain('qr');
    expect(JSON.stringify(participantTicketFixtures)).not.toContain('barcode');
  });
});

describe('role and event phase fixtures', () => {
  it('covers every role and phase exactly once per matrix combination', () => {
    expect(fixtureEventRoles).toHaveLength(7);
    expect(fixtureEventPhases).toHaveLength(5);
    expect(fixtureContextMatrix).toHaveLength(35);
    expect(
      new Set(fixtureContextMatrix.map(({ role, phase }) => `${role}:${phase}`))
        .size,
    ).toBe(35);
  });

  it('is deeply frozen so one test cannot mutate another scenario', () => {
    expect(Object.isFrozen(fixtureEventRoles)).toBe(true);
    expect(Object.isFrozen(fixtureEventPhases)).toBe(true);
    expect(Object.isFrozen(fixtureContextMatrix)).toBe(true);
    expect(Object.isFrozen(fixtureContextMatrix[0])).toBe(true);
  });

  it('selects deterministic named subsets for component test matrices', () => {
    const selected = selectFixtureContexts({
      roles: ['participant', 'organizer_admin'],
      phases: ['activation_open', 'live'],
    });

    expect(selected).toEqual([
      { role: 'participant', phase: 'activation_open' },
      { role: 'organizer_admin', phase: 'activation_open' },
      { role: 'participant', phase: 'live' },
      { role: 'organizer_admin', phase: 'live' },
    ]);
    expect(selected.map(fixtureContextName)).toEqual([
      'participant @ activation_open',
      'organizer_admin @ activation_open',
      'participant @ live',
      'organizer_admin @ live',
    ]);
    expect(Object.isFrozen(selected)).toBe(true);
  });
});
