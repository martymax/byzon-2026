import { z } from 'zod';

import {
  defineApiProblemSchema,
  idempotencyInProgressProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyKeySchema,
  sessionExpiredProblemSchema,
} from './base.js';

const MAX_AGENDA_ITEMS = 512;
const MAX_CONFLICTING_SESSIONS = 10;
const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const safePositiveVersionSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const safeNonnegativeVersionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const unsafeInlineTextPattern =
  /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;
const safeInlineTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, {
      message: 'Text must not be blank',
    })
    .refine((value) => !unsafeInlineTextPattern.test(value), {
      message: 'Text contains unsafe control characters',
    });

const eventTimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Event timezone must be a supported IANA timezone' },
  );

const localDateInTimezone = (
  timestamp: string,
  timezone: string,
): string | null => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      calendar: 'iso8601',
      day: '2-digit',
      month: '2-digit',
      timeZone: timezone,
      year: 'numeric',
    }).formatToParts(new Date(timestamp));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((value) => value.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch {
    return null;
  }
};

/**
 * CS-AGENDA-01 carries event/user-scoped P2 data. Browser persistence is valid
 * only through the owner lease, revocation epoch and fail-closed feature gate
 * defined by CS-OFFLINE-01. Reservation and waitlist mutations stay
 * authoritative, idempotent and online-only.
 */
export const participantAgendaCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  vary: Object.freeze(['authorization', 'cookie'] as const),
  scope: 'event-user',
  offlineRead: 'requires-offline-contract-v1-owner-lease',
  browserPersistence: 'offline-contract-v1-feature-gated',
  mutation: 'online-only',
  idempotency: 'required',
} as const);

export const agendaVersionSchema = safePositiveVersionSchema;
export type AgendaVersion = z.infer<typeof agendaVersionSchema>;

export const agendaSessionStatusSchema = z.enum(['published', 'cancelled']);
export type AgendaSessionStatus = z.infer<typeof agendaSessionStatusSchema>;

export const agendaRoomSnapshotSchema = z.strictObject({
  id: uuidSchema,
  name: safeInlineTextSchema(256),
});
export type AgendaRoomSnapshot = z.infer<typeof agendaRoomSnapshotSchema>;

export const agendaCalendarIdentitySchema = z.strictObject({
  uid: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9][A-Za-z0-9.-]*$/),
  sequence: safeNonnegativeVersionSchema,
});
export type AgendaCalendarIdentity = z.infer<
  typeof agendaCalendarIdentitySchema
>;

export const agendaSessionSnapshotSchema = z
  .strictObject({
    id: uuidSchema,
    eventId: uuidSchema,
    title: safeInlineTextSchema(512),
    startsAt: dateTimeSchema,
    endsAt: dateTimeSchema,
    room: agendaRoomSnapshotSchema.nullable(),
    status: agendaSessionStatusSchema,
    calendar: agendaCalendarIdentitySchema,
  })
  .superRefine((session, context) => {
    if (Date.parse(session.endsAt) <= Date.parse(session.startsAt)) {
      context.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'Session must end after it starts',
      });
    }
  });

export type AgendaSessionSnapshot = z.infer<typeof agendaSessionSnapshotSchema>;

export const agendaDaySnapshotSchema = z.strictObject({
  localDate: z.string().date(),
  title: safeInlineTextSchema(256),
});
export type AgendaDaySnapshot = z.infer<typeof agendaDaySnapshotSchema>;

const reservationActorAvailabilitySchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('available') }),
  z.strictObject({
    state: z.literal('held_for_participant'),
    offerId: uuidSchema,
    expiresAt: dateTimeSchema,
  }),
  z.strictObject({ state: z.literal('unavailable') }),
]);

const reservationCapacitySchema = z
  .strictObject({
    mode: z.literal('reservation'),
    capacity: z.number().int().positive().max(100_000),
    confirmed: z.number().int().nonnegative().max(100_000),
    held: z.number().int().nonnegative().max(100_000),
    remaining: z.number().int().nonnegative().max(100_000),
    waitlistAvailable: z.boolean(),
    actorAvailability: reservationActorAvailabilitySchema,
  })
  .superRefine((capacity, context) => {
    if (capacity.confirmed + capacity.held > capacity.capacity) {
      context.addIssue({
        code: 'custom',
        path: ['confirmed'],
        message: 'Confirmed reservations and holds cannot exceed capacity',
      });
    }
    if (
      capacity.remaining !==
      capacity.capacity - capacity.confirmed - capacity.held
    ) {
      context.addIssue({
        code: 'custom',
        path: ['remaining'],
        message: 'Remaining capacity must match the canonical server count',
      });
    }
    if (
      capacity.actorAvailability.state === 'available' &&
      capacity.remaining === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['actorAvailability'],
        message: 'Actor availability requires unheld remaining capacity',
      });
    }
    if (
      capacity.actorAvailability.state === 'held_for_participant' &&
      capacity.held === 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['actorAvailability'],
        message: 'Actor offer requires canonical held capacity',
      });
    }
  });

export const agendaCapacitySnapshotSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('none') }),
  reservationCapacitySchema,
]);

export type AgendaCapacitySnapshot = z.infer<
  typeof agendaCapacitySnapshotSchema
>;

export const agendaSessionActionStateSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('available') }),
  z.strictObject({ state: z.literal('capacity_full') }),
  z.strictObject({ state: z.literal('closed') }),
  z.strictObject({ state: z.literal('cancelled') }),
]);

export type AgendaSessionActionState = z.infer<
  typeof agendaSessionActionStateSchema
>;

const waitlistBaseShape = {
  id: uuidSchema,
  joinedAt: dateTimeSchema,
} as const;

export const agendaWaitlistStateSchema = z
  .discriminatedUnion('state', [
    z.strictObject({
      ...waitlistBaseShape,
      state: z.literal('waiting'),
      position: z.number().int().positive().max(100_000),
    }),
    z.strictObject({
      ...waitlistBaseShape,
      state: z.literal('offered'),
      offerId: uuidSchema,
      offeredAt: dateTimeSchema,
      expiresAt: dateTimeSchema,
    }),
    z.strictObject({
      ...waitlistBaseShape,
      state: z.literal('expired'),
      offerId: uuidSchema,
      offeredAt: dateTimeSchema,
      expiresAt: dateTimeSchema,
      expiredAt: dateTimeSchema,
    }),
    z.strictObject({
      ...waitlistBaseShape,
      state: z.literal('cancelled'),
      cancelledAt: dateTimeSchema,
    }),
  ])
  .superRefine((waitlist, context) => {
    if (
      waitlist.state !== 'waiting' &&
      waitlist.state !== 'cancelled' &&
      Date.parse(waitlist.offeredAt) < Date.parse(waitlist.joinedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['offeredAt'],
        message: 'Waitlist offer cannot precede joining the waitlist',
      });
    }
    if (
      waitlist.state !== 'waiting' &&
      waitlist.state !== 'cancelled' &&
      Date.parse(waitlist.expiresAt) <= Date.parse(waitlist.offeredAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'Waitlist offer must expire after it was created',
      });
    }
    if (
      waitlist.state === 'expired' &&
      Date.parse(waitlist.expiredAt) < Date.parse(waitlist.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['expiredAt'],
        message: 'Waitlist expiry record cannot precede its deadline',
      });
    }
    if (
      waitlist.state === 'cancelled' &&
      Date.parse(waitlist.cancelledAt) < Date.parse(waitlist.joinedAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['cancelledAt'],
        message: 'Waitlist cancellation cannot precede joining the waitlist',
      });
    }
  });

export type AgendaWaitlistState = z.infer<typeof agendaWaitlistStateSchema>;

const agendaItemBaseShape = {
  day: agendaDaySnapshotSchema,
  session: agendaSessionSnapshotSchema,
  capacity: agendaCapacitySnapshotSchema,
  action: agendaSessionActionStateSchema,
} as const;

export const participantAgendaItemSchema = z
  .discriminatedUnion('state', [
    z.strictObject({
      ...agendaItemBaseShape,
      state: z.literal('saved'),
      source: z.enum(['manual', 'organizer']),
      savedAt: dateTimeSchema,
    }),
    z.strictObject({
      ...agendaItemBaseShape,
      state: z.literal('reserved'),
      reservation: z.strictObject({
        id: uuidSchema,
        version: safePositiveVersionSchema,
        confirmedAt: dateTimeSchema,
      }),
    }),
    z.strictObject({
      ...agendaItemBaseShape,
      state: z.literal('waitlisted'),
      waitlist: agendaWaitlistStateSchema,
    }),
  ])
  .superRefine((item, context) => {
    if (
      item.session.status === 'cancelled' &&
      item.action.state !== 'cancelled'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['action', 'state'],
        message: 'A cancelled session must expose a cancelled action',
      });
    }
    if (
      item.session.status === 'published' &&
      item.action.state === 'cancelled'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['action', 'state'],
        message: 'A published session cannot expose a cancelled action',
      });
    }

    if (
      item.action.state === 'capacity_full' &&
      (item.capacity.mode !== 'reservation' ||
        item.capacity.remaining !== 0 ||
        item.capacity.actorAvailability.state !== 'unavailable')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['action', 'state'],
        message: 'Capacity-full requires zero canonical reservation capacity',
      });
    }
    if (
      item.action.state === 'available' &&
      item.capacity.mode === 'reservation' &&
      item.capacity.actorAvailability.state === 'unavailable'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['action', 'state'],
        message: 'Available reservation action requires remaining capacity',
      });
    }
    if (
      item.action.state === 'closed' &&
      item.capacity.mode !== 'reservation'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['action', 'state'],
        message: 'Closed is only valid for reservation sessions',
      });
    }
    if (item.state !== 'saved' && item.capacity.mode !== 'reservation') {
      context.addIssue({
        code: 'custom',
        path: ['capacity', 'mode'],
        message: 'Reservation and waitlist state require reservation capacity',
      });
    }
    if (
      item.state === 'waitlisted' &&
      item.waitlist.state === 'waiting' &&
      item.action.state !== 'capacity_full'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['action', 'state'],
        message: 'A waiting entry requires a full session',
      });
    }
    if (
      item.state === 'waitlisted' &&
      item.waitlist.state === 'offered' &&
      (item.action.state !== 'available' ||
        item.capacity.mode !== 'reservation' ||
        item.capacity.actorAvailability.state !== 'held_for_participant' ||
        item.capacity.actorAvailability.offerId !== item.waitlist.offerId ||
        item.capacity.actorAvailability.expiresAt !== item.waitlist.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['action', 'state'],
        message: 'An active offer requires available held capacity',
      });
    }
    if (
      item.capacity.mode === 'reservation' &&
      item.capacity.actorAvailability.state === 'held_for_participant' &&
      (item.state !== 'waitlisted' || item.waitlist.state !== 'offered')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['capacity', 'actorAvailability'],
        message: 'Participant hold requires the matching active offer state',
      });
    }
  });

export type ParticipantAgendaItem = z.infer<typeof participantAgendaItemSchema>;

export const agendaCalendarExportSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('available'),
    href: z.literal('/api/v1/me/agenda.ics'),
  }),
  z.strictObject({
    state: z.literal('unavailable'),
    reason: z.literal('empty'),
  }),
]);

export type AgendaCalendarExport = z.infer<typeof agendaCalendarExportSchema>;

const participantAgendaSnapshotShape = {
  eventId: uuidSchema,
  userId: uuidSchema,
  eventTimezone: eventTimezoneSchema,
  serverNow: dateTimeSchema,
  version: agendaVersionSchema,
  publicationVersion: safePositiveVersionSchema,
  items: z.array(participantAgendaItemSchema).max(MAX_AGENDA_ITEMS),
  calendarExport: agendaCalendarExportSchema,
} as const;

type AgendaSnapshotForValidation = {
  readonly eventId: string;
  readonly userId: string;
  readonly eventTimezone: string;
  readonly serverNow: string;
  readonly version: number;
  readonly publicationVersion: number;
  readonly items: readonly ParticipantAgendaItem[];
  readonly calendarExport: AgendaCalendarExport;
};

const validateAgendaSnapshot = (
  snapshot: AgendaSnapshotForValidation,
  context: z.RefinementCtx,
): void => {
  const serverNow = Date.parse(snapshot.serverNow);
  const sessionIds = snapshot.items.map(({ session }) => session.id);
  if (new Set(sessionIds).size !== sessionIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'Agenda session IDs must be unique',
    });
  }
  const calendarUids = snapshot.items.map(
    ({ session }) => session.calendar.uid,
  );
  if (new Set(calendarUids).size !== calendarUids.length) {
    context.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'Agenda calendar UIDs must be unique',
    });
  }

  const dayTitles = new Map<string, string>();
  snapshot.items.forEach((item, index) => {
    if (item.session.eventId !== snapshot.eventId) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'session', 'eventId'],
        message: 'Every session must belong to the agenda event',
      });
    }

    if (
      item.day.localDate !==
      localDateInTimezone(item.session.startsAt, snapshot.eventTimezone)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'day', 'localDate'],
        message: 'Agenda day must match the event-local session start date',
      });
    }
    if (item.session.calendar.sequence !== snapshot.publicationVersion) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'session', 'calendar', 'sequence'],
        message: 'Calendar sequence must match the publication version',
      });
    }

    const knownTitle = dayTitles.get(item.day.localDate);
    if (knownTitle !== undefined && knownTitle !== item.day.title) {
      context.addIssue({
        code: 'custom',
        path: ['items', index, 'day', 'title'],
        message: 'One agenda day cannot have multiple titles',
      });
    }
    dayTitles.set(item.day.localDate, item.day.title);

    const timestamps: Array<readonly [string, string]> =
      item.state === 'saved'
        ? [['savedAt', item.savedAt]]
        : item.state === 'reserved'
          ? [['reservation.confirmedAt', item.reservation.confirmedAt]]
          : [['waitlist.joinedAt', item.waitlist.joinedAt]];
    timestamps.forEach(([path, timestamp]) => {
      if (Date.parse(timestamp) > serverNow) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, ...path.split('.')],
          message: 'Participant state timestamp cannot be in the future',
        });
      }
    });

    if (item.state === 'waitlisted') {
      const { waitlist } = item;
      if (
        waitlist.state === 'offered' &&
        (Date.parse(waitlist.offeredAt) > serverNow ||
          Date.parse(waitlist.expiresAt) <= serverNow)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'waitlist', 'expiresAt'],
          message: 'An offered waitlist entry must be active at serverNow',
        });
      }
      if (
        waitlist.state === 'expired' &&
        (Date.parse(waitlist.expiresAt) > serverNow ||
          Date.parse(waitlist.expiredAt) > serverNow)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'waitlist', 'expiredAt'],
          message: 'An expired waitlist entry must be expired at serverNow',
        });
      }
      if (
        waitlist.state === 'cancelled' &&
        Date.parse(waitlist.cancelledAt) > serverNow
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'waitlist', 'cancelledAt'],
          message: 'Waitlist cancellation cannot be in the future',
        });
      }
    }
  });

  snapshot.items.slice(1).forEach((item, index) => {
    const previous = snapshot.items[index];
    if (!previous) return;
    const startsAt = Date.parse(item.session.startsAt);
    const previousStartsAt = Date.parse(previous.session.startsAt);
    if (
      startsAt < previousStartsAt ||
      (startsAt === previousStartsAt && item.session.id < previous.session.id)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items', index + 1, 'session', 'startsAt'],
        message: 'Agenda items must be ordered by start time and session ID',
      });
    }
  });

  if (
    (snapshot.items.length === 0) !==
    (snapshot.calendarExport.state === 'unavailable')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['calendarExport'],
      message: 'Calendar export availability must match agenda contents',
    });
  }
};

export const participantAgendaResponseSchema = z
  .strictObject(participantAgendaSnapshotShape)
  .superRefine(validateAgendaSnapshot);

export type ParticipantAgendaResponse = z.infer<
  typeof participantAgendaResponseSchema
>;

export const agendaMutationActionSchema = z.enum([
  'add',
  'remove',
  'reserve',
  'cancel',
  'join_waitlist',
  'leave_waitlist',
  'accept_offer',
  'decline_offer',
]);

export type AgendaMutationAction = z.infer<typeof agendaMutationActionSchema>;

const agendaMutationRequestBaseShape = {
  sessionId: uuidSchema,
  expectedVersion: agendaVersionSchema,
} as const;

const simpleAgendaMutationActionSchema = z.enum([
  'add',
  'remove',
  'reserve',
  'cancel',
  'join_waitlist',
  'leave_waitlist',
]);

export const participantAgendaMutationRequestSchema = z.discriminatedUnion(
  'action',
  [
    z.strictObject({
      ...agendaMutationRequestBaseShape,
      action: simpleAgendaMutationActionSchema,
    }),
    z.strictObject({
      ...agendaMutationRequestBaseShape,
      action: z.literal('accept_offer'),
      offerId: uuidSchema,
    }),
    z.strictObject({
      ...agendaMutationRequestBaseShape,
      action: z.literal('decline_offer'),
      offerId: uuidSchema,
    }),
  ],
);

export type ParticipantAgendaMutationRequest = z.infer<
  typeof participantAgendaMutationRequestSchema
>;

/**
 * The idempotency key is transport metadata and must be supplied as a request
 * header. It is deliberately absent from the JSON body and response.
 */
export const participantAgendaMutationHeadersSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});

export type ParticipantAgendaMutationHeaders = z.infer<
  typeof participantAgendaMutationHeadersSchema
>;

const agendaMutationResultBaseShape = {
  sessionId: uuidSchema,
  outcome: z.enum(['applied', 'already_applied']),
} as const;

const agendaMutationResultSchema = z.discriminatedUnion('action', [
  z.strictObject({
    ...agendaMutationResultBaseShape,
    action: simpleAgendaMutationActionSchema,
  }),
  z.strictObject({
    ...agendaMutationResultBaseShape,
    action: z.literal('accept_offer'),
    offerId: uuidSchema,
  }),
  z.strictObject({
    ...agendaMutationResultBaseShape,
    action: z.literal('decline_offer'),
    offerId: uuidSchema,
  }),
]);

type AgendaMutationResult = z.infer<typeof agendaMutationResultSchema>;

const agendaConflictSessionSnapshotSchema = agendaSessionSnapshotSchema.refine(
  ({ status }) => status === 'published',
  'A cancelled session cannot cause a time conflict',
);

const sameAgendaSession = (
  left: AgendaSessionSnapshot,
  right: AgendaSessionSnapshot,
): boolean =>
  left.id === right.id &&
  left.eventId === right.eventId &&
  left.title === right.title &&
  left.startsAt === right.startsAt &&
  left.endsAt === right.endsAt &&
  left.status === right.status &&
  left.calendar.uid === right.calendar.uid &&
  left.calendar.sequence === right.calendar.sequence &&
  (left.room === null
    ? right.room === null
    : right.room !== null &&
      left.room.id === right.room.id &&
      left.room.name === right.room.name);

export const agendaTimeConflictWarningSchema = z
  .strictObject({
    eventId: uuidSchema,
    sessionId: uuidSchema,
    targetSession: agendaConflictSessionSnapshotSchema,
    conflictingSessions: z
      .array(agendaConflictSessionSnapshotSchema)
      .min(1)
      .max(MAX_CONFLICTING_SESSIONS),
  })
  .superRefine((warning, context) => {
    const ids = warning.conflictingSessions.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['conflictingSessions'],
        message: 'Conflicting session IDs must be unique',
      });
    }
    if (
      warning.targetSession.id !== warning.sessionId ||
      warning.targetSession.eventId !== warning.eventId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetSession'],
        message: 'Conflict target must match the requested event and session',
      });
    }
    warning.conflictingSessions.forEach((session, index) => {
      const overlaps =
        Date.parse(session.startsAt) <
          Date.parse(warning.targetSession.endsAt) &&
        Date.parse(session.endsAt) > Date.parse(warning.targetSession.startsAt);
      if (
        session.eventId !== warning.eventId ||
        session.id === warning.sessionId ||
        !overlaps
      ) {
        context.addIssue({
          code: 'custom',
          path: ['conflictingSessions', index],
          message:
            'Conflicting session must be a different overlapping same-event item',
        });
      }
    });
    warning.conflictingSessions.slice(1).forEach((session, index) => {
      const previous = warning.conflictingSessions[index];
      const startsAt = Date.parse(session.startsAt);
      const previousStartsAt = previous
        ? Date.parse(previous.startsAt)
        : Number.NaN;
      if (
        previous &&
        (startsAt < previousStartsAt ||
          (startsAt === previousStartsAt && session.id < previous.id))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['conflictingSessions', index + 1],
          message: 'Conflicting sessions must be canonically ordered',
        });
      }
    });
  });

export type AgendaTimeConflictWarning = z.infer<
  typeof agendaTimeConflictWarningSchema
>;

const validateAgendaMutationPostcondition = (
  response: AgendaSnapshotForValidation & {
    readonly mutation: AgendaMutationResult;
    readonly timeConflict: AgendaTimeConflictWarning | null;
  },
  context: z.RefinementCtx,
): void => {
  const { mutation, timeConflict } = response;
  const item = response.items.find(
    ({ session }) => session.id === mutation.sessionId,
  );
  const issue = (message: string) =>
    context.addIssue({
      code: 'custom',
      path: ['mutation'],
      message,
    });

  if (timeConflict !== null) {
    if (
      mutation.action !== 'add' &&
      mutation.action !== 'reserve' &&
      mutation.action !== 'accept_offer'
    ) {
      issue('Only a mutation that adds an agenda item may carry a conflict');
    }
    if (
      timeConflict.eventId !== response.eventId ||
      timeConflict.sessionId !== mutation.sessionId ||
      timeConflict.targetSession.calendar.sequence !==
        response.publicationVersion ||
      !item ||
      !sameAgendaSession(item.session, timeConflict.targetSession)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['timeConflict', 'targetSession'],
        message:
          'Conflict warning target must match the canonical mutation snapshot',
      });
    }
    timeConflict.conflictingSessions.forEach((session, index) => {
      const canonicalItem = response.items.find(
        (candidate) => candidate.session.id === session.id,
      );
      if (
        !canonicalItem ||
        !sameAgendaSession(canonicalItem.session, session)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['timeConflict', 'conflictingSessions', index],
          message:
            'Conflict warning sessions must match canonical agenda snapshots',
        });
      }
    });
  }

  switch (mutation.action) {
    case 'add':
      if (!item || (mutation.outcome === 'applied' && item.state !== 'saved')) {
        issue(
          'An applied add must be saved; a replay must remain in the agenda',
        );
      }
      return;
    case 'remove':
      if (item) issue('A removed session must be absent from the snapshot');
      return;
    case 'reserve':
    case 'accept_offer':
      if (item?.state !== 'reserved') {
        issue('A successful reservation must be canonical and reserved');
      }
      return;
    case 'cancel':
      if (item !== undefined && item.state !== 'saved') {
        issue('A cancelled reservation must be absent or canonically saved');
      }
      return;
    case 'join_waitlist':
      if (item?.state !== 'waitlisted' || item.waitlist.state !== 'waiting') {
        issue('A joined waitlist must be canonical and waiting');
      }
      return;
    case 'leave_waitlist':
      if (
        item !== undefined &&
        item.state !== 'saved' &&
        (item.state !== 'waitlisted' ||
          (item.waitlist.state !== 'expired' &&
            item.waitlist.state !== 'cancelled'))
      ) {
        issue(
          'A left waitlist must be saved, absent or in a terminal waitlist state',
        );
      }
      return;
    case 'decline_offer':
      if (
        item !== undefined &&
        item.state !== 'saved' &&
        (item.state !== 'waitlisted' ||
          (item.waitlist.state !== 'expired' &&
            item.waitlist.state !== 'cancelled'))
      ) {
        issue(
          'A declined offer must be saved, absent or in a terminal waitlist state',
        );
      }
      return;
  }
};

export const participantAgendaMutationResponseSchema = z
  .strictObject({
    ...participantAgendaSnapshotShape,
    mutation: agendaMutationResultSchema,
    timeConflict: agendaTimeConflictWarningSchema.nullable(),
  })
  .superRefine((response, context) => {
    validateAgendaSnapshot(response, context);
    validateAgendaMutationPostcondition(response, context);
  });

export type ParticipantAgendaMutationResponse = z.infer<
  typeof participantAgendaMutationResponseSchema
>;

export const agendaAuthenticationRequiredProblemSchema = defineApiProblemSchema(
  'AUTHENTICATION_REQUIRED',
  401,
);
export const agendaEventAccessDeniedProblemSchema = defineApiProblemSchema(
  'EVENT_ACCESS_DENIED',
  403,
);
export const agendaSessionNotFoundProblemSchema = defineApiProblemSchema(
  'SESSION_NOT_FOUND',
  404,
);
export const agendaDisabledProblemSchema = defineApiProblemSchema(
  'AGENDA_DISABLED',
  409,
);
export const agendaTicketInactiveProblemSchema = defineApiProblemSchema(
  'TICKET_INACTIVE',
  409,
)
  .extend({
    sessionId: uuidSchema,
    agenda: participantAgendaResponseSchema,
  })
  .superRefine((problem, context) => {
    if (
      !problem.agenda.items.some(
        ({ session }) => session.id === problem.sessionId,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['agenda', 'items'],
        message: 'Ticket problem must carry the canonical target state',
      });
    }
  });
export const agendaCapacityFullProblemSchema = defineApiProblemSchema(
  'CAPACITY_FULL',
  409,
)
  .extend({
    sessionId: uuidSchema,
    agenda: participantAgendaResponseSchema,
  })
  .superRefine((problem, context) => {
    const item = problem.agenda.items.find(
      ({ session }) => session.id === problem.sessionId,
    );
    if (
      item?.capacity.mode !== 'reservation' ||
      item.capacity.remaining !== 0 ||
      item.capacity.actorAvailability.state !== 'unavailable' ||
      item.action.state !== 'capacity_full'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['agenda', 'items'],
        message: 'Capacity problem must carry the canonical full target state',
      });
    }
  });
export const agendaReservationClosedProblemSchema = defineApiProblemSchema(
  'RESERVATION_CLOSED',
  409,
)
  .extend({
    sessionId: uuidSchema,
    agenda: participantAgendaResponseSchema,
  })
  .superRefine((problem, context) => {
    const item = problem.agenda.items.find(
      ({ session }) => session.id === problem.sessionId,
    );
    if (
      item?.capacity.mode !== 'reservation' ||
      item.action.state !== 'closed'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['agenda', 'items'],
        message: 'Closed problem must carry the canonical target state',
      });
    }
  });
export const agendaOfferExpiredProblemSchema = defineApiProblemSchema(
  'OFFER_EXPIRED',
  409,
)
  .extend({
    sessionId: uuidSchema,
    offerId: uuidSchema,
    serverNow: dateTimeSchema,
    agenda: participantAgendaResponseSchema,
  })
  .superRefine((problem, context) => {
    const item = problem.agenda.items.find(
      ({ session }) => session.id === problem.sessionId,
    );
    if (
      problem.serverNow !== problem.agenda.serverNow ||
      item?.state !== 'waitlisted' ||
      item.waitlist.state !== 'expired' ||
      item.waitlist.offerId !== problem.offerId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['agenda', 'items'],
        message: 'Expired offer must match canonical server time and state',
      });
    }
  });
export const agendaStaleVersionProblemSchema = defineApiProblemSchema(
  'STALE_VERSION',
  409,
)
  .extend({
    currentVersion: agendaVersionSchema,
    agenda: participantAgendaResponseSchema,
  })
  .superRefine((problem, context) => {
    if (problem.currentVersion !== problem.agenda.version) {
      context.addIssue({
        code: 'custom',
        path: ['currentVersion'],
        message: 'Stale version must match the canonical agenda snapshot',
      });
    }
  });
export const agendaValidationProblemSchema = defineApiProblemSchema(
  'VALIDATION_FAILED',
  422,
);
export const agendaInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);

const participantAgendaReadProblems = [
  agendaAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  agendaEventAccessDeniedProblemSchema,
  agendaDisabledProblemSchema,
  agendaValidationProblemSchema,
  agendaInternalErrorProblemSchema,
] as const;

export const participantAgendaProblemSchema = z.discriminatedUnion(
  'code',
  participantAgendaReadProblems,
);

export const participantAgendaMutationProblemSchema = z.discriminatedUnion(
  'code',
  [
    ...participantAgendaReadProblems,
    agendaSessionNotFoundProblemSchema,
    agendaTicketInactiveProblemSchema,
    agendaCapacityFullProblemSchema,
    agendaReservationClosedProblemSchema,
    agendaOfferExpiredProblemSchema,
    agendaStaleVersionProblemSchema,
    idempotencyKeyReusedProblemSchema,
    idempotencyInProgressProblemSchema,
  ],
);

export type ParticipantAgendaProblem = z.infer<
  typeof participantAgendaProblemSchema
>;
export type ParticipantAgendaMutationProblem = z.infer<
  typeof participantAgendaMutationProblemSchema
>;
