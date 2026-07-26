import { describe, expect, it } from 'vitest';

import {
  agendaMutationActionSchema,
  agendaTimeConflictWarningSchema,
  participantAgendaCachePolicy,
  participantAgendaMutationHeadersSchema,
  participantAgendaMutationProblemSchema,
  participantAgendaMutationRequestSchema,
  participantAgendaMutationResponseSchema,
  participantAgendaProblemSchema,
  participantAgendaResponseSchema,
  problemTypeForCode,
} from './index.js';

const ids = {
  event: '01920000-0000-7000-8000-000000000001',
  otherEvent: '01920000-0000-7000-8000-000000000002',
  user: '01920000-0000-7000-8000-000000000003',
  session: '01920000-0000-7000-8000-000000000004',
  otherSession: '01920000-0000-7000-8000-000000000005',
  room: '01920000-0000-7000-8000-000000000006',
  reservation: '01920000-0000-7000-8000-000000000007',
  waitlist: '01920000-0000-7000-8000-000000000008',
  offer: '01920000-0000-7000-8000-000000000009',
} as const;

const day = {
  localDate: '2026-09-18',
  title: 'Pátek',
};

const session = {
  id: ids.session,
  eventId: ids.event,
  title: 'Růst bez zkratek',
  startsAt: '2026-09-18T09:00:00.000+02:00',
  endsAt: '2026-09-18T10:00:00.000+02:00',
  room: {
    id: ids.room,
    name: 'Vltava',
  },
  status: 'published' as const,
  calendar: {
    uid: `${ids.session}@agenda.byzon.invalid`,
    sequence: 3,
  },
};

const reservationCapacity = {
  mode: 'reservation' as const,
  capacity: 10,
  confirmed: 9,
  held: 0,
  remaining: 1,
  waitlistAvailable: true,
  actorAvailability: { state: 'available' as const },
};

const savedItem = {
  day,
  session,
  capacity: { mode: 'none' as const },
  action: { state: 'available' as const },
  state: 'saved' as const,
  source: 'manual' as const,
  savedAt: '2026-09-18T05:45:00.000Z',
};

const reservedItem = {
  day,
  session,
  capacity: reservationCapacity,
  action: { state: 'available' as const },
  state: 'reserved' as const,
  reservation: {
    id: ids.reservation,
    version: 1,
    confirmedAt: '2026-09-18T05:50:00.000Z',
  },
};

const offeredItem = {
  day,
  session,
  capacity: {
    ...reservationCapacity,
    held: 1,
    remaining: 0,
    actorAvailability: {
      state: 'held_for_participant' as const,
      offerId: ids.offer,
      expiresAt: '2026-09-18T06:45:00.000Z',
    },
  },
  action: { state: 'available' as const },
  state: 'waitlisted' as const,
  waitlist: {
    id: ids.waitlist,
    state: 'offered' as const,
    joinedAt: '2026-09-18T05:00:00.000Z',
    offerId: ids.offer,
    offeredAt: '2026-09-18T06:00:00.000Z',
    expiresAt: '2026-09-18T06:45:00.000Z',
  },
};

const response = {
  eventId: ids.event,
  userId: ids.user,
  eventTimezone: 'Europe/Prague',
  serverNow: '2026-09-18T06:30:00.000Z',
  version: 7,
  publicationVersion: 3,
  items: [savedItem],
  calendarExport: {
    state: 'available' as const,
    href: '/api/v1/me/agenda.ics' as const,
  },
};

const problem = <Code extends string, Status extends number>(
  code: Code,
  status: Status,
) => ({
  type: problemTypeForCode(code),
  title: 'Agenda problem',
  status,
  code,
  detail: 'Synthetic agenda request could not be completed.',
  requestId: 'request-agenda-0001',
});

describe('CS-AGENDA-01 participant contracts', () => {
  it('declares a private event/user boundary and online idempotent mutations', () => {
    expect(participantAgendaCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      vary: ['authorization', 'cookie'],
      scope: 'event-user',
      offlineRead: 'requires-offline-contract-v1-owner-lease',
      browserPersistence: 'offline-contract-v1-feature-gated',
      mutation: 'online-only',
      idempotency: 'required',
    });
    expect(
      participantAgendaMutationHeadersSchema.parse({
        idempotencyKey: 'agenda-mutation-0001',
      }),
    ).toEqual({ idempotencyKey: 'agenda-mutation-0001' });
    expect(
      participantAgendaMutationHeadersSchema.safeParse({
        idempotencyKey: 'short',
      }).success,
    ).toBe(false);
    expect(
      participantAgendaMutationHeadersSchema.safeParse({
        idempotencyKey: 'agenda-mutation-0001',
        authorization: 'must-not-enter-runtime-contract',
      }).success,
    ).toBe(false);
  });

  it('accepts only the explicit mutation state machine and expected version', () => {
    const simpleActions = [
      'add',
      'remove',
      'reserve',
      'cancel',
      'join_waitlist',
      'leave_waitlist',
    ] as const;

    expect(agendaMutationActionSchema.options).toEqual([
      ...simpleActions,
      'accept_offer',
      'decline_offer',
      'registration_estimate',
    ]);
    simpleActions.forEach((action) => {
      expect(
        participantAgendaMutationRequestSchema.parse({
          sessionId: ids.session,
          action,
          expectedVersion: 7,
        }),
      ).toEqual({
        sessionId: ids.session,
        action,
        expectedVersion: 7,
      });
    });
    for (const action of ['accept_offer', 'decline_offer'] as const) {
      expect(
        participantAgendaMutationRequestSchema.parse({
          sessionId: ids.session,
          action,
          offerId: ids.offer,
          expectedVersion: 7,
        }),
      ).toMatchObject({ action, offerId: ids.offer });
    }
    expect(
      participantAgendaMutationRequestSchema.parse({
        sessionId: ids.session,
        action: 'registration_estimate',
        registered: false,
        expectedVersion: 7,
      }),
    ).toMatchObject({
      action: 'registration_estimate',
      registered: false,
    });
    expect(
      participantAgendaMutationRequestSchema.safeParse({
        sessionId: ids.session,
        action: 'accept_offer',
        expectedVersion: 7,
      }).success,
    ).toBe(false);
    expect(
      participantAgendaMutationRequestSchema.safeParse({
        sessionId: ids.session,
        action: 'registration_estimate',
        expectedVersion: 7,
      }).success,
    ).toBe(false);
    expect(
      participantAgendaMutationRequestSchema.safeParse({
        sessionId: ids.session,
        action: 'reserve',
        expectedVersion: 0,
      }).success,
    ).toBe(false);
    expect(
      participantAgendaMutationRequestSchema.safeParse({
        sessionId: ids.session,
        action: 'reserve',
        expectedVersion: 7,
        participantId: ids.user,
      }).success,
    ).toBe(false);
  });

  it('validates canonical saved, reserved and offered snapshots', () => {
    expect(participantAgendaResponseSchema.parse(response)).toEqual(response);
    expect(
      participantAgendaResponseSchema.parse({
        ...response,
        items: [reservedItem],
      }).items[0]?.state,
    ).toBe('reserved');
    expect(
      participantAgendaResponseSchema.parse({
        ...response,
        items: [offeredItem],
      }).items[0],
    ).toMatchObject({
      state: 'waitlisted',
      waitlist: { state: 'offered' },
      action: { state: 'available' },
    });
    expect(
      participantAgendaResponseSchema.parse({
        ...response,
        items: [],
        calendarExport: { state: 'unavailable', reason: 'empty' },
      }),
    ).toMatchObject({ items: [], calendarExport: { reason: 'empty' } });
  });

  it('derives agenda days from the event timezone across UTC midnight', () => {
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        eventTimezone: 'UTC',
      }).success,
    ).toBe(true);
    const lateUtcSession = {
      ...session,
      startsAt: '2026-09-18T23:30:00.000Z',
      endsAt: '2026-09-19T00:15:00.000Z',
    };
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        items: [
          {
            ...savedItem,
            day: { ...day, localDate: '2026-09-19' },
            session: lateUtcSession,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        items: [{ ...savedItem, session: lateUtcSession }],
      }).success,
    ).toBe(false);

    const daylightSavingSession = {
      ...session,
      startsAt: '2026-03-29T00:30:00.000Z',
      endsAt: '2026-03-29T01:30:00.000Z',
    };
    const daylightSavingResponse = {
      ...response,
      serverNow: '2026-03-28T22:00:00.000Z',
      items: [
        {
          ...savedItem,
          savedAt: '2026-03-28T21:30:00.000Z',
          day: { ...day, localDate: '2026-03-29' },
          session: daylightSavingSession,
        },
      ],
    };
    expect(
      participantAgendaResponseSchema.safeParse(daylightSavingResponse).success,
    ).toBe(true);
    expect(
      participantAgendaResponseSchema.safeParse({
        ...daylightSavingResponse,
        items: [
          {
            ...daylightSavingResponse.items[0],
            day: { ...day, localDate: '2026-03-28' },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        eventTimezone: 'Europe/Not_A_Real_Zone',
      }).success,
    ).toBe(false);
  });

  it('requires stable non-injectable calendar identity and bounded sequence', () => {
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        publicationVersion: 4,
        items: [
          {
            ...savedItem,
            session: {
              ...session,
              calendar: { ...session.calendar, sequence: 4 },
            },
          },
        ],
      }).success,
    ).toBe(true);
    for (const calendar of [
      { uid: `unsafe\r\nATTENDEE:foreign@example.test`, sequence: 3 },
      { uid: 'not-globally-namespaced', sequence: 3 },
      { uid: session.calendar.uid, sequence: -1 },
    ]) {
      expect(
        participantAgendaResponseSchema.safeParse({
          ...response,
          items: [
            {
              ...savedItem,
              session: { ...session, calendar },
            },
          ],
        }).success,
      ).toBe(false);
    }
  });

  it('rejects cross-event, duplicate, unordered and private foreign identity data', () => {
    const laterSession = {
      ...session,
      id: ids.otherSession,
      startsAt: '2026-09-18T11:00:00.000+02:00',
      endsAt: '2026-09-18T12:00:00.000+02:00',
    };
    const laterItem = {
      ...savedItem,
      session: laterSession,
    };

    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        items: [laterItem, savedItem],
      }).success,
    ).toBe(false);
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        items: [savedItem, savedItem],
      }).success,
    ).toBe(false);
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        items: [
          {
            ...savedItem,
            session: { ...session, eventId: ids.otherEvent },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        otherParticipantId: ids.otherSession,
      }).success,
    ).toBe(false);
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        items: [
          {
            ...savedItem,
            participantEmail: 'other@example.test',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('enforces day, status, action and capacity invariants', () => {
    const invalidResponses = [
      {
        ...response,
        items: [
          {
            ...savedItem,
            day: { ...day, localDate: '2026-09-19' },
          },
        ],
      },
      {
        ...response,
        items: [
          {
            ...savedItem,
            session: { ...session, status: 'cancelled' },
          },
        ],
      },
      {
        ...response,
        items: [
          {
            ...savedItem,
            capacity: {
              ...reservationCapacity,
              remaining: 0,
            },
            action: { state: 'available' },
          },
        ],
      },
      {
        ...response,
        items: [
          {
            ...savedItem,
            capacity: {
              ...reservationCapacity,
              confirmed: 10,
              remaining: 1,
            },
          },
        ],
      },
      {
        ...response,
        items: [
          {
            ...reservedItem,
            capacity: { mode: 'none' },
          },
        ],
      },
      {
        ...response,
        items: [
          {
            ...savedItem,
            capacity: {
              mode: 'registration_estimate',
              registrations: 12,
            },
            action: {
              state: 'available',
            },
          },
        ],
      },
    ];

    invalidResponses.forEach((invalidResponse) => {
      expect(
        participantAgendaResponseSchema.safeParse(invalidResponse).success,
      ).toBe(false);
    });
  });

  it('derives active and expired offers from serverNow, never client time', () => {
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        serverNow: '2026-09-18T06:45:00.000Z',
        items: [offeredItem],
      }).success,
    ).toBe(false);
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        items: [
          {
            ...offeredItem,
            waitlist: {
              ...offeredItem.waitlist,
              state: 'expired',
              expiredAt: '2026-09-18T06:46:00.000Z',
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        serverNow: '2026-09-18T06:46:00.000Z',
        items: [
          {
            ...offeredItem,
            action: { state: 'capacity_full' },
            capacity: {
              ...reservationCapacity,
              confirmed: 10,
              held: 0,
              remaining: 0,
              actorAvailability: { state: 'unavailable' },
            },
            waitlist: {
              ...offeredItem.waitlist,
              state: 'expired',
              expiredAt: '2026-09-18T06:46:00.000Z',
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('represents a cancelled registration-estimate session without contradiction', () => {
    expect(
      participantAgendaResponseSchema.safeParse({
        ...response,
        items: [
          {
            ...savedItem,
            session: { ...session, status: 'cancelled' },
            capacity: {
              mode: 'registration_estimate',
              registrations: 24,
            },
            action: { state: 'cancelled' },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('returns a complete canonical snapshot after every mutation', () => {
    const mutationResponse = {
      ...response,
      version: 8,
      items: [reservedItem],
      mutation: {
        sessionId: ids.session,
        action: 'reserve' as const,
        outcome: 'applied' as const,
      },
      timeConflict: null,
    };

    expect(
      participantAgendaMutationResponseSchema.parse(mutationResponse),
    ).toEqual(mutationResponse);
    expect(
      participantAgendaMutationResponseSchema.safeParse({
        ...mutationResponse,
        capacity: reservationCapacity,
      }).success,
    ).toBe(false);
    for (const mutation of [
      {
        sessionId: ids.session,
        action: 'add' as const,
        outcome: 'applied' as const,
      },
      {
        sessionId: ids.session,
        action: 'leave_waitlist' as const,
        outcome: 'applied' as const,
      },
      {
        sessionId: ids.session,
        action: 'decline_offer' as const,
        offerId: ids.offer,
        outcome: 'applied' as const,
      },
    ]) {
      expect(
        participantAgendaMutationResponseSchema.safeParse({
          ...mutationResponse,
          mutation,
        }).success,
      ).toBe(false);
    }
  });

  it('accepts canonical removal of source-less reservation and waitlist projections', () => {
    const releasedSnapshot = {
      ...response,
      version: 8,
      items: [],
      calendarExport: {
        state: 'unavailable' as const,
        reason: 'empty' as const,
      },
      timeConflict: null,
    };
    const releases = [
      {
        sessionId: ids.session,
        action: 'cancel' as const,
        outcome: 'applied' as const,
      },
      {
        sessionId: ids.session,
        action: 'leave_waitlist' as const,
        outcome: 'applied' as const,
      },
      {
        sessionId: ids.session,
        action: 'decline_offer' as const,
        offerId: ids.offer,
        outcome: 'applied' as const,
      },
    ];

    for (const mutation of releases) {
      expect(
        participantAgendaMutationResponseSchema.safeParse({
          ...releasedSnapshot,
          mutation,
        }).success,
      ).toBe(true);
    }
  });

  it('accepts a canonical terminal waitlist after leaving or declining', () => {
    const cancelledWaitlistItem = {
      ...offeredItem,
      capacity: reservationCapacity,
      waitlist: {
        id: ids.waitlist,
        state: 'cancelled' as const,
        joinedAt: offeredItem.waitlist.joinedAt,
        cancelledAt: response.serverNow,
      },
    };
    for (const mutation of [
      {
        sessionId: ids.session,
        action: 'leave_waitlist' as const,
        outcome: 'applied' as const,
      },
      {
        sessionId: ids.session,
        action: 'decline_offer' as const,
        offerId: ids.offer,
        outcome: 'applied' as const,
      },
    ]) {
      expect(
        participantAgendaMutationResponseSchema.safeParse({
          ...response,
          version: 8,
          items: [cancelledWaitlistItem],
          mutation,
          timeConflict: null,
        }).success,
      ).toBe(true);
    }
  });

  it('validates bounded canonical conflict warnings and every explicit problem family', () => {
    const targetSession = {
      ...session,
      id: ids.otherSession,
      startsAt: '2026-09-18T09:30:00.000+02:00',
      endsAt: '2026-09-18T10:30:00.000+02:00',
      calendar: {
        uid: `${ids.otherSession}@agenda.byzon.invalid`,
        sequence: 3,
      },
    };
    const conflict = {
      eventId: ids.event,
      sessionId: ids.otherSession,
      targetSession,
      conflictingSessions: [session],
    };
    const targetReservedItem = {
      ...reservedItem,
      session: targetSession,
      reservation: {
        ...reservedItem.reservation,
        id: ids.offer,
      },
    };
    const conflictResponse = {
      ...response,
      version: 8,
      items: [savedItem, targetReservedItem],
      mutation: {
        sessionId: ids.otherSession,
        action: 'reserve' as const,
        outcome: 'applied' as const,
      },
      timeConflict: conflict,
    };

    expect(
      participantAgendaMutationResponseSchema.parse(conflictResponse),
    ).toEqual(conflictResponse);
    expect(
      participantAgendaMutationResponseSchema.safeParse({
        ...conflictResponse,
        timeConflict: {
          ...conflict,
          targetSession: {
            ...targetSession,
            calendar: { ...targetSession.calendar, sequence: 2 },
          },
        },
      }).success,
    ).toBe(false);
    expect(
      agendaTimeConflictWarningSchema.safeParse({
        ...conflict,
        conflictingSessions: [
          {
            ...session,
            eventId: ids.otherEvent,
          },
        ],
      }).success,
    ).toBe(false);
    const equivalentOffsetConflict = {
      ...session,
      id: ids.reservation,
      startsAt: '2026-09-18T08:00:00.000+01:00',
      endsAt: '2026-09-18T09:00:00.000+01:00',
      calendar: {
        uid: `${ids.reservation}@agenda.byzon.invalid`,
        sequence: 3,
      },
    };
    expect(
      agendaTimeConflictWarningSchema.safeParse({
        ...conflict,
        conflictingSessions: [equivalentOffsetConflict, session],
      }).success,
    ).toBe(false);
    expect(
      participantAgendaMutationResponseSchema.safeParse({
        ...conflictResponse,
        timeConflict: {
          ...conflict,
          conflictingSessions: [{ ...session, title: 'Stale title' }],
        },
      }).success,
    ).toBe(false);
    expect(
      agendaTimeConflictWarningSchema.safeParse({
        ...conflict,
        conflictingSessions: [session, session],
      }).success,
    ).toBe(false);
    expect(
      agendaTimeConflictWarningSchema.safeParse({
        ...conflict,
        conflictingSessions: [
          {
            ...session,
            startsAt: '2026-09-18T11:00:00.000+02:00',
            endsAt: '2026-09-18T12:00:00.000+02:00',
          },
        ],
      }).success,
    ).toBe(false);
    const secondConflict = {
      ...session,
      id: ids.reservation,
      startsAt: '2026-09-18T09:15:00.000+02:00',
      endsAt: '2026-09-18T09:45:00.000+02:00',
      calendar: {
        uid: `${ids.reservation}@agenda.byzon.invalid`,
        sequence: 3,
      },
    };
    expect(
      agendaTimeConflictWarningSchema.safeParse({
        ...conflict,
        conflictingSessions: [secondConflict, session],
      }).success,
    ).toBe(false);
    expect(
      agendaTimeConflictWarningSchema.safeParse({
        ...conflict,
        conflictingSessions: [
          {
            ...session,
            participant: {
              id: ids.user,
              email: 'other@example.test',
            },
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      participantAgendaProblemSchema.parse(
        problem('AUTHENTICATION_REQUIRED', 401),
      ).code,
    ).toBe('AUTHENTICATION_REQUIRED');
    expect(
      participantAgendaMutationProblemSchema.parse({
        ...problem('STALE_VERSION', 409),
        currentVersion: 8,
        agenda: { ...response, version: 8 },
      }).code,
    ).toBe('STALE_VERSION');
    const expiredItem = {
      ...offeredItem,
      action: { state: 'capacity_full' as const },
      capacity: {
        ...reservationCapacity,
        confirmed: 10,
        held: 0,
        remaining: 0,
        actorAvailability: { state: 'unavailable' as const },
      },
      waitlist: {
        ...offeredItem.waitlist,
        state: 'expired' as const,
        expiredAt: '2026-09-18T06:46:00.000Z',
      },
    };
    expect(
      participantAgendaMutationProblemSchema.parse({
        ...problem('OFFER_EXPIRED', 409),
        sessionId: ids.session,
        offerId: ids.offer,
        serverNow: '2026-09-18T06:46:00.000Z',
        agenda: {
          ...response,
          serverNow: '2026-09-18T06:46:00.000Z',
          items: [expiredItem],
        },
      }).code,
    ).toBe('OFFER_EXPIRED');
    expect(
      participantAgendaMutationProblemSchema.parse({
        ...problem('CAPACITY_FULL', 409),
        sessionId: ids.session,
        agenda: {
          ...response,
          items: [
            {
              ...savedItem,
              capacity: {
                ...reservationCapacity,
                confirmed: 10,
                held: 0,
                remaining: 0,
                actorAvailability: { state: 'unavailable' },
              },
              action: { state: 'capacity_full' },
            },
          ],
        },
      }).code,
    ).toBe('CAPACITY_FULL');
    expect(
      participantAgendaMutationProblemSchema.parse({
        ...problem('RESERVATION_CLOSED', 409),
        sessionId: ids.session,
        agenda: {
          ...response,
          items: [
            {
              ...savedItem,
              capacity: {
                ...reservationCapacity,
                actorAvailability: { state: 'unavailable' },
              },
              action: { state: 'closed' },
            },
          ],
        },
      }).code,
    ).toBe('RESERVATION_CLOSED');
    expect(
      participantAgendaMutationProblemSchema.parse({
        ...problem('TICKET_INACTIVE', 409),
        sessionId: ids.session,
        agenda: response,
      }).code,
    ).toBe('TICKET_INACTIVE');

    const mutationProblems = [
      problem('SESSION_NOT_FOUND', 404),
      problem('EVENT_ACCESS_DENIED', 403),
      problem('AGENDA_DISABLED', 409),
      problem('VALIDATION_FAILED', 422),
      problem('IDEMPOTENCY_KEY_REUSED', 409),
      problem('IDEMPOTENCY_IN_PROGRESS', 409),
      problem('INTERNAL_ERROR', 500),
    ];
    mutationProblems.forEach((mutationProblem) => {
      expect(
        participantAgendaMutationProblemSchema.safeParse(mutationProblem)
          .success,
      ).toBe(true);
    });
  });
});
