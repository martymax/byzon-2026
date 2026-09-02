import { z } from 'zod';

import {
  defineApiProblemSchema,
  idempotencyInProgressProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyKeySchema,
  opaqueCursorSchema,
  requestIdSchema,
  sessionExpiredProblemSchema,
} from './base.js';

const uuidSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime({ offset: true });
const versionSchema = z.number().int().positive();
const unsafeInlineTextPattern =
  /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069<>]/;
const unsafeMultilineTextPattern =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069<>]/;

const safeInlineTextSchema = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim().length > 0, {
      message: 'Text must not be blank',
    })
    .refine((value) => !unsafeInlineTextPattern.test(value), {
      message: 'Text contains unsafe control characters or markup',
    });

const safeMultilineTextSchema = (minimum: number, maximum: number) =>
  z
    .string()
    .min(minimum)
    .max(maximum)
    .refine((value) => value.trim().length >= minimum, {
      message: `Text must contain at least ${minimum} visible characters`,
    })
    .refine((value) => !unsafeMultilineTextPattern.test(value), {
      message: 'Text contains unsafe control characters or markup',
    });

const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Timezone must be a supported IANA timezone' },
  );

const mutationReasonSchema = safeMultilineTextSchema(8, 500);

/**
 * CS-ADMIN-01 carries P3 operational data. Reads and mutations are
 * server-authorized, event-scoped, online-only and never browser-persisted.
 */
export const adminCachePolicy = Object.freeze({
  cacheControl: 'private, no-store',
  browserPersistence: 'forbidden',
  sharedCache: 'forbidden',
  mutation: 'online-only',
  mutationIdempotency: 'required',
  permissionRevocationWipe: 'required',
} as const);

export const adminPermissionSchema = z.enum([
  'program:manage',
  'ticket:any:manage',
  'participant:operational:read',
  'role:manage',
  'operations:read',
  'audit:read',
  'event:settings:manage',
  'reservation:any:read',
  'reservation:assigned:read',
  'agenda:any:override',
  'announcement:send',
  'personal-data:operational:export',
]);

export type AdminPermission = z.infer<typeof adminPermissionSchema>;

export const adminActorRoleSchema = z.enum([
  'organizer_admin',
  'checkin_operator',
  'moderator',
  'room_operator',
]);

export type AdminActorRole = z.infer<typeof adminActorRoleSchema>;

const assignedSessionSchema = z.strictObject({
  sessionId: uuidSchema,
  title: safeInlineTextSchema(160),
});

export const adminContextResponseSchema = z
  .strictObject({
    event: z.strictObject({
      id: uuidSchema,
      name: safeInlineTextSchema(160),
      timezone: timezoneSchema,
      phase: z.enum(['draft', 'activation_open', 'live', 'ended', 'archived']),
    }),
    features: z.strictObject({
      announcementsEnabled: z.boolean(),
    }),
    capabilities: z.strictObject({
      canEnterCheckin: z.boolean(),
    }),
    actor: z.strictObject({
      displayLabel: safeInlineTextSchema(120),
      roles: z.array(adminActorRoleSchema).min(1).max(4),
      permissions: z.array(adminPermissionSchema).max(12),
      assignedSessions: z.array(assignedSessionSchema).max(30),
    }),
  })
  .superRefine((context, refinement) => {
    if (new Set(context.actor.roles).size !== context.actor.roles.length) {
      refinement.addIssue({
        code: 'custom',
        path: ['actor', 'roles'],
        message: 'Admin context roles must be unique',
      });
    }
    if (
      new Set(context.actor.permissions).size !==
      context.actor.permissions.length
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['actor', 'permissions'],
        message: 'Admin context permissions must be unique',
      });
    }
    const sessionIds = context.actor.assignedSessions.map(
      ({ sessionId }) => sessionId,
    );
    if (new Set(sessionIds).size !== sessionIds.length) {
      refinement.addIssue({
        code: 'custom',
        path: ['actor', 'assignedSessions'],
        message: 'Assigned session IDs must be unique',
      });
    }
  });

export type AdminContextResponse = z.infer<typeof adminContextResponseSchema>;

export const adminOperationsMetricIdSchema = z.enum([
  'activation',
  'import',
  'content',
  'checkin',
  'reservation',
  'notification',
]);

export const adminOperationsMetricSchema = z.strictObject({
  id: adminOperationsMetricIdSchema,
  label: safeInlineTextSchema(100),
  value: safeInlineTextSchema(80),
  state: z.enum(['healthy', 'attention', 'degraded']),
  detail: safeInlineTextSchema(240),
});

const adminQueueSummarySchema = z.strictObject({
  queue: z.enum(['default', 'notifications', 'exports']),
  ready: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const adminOperationsOverviewResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    version: versionSchema,
    generatedAt: dateTimeSchema,
    metrics: z.array(adminOperationsMetricSchema).max(6),
    queues: z.array(adminQueueSummarySchema).max(3),
  })
  .superRefine((overview, context) => {
    const metricIds = overview.metrics.map(({ id }) => id);
    if (new Set(metricIds).size !== metricIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['metrics'],
        message: 'Operations metric IDs must be unique',
      });
    }
    const queues = overview.queues.map(({ queue }) => queue);
    if (new Set(queues).size !== queues.length) {
      context.addIssue({
        code: 'custom',
        path: ['queues'],
        message: 'Operations queues must be unique',
      });
    }
  });

export type AdminOperationsOverviewResponse = z.infer<
  typeof adminOperationsOverviewResponseSchema
>;

export const adminAssignmentRoleSchema = z.enum([
  'checkin_operator',
  'moderator',
  'room_operator',
]);

export type AdminAssignmentRole = z.infer<typeof adminAssignmentRoleSchema>;

export const adminAssignmentScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('event'),
    label: safeInlineTextSchema(120),
  }),
  z.strictObject({
    kind: z.literal('station'),
    stationId: uuidSchema,
    label: safeInlineTextSchema(120),
  }),
  z.strictObject({
    kind: z.literal('session'),
    sessionId: uuidSchema,
    label: safeInlineTextSchema(160),
  }),
]);

export type AdminAssignmentScope = z.infer<typeof adminAssignmentScopeSchema>;

export const adminRoleAssignmentSchema = z.strictObject({
  assignmentId: uuidSchema,
  eventId: uuidSchema,
  operatorId: uuidSchema,
  operatorLabel: safeInlineTextSchema(120),
  role: adminAssignmentRoleSchema,
  scope: adminAssignmentScopeSchema,
  state: z.enum(['active', 'scheduled']),
  version: versionSchema,
});

export type AdminRoleAssignment = z.infer<typeof adminRoleAssignmentSchema>;

export const adminRoleAssignmentListQuerySchema = z.strictObject({
  role: adminAssignmentRoleSchema.optional(),
  state: z.enum(['active', 'scheduled']).optional(),
  scopeKind: z.enum(['event', 'station', 'session']).optional(),
  cursor: opaqueCursorSchema.optional(),
});

export type AdminRoleAssignmentListQuery = z.infer<
  typeof adminRoleAssignmentListQuerySchema
>;

export const adminRoleAssignmentListResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    assignmentsVersion: versionSchema,
    items: z.array(adminRoleAssignmentSchema).max(100),
    pageInfo: z.strictObject({
      nextCursor: opaqueCursorSchema.nullable(),
      hasMore: z.boolean(),
    }),
  })
  .superRefine((response, context) => {
    const ids = response.items.map(({ assignmentId }) => assignmentId);
    if (
      response.items.some(({ eventId }) => eventId !== response.eventId) ||
      new Set(ids).size !== ids.length ||
      response.pageInfo.hasMore !== (response.pageInfo.nextCursor !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message:
          'Role assignments must be event-scoped, unique and carry consistent page info',
      });
    }
  });

export type AdminRoleAssignmentListResponse = z.infer<
  typeof adminRoleAssignmentListResponseSchema
>;

export const adminRolePersonSearchRequestSchema = z.strictObject({
  query: safeInlineTextSchema(120).refine(
    (value) => value.trim().length >= 2,
    'Person search needs at least two visible characters',
  ),
});

export type AdminRolePersonSearchRequest = z.infer<
  typeof adminRolePersonSearchRequestSchema
>;

export const adminRolePersonSchema = z.strictObject({
  operatorId: uuidSchema,
  displayName: safeInlineTextSchema(120),
  maskedVerifiedContact: safeInlineTextSchema(160).refine(
    (value) => /[*•…]/.test(value),
    'Verified contact must remain masked',
  ),
});

export type AdminRolePerson = z.infer<typeof adminRolePersonSchema>;

export const adminRolePersonSearchResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    items: z.array(adminRolePersonSchema).max(20),
  })
  .superRefine((response, context) => {
    const ids = response.items.map(({ operatorId }) => operatorId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Role person search results must be unique',
      });
    }
  });

export type AdminRolePersonSearchResponse = z.infer<
  typeof adminRolePersonSearchResponseSchema
>;

export const adminRoleScopeOptionsRequestSchema = z.strictObject({
  role: adminAssignmentRoleSchema,
});

export type AdminRoleScopeOptionsRequest = z.infer<
  typeof adminRoleScopeOptionsRequestSchema
>;

export const adminRoleScopeOptionsResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    role: adminAssignmentRoleSchema,
    options: z.array(adminAssignmentScopeSchema).max(200),
  })
  .superRefine((response, context) => {
    const compatible = (kind: AdminAssignmentScope['kind']) =>
      response.role === 'checkin_operator'
        ? kind === 'station'
        : response.role === 'moderator'
          ? kind === 'event' || kind === 'session'
          : kind === 'session';
    const ids = response.options.map((option) =>
      option.kind === 'event'
        ? 'event'
        : option.kind === 'station'
          ? option.stationId
          : option.sessionId,
    );
    if (
      response.options.some(({ kind }) => !compatible(kind)) ||
      new Set(ids).size !== ids.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Role scope options must be compatible and unique',
      });
    }
  });

export type AdminRoleScopeOptionsResponse = z.infer<
  typeof adminRoleScopeOptionsResponseSchema
>;

const roleAssignmentMutationBase = {
  expectedVersion: versionSchema,
  reason: mutationReasonSchema,
} as const;

/**
 * Actor roles are derived from the authenticated event policy and are never
 * accepted from this mutation body.
 */
export const adminRoleAssignmentMutationRequestSchema = z.discriminatedUnion(
  'action',
  [
    z.strictObject({
      ...roleAssignmentMutationBase,
      action: z.literal('grant'),
      operatorId: uuidSchema,
      role: adminAssignmentRoleSchema,
      scope: adminAssignmentScopeSchema,
    }),
    z.strictObject({
      ...roleAssignmentMutationBase,
      action: z.literal('revoke'),
      assignmentId: uuidSchema,
    }),
  ],
);

export type AdminRoleAssignmentMutationRequest = z.infer<
  typeof adminRoleAssignmentMutationRequestSchema
>;

export const adminRoleAssignmentMutationHeadersSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});

export const adminRoleAssignmentMutationResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    outcome: z.enum(['granted', 'revoked', 'already_applied']),
    assignmentsVersion: versionSchema,
    assignment: adminRoleAssignmentSchema.nullable(),
    changedAt: dateTimeSchema,
    audit: z.strictObject({ auditId: uuidSchema }),
  })
  .superRefine((response, context) => {
    if (response.outcome === 'granted' && response.assignment === null) {
      context.addIssue({
        code: 'custom',
        path: ['assignment'],
        message: 'A granted role response must carry the assignment',
      });
    }
    if (
      response.assignment !== null &&
      response.assignment.eventId !== response.eventId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assignment', 'eventId'],
        message: 'Role assignment must match the response event',
      });
    }
  });

export type AdminRoleAssignmentMutationResponse = z.infer<
  typeof adminRoleAssignmentMutationResponseSchema
>;

export const adminExportReportSchema = z.enum([
  'participant_summary',
  'checkin_summary',
  'reservation_summary',
  'audit_log',
]);

export type AdminExportReport = z.infer<typeof adminExportReportSchema>;

export const adminExportRequestSchema = z
  .strictObject({
    report: adminExportReportSchema,
    format: z.enum(['csv', 'json']),
    range: z
      .strictObject({
        from: dateTimeSchema,
        to: dateTimeSchema,
      })
      .nullable(),
    reason: mutationReasonSchema,
  })
  .superRefine((request, context) => {
    if (
      request.range !== null &&
      Date.parse(request.range.to) < Date.parse(request.range.from)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['range', 'to'],
        message: 'Export range end cannot precede its start',
      });
    }
  });

export type AdminExportRequest = z.infer<typeof adminExportRequestSchema>;

export const adminExportHeadersSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});

export const adminExportResponseSchema = z.strictObject({
  eventId: uuidSchema,
  exportId: uuidSchema,
  report: adminExportReportSchema,
  outcome: z.enum(['queued', 'already_queued']),
  state: z.literal('queued'),
  queuedAt: dateTimeSchema,
  audit: z.strictObject({ auditId: uuidSchema }),
});

export type AdminExportResponse = z.infer<typeof adminExportResponseSchema>;

export const adminReservationActionSchema = z.enum([
  'capacity_override',
  'cancel_reservation',
]);

export type AdminReservationAction = z.infer<
  typeof adminReservationActionSchema
>;

const adminReservationCapacitySchema = z.number().int().positive().max(100_000);

export const adminSessionCapacityRecordSchema = z
  .strictObject({
    eventId: uuidSchema,
    sessionId: uuidSchema,
    sessionTitle: safeInlineTextSchema(160),
    sessionType: z.enum([
      'talk',
      'panel',
      'workshop',
      'mastermind',
      'coaching',
      'networking',
      'break',
      'meal',
      'gala',
      'other',
    ]),
    sessionStatus: z.enum(['draft', 'published', 'cancelled', 'archived']),
    capacity: adminReservationCapacitySchema.nullable(),
    confirmedCount: z.number().int().nonnegative().max(100_000),
    version: versionSchema,
  })
  .superRefine((record, context) => {
    if (record.capacity === null && record.sessionType !== 'networking') {
      context.addIssue({
        code: 'custom',
        path: ['capacity'],
        message: 'Only networking may await an administrator-set capacity',
      });
    }
    if (record.capacity === null && record.confirmedCount !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['confirmedCount'],
        message: 'An unconfigured activity cannot have reservations',
      });
    }
    if (record.capacity !== null && record.confirmedCount > record.capacity) {
      context.addIssue({
        code: 'custom',
        path: ['confirmedCount'],
        message: 'Confirmed count cannot exceed canonical capacity',
      });
    }
  });

export type AdminSessionCapacityRecord = z.infer<
  typeof adminSessionCapacityRecordSchema
>;

export const adminSessionCapacityListResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    generatedAt: dateTimeSchema,
    items: z.array(adminSessionCapacityRecordSchema).max(100),
  })
  .superRefine((response, context) => {
    if (
      response.items.some(({ eventId }) => eventId !== response.eventId) ||
      new Set(response.items.map(({ sessionId }) => sessionId)).size !==
        response.items.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Capacity items must be unique and match the response event',
      });
    }
  });

export type AdminSessionCapacityListResponse = z.infer<
  typeof adminSessionCapacityListResponseSchema
>;

export const adminReservationRecordSchema = z
  .strictObject({
    reservationId: uuidSchema,
    eventId: uuidSchema,
    sessionId: uuidSchema,
    sessionTitle: safeInlineTextSchema(160),
    participantReference: safeInlineTextSchema(80),
    state: z.enum(['reserved', 'cancelled']),
    capacity: adminReservationCapacitySchema,
    reservedCount: z.number().int().nonnegative().max(100_000),
    version: versionSchema,
    availableActions: z.array(adminReservationActionSchema).max(4),
  })
  .superRefine((record, context) => {
    if (record.reservedCount > record.capacity) {
      context.addIssue({
        code: 'custom',
        path: ['reservedCount'],
        message: 'Reserved count cannot exceed canonical capacity',
      });
    }
    if (
      new Set(record.availableActions).size !== record.availableActions.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['availableActions'],
        message: 'Available reservation actions must be unique',
      });
    }
  });

export type AdminReservationRecord = z.infer<
  typeof adminReservationRecordSchema
>;

export const adminReservationListResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    generatedAt: dateTimeSchema,
    items: z.array(adminReservationRecordSchema).max(100),
  })
  .superRefine((response, context) => {
    if (
      response.items.some(({ eventId }) => eventId !== response.eventId) ||
      new Set(response.items.map(({ reservationId }) => reservationId)).size !==
        response.items.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message:
          'Reservation items must be unique and match the response event',
      });
    }
  });

export type AdminReservationListResponse = z.infer<
  typeof adminReservationListResponseSchema
>;

const maskedParticipantReferenceSchema = safeInlineTextSchema(80).refine(
  (value) =>
    /[*•…]/.test(value) &&
    !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value),
  'Participant reference must be masked',
);

export const adminReservationSessionQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(50).default(25),
});

export type AdminReservationSessionQuery = z.infer<
  typeof adminReservationSessionQuerySchema
>;

export const adminReservationSessionItemSchema = z
  .strictObject({
    eventId: uuidSchema,
    sessionId: uuidSchema,
    sessionTitle: safeInlineTextSchema(160),
    localDate: z.string().date().nullable(),
    startsAt: dateTimeSchema.nullable(),
    roomLabel: safeInlineTextSchema(120).nullable(),
    capacity: adminReservationCapacitySchema.nullable(),
    confirmedCount: z.number().int().nonnegative().max(100_000),
    waitingCount: z.number().int().nonnegative().max(100_000).nullable(),
    capacityVersion: versionSchema,
    reservations: z
      .array(
        z.strictObject({
          reservationId: uuidSchema,
          maskedParticipantReference: maskedParticipantReferenceSchema,
          state: z.enum(['reserved', 'cancelled']),
          version: versionSchema,
          availableActions: z.array(adminReservationActionSchema).max(2),
        }),
      )
      .max(100),
  })
  .superRefine((item, context) => {
    if (item.capacity !== null && item.confirmedCount > item.capacity) {
      context.addIssue({
        code: 'custom',
        path: ['confirmedCount'],
        message: 'Confirmed count cannot exceed session capacity',
      });
    }
    const ids = item.reservations.map(({ reservationId }) => reservationId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['reservations'],
        message: 'Session reservation IDs must be unique',
      });
    }
  });

export type AdminReservationSessionItem = z.infer<
  typeof adminReservationSessionItemSchema
>;

export const adminReservationSessionPageSchema = z
  .strictObject({
    eventId: uuidSchema,
    generatedAt: dateTimeSchema,
    items: z.array(adminReservationSessionItemSchema).max(50),
    pageInfo: z.strictObject({
      nextCursor: z.string().min(1).max(200).nullable(),
      hasMore: z.boolean(),
    }),
  })
  .superRefine((page, context) => {
    if (
      page.items.some(({ eventId }) => eventId !== page.eventId) ||
      new Set(page.items.map(({ sessionId }) => sessionId)).size !==
        page.items.length ||
      page.pageInfo.hasMore !== (page.pageInfo.nextCursor !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message:
          'Reservation sessions must be event-scoped, unique and carry consistent page info',
      });
    }
  });

export type AdminReservationSessionPage = z.infer<
  typeof adminReservationSessionPageSchema
>;

const reservationMutationBase = {
  reservationId: uuidSchema,
  expectedVersion: versionSchema,
  reason: mutationReasonSchema,
} as const;

/**
 * Assigned session IDs are server-side authorization context. They are
 * intentionally absent from every reservation mutation request.
 *
 * `capacity_override` is a rollout-only compatibility branch for cached
 * clients. New clients edit capacity through the session-level contract.
 */
export const adminReservationMutationRequestSchema = z.discriminatedUnion(
  'action',
  [
    z.strictObject({
      ...reservationMutationBase,
      action: z.literal('capacity_override'),
      capacity: adminReservationCapacitySchema,
    }),
    z.strictObject({
      ...reservationMutationBase,
      action: z.literal('cancel_reservation'),
    }),
  ],
);

export type AdminReservationMutationRequest = z.infer<
  typeof adminReservationMutationRequestSchema
>;

export const adminReservationMutationHeadersSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});

export const adminReservationMutationResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    outcome: z.enum(['updated', 'already_applied']),
    record: adminReservationRecordSchema,
    changedAt: dateTimeSchema,
    audit: z.strictObject({ auditId: uuidSchema }),
  })
  .superRefine((response, context) => {
    if (response.record.eventId !== response.eventId) {
      context.addIssue({
        code: 'custom',
        path: ['record', 'eventId'],
        message: 'Reservation mutation record must match the response event',
      });
    }
  });

export type AdminReservationMutationResponse = z.infer<
  typeof adminReservationMutationResponseSchema
>;

export const adminSessionCapacityMutationRequestSchema = z.strictObject({
  sessionId: uuidSchema,
  expectedVersion: versionSchema,
  capacity: adminReservationCapacitySchema,
  reason: mutationReasonSchema,
});

export type AdminSessionCapacityMutationRequest = z.infer<
  typeof adminSessionCapacityMutationRequestSchema
>;

export const adminSessionCapacityMutationResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    outcome: z.enum(['updated', 'already_applied']),
    record: adminSessionCapacityRecordSchema,
    changedAt: dateTimeSchema,
    audit: z.strictObject({ auditId: uuidSchema }),
  })
  .superRefine((response, context) => {
    if (response.record.eventId !== response.eventId) {
      context.addIssue({
        code: 'custom',
        path: ['record', 'eventId'],
        message: 'Session capacity record must match the response event',
      });
    }
  });

export type AdminSessionCapacityMutationResponse = z.infer<
  typeof adminSessionCapacityMutationResponseSchema
>;

export const adminAuditCategorySchema = z.enum([
  'support',
  'import',
  'announcement',
  'role',
  'reservation',
  'settings',
  'export',
]);

export type AdminAuditCategory = z.infer<typeof adminAuditCategorySchema>;

export const adminAuditEntrySchema = z.strictObject({
  auditId: uuidSchema,
  eventId: uuidSchema,
  actorLabel: safeInlineTextSchema(120),
  category: adminAuditCategorySchema,
  action: safeInlineTextSchema(100),
  targetReference: safeInlineTextSchema(120),
  reason: safeMultilineTextSchema(1, 500),
  outcome: z.enum(['succeeded', 'rejected', 'queued']),
  createdAt: dateTimeSchema,
  resultingVersion: versionSchema.nullable(),
  redacted: z.boolean(),
});

export type AdminAuditEntry = z.infer<typeof adminAuditEntrySchema>;

export const adminAuditQuerySchema = z
  .strictObject({
    category: adminAuditCategorySchema.optional(),
    action: safeInlineTextSchema(100).optional(),
    requestId: requestIdSchema.optional(),
    from: dateTimeSchema.optional(),
    to: dateTimeSchema.optional(),
    cursor: opaqueCursorSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .superRefine((query, context) => {
    if (
      query.from !== undefined &&
      query.to !== undefined &&
      Date.parse(query.to) < Date.parse(query.from)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Audit query end cannot precede its start',
      });
    }
  });

export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

export const adminAuditResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    items: z.array(adminAuditEntrySchema).max(100),
    pageInfo: z.strictObject({
      nextCursor: opaqueCursorSchema.nullable(),
      hasMore: z.boolean(),
    }),
  })
  .superRefine((response, context) => {
    if (
      response.items.some(({ eventId }) => eventId !== response.eventId) ||
      new Set(response.items.map(({ auditId }) => auditId)).size !==
        response.items.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Audit entries must be unique and match the response event',
      });
    }
    response.items.slice(1).forEach((item, index) => {
      const previous = response.items[index];
      if (
        previous &&
        (Date.parse(item.createdAt) > Date.parse(previous.createdAt) ||
          (item.createdAt === previous.createdAt &&
            item.auditId > previous.auditId))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index + 1, 'createdAt'],
          message: 'Audit entries must be ordered newest-first',
        });
      }
    });
    if (response.pageInfo.hasMore !== (response.pageInfo.nextCursor !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['pageInfo'],
        message: 'Audit cursor must match hasMore',
      });
    }
  });

export type AdminAuditResponse = z.infer<typeof adminAuditResponseSchema>;

export const adminEventSettingsSchema = z.strictObject({
  eventId: uuidSchema,
  registrationMode: z.enum(['open', 'invite_only', 'closed']),
  reservationChangesAllowed: z.boolean(),
  supportMessage: safeMultilineTextSchema(1, 240),
  version: versionSchema,
});

export type AdminEventSettings = z.infer<typeof adminEventSettingsSchema>;

export const adminEventSettingsUpdateRequestSchema = z.strictObject({
  expectedVersion: versionSchema,
  settings: z.strictObject({
    registrationMode: z.enum(['open', 'invite_only', 'closed']),
    reservationChangesAllowed: z.boolean(),
    supportMessage: safeMultilineTextSchema(1, 240),
  }),
  reason: mutationReasonSchema,
});

export type AdminEventSettingsUpdateRequest = z.infer<
  typeof adminEventSettingsUpdateRequestSchema
>;

export const adminEventSettingsUpdateHeadersSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});

export const adminEventSettingsUpdateResponseSchema = z
  .strictObject({
    eventId: uuidSchema,
    outcome: z.enum(['updated', 'already_applied']),
    settings: adminEventSettingsSchema,
    changedAt: dateTimeSchema,
    audit: z.strictObject({ auditId: uuidSchema }),
  })
  .superRefine((response, context) => {
    if (response.settings.eventId !== response.eventId) {
      context.addIssue({
        code: 'custom',
        path: ['settings', 'eventId'],
        message: 'Settings mutation snapshot must match the response event',
      });
    }
  });

export type AdminEventSettingsUpdateResponse = z.infer<
  typeof adminEventSettingsUpdateResponseSchema
>;

export const adminAuthenticationRequiredProblemSchema = defineApiProblemSchema(
  'AUTHENTICATION_REQUIRED',
  401,
);
export const adminEventAccessDeniedProblemSchema = defineApiProblemSchema(
  'EVENT_ACCESS_DENIED',
  403,
);
export const adminResourceNotFoundProblemSchema = defineApiProblemSchema(
  'ADMIN_RESOURCE_NOT_FOUND',
  404,
);
export const adminStaleVersionProblemSchema = defineApiProblemSchema(
  'STALE_VERSION',
  409,
).extend({
  currentVersion: versionSchema,
});
export const adminInvalidTransitionProblemSchema = defineApiProblemSchema(
  'ADMIN_INVALID_TRANSITION',
  409,
);
export const adminLastAdministratorProblemSchema = defineApiProblemSchema(
  'LAST_ADMINISTRATOR_GUARD',
  409,
);
export const adminSelfLockoutProblemSchema = defineApiProblemSchema(
  'SELF_LOCKOUT_GUARD',
  409,
);
export const adminExportUnavailableProblemSchema = defineApiProblemSchema(
  'EXPORT_UNAVAILABLE',
  409,
);
export const adminValidationProblemSchema = defineApiProblemSchema(
  'VALIDATION_FAILED',
  422,
);
export const adminInternalErrorProblemSchema = defineApiProblemSchema(
  'INTERNAL_ERROR',
  500,
);

const adminReadProblems = [
  adminAuthenticationRequiredProblemSchema,
  sessionExpiredProblemSchema,
  adminEventAccessDeniedProblemSchema,
  adminResourceNotFoundProblemSchema,
  adminValidationProblemSchema,
  adminInternalErrorProblemSchema,
] as const;

export const adminReadProblemSchema = z.discriminatedUnion(
  'code',
  adminReadProblems,
);

export const adminMutationProblemSchema = z.discriminatedUnion('code', [
  ...adminReadProblems,
  adminStaleVersionProblemSchema,
  adminInvalidTransitionProblemSchema,
  adminLastAdministratorProblemSchema,
  adminSelfLockoutProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
]);

export const adminExportProblemSchema = z.discriminatedUnion('code', [
  ...adminReadProblems,
  adminExportUnavailableProblemSchema,
  idempotencyKeyReusedProblemSchema,
  idempotencyInProgressProblemSchema,
]);

export type AdminReadProblem = z.infer<typeof adminReadProblemSchema>;
export type AdminMutationProblem = z.infer<typeof adminMutationProblemSchema>;
export type AdminExportProblem = z.infer<typeof adminExportProblemSchema>;
