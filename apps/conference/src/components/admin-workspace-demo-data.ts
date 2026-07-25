import {
  auditEntrySchema,
  eventSettingsSchema,
  type ImportRowStatus,
  operationsOverviewSchema,
  reservationRecordSchema,
  supportRecordSchema,
  ticketImportPreviewSchema,
} from './admin-workspace-contracts';

export const adminDemoScope = Object.freeze({
  eventId: 'event-byzon-2026',
  eventName: 'Byzon 2026 · syntetická akce',
  eventTimezone: 'Europe/Prague',
  assignedSessionIds: ['session-growth-2026'],
} as const);

const importRows = [
  {
    rowId: 'import-row-0001',
    sourceReference: 'SYN-10001',
    displayName: 'Alex N.',
    maskedContact: 'a•••@example.test',
    status: 'new',
    incomingState: 'active',
    currentState: null,
    issues: [],
  },
  {
    rowId: 'import-row-0002',
    sourceReference: 'SYN-10002',
    displayName: 'Beáta K.',
    maskedContact: 'b•••@example.test',
    status: 'unchanged',
    incomingState: 'active',
    currentState: 'active',
    issues: [],
  },
  {
    rowId: 'import-row-0003',
    sourceReference: 'SYN-10003',
    displayName: 'Cyril P.',
    maskedContact: 'c•••@example.test',
    status: 'status_changed',
    incomingState: 'cancelled',
    currentState: 'active',
    issues: ['Stav se změní z aktivní na zrušenou.'],
  },
] as const;

const conflictRows = [
  ...importRows,
  {
    rowId: 'import-row-0004',
    sourceReference: 'SYN-10004',
    displayName: 'Dana R.',
    maskedContact: 'd•••@example.test',
    status: 'conflict',
    incomingState: 'active',
    currentState: 'blocked',
    issues: [
      'Reference odpovídá jiné syntetické vstupence; celý apply je zablokovaný.',
    ],
  },
] as const;

const summaryFor = (rows: readonly { readonly status: ImportRowStatus }[]) => ({
  total: rows.length,
  new: rows.filter(({ status }) => status === 'new').length,
  unchanged: rows.filter(({ status }) => status === 'unchanged').length,
  statusChanged: rows.filter(({ status }) => status === 'status_changed')
    .length,
  conflict: rows.filter(({ status }) => status === 'conflict').length,
  unknown: rows.filter(({ status }) => status === 'unknown').length,
});

export const demoImportPreview = ticketImportPreviewSchema.parse({
  previewId: 'mock-import-preview-2026-07-25',
  eventId: adminDemoScope.eventId,
  previewVersion: 'mock-import-version-0003',
  source: {
    fileName: 'synthetic-tickets.csv',
    mediaType: 'text/csv',
    byteSize: 4_280,
  },
  createdAt: '2026-07-25T12:00:00.000+02:00',
  rows: importRows,
  summary: summaryFor(importRows),
});

const unknownRows = [
  ...importRows,
  {
    rowId: 'import-row-0005',
    sourceReference: 'SYN-10005',
    displayName: 'Erik S.',
    maskedContact: 'e•••@example.test',
    status: 'unknown',
    incomingState: null,
    currentState: null,
    issues: ['Zdroj obsahuje neznámý stav. Preview nelze použít ani částečně.'],
  },
] as const;

export const demoImportPreviewWithUnknown = ticketImportPreviewSchema.parse({
  ...demoImportPreview,
  previewId: 'mock-import-preview-unknown',
  previewVersion: 'mock-import-version-unknown',
  source: {
    fileName: 'synthetic-tickets-unknown.xlsx',
    mediaType: 'application/vnd.openxmlformats',
    byteSize: 8_620,
  },
  rows: unknownRows,
  summary: {
    ...summaryFor(importRows),
    total: unknownRows.length,
    unknown: 1,
  },
});

export const demoSupportRecords = supportRecordSchema.array().parse([
  {
    participantId: 'participant-synthetic-001',
    eventId: adminDemoScope.eventId,
    displayName: 'Alex N.',
    maskedContact: 'a•••@example.test',
    ticketReference: 'SYN-10001',
    ticketState: 'active',
    accessState: 'claimed',
    version: 3,
  },
  {
    participantId: 'participant-synthetic-002',
    eventId: adminDemoScope.eventId,
    displayName: 'Dana R.',
    maskedContact: 'd•••@example.test',
    ticketReference: 'SYN-10004',
    ticketState: 'blocked',
    accessState: 'not_claimed',
    version: 2,
  },
]);

export const demoImportPreviewWithConflict = ticketImportPreviewSchema.parse({
  ...demoImportPreview,
  previewId: 'mock-import-preview-conflict',
  previewVersion: 'mock-import-version-conflict',
  source: {
    fileName: 'synthetic-tickets-conflict.csv',
    mediaType: 'text/csv',
    byteSize: 5_240,
  },
  rows: conflictRows,
  summary: summaryFor(conflictRows),
});

export const demoOperationsOverview = operationsOverviewSchema.parse({
  eventId: adminDemoScope.eventId,
  version: 3,
  generatedAt: '2026-07-25T12:00:00.000+02:00',
  metrics: [
    {
      id: 'activation',
      label: 'Aktivace',
      value: '412 / 440',
      state: 'healthy',
      detail: '28 dosud neaktivovaných přístupů.',
    },
    {
      id: 'import',
      label: 'Poslední import',
      value: 'Před 18 min',
      state: 'attention',
      detail: '1 konflikt čeká na bezpečné vyřešení.',
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
      detail: '2 aktivní stanoviště.',
    },
    {
      id: 'reservation',
      label: 'Rezervace',
      value: '89 %',
      state: 'attention',
      detail: 'Workshop Růst bez zkratek se blíží kapacitě.',
    },
    {
      id: 'notification',
      label: 'Oznámení',
      value: '1 čeká',
      state: 'degraded',
      detail: 'Jedna syntetická úloha skončila v DLQ bez obsahu zprávy.',
    },
  ],
  queues: [
    { queue: 'default', ready: 2, processing: 1, failed: 0 },
    { queue: 'notifications', ready: 1, processing: 0, failed: 1 },
    { queue: 'exports', ready: 0, processing: 1, failed: 0 },
  ],
  assignments: [
    {
      assignmentId: 'assignment-checkin-001',
      operatorLabel: 'Operátor #12',
      role: 'checkin_operator',
      scopeLabel: 'Hlavní vstup',
      state: 'active',
      version: 2,
    },
    {
      assignmentId: 'assignment-room-001',
      operatorLabel: 'Operátor #27',
      role: 'room_operator',
      scopeLabel: 'Růst bez zkratek',
      state: 'scheduled',
      version: 1,
    },
  ],
});

export const demoReservations = reservationRecordSchema.array().parse([
  {
    reservationId: 'reservation-synthetic-001',
    eventId: adminDemoScope.eventId,
    sessionId: 'session-growth-2026',
    sessionTitle: 'Růst bez zkratek',
    participantReference: 'Účastník •001',
    state: 'reserved',
    capacity: 40,
    reservedCount: 38,
    version: 4,
  },
  {
    reservationId: 'reservation-synthetic-002',
    eventId: adminDemoScope.eventId,
    sessionId: 'session-panel-2026',
    sessionTitle: 'Panel: firmy v pohybu',
    participantReference: 'Účastník •002',
    state: 'attended',
    capacity: 80,
    reservedCount: 65,
    version: 2,
  },
]);

export const demoEventSettings = eventSettingsSchema.parse({
  eventId: adminDemoScope.eventId,
  registrationMode: 'open',
  reservationChangesAllowed: true,
  supportMessage: 'V případě potíží se obraťte na registrační pult.',
  version: 5,
});

export const demoAuditEntries = auditEntrySchema.array().parse([
  {
    auditId: 'mock-audit-initial-001',
    eventId: adminDemoScope.eventId,
    actorLabel: 'Demo administrátor',
    category: 'settings',
    action: 'update_support_message',
    targetReference: 'event-byzon-2026',
    reason: 'Aktualizace pokynu pro syntetický nácvik.',
    outcome: 'succeeded',
    createdAt: '2026-07-25T11:20:00.000+02:00',
    resultingVersion: 5,
  },
  {
    auditId: 'mock-audit-initial-002',
    eventId: adminDemoScope.eventId,
    actorLabel: 'Demo operátor',
    category: 'reservation',
    action: 'capacity_override',
    targetReference: 'reservation-synthetic-001',
    reason: 'Syntetické ověření provozní výjimky.',
    outcome: 'succeeded',
    createdAt: '2026-07-25T10:30:00.000+02:00',
    resultingVersion: 4,
  },
]);
