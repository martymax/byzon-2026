import {
  participantAgendaMutationProblemSchema,
  participantAgendaMutationResponseSchema,
  participantAgendaProblemSchema,
  participantAgendaResponseSchema,
  problemTypeForCode,
} from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';
import { contentFixtureIds } from './content.js';

export const agendaFixtureIds = Object.freeze({
  event: contentFixtureIds.event,
  user: '01930000-0000-7000-8000-000000000001',
  savedSession: contentFixtureIds.opening,
  reservedSession: contentFixtureIds.workshop,
  waitingSession: contentFixtureIds.agendaWaiting,
  fifoFirstSession: contentFixtureIds.agendaFifoFirst,
  fifoSecondSession: contentFixtureIds.agendaFifoSecond,
  cancelledSession: contentFixtureIds.agendaCancelled,
  fullSession: contentFixtureIds.agendaFull,
  closedSession: contentFixtureIds.agendaClosed,
  waitlistCancelledSession: contentFixtureIds.agendaWaitlistCancelled,
  reservation: '01930000-0000-7000-8000-00000000000a',
  waitlist: '01930000-0000-7000-8000-00000000000b',
  conflictTargetSession: contentFixtureIds.agendaConflictTarget,
  roomMain: contentFixtureIds.mainStage,
  roomWorkshop: contentFixtureIds.workshopRoom,
} as const);

const friday = {
  localDate: '2026-09-18',
  title: 'Pátek',
};

const saturday = {
  localDate: '2026-09-19',
  title: 'Sobota',
};

const mainRoom = {
  id: agendaFixtureIds.roomMain,
  name: 'Main Stage',
};

const workshopRoom = {
  id: agendaFixtureIds.roomWorkshop,
  name: 'Workshop room',
};

const session = (
  id: string,
  title: string,
  startsAt: string,
  endsAt: string,
  room: typeof mainRoom | typeof workshopRoom | null = workshopRoom,
) => ({
  id,
  eventId: agendaFixtureIds.event,
  title,
  startsAt,
  endsAt,
  room,
  status: 'published' as const,
  calendar: {
    uid: `${id}@byzon-2026.byzon.cz`,
    sequence: 3,
  },
});

const savedSession = session(
  agendaFixtureIds.savedSession,
  'Otevření konference',
  '2026-09-18T07:00:00.000Z',
  '2026-09-18T08:00:00.000Z',
  mainRoom,
);
const reservedSession = session(
  agendaFixtureIds.reservedSession,
  'Růst bez zkratek',
  '2026-09-19T08:00:00.000Z',
  '2026-09-19T09:30:00.000Z',
);
const conflictTargetSession = session(
  agendaFixtureIds.conflictTargetSession,
  'Překrývající se workshop',
  '2026-09-18T07:30:00.000Z',
  '2026-09-18T08:30:00.000Z',
);
const waitingSession = session(
  agendaFixtureIds.waitingSession,
  'Kapacitní workshop',
  '2026-09-19T10:00:00.000Z',
  '2026-09-19T11:00:00.000Z',
);
const fifoFirstSession = session(
  agendaFixtureIds.fifoFirstSession,
  'Workshop – první ve FIFO',
  '2026-09-19T11:30:00.000Z',
  '2026-09-19T12:30:00.000Z',
);
const fifoSecondSession = session(
  agendaFixtureIds.fifoSecondSession,
  'Workshop – druhý ve FIFO',
  '2026-09-19T13:00:00.000Z',
  '2026-09-19T14:00:00.000Z',
);
const waitlistCancelledSession = session(
  agendaFixtureIds.waitlistCancelledSession,
  'Workshop s opuštěným pořadníkem',
  '2026-09-19T14:30:00.000Z',
  '2026-09-19T15:30:00.000Z',
);
const fullSession = session(
  agendaFixtureIds.fullSession,
  'Plně obsazený mastermind',
  '2026-09-19T16:00:00.000Z',
  '2026-09-19T17:00:00.000Z',
);
const closedSession = session(
  agendaFixtureIds.closedSession,
  'Uzavřená rezervace',
  '2026-09-19T17:30:00.000Z',
  '2026-09-19T18:30:00.000Z',
);
const cancelledSession = {
  ...session(
    agendaFixtureIds.cancelledSession,
    'Zrušený workshop',
    '2026-09-19T20:30:00.000Z',
    '2026-09-19T21:30:00.000Z',
  ),
  status: 'cancelled' as const,
};

const availableExport = {
  state: 'available' as const,
  href: '/api/v1/me/agenda.ics' as const,
};

const snapshotBase = {
  eventId: agendaFixtureIds.event,
  userId: agendaFixtureIds.user,
  eventTimezone: 'Europe/Prague',
  serverNow: '2026-09-18T06:30:00.000Z',
  version: 7,
  publicationVersion: 3,
};

const savedItem = {
  day: friday,
  session: savedSession,
  state: 'saved' as const,
  source: 'manual' as const,
  savedAt: '2026-09-18T05:30:00.000Z',
  capacity: { mode: 'none' as const },
  action: { state: 'available' as const },
};

const reservedItem = {
  day: saturday,
  session: reservedSession,
  state: 'reserved' as const,
  reservation: {
    id: agendaFixtureIds.reservation,
    version: 1,
    confirmedAt: '2026-09-18T05:45:00.000Z',
  },
  capacity: {
    mode: 'reservation' as const,
    capacity: 20,
    confirmed: 18,
    held: 0,
    remaining: 2,
    waitlistAvailable: true,
    actorAvailability: { state: 'available' as const },
  },
  action: { state: 'available' as const },
};

const conflictTargetItem = {
  day: friday,
  session: conflictTargetSession,
  state: 'saved' as const,
  source: 'manual' as const,
  savedAt: '2026-09-18T05:40:00.000Z',
  capacity: {
    mode: 'reservation' as const,
    capacity: 20,
    confirmed: 10,
    held: 0,
    remaining: 10,
    waitlistAvailable: true,
    actorAvailability: { state: 'available' as const },
  },
  action: { state: 'available' as const },
};

const conflictReservedItem = {
  day: friday,
  session: conflictTargetSession,
  state: 'reserved' as const,
  reservation: {
    id: agendaFixtureIds.reservation,
    version: 1,
    confirmedAt: snapshotBase.serverNow,
  },
  capacity: {
    mode: 'reservation' as const,
    capacity: 20,
    confirmed: 11,
    held: 0,
    remaining: 9,
    waitlistAvailable: true,
    actorAvailability: { state: 'available' as const },
  },
  action: { state: 'available' as const },
};

const conflictExistingReservedItem = {
  day: friday,
  session: savedSession,
  state: 'reserved' as const,
  reservation: {
    id: agendaFixtureIds.reservation,
    version: 1,
    confirmedAt: snapshotBase.serverNow,
  },
  capacity: {
    mode: 'reservation' as const,
    capacity: 20,
    confirmed: 11,
    held: 0,
    remaining: 9,
    waitlistAvailable: true,
    actorAvailability: { state: 'available' as const },
  },
  action: { state: 'available' as const },
};

const waitingItem = {
  day: saturday,
  session: waitingSession,
  state: 'waitlisted' as const,
  waitlist: {
    id: agendaFixtureIds.waitlist,
    state: 'waiting' as const,
    joinedAt: '2026-09-18T05:50:00.000Z',
    position: 3,
    actionsAvailable: true,
  },
  capacity: {
    mode: 'reservation' as const,
    capacity: 12,
    confirmed: 12,
    held: 0,
    remaining: 0,
    waitlistAvailable: true,
    actorAvailability: { state: 'unavailable' as const },
  },
  action: { state: 'capacity_full' as const },
};

const fifoFirstItem = {
  day: saturday,
  session: fifoFirstSession,
  state: 'waitlisted' as const,
  waitlist: {
    id: agendaFixtureIds.waitlist,
    state: 'waiting' as const,
    joinedAt: '2026-09-18T05:00:00.000Z',
    position: 1,
    actionsAvailable: true,
  },
  capacity: {
    mode: 'reservation' as const,
    capacity: 12,
    confirmed: 12,
    held: 0,
    remaining: 0,
    waitlistAvailable: true,
    actorAvailability: { state: 'unavailable' as const },
  },
  action: { state: 'capacity_full' as const },
};

const promotedItem = {
  day: saturday,
  session: fifoFirstSession,
  state: 'reserved' as const,
  reservation: {
    id: agendaFixtureIds.reservation,
    version: 1,
    confirmedAt: '2026-09-18T06:30:00.000Z',
  },
  capacity: {
    mode: 'reservation' as const,
    capacity: 12,
    confirmed: 12,
    held: 0,
    remaining: 0,
    waitlistAvailable: true,
    actorAvailability: { state: 'unavailable' as const },
  },
  action: { state: 'capacity_full' as const },
};

const fifoSecondItem = {
  day: saturday,
  session: fifoSecondSession,
  state: 'waitlisted' as const,
  waitlist: {
    id: agendaFixtureIds.waitlist,
    state: 'waiting' as const,
    joinedAt: '2026-09-18T04:30:00.000Z',
    position: 2,
    actionsAvailable: true,
  },
  capacity: {
    mode: 'reservation' as const,
    capacity: 8,
    confirmed: 8,
    held: 0,
    remaining: 0,
    waitlistAvailable: true,
    actorAvailability: { state: 'unavailable' as const },
  },
  action: { state: 'capacity_full' as const },
};

const waitlistCancelledItem = {
  day: saturday,
  session: waitlistCancelledSession,
  state: 'saved' as const,
  source: 'manual' as const,
  savedAt: '2026-09-18T05:00:00.000Z',
  capacity: {
    mode: 'reservation' as const,
    capacity: 10,
    confirmed: 9,
    held: 0,
    remaining: 1,
    waitlistAvailable: true,
    actorAvailability: { state: 'available' as const },
  },
  action: { state: 'available' as const },
};

const fullItem = {
  day: saturday,
  session: fullSession,
  state: 'saved' as const,
  source: 'manual' as const,
  savedAt: '2026-09-18T05:20:00.000Z',
  capacity: {
    mode: 'reservation' as const,
    capacity: 16,
    confirmed: 16,
    held: 0,
    remaining: 0,
    waitlistAvailable: false,
    actorAvailability: { state: 'unavailable' as const },
  },
  action: { state: 'capacity_full' as const },
};

const closedItem = {
  day: saturday,
  session: closedSession,
  state: 'saved' as const,
  source: 'manual' as const,
  savedAt: '2026-09-18T05:10:00.000Z',
  capacity: {
    mode: 'reservation' as const,
    capacity: 16,
    confirmed: 14,
    held: 0,
    remaining: 2,
    waitlistAvailable: false,
    actorAvailability: { state: 'unavailable' as const },
  },
  action: { state: 'closed' as const },
};

const cancelledItem = {
  day: saturday,
  session: cancelledSession,
  state: 'saved' as const,
  source: 'organizer' as const,
  savedAt: '2026-09-18T04:00:00.000Z',
  capacity: { mode: 'none' as const },
  action: { state: 'cancelled' as const },
};

export const participantAgendaFixtures = defineFixtureSet({
  name: 'agenda.snapshot',
  schema: participantAgendaResponseSchema,
  fixtures: {
    empty: {
      ...snapshotBase,
      items: [],
      calendarExport: { state: 'unavailable', reason: 'empty' },
    },
    happy: {
      ...snapshotBase,
      items: [savedItem, reservedItem, waitingItem],
      calendarExport: availableExport,
    },
    saved: {
      ...snapshotBase,
      items: [savedItem],
      calendarExport: availableExport,
    },
    reserved: {
      ...snapshotBase,
      items: [reservedItem],
      calendarExport: availableExport,
    },
    conflict_target: {
      ...snapshotBase,
      items: [conflictTargetItem],
      calendarExport: availableExport,
    },
    waiting: {
      ...snapshotBase,
      items: [waitingItem],
      calendarExport: availableExport,
    },
    fifo_first_waiting: {
      ...snapshotBase,
      items: [fifoFirstItem],
      calendarExport: availableExport,
    },
    fifo_second_waiting: {
      ...snapshotBase,
      items: [fifoSecondItem],
      calendarExport: availableExport,
    },
    waitlist_cancelled: {
      ...snapshotBase,
      items: [waitlistCancelledItem],
      calendarExport: availableExport,
    },
    cancelled: {
      ...snapshotBase,
      items: [cancelledItem],
      calendarExport: availableExport,
    },
    full: {
      ...snapshotBase,
      items: [fullItem],
      calendarExport: availableExport,
    },
    closed: {
      ...snapshotBase,
      items: [closedItem],
      calendarExport: availableExport,
    },
  },
});

export const participantAgendaMutationFixtures = defineFixtureSet({
  name: 'agenda.mutation',
  schema: participantAgendaMutationResponseSchema,
  fixtures: {
    reserved: {
      ...snapshotBase,
      version: 8,
      items: [reservedItem],
      calendarExport: availableExport,
      mutation: {
        sessionId: agendaFixtureIds.reservedSession,
        action: 'reserve',
        outcome: 'applied',
      },
      timeConflict: null,
    },
    reserved_with_conflict: {
      ...snapshotBase,
      version: 8,
      items: [savedItem, conflictReservedItem],
      calendarExport: availableExport,
      mutation: {
        sessionId: agendaFixtureIds.conflictTargetSession,
        action: 'reserve',
        outcome: 'applied',
      },
      timeConflict: {
        eventId: agendaFixtureIds.event,
        sessionId: agendaFixtureIds.conflictTargetSession,
        targetSession: conflictTargetSession,
        conflictingSessions: [savedSession],
      },
    },
    reserved_from_waitlist_capacity: {
      ...snapshotBase,
      version: 9,
      items: [promotedItem],
      calendarExport: availableExport,
      mutation: {
        sessionId: agendaFixtureIds.fifoFirstSession,
        action: 'reserve',
        outcome: 'applied',
      },
      timeConflict: null,
    },
    removed: {
      ...snapshotBase,
      version: 10,
      items: [],
      calendarExport: { state: 'unavailable', reason: 'empty' },
      mutation: {
        sessionId: agendaFixtureIds.savedSession,
        action: 'remove',
        outcome: 'applied',
      },
      timeConflict: null,
    },
    idempotent_replay: {
      ...snapshotBase,
      version: 8,
      items: [reservedItem],
      calendarExport: availableExport,
      mutation: {
        sessionId: agendaFixtureIds.reservedSession,
        action: 'reserve',
        outcome: 'already_applied',
      },
      timeConflict: null,
    },
  },
});

interface AgendaProblemStatus {
  readonly AUTHENTICATION_REQUIRED: 401;
  readonly AUTH_SESSION_EXPIRED: 401;
  readonly EVENT_ACCESS_DENIED: 403;
  readonly SESSION_NOT_FOUND: 404;
  readonly AGENDA_DISABLED: 409;
  readonly TICKET_INACTIVE: 409;
  readonly CAPACITY_FULL: 409;
  readonly RESERVATION_CLOSED: 409;
  readonly RESERVATION_CONFLICT: 409;
  readonly STALE_VERSION: 409;
  readonly VALIDATION_FAILED: 422;
  readonly RATE_LIMITED: 429;
  readonly IDEMPOTENCY_KEY_REUSED: 409;
  readonly IDEMPOTENCY_IN_PROGRESS: 409;
  readonly INTERNAL_ERROR: 500;
}

const problem = <Code extends keyof AgendaProblemStatus>(
  code: Code,
  status: AgendaProblemStatus[Code],
) => ({
  type: problemTypeForCode(code),
  title: 'Agenda fixture problem',
  status,
  code,
  detail: 'Synthetic participant agenda fixture failure.',
  requestId: 'fixture-agenda-0001',
});

const readProblems = {
  authentication: problem('AUTHENTICATION_REQUIRED', 401),
  session_expired: problem('AUTH_SESSION_EXPIRED', 401),
  permission: problem('EVENT_ACCESS_DENIED', 403),
  disabled: problem('AGENDA_DISABLED', 409),
  validation: problem('VALIDATION_FAILED', 422),
  rate_limited: problem('RATE_LIMITED', 429),
  internal_error: problem('INTERNAL_ERROR', 500),
} as const;

export const participantAgendaProblemFixtures = defineFixtureSet({
  name: 'agenda.problem',
  schema: participantAgendaProblemSchema,
  fixtures: readProblems,
});

export const participantAgendaMutationProblemFixtures = defineFixtureSet({
  name: 'agenda.mutation-problem',
  schema: participantAgendaMutationProblemSchema,
  fixtures: {
    ...readProblems,
    session_not_found: problem('SESSION_NOT_FOUND', 404),
    ticket_inactive: {
      ...problem('TICKET_INACTIVE', 409),
      sessionId: agendaFixtureIds.reservedSession,
      agenda: {
        ...snapshotBase,
        items: [reservedItem],
        calendarExport: availableExport,
      },
    },
    capacity_full: {
      ...problem('CAPACITY_FULL', 409),
      sessionId: agendaFixtureIds.fullSession,
      agenda: {
        ...snapshotBase,
        items: [fullItem],
        calendarExport: availableExport,
      },
    },
    reservation_closed: {
      ...problem('RESERVATION_CLOSED', 409),
      sessionId: agendaFixtureIds.closedSession,
      agenda: {
        ...snapshotBase,
        items: [closedItem],
        calendarExport: availableExport,
      },
    },
    reservation_conflict: {
      ...problem('RESERVATION_CONFLICT', 409),
      sessionId: agendaFixtureIds.conflictTargetSession,
      agenda: {
        ...snapshotBase,
        items: [conflictExistingReservedItem, conflictTargetItem],
        calendarExport: availableExport,
      },
      conflict: {
        eventId: agendaFixtureIds.event,
        sessionId: agendaFixtureIds.conflictTargetSession,
        targetSessions: [conflictTargetSession],
        conflictingSessions: [savedSession],
      },
      replacement: {
        allowed: true,
        until: savedSession.startsAt,
        reservationSessionIds: [agendaFixtureIds.savedSession],
      },
    },
    stale_version: {
      ...problem('STALE_VERSION', 409),
      currentVersion: 8,
      agenda: {
        ...snapshotBase,
        version: 8,
        items: [savedItem, reservedItem, waitingItem],
        calendarExport: availableExport,
      },
    },
    key_reused: problem('IDEMPOTENCY_KEY_REUSED', 409),
    in_progress: problem('IDEMPOTENCY_IN_PROGRESS', 409),
  },
});
