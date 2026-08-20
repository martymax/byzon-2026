import {
  adminAuditResponseSchema,
  adminContextResponseSchema,
  adminEventSettingsSchema,
  adminEventSettingsUpdateResponseSchema,
  adminExportProblemSchema,
  adminExportResponseSchema,
  adminMutationProblemSchema,
  adminOperationsOverviewResponseSchema,
  adminReadProblemSchema,
  adminReservationListResponseSchema,
  adminReservationMutationResponseSchema,
  adminRoleAssignmentMutationResponseSchema,
  problemTypeForCode,
  type AdminReservationRecord,
} from '@byzon/domain/contracts';

import { defineFixtureSet } from '../fixture-harness.js';

export const adminFixtureIds = Object.freeze({
  event: '019fb200-0000-7000-8000-000000000001',
  session: '019fb200-0000-7000-8000-000000000002',
  secondSession: '019fb200-0000-7000-8000-000000000003',
  operator: '019fb200-0000-7000-8000-000000000004',
  assignment: '019fb200-0000-7000-8000-000000000005',
  export: '019fb200-0000-7000-8000-000000000006',
  reservation: '019fb200-0000-7000-8000-000000000007',
  secondReservation: '019fb200-0000-7000-8000-000000000008',
  auditNewest: '019fb200-0000-7000-8000-000000000009',
  auditOlder: '019fb200-0000-7000-8000-000000000010',
  auditMutation: '019fb200-0000-7000-8000-000000000011',
} as const);

export const adminContextFixtures = defineFixtureSet({
  name: 'admin.context',
  schema: adminContextResponseSchema,
  fixtures: {
    organizer: {
      event: {
        id: adminFixtureIds.event,
        name: 'BYZON 2026 — syntetická ukázka',
        timezone: 'Europe/Prague',
        phase: 'live',
      },
      actor: {
        displayLabel: 'Demo administrátor',
        roles: ['organizer_admin'],
        permissions: [
          'program:manage',
          'ticket:any:manage',
          'participant:operational:read',
          'role:manage',
          'operations:read',
          'audit:read',
          'event:settings:manage',
          'reservation:any:read',
          'agenda:any:override',
          'announcement:send',
          'personal-data:operational:export',
        ],
        assignedSessions: [],
      },
    },
    room_operator: {
      event: {
        id: adminFixtureIds.event,
        name: 'BYZON 2026 — syntetická ukázka',
        timezone: 'Europe/Prague',
        phase: 'live',
      },
      actor: {
        displayLabel: 'Demo vedoucí aktivity',
        roles: ['room_operator'],
        permissions: ['reservation:assigned:read'],
        assignedSessions: [
          {
            sessionId: adminFixtureIds.session,
            title: 'Růst bez zkratek',
          },
        ],
      },
    },
  },
});

export const adminOperationsOverviewFixtures = defineFixtureSet({
  name: 'admin.operations-overview',
  schema: adminOperationsOverviewResponseSchema,
  fixtures: {
    healthy: {
      eventId: adminFixtureIds.event,
      version: 3,
      generatedAt: '2026-07-25T12:00:00.000+02:00',
      metrics: [
        {
          id: 'activation',
          label: 'Aktivace',
          value: '412 / 440',
          state: 'healthy',
          detail: '28 syntetických přístupů čeká na aktivaci.',
        },
        {
          id: 'import',
          label: 'Poslední import',
          value: 'Před 18 min',
          state: 'healthy',
          detail: 'Poslední syntetický import byl bez konfliktu.',
        },
        {
          id: 'content',
          label: 'Publikovaný obsah',
          value: 'Synchronní',
          state: 'healthy',
          detail: 'Bez čekajících změn publikace.',
        },
        {
          id: 'checkin',
          label: 'Check-in',
          value: '186 odbaveno',
          state: 'healthy',
          detail: 'Dvě syntetická stanoviště jsou aktivní.',
        },
        {
          id: 'reservation',
          label: 'Rezervace',
          value: '89 %',
          state: 'attention',
          detail: 'Jedna syntetická session se blíží kapacitě.',
        },
        {
          id: 'notification',
          label: 'Oznámení',
          value: '1 čeká',
          state: 'attention',
          detail: 'Jedna syntetická úloha čeká ve frontě.',
        },
      ],
      queues: [
        { queue: 'default', ready: 2, processing: 1, failed: 0 },
        { queue: 'notifications', ready: 1, processing: 0, failed: 0 },
        { queue: 'exports', ready: 0, processing: 1, failed: 0 },
      ],
    },
    degraded: {
      eventId: adminFixtureIds.event,
      version: 4,
      generatedAt: '2026-07-25T12:05:00.000+02:00',
      metrics: [
        {
          id: 'notification',
          label: 'Oznámení',
          value: '1 selhalo',
          state: 'degraded',
          detail: 'Syntetická úloha skončila v bezpečném DLQ souhrnu.',
        },
      ],
      queues: [{ queue: 'notifications', ready: 0, processing: 0, failed: 1 }],
    },
  },
});

const roleAssignment = {
  assignmentId: adminFixtureIds.assignment,
  eventId: adminFixtureIds.event,
  operatorId: adminFixtureIds.operator,
  operatorLabel: 'Operátor #27',
  role: 'room_operator' as const,
  scope: {
    kind: 'session' as const,
    sessionId: adminFixtureIds.session,
    label: 'Růst bez zkratek',
  },
  state: 'active' as const,
  version: 1,
};

export const adminRoleAssignmentFixtures = defineFixtureSet({
  name: 'admin.role-assignment',
  schema: adminRoleAssignmentMutationResponseSchema,
  fixtures: {
    granted: {
      eventId: adminFixtureIds.event,
      outcome: 'granted',
      assignmentsVersion: 3,
      assignment: roleAssignment,
      changedAt: '2026-07-25T12:10:00.000+02:00',
      audit: { auditId: adminFixtureIds.auditMutation },
    },
    idempotent_replay: {
      eventId: adminFixtureIds.event,
      outcome: 'already_applied',
      assignmentsVersion: 3,
      assignment: roleAssignment,
      changedAt: '2026-07-25T12:10:00.000+02:00',
      audit: { auditId: adminFixtureIds.auditMutation },
    },
  },
});

export const adminExportFixtures = defineFixtureSet({
  name: 'admin.export',
  schema: adminExportResponseSchema,
  fixtures: {
    queued: {
      eventId: adminFixtureIds.event,
      exportId: adminFixtureIds.export,
      report: 'reservation_summary',
      outcome: 'queued',
      state: 'queued',
      queuedAt: '2026-07-25T12:15:00.000+02:00',
      audit: { auditId: adminFixtureIds.auditMutation },
    },
    idempotent_replay: {
      eventId: adminFixtureIds.event,
      exportId: adminFixtureIds.export,
      report: 'reservation_summary',
      outcome: 'already_queued',
      state: 'queued',
      queuedAt: '2026-07-25T12:15:00.000+02:00',
      audit: { auditId: adminFixtureIds.auditMutation },
    },
  },
});

const reservedRecord = {
  reservationId: adminFixtureIds.reservation,
  eventId: adminFixtureIds.event,
  sessionId: adminFixtureIds.session,
  sessionTitle: 'Růst bez zkratek',
  participantReference: 'Účastník •001',
  state: 'reserved' as const,
  capacity: 40,
  reservedCount: 38,
  version: 4,
  availableActions: ['capacity_override', 'cancel_reservation'],
} satisfies AdminReservationRecord;

const cancelledRecord = {
  reservationId: adminFixtureIds.secondReservation,
  eventId: adminFixtureIds.event,
  sessionId: adminFixtureIds.secondSession,
  sessionTitle: 'Panel: firmy v pohybu',
  participantReference: 'Účastník •002',
  state: 'cancelled' as const,
  capacity: 80,
  reservedCount: 65,
  version: 2,
  availableActions: [],
} satisfies AdminReservationRecord;

export const adminReservationFixtures = defineFixtureSet({
  name: 'admin.reservations',
  schema: adminReservationListResponseSchema,
  fixtures: {
    list: {
      eventId: adminFixtureIds.event,
      generatedAt: '2026-07-25T12:00:00.000+02:00',
      items: [reservedRecord, cancelledRecord],
    },
    empty: {
      eventId: adminFixtureIds.event,
      generatedAt: '2026-07-25T12:00:00.000+02:00',
      items: [],
    },
    assigned_session_only: {
      eventId: adminFixtureIds.event,
      generatedAt: '2026-07-25T12:00:00.000+02:00',
      items: [reservedRecord],
    },
  },
});

export const adminReservationMutationFixtures = defineFixtureSet({
  name: 'admin.reservation-mutation',
  schema: adminReservationMutationResponseSchema,
  fixtures: {
    cancelled: {
      eventId: adminFixtureIds.event,
      outcome: 'updated',
      record: {
        ...reservedRecord,
        state: 'cancelled',
        version: 5,
        availableActions: [],
      },
      changedAt: '2026-07-25T12:20:00.000+02:00',
      audit: { auditId: adminFixtureIds.auditMutation },
    },
    idempotent_replay: {
      eventId: adminFixtureIds.event,
      outcome: 'already_applied',
      record: {
        ...reservedRecord,
        state: 'cancelled',
        version: 5,
        availableActions: [],
      },
      changedAt: '2026-07-25T12:20:00.000+02:00',
      audit: { auditId: adminFixtureIds.auditMutation },
    },
  },
});

const newestAudit = {
  auditId: adminFixtureIds.auditNewest,
  eventId: adminFixtureIds.event,
  actorLabel: 'Demo administrátor',
  category: 'settings' as const,
  action: 'update_settings',
  targetReference: 'event •001',
  reason: 'Aktualizace syntetického provozního pokynu.',
  outcome: 'succeeded' as const,
  createdAt: '2026-07-25T12:00:00.000+02:00',
  resultingVersion: 5,
  redacted: false,
};

const olderAudit = {
  auditId: adminFixtureIds.auditOlder,
  eventId: adminFixtureIds.event,
  actorLabel: 'Demo administrátor',
  category: 'reservation' as const,
  action: 'cancel_reservation',
  targetReference: 'reservation •001',
  reason: 'Syntetické zrušení rezervace.',
  outcome: 'succeeded' as const,
  createdAt: '2026-07-25T11:00:00.000+02:00',
  resultingVersion: 4,
  redacted: true,
};

export const adminAuditFixtures = defineFixtureSet({
  name: 'admin.audit',
  schema: adminAuditResponseSchema,
  fixtures: {
    page: {
      eventId: adminFixtureIds.event,
      items: [newestAudit, olderAudit],
      pageInfo: { nextCursor: null, hasMore: false },
    },
    empty: {
      eventId: adminFixtureIds.event,
      items: [],
      pageInfo: { nextCursor: null, hasMore: false },
    },
    first_page: {
      eventId: adminFixtureIds.event,
      items: [newestAudit],
      pageInfo: { nextCursor: 'fixture-admin-audit-page-2', hasMore: true },
    },
  },
});

const settings = {
  eventId: adminFixtureIds.event,
  registrationMode: 'open' as const,
  reservationChangesAllowed: true,
  supportMessage: 'Kontaktujte syntetický registrační pult.',
  version: 5,
};

export const adminEventSettingsFixtures = defineFixtureSet({
  name: 'admin.event-settings',
  schema: adminEventSettingsSchema,
  fixtures: {
    open: settings,
    closed: {
      ...settings,
      registrationMode: 'closed',
      reservationChangesAllowed: false,
      version: 6,
    },
  },
});

export const adminEventSettingsUpdateFixtures = defineFixtureSet({
  name: 'admin.event-settings-update',
  schema: adminEventSettingsUpdateResponseSchema,
  fixtures: {
    updated: {
      eventId: adminFixtureIds.event,
      outcome: 'updated',
      settings: {
        ...settings,
        registrationMode: 'invite_only',
        version: 6,
      },
      changedAt: '2026-07-25T12:25:00.000+02:00',
      audit: { auditId: adminFixtureIds.auditMutation },
    },
    idempotent_replay: {
      eventId: adminFixtureIds.event,
      outcome: 'already_applied',
      settings: {
        ...settings,
        registrationMode: 'invite_only',
        version: 6,
      },
      changedAt: '2026-07-25T12:25:00.000+02:00',
      audit: { auditId: adminFixtureIds.auditMutation },
    },
  },
});

interface AdminProblemStatus {
  readonly AUTHENTICATION_REQUIRED: 401;
  readonly AUTH_SESSION_EXPIRED: 401;
  readonly EVENT_ACCESS_DENIED: 403;
  readonly ADMIN_RESOURCE_NOT_FOUND: 404;
  readonly VALIDATION_FAILED: 422;
  readonly INTERNAL_ERROR: 500;
  readonly ADMIN_INVALID_TRANSITION: 409;
  readonly LAST_ADMINISTRATOR_GUARD: 409;
  readonly SELF_LOCKOUT_GUARD: 409;
  readonly EXPORT_UNAVAILABLE: 409;
  readonly IDEMPOTENCY_KEY_REUSED: 409;
  readonly IDEMPOTENCY_IN_PROGRESS: 409;
}

const problem = <Code extends keyof AdminProblemStatus>(
  code: Code,
  status: AdminProblemStatus[Code],
) => ({
  type: problemTypeForCode(code),
  title: 'Synthetic admin problem',
  status,
  code,
  detail: 'Synthetic admin request could not be completed.',
  requestId: 'fixture-admin-0001',
});

export const adminReadProblemFixtures = defineFixtureSet({
  name: 'admin.read-problem',
  schema: adminReadProblemSchema,
  fixtures: {
    authentication: problem('AUTHENTICATION_REQUIRED', 401),
    session_expired: problem('AUTH_SESSION_EXPIRED', 401),
    permission: problem('EVENT_ACCESS_DENIED', 403),
    not_found: problem('ADMIN_RESOURCE_NOT_FOUND', 404),
    validation: problem('VALIDATION_FAILED', 422),
    internal_error: problem('INTERNAL_ERROR', 500),
  },
});

export const adminMutationProblemFixtures = defineFixtureSet({
  name: 'admin.mutation-problem',
  schema: adminMutationProblemSchema,
  fixtures: {
    permission: problem('EVENT_ACCESS_DENIED', 403),
    stale: {
      type: problemTypeForCode('STALE_VERSION'),
      title: 'Synthetic admin problem',
      status: 409,
      code: 'STALE_VERSION',
      detail: 'Synthetic admin resource is stale.',
      requestId: 'fixture-admin-0002',
      currentVersion: 6,
    },
    invalid_transition: problem('ADMIN_INVALID_TRANSITION', 409),
    last_administrator: problem('LAST_ADMINISTRATOR_GUARD', 409),
    self_lockout: problem('SELF_LOCKOUT_GUARD', 409),
    key_reused: problem('IDEMPOTENCY_KEY_REUSED', 409),
    in_progress: problem('IDEMPOTENCY_IN_PROGRESS', 409),
  },
});

export const adminExportProblemFixtures = defineFixtureSet({
  name: 'admin.export-problem',
  schema: adminExportProblemSchema,
  fixtures: {
    permission: problem('EVENT_ACCESS_DENIED', 403),
    unavailable: problem('EXPORT_UNAVAILABLE', 409),
    key_reused: problem('IDEMPOTENCY_KEY_REUSED', 409),
    in_progress: problem('IDEMPOTENCY_IN_PROGRESS', 409),
  },
});
