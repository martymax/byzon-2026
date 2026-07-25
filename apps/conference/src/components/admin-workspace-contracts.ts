import { z } from 'zod';

const opaqueIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[a-z0-9._:-]+$/i);
const versionSchema = z.number().int().positive();
const timestampSchema = z.string().datetime({ offset: true });
const safeText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f<>]/.test(value), {
      message: 'Text obsahuje nepovolené znaky.',
    });

export const adminDemoRoleSchema = z.enum([
  'organizer_admin',
  'support_operator',
  'room_operator',
  'participant',
]);
export type AdminDemoRole = z.infer<typeof adminDemoRoleSchema>;

export const adminWorkspaceSectionSchema = z.enum([
  'overview',
  'import',
  'support',
  'announcements',
  'operations',
  'reservations',
  'content',
]);
export type AdminWorkspaceSection = z.infer<typeof adminWorkspaceSectionSchema>;

export const adminWorkspaceScopeSchema = z.strictObject({
  eventId: opaqueIdSchema,
  eventName: safeText(120),
  eventTimezone: z.string().trim().min(3).max(80),
  role: adminDemoRoleSchema,
  assignedSessionIds: z.array(opaqueIdSchema).max(30),
});
export type AdminWorkspaceScope = z.infer<typeof adminWorkspaceScopeSchema>;

const sectionAccess: Record<AdminDemoRole, readonly AdminWorkspaceSection[]> = {
  organizer_admin: [
    'overview',
    'import',
    'support',
    'announcements',
    'operations',
    'reservations',
    'content',
  ],
  support_operator: ['support'],
  room_operator: ['reservations'],
  participant: [],
};

export const canAccessAdminSection = (
  role: AdminDemoRole,
  section: AdminWorkspaceSection,
): boolean => sectionAccess[role].includes(section);

export const importRowStatusSchema = z.enum([
  'new',
  'unchanged',
  'status_changed',
  'conflict',
  'unknown',
]);
export type ImportRowStatus = z.infer<typeof importRowStatusSchema>;

export const ticketImportRowSchema = z.strictObject({
  rowId: opaqueIdSchema,
  sourceReference: safeText(80),
  displayName: safeText(120),
  maskedContact: safeText(120),
  status: importRowStatusSchema,
  incomingState: z.enum(['active', 'blocked', 'cancelled']).nullable(),
  currentState: z.enum(['active', 'blocked', 'cancelled']).nullable(),
  issues: z.array(safeText(240)).max(8),
});
export type TicketImportRow = z.infer<typeof ticketImportRowSchema>;

const importSummarySchema = z.strictObject({
  total: z.number().int().nonnegative(),
  new: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  statusChanged: z.number().int().nonnegative(),
  conflict: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});

export const ticketImportPreviewSchema = z
  .strictObject({
    previewId: opaqueIdSchema,
    eventId: opaqueIdSchema,
    previewVersion: opaqueIdSchema,
    source: z.strictObject({
      fileName: safeText(180),
      mediaType: z.enum(['text/csv', 'application/vnd.openxmlformats']),
      byteSize: z.number().int().positive().max(10_000_000),
    }),
    createdAt: timestampSchema,
    rows: z.array(ticketImportRowSchema).min(1).max(500),
    summary: importSummarySchema,
  })
  .superRefine((preview, context) => {
    const counts = {
      total: preview.rows.length,
      new: preview.rows.filter(({ status }) => status === 'new').length,
      unchanged: preview.rows.filter(({ status }) => status === 'unchanged')
        .length,
      statusChanged: preview.rows.filter(
        ({ status }) => status === 'status_changed',
      ).length,
      conflict: preview.rows.filter(({ status }) => status === 'conflict')
        .length,
      unknown: preview.rows.filter(({ status }) => status === 'unknown').length,
    };

    if (JSON.stringify(counts) !== JSON.stringify(preview.summary)) {
      context.addIssue({
        code: 'custom',
        path: ['summary'],
        message: 'Souhrn neodpovídá řádkům immutable preview.',
      });
    }
  });
export type TicketImportPreview = z.infer<typeof ticketImportPreviewSchema>;

export const canApplyTicketImport = (preview: TicketImportPreview): boolean =>
  preview.summary.unknown === 0;

export const ticketImportApplyRequestSchema = z
  .strictObject({
    eventId: opaqueIdSchema,
    previewId: opaqueIdSchema,
    previewVersion: opaqueIdSchema,
    expectedImpact: importSummarySchema,
    reason: safeText(500),
    idempotencyKey: opaqueIdSchema,
  })
  .superRefine((request, context) => {
    if (request.expectedImpact.unknown > 0) {
      context.addIssue({
        code: 'custom',
        path: ['expectedImpact', 'unknown'],
        message: 'Neznámý stav nesmí být aplikován.',
      });
    }
  });
export type TicketImportApplyRequest = z.infer<
  typeof ticketImportApplyRequestSchema
>;

export const ticketImportReportSchema = z.strictObject({
  reportId: opaqueIdSchema,
  previewId: opaqueIdSchema,
  previewVersion: opaqueIdSchema,
  state: z.literal('mock_applied'),
  applied: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  skippedConflicts: z.number().int().nonnegative(),
  completedAt: timestampSchema,
  auditId: opaqueIdSchema,
});
export type TicketImportReport = z.infer<typeof ticketImportReportSchema>;

export const applyTicketImportPreview = (
  previewInput: TicketImportPreview,
  requestInput: TicketImportApplyRequest,
): TicketImportReport => {
  const preview = ticketImportPreviewSchema.parse(previewInput);
  const request = ticketImportApplyRequestSchema.parse(requestInput);
  if (
    request.eventId !== preview.eventId ||
    request.previewId !== preview.previewId ||
    request.previewVersion !== preview.previewVersion ||
    JSON.stringify(request.expectedImpact) !== JSON.stringify(preview.summary)
  ) {
    throw new Error('IMPORT_PREVIEW_STALE');
  }
  if (!canApplyTicketImport(preview)) {
    throw new Error('IMPORT_UNKNOWN_STATUS');
  }

  return ticketImportReportSchema.parse({
    reportId: `mock-report-${preview.previewId}`,
    previewId: preview.previewId,
    previewVersion: preview.previewVersion,
    state: 'mock_applied',
    applied: preview.summary.new + preview.summary.statusChanged,
    unchanged: preview.summary.unchanged,
    skippedConflicts: preview.summary.conflict,
    completedAt: '2026-07-25T12:30:00.000+02:00',
    auditId: `mock-audit-${preview.previewId}`,
  });
};

export const supportActionSchema = z.enum([
  'resend',
  'reassign',
  'block',
  'reactivate',
  'transfer',
]);
export type SupportAction = z.infer<typeof supportActionSchema>;

export const supportRecordSchema = z.strictObject({
  participantId: opaqueIdSchema,
  eventId: opaqueIdSchema,
  displayName: safeText(120),
  maskedContact: safeText(120),
  ticketReference: safeText(80),
  ticketState: z.enum(['active', 'blocked']),
  accessState: z.enum(['claimed', 'not_claimed']),
  version: versionSchema,
});
export type SupportRecord = z.infer<typeof supportRecordSchema>;

export const auditEntrySchema = z.strictObject({
  auditId: opaqueIdSchema,
  eventId: opaqueIdSchema,
  actorLabel: safeText(100),
  category: z.enum([
    'support',
    'import',
    'announcement',
    'role',
    'reservation',
    'attendance',
    'settings',
    'export',
  ]),
  action: safeText(100),
  targetReference: safeText(120),
  reason: safeText(500),
  outcome: z.enum(['succeeded', 'rejected', 'queued']),
  createdAt: timestampSchema,
  resultingVersion: versionSchema.nullable(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const supportMutationRequestSchema = z
  .strictObject({
    eventId: opaqueIdSchema,
    participantId: opaqueIdSchema,
    action: supportActionSchema,
    reason: safeText(500),
    targetTicketReference: safeText(80).nullable(),
    expectedVersion: versionSchema,
    idempotencyKey: opaqueIdSchema,
  })
  .superRefine((request, context) => {
    if (
      ['reassign', 'transfer'].includes(request.action) &&
      request.targetTicketReference === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['targetTicketReference'],
        message: 'Cílová reference je pro tuto akci povinná.',
      });
    }
  });
export type SupportMutationRequest = z.infer<
  typeof supportMutationRequestSchema
>;

export const supportMutationResponseSchema = z.strictObject({
  record: supportRecordSchema,
  audit: auditEntrySchema,
  result: z.enum(['applied', 'already_applied']),
});
export type SupportMutationResponse = z.infer<
  typeof supportMutationResponseSchema
>;

export const applySupportMutation = (
  recordInput: SupportRecord,
  requestInput: SupportMutationRequest,
): SupportMutationResponse => {
  const record = supportRecordSchema.parse(recordInput);
  const request = supportMutationRequestSchema.parse(requestInput);
  if (
    record.eventId !== request.eventId ||
    record.participantId !== request.participantId
  ) {
    throw new Error('SUPPORT_SCOPE_MISMATCH');
  }
  if (record.version !== request.expectedVersion) {
    throw new Error('SUPPORT_STALE_VERSION');
  }
  if (
    (request.action === 'block' && record.ticketState === 'blocked') ||
    (request.action === 'reactivate' && record.ticketState === 'active')
  ) {
    throw new Error('SUPPORT_INVALID_TRANSITION');
  }

  const ticketState =
    request.action === 'block'
      ? 'blocked'
      : request.action === 'reactivate'
        ? 'active'
        : record.ticketState;
  const ticketReference =
    request.action === 'reassign' || request.action === 'transfer'
      ? request.targetTicketReference!
      : record.ticketReference;
  const resultingVersion = record.version + 1;

  return supportMutationResponseSchema.parse({
    record: {
      ...record,
      ticketState,
      ticketReference,
      version: resultingVersion,
    },
    result: 'applied',
    audit: {
      auditId: `mock-audit-${request.idempotencyKey}`,
      eventId: record.eventId,
      actorLabel: 'Demo operátor',
      category: 'support',
      action: request.action,
      targetReference: record.ticketReference,
      reason: request.reason,
      outcome: 'succeeded',
      createdAt: '2026-07-25T12:40:00.000+02:00',
      resultingVersion,
    },
  });
};

export const announcementDraftSchema = z.strictObject({
  title: safeText(160),
  bodyText: safeText(4_000),
  severity: z.enum(['info', 'important', 'critical']),
  audience: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('event') }),
    z.strictObject({
      kind: z.literal('session'),
      sessionId: opaqueIdSchema,
    }),
  ]),
});
export type AnnouncementDraft = z.infer<typeof announcementDraftSchema>;

export const announcementPreviewSchema = z.strictObject({
  previewId: opaqueIdSchema,
  previewVersion: opaqueIdSchema,
  eventId: opaqueIdSchema,
  draft: announcementDraftSchema,
  recipientCount: z.number().int().nonnegative().max(100_000),
  excludedCount: z.number().int().nonnegative().max(100_000),
  createdAt: timestampSchema,
});
export type AnnouncementPreview = z.infer<typeof announcementPreviewSchema>;

export const createAnnouncementPreview = (
  eventId: string,
  draftInput: AnnouncementDraft,
): AnnouncementPreview => {
  const draft = announcementDraftSchema.parse(draftInput);
  const fingerprint = [
    draft.title.length,
    draft.bodyText.length,
    draft.severity,
    draft.audience.kind,
    draft.audience.kind === 'session' ? draft.audience.sessionId : 'event',
  ].join('-');
  return announcementPreviewSchema.parse({
    previewId: `mock-ann-preview-${fingerprint}`,
    previewVersion: `mock-ann-version-${fingerprint}`,
    eventId,
    draft,
    recipientCount: draft.audience.kind === 'event' ? 428 : 37,
    excludedCount: draft.audience.kind === 'event' ? 12 : 2,
    createdAt: '2026-07-25T12:45:00.000+02:00',
  });
};

export const announcementSendRequestSchema = z.strictObject({
  eventId: opaqueIdSchema,
  previewId: opaqueIdSchema,
  previewVersion: opaqueIdSchema,
  reason: safeText(500),
  idempotencyKey: opaqueIdSchema,
});

export const announcementSendResponseSchema = z.strictObject({
  announcementId: opaqueIdSchema,
  state: z.literal('sent_in_app_mock'),
  recipientCount: z.number().int().nonnegative(),
  sentAt: timestampSchema,
  audit: auditEntrySchema,
});
export type AnnouncementSendResponse = z.infer<
  typeof announcementSendResponseSchema
>;

export const sendAnnouncementPreview = (
  previewInput: AnnouncementPreview,
  requestInput: z.infer<typeof announcementSendRequestSchema>,
): AnnouncementSendResponse => {
  const preview = announcementPreviewSchema.parse(previewInput);
  const request = announcementSendRequestSchema.parse(requestInput);
  if (
    preview.eventId !== request.eventId ||
    preview.previewId !== request.previewId ||
    preview.previewVersion !== request.previewVersion
  ) {
    throw new Error('ANNOUNCEMENT_PREVIEW_STALE');
  }

  return announcementSendResponseSchema.parse({
    announcementId: `mock-announcement-${preview.previewId}`,
    state: 'sent_in_app_mock',
    recipientCount: preview.recipientCount,
    sentAt: '2026-07-25T12:50:00.000+02:00',
    audit: {
      auditId: `mock-audit-${request.idempotencyKey}`,
      eventId: preview.eventId,
      actorLabel: 'Demo administrátor',
      category: 'announcement',
      action: 'send_in_app',
      targetReference: preview.previewId,
      reason: request.reason,
      outcome: 'succeeded',
      createdAt: '2026-07-25T12:50:00.000+02:00',
      resultingVersion: 1,
    },
  });
};

export const operationsOverviewSchema = z.strictObject({
  eventId: opaqueIdSchema,
  generatedAt: timestampSchema,
  metrics: z.array(
    z.strictObject({
      id: z.enum([
        'activation',
        'import',
        'content',
        'checkin',
        'reservation',
        'notification',
      ]),
      label: safeText(100),
      value: safeText(80),
      state: z.enum(['healthy', 'attention', 'degraded']),
      detail: safeText(240),
    }),
  ),
  queues: z.array(
    z.strictObject({
      queue: z.enum(['default', 'notifications', 'exports']),
      ready: z.number().int().nonnegative(),
      processing: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    }),
  ),
  assignments: z.array(
    z.strictObject({
      assignmentId: opaqueIdSchema,
      operatorLabel: safeText(100),
      role: z.enum(['checkin_operator', 'room_operator', 'moderator']),
      scopeLabel: safeText(120),
      state: z.enum(['active', 'scheduled']),
      version: versionSchema,
    }),
  ),
});
export type OperationsOverview = z.infer<typeof operationsOverviewSchema>;

export const reservationRecordSchema = z.strictObject({
  reservationId: opaqueIdSchema,
  eventId: opaqueIdSchema,
  sessionId: opaqueIdSchema,
  sessionTitle: safeText(160),
  participantReference: safeText(80),
  state: z.enum(['reserved', 'cancelled', 'attended']),
  capacity: z.number().int().positive(),
  reservedCount: z.number().int().nonnegative(),
  version: versionSchema,
});
export type ReservationRecord = z.infer<typeof reservationRecordSchema>;

export const eventSettingsSchema = z.strictObject({
  eventId: opaqueIdSchema,
  registrationMode: z.enum(['open', 'invite_only', 'closed']),
  reservationChangesAllowed: z.boolean(),
  supportMessage: safeText(240),
  version: versionSchema,
});
export type EventSettings = z.infer<typeof eventSettingsSchema>;

export const adminReasonSchema = safeText(500);
