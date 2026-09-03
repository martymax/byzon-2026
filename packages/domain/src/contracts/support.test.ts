import { describe, expect, it } from 'vitest';

import {
  adminParticipantCreateRequestSchema,
  adminParticipantCreateResponseSchema,
  adminParticipantDetailSchema,
  adminParticipantInviteRequestSchema,
  adminParticipantInviteResponseSchema,
  adminParticipantListRequestSchema,
  adminParticipantListResponseSchema,
  adminParticipantUpdateRequestSchema,
  problemTypeForCode,
  supportCachePolicy,
  supportMutationHeadersSchema,
  supportMutationProblemSchema,
  supportMutationRequestSchema,
  supportSearchQuerySchema,
  supportSearchResponseSchema,
  supportTargetTicketSearchProblemSchema,
  supportTargetTicketSearchRequestSchema,
  supportTargetTicketSearchResponseSchema,
} from './index.js';

const ids = {
  event: '019fa100-0000-7000-8000-000000000001',
  participant: '019fa100-0000-7000-8000-000000000002',
  ticket: '019fa100-0000-7000-8000-000000000003',
  participantTwo: '019fa100-0000-7000-8000-000000000004',
  ticketTwo: '019fa100-0000-7000-8000-000000000005',
} as const;

const activeRecord = {
  eventId: ids.event,
  participantId: ids.participant,
  ticketId: ids.ticket,
  displayName: 'Syntetický účastník',
  maskedContact: 's•••@example.test',
  referenceSuffix: 'T001',
  ticketState: 'active' as const,
  accessState: 'claimed' as const,
  version: 3,
  availableActions: ['resend', 'reassign', 'block', 'transfer'] as const,
};

describe('CS-SUPPORT-01 contracts', () => {
  it('supports an initial participant list, filters and complete editable detail', () => {
    const listItem = {
      eventId: ids.event,
      participantId: ids.participant,
      ticketId: ids.ticket,
      displayName: 'Syntetický účastník',
      contactEmail: 'synteticky@example.test',
      company: 'Future Works',
      jobTitle: 'CEO',
      referenceSuffix: 'T001',
      ticketState: 'active' as const,
      accessState: 'claimed' as const,
      networkingState: 'enabled' as const,
      invitation: {
        status: 'accepted' as const,
        lastSentAt: '2026-08-20T09:55:00.000Z',
      },
      checkedIn: true,
      reservationCount: 2,
      profileVersion: 1,
      ticketVersion: 3,
      updatedAt: '2026-09-02T10:00:00.000Z',
      availableActions: ['block'] as const,
    };
    expect(adminParticipantListRequestSchema.parse({})).toEqual({
      query: '',
      ticketStates: [],
      networkingStates: [],
      limit: 100,
      offset: 0,
    });
    expect(
      adminParticipantListResponseSchema.parse({
        eventId: ids.event,
        generatedAt: '2026-09-02T10:00:00.000Z',
        items: [listItem],
        pageInfo: { total: 1, offset: 0, hasMore: false },
        summary: {
          total: 1,
          active: 1,
          networkingEnabled: 1,
          checkedIn: 1,
        },
      }).items,
    ).toHaveLength(1);

    const detail = adminParticipantDetailSchema.parse({
      eventId: ids.event,
      participantId: ids.participant,
      ticketId: ids.ticket,
      firstName: 'Syntetický',
      lastName: 'Účastník',
      contactEmail: 'synteticky@example.test',
      phone: '+420777123456',
      company: 'Future Works',
      jobTitle: 'CEO',
      introduction: 'Hledám nové obchodní partnery.',
      linkedinUrl: 'https://www.linkedin.com/in/synthetic',
      todayHunting: ['business_partners'],
      networkingEnabled: true,
      moderationStatus: 'visible',
      onboardingCompleted: true,
      membershipStatus: 'active',
      invitation: {
        status: 'accepted',
        lastSentAt: '2026-08-20T09:55:00.000Z',
      },
      ticket: {
        source: 'ticket',
        referenceSuffix: 'T001',
        externalId: 'ticket-1',
        orderExternalId: 'order-1',
        state: 'active',
        claimedAt: '2026-08-20T10:00:00.000Z',
        version: 3,
        availableActions: ['block'],
      },
      checkIn: { occurredAt: '2026-09-02T08:00:00.000Z' },
      reservations: [],
      profileVersion: 1,
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
    });
    expect(
      adminParticipantUpdateRequestSchema.parse({
        participantId: ids.participant,
        expectedProfileVersion: detail.profileVersion,
        reason: 'Oprava na žádost účastníka.',
        profile: {
          firstName: detail.firstName,
          lastName: detail.lastName,
          contactEmail: detail.contactEmail,
          phone: detail.phone,
          company: detail.company,
          jobTitle: detail.jobTitle,
          introduction: detail.introduction,
          linkedinUrl: detail.linkedinUrl,
          todayHunting: detail.todayHunting,
          networkingEnabled: detail.networkingEnabled,
          moderationStatus: detail.moderationStatus,
        },
      }).profile.networkingEnabled,
    ).toBe(true);
  });

  it('validates manual participant creation and its audited result', () => {
    const request = adminParticipantCreateRequestSchema.parse({
      reason: 'Registrace hosta mimo SimpleShop.',
      profile: {
        firstName: 'Ruční',
        lastName: 'Účastník',
        contactEmail: ' RUCNI@example.test ',
        phone: null,
        company: '',
        jobTitle: '',
      },
    });
    expect(request.profile.contactEmail).toBe('rucni@example.test');

    const detail = adminParticipantDetailSchema.parse({
      eventId: ids.event,
      participantId: ids.participant,
      ticketId: ids.ticket,
      firstName: request.profile.firstName,
      lastName: request.profile.lastName,
      contactEmail: request.profile.contactEmail,
      phone: null,
      company: '',
      jobTitle: '',
      introduction: '',
      linkedinUrl: null,
      todayHunting: [],
      networkingEnabled: false,
      moderationStatus: 'visible',
      onboardingCompleted: false,
      membershipStatus: 'active',
      invitation: { status: 'not_sent', lastSentAt: null },
      ticket: {
        source: 'ticket',
        referenceSuffix: 'M1234567',
        externalId: null,
        orderExternalId: null,
        state: 'active',
        claimedAt: '2026-09-02T10:00:00.000Z',
        version: 1,
        availableActions: ['block'],
      },
      checkIn: null,
      reservations: [],
      profileVersion: 1,
      createdAt: '2026-09-02T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z',
    });
    expect(
      adminParticipantCreateResponseSchema.parse({
        eventId: ids.event,
        outcome: 'created',
        detail,
        createdAt: '2026-09-02T10:00:00.000Z',
        audit: { auditId: ids.ticketTwo },
      }).detail.invitation.status,
    ).toBe('not_sent');
    expect(
      adminParticipantCreateRequestSchema.safeParse({
        ...request,
        reason: 'krátké',
      }).success,
    ).toBe(false);
  });

  it('binds a sent invitation receipt to one participant and delivery time', () => {
    expect(
      adminParticipantInviteRequestSchema.parse({
        participantId: ids.participant,
      }),
    ).toEqual({ participantId: ids.participant });
    expect(
      adminParticipantInviteResponseSchema.parse({
        eventId: ids.event,
        participantId: ids.participant,
        outcome: 'sent',
        sentAt: '2026-09-02T10:00:00.000Z',
        invitation: {
          status: 'sent',
          lastSentAt: '2026-09-02T10:00:00.000Z',
        },
        audit: { auditId: ids.ticketTwo },
      }).invitation.status,
    ).toBe('sent');
    expect(
      adminParticipantInviteResponseSchema.safeParse({
        eventId: ids.event,
        participantId: ids.participant,
        outcome: 'sent',
        sentAt: '2026-09-02T10:00:00.000Z',
        invitation: { status: 'not_sent', lastSentAt: null },
        audit: { auditId: ids.ticketTwo },
      }).success,
    ).toBe(false);
  });

  it('validates bounded no/single/ambiguous search outcomes', () => {
    expect(
      supportSearchQuerySchema.parse({ query: 'syntetický', limit: 5 }),
    ).toEqual({ query: 'syntetický', limit: 5 });
    expect(
      supportSearchResponseSchema.parse({
        eventId: ids.event,
        limitedTo: 5,
        outcome: 'no_match',
        matches: [],
      }).outcome,
    ).toBe('no_match');
    expect(
      supportSearchResponseSchema.parse({
        eventId: ids.event,
        limitedTo: 5,
        outcome: 'single_match',
        matches: [activeRecord],
      }).outcome,
    ).toBe('single_match');
    expect(
      supportSearchResponseSchema.parse({
        eventId: ids.event,
        limitedTo: 5,
        outcome: 'ambiguous',
        matches: [
          activeRecord,
          {
            ...activeRecord,
            participantId: ids.participantTwo,
            ticketId: ids.ticketTwo,
            referenceSuffix: 'T002',
          },
        ],
      }).outcome,
    ).toBe('ambiguous');
    expect(
      supportSearchResponseSchema.safeParse({
        eventId: ids.event,
        limitedTo: 5,
        outcome: 'single_match',
        matches: [activeRecord, activeRecord],
      }).success,
    ).toBe(false);
  });

  it('keeps operational PII masked and private/no-store', () => {
    expect(supportCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      browserPersistence: 'forbidden',
      sharedCache: 'forbidden',
      searchMutation: 'none',
      supportMutation: 'online-only',
      mutationIdempotency: 'required',
    });
    expect(
      supportSearchResponseSchema.safeParse({
        eventId: ids.event,
        limitedTo: 5,
        outcome: 'single_match',
        matches: [
          {
            ...activeRecord,
            maskedContact: 'person@example.test',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('defines a reference-based target picker with no, ambiguous and stale branches', () => {
    expect(
      supportTargetTicketSearchRequestSchema.parse({
        sourceTicketId: ids.ticket,
        sourceExpectedVersion: 3,
        reference: 'T002',
        limit: 5,
      }),
    ).toMatchObject({ reference: 'T002' });
    expect(
      supportTargetTicketSearchRequestSchema.safeParse({
        sourceTicketId: ids.ticket,
        sourceExpectedVersion: 3,
        reference: ids.ticketTwo,
        targetTicketId: ids.ticketTwo,
      }).success,
    ).toBe(false);

    const candidate = {
      eventId: ids.event,
      ticketId: ids.ticketTwo,
      maskedContact: 't•••@example.test',
      referenceSuffix: 'T002',
      ticketState: 'active' as const,
      accessState: 'claimed' as const,
      version: 2,
    };
    expect(
      supportTargetTicketSearchResponseSchema.parse({
        eventId: ids.event,
        sourceTicketId: ids.ticket,
        sourceVersion: 3,
        limitedTo: 5,
        outcome: 'ambiguous',
        candidates: [
          candidate,
          {
            ...candidate,
            ticketId: '019fa100-0000-7000-8000-000000000006',
            referenceSuffix: 'T003',
          },
        ],
      }).outcome,
    ).toBe('ambiguous');
    expect(
      supportTargetTicketSearchResponseSchema.safeParse({
        eventId: ids.event,
        sourceTicketId: ids.ticket,
        sourceVersion: 3,
        limitedTo: 5,
        outcome: 'single_match',
        candidates: [{ ...candidate, maskedContact: 'target@example.test' }],
      }).success,
    ).toBe(false);
    expect(
      supportTargetTicketSearchProblemSchema.parse({
        type: problemTypeForCode('STALE_VERSION'),
        title: 'Source changed',
        status: 409,
        code: 'STALE_VERSION',
        detail: 'Reload the source record.',
        requestId: 'support-target-test',
        currentVersion: 4,
      }).code,
    ).toBe('STALE_VERSION');
  });

  it('requires reason/version/target while deriving actor authority server-side', () => {
    const blockRequest = {
      participantId: ids.participant,
      ticketId: ids.ticket,
      action: 'block' as const,
      expectedVersion: 3,
      reason: 'Potvrzená bezpečná blokace vstupenky.',
      targetTicketId: null,
    };

    expect(supportMutationRequestSchema.parse(blockRequest)).toEqual(
      blockRequest,
    );
    expect(
      supportMutationRequestSchema.safeParse({
        ...blockRequest,
        action: 'transfer',
      }).success,
    ).toBe(false);
    expect(
      supportMutationRequestSchema.safeParse({
        ...blockRequest,
        actorRole: 'organizer_admin',
        assignedSessionIds: [],
      }).success,
    ).toBe(false);
    expect(
      supportMutationHeadersSchema.parse({
        idempotencyKey: 'support-mutation-0001',
      }),
    ).toEqual({ idempotencyKey: 'support-mutation-0001' });
  });

  it('enumerates stale and invalid-transition problems', () => {
    const stale = {
      type: problemTypeForCode('STALE_VERSION'),
      title: 'Support record is stale',
      status: 409,
      code: 'STALE_VERSION',
      detail: 'Reload the canonical support record.',
      requestId: 'request-support-0001',
      currentVersion: 4,
    };

    expect(supportMutationProblemSchema.parse(stale)).toEqual(stale);
    expect(
      supportMutationProblemSchema.safeParse({
        ...stale,
        type: problemTypeForCode('SUPPORT_UNSAFE_OVERRIDE'),
        code: 'SUPPORT_UNSAFE_OVERRIDE',
      }).success,
    ).toBe(false);
  });
});
