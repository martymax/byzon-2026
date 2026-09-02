import { describe, expect, it } from 'vitest';

import {
  adminAuditActionSchema,
  adminAuditQuerySchema,
  adminAuditResponseSchema,
  adminCachePolicy,
  adminContextResponseSchema,
  adminEventSettingsUpdateRequestSchema,
  adminExportJobListResponseSchema,
  adminExportRequestSchema,
  adminMutationProblemSchema,
  adminOperationsOverviewResponseSchema,
  adminReservationListResponseSchema,
  adminReservationMutationRequestSchema,
  adminReservationSessionPageSchema,
  adminReservationSessionQuerySchema,
  adminSessionCapacityListResponseSchema,
  adminSessionCapacityMutationRequestSchema,
  adminRoleAssignmentMutationRequestSchema,
  adminRoleAssignmentListResponseSchema,
  adminRolePersonSearchRequestSchema,
  adminRolePersonSearchResponseSchema,
  adminRoleScopeOptionsResponseSchema,
  problemTypeForCode,
} from './index.js';

const ids = {
  event: '019fa200-0000-7000-8000-000000000001',
  session: '019fa200-0000-7000-8000-000000000002',
  reservation: '019fa200-0000-7000-8000-000000000003',
  auditNewest: '019fa200-0000-7000-8000-000000000004',
  auditOlder: '019fa200-0000-7000-8000-000000000005',
  operator: '019fa200-0000-7000-8000-000000000006',
  networkingSession: '019fa200-0000-7000-8000-000000000007',
  assignment: '019fa200-0000-7000-8000-000000000008',
  station: '019fa200-0000-7000-8000-000000000009',
} as const;

describe('CS-ADMIN-01 contracts', () => {
  it('validates event-scoped role lists, person search and compatible named scopes', () => {
    const assignment = {
      assignmentId: ids.assignment,
      eventId: ids.event,
      operatorId: ids.operator,
      operatorLabel: 'Patrik Novák',
      role: 'room_operator' as const,
      scope: {
        kind: 'session' as const,
        sessionId: ids.session,
        label: 'Růst bez zkratek',
      },
      state: 'active' as const,
      version: 2,
    };
    const list = {
      eventId: ids.event,
      assignmentsVersion: 3,
      items: [assignment],
      pageInfo: { nextCursor: null, hasMore: false },
    };
    expect(adminRoleAssignmentListResponseSchema.parse(list)).toEqual(list);
    expect(
      adminRoleAssignmentListResponseSchema.safeParse({
        ...list,
        items: [assignment, assignment],
      }).success,
    ).toBe(false);

    expect(
      adminRolePersonSearchRequestSchema.parse({ query: 'Patrik' }),
    ).toEqual({ query: 'Patrik' });
    expect(
      adminRolePersonSearchRequestSchema.safeParse({
        query: 'Patrik',
        operatorId: ids.operator,
      }).success,
    ).toBe(false);
    expect(
      adminRolePersonSearchResponseSchema.safeParse({
        eventId: ids.event,
        items: [
          {
            operatorId: ids.operator,
            displayName: 'Patrik Novák',
            maskedVerifiedContact: 'patrik@example.test',
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      adminRoleScopeOptionsResponseSchema.parse({
        eventId: ids.event,
        role: 'checkin_operator',
        options: [
          { kind: 'station', stationId: ids.station, label: 'Hlavní vstup' },
        ],
      }),
    ).toBeTruthy();
    expect(
      adminRoleScopeOptionsResponseSchema.safeParse({
        eventId: ids.event,
        role: 'room_operator',
        options: [
          { kind: 'station', stationId: ids.station, label: 'Hlavní vstup' },
        ],
      }).success,
    ).toBe(false);
  });

  it('returns server-derived actor permissions and scope as private data', () => {
    const context = {
      event: {
        id: ids.event,
        name: 'BYZON 2026 — syntetická ukázka',
        timezone: 'Europe/Prague',
        phase: 'live' as const,
      },
      features: { announcementsEnabled: true },
      capabilities: { canEnterCheckin: true },
      actor: {
        displayLabel: 'Administrátor akce',
        roles: ['organizer_admin'] as const,
        permissions: [
          'program:manage',
          'operations:read',
          'reservation:any:read',
        ] as const,
        assignedSessions: [
          {
            sessionId: ids.session,
            title: 'Růst bez zkratek',
          },
        ],
      },
    };

    expect(adminContextResponseSchema.parse(context)).toEqual(context);
    expect(adminCachePolicy).toEqual({
      cacheControl: 'private, no-store',
      browserPersistence: 'forbidden',
      sharedCache: 'forbidden',
      mutation: 'online-only',
      mutationIdempotency: 'required',
      permissionRevocationWipe: 'required',
    });
    expect(
      adminContextResponseSchema.safeParse({
        ...context,
        actor: {
          ...context.actor,
          permissions: ['reservation:any:read', 'reservation:any:read'],
        },
      }).success,
    ).toBe(false);
    expect(
      adminContextResponseSchema.safeParse({
        ...context,
        features: { announcementsEnabled: 'yes' },
      }).success,
    ).toBe(false);
    expect(
      adminContextResponseSchema.safeParse({
        ...context,
        capabilities: { canEnterCheckin: 'yes' },
      }).success,
    ).toBe(false);
  });

  it('validates bounded operations and queue summaries', () => {
    const overview = {
      eventId: ids.event,
      version: 3,
      generatedAt: '2026-07-25T12:00:00.000+02:00',
      metrics: [
        {
          id: 'activation' as const,
          label: 'Aktivace',
          value: '412 / 440',
          state: 'healthy' as const,
          detail: 'Syntetický stav aktivací.',
        },
        {
          id: 'notification' as const,
          label: 'Oznámení',
          value: '1 čeká',
          state: 'attention' as const,
          detail: 'Jedna syntetická úloha čeká ve frontě.',
        },
      ],
      queues: [
        { queue: 'default' as const, ready: 1, processing: 1, failed: 0 },
        {
          queue: 'notifications' as const,
          ready: 1,
          processing: 0,
          failed: 0,
        },
      ],
    };

    expect(adminOperationsOverviewResponseSchema.parse(overview)).toEqual(
      overview,
    );
    expect(
      adminOperationsOverviewResponseSchema.safeParse({
        ...overview,
        metrics: [overview.metrics[0], overview.metrics[0]],
      }).success,
    ).toBe(false);
  });

  it('keeps export jobs event-scoped and exposes downloads only while ready', () => {
    const exportId = '019fa200-0000-7000-8000-000000000010';
    const ready = {
      eventId: ids.event,
      exportId,
      report: 'participant_summary' as const,
      format: 'csv' as const,
      range: null,
      createdByLabel: 'Demo administrátor',
      state: 'ready' as const,
      createdAt: '2026-07-25T12:00:00.000+02:00',
      expiresAt: '2026-07-26T12:00:00.000+02:00',
      downloadPath: `/api/v1/admin/events/${ids.event}/exports/${exportId}`,
    };
    const response = {
      eventId: ids.event,
      items: [ready],
      pageInfo: { nextCursor: null, hasMore: false },
    };

    expect(adminExportJobListResponseSchema.parse(response)).toEqual(response);
    expect(
      adminExportJobListResponseSchema.safeParse({
        ...response,
        items: [
          { ...ready, state: 'queued', downloadPath: ready.downloadPath },
        ],
      }).success,
    ).toBe(false);
    expect(
      adminExportJobListResponseSchema.safeParse({
        ...response,
        items: [
          {
            ...ready,
            downloadPath: `https://attacker.example/exports/${exportId}`,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      adminExportJobListResponseSchema.safeParse({
        ...response,
        items: [{ ...ready, eventId: ids.session }],
      }).success,
    ).toBe(false);
    expect(
      adminExportJobListResponseSchema.safeParse({
        ...response,
        items: [
          {
            ...ready,
            range: {
              from: '2026-07-25T13:00:00.000+02:00',
              to: '2026-07-25T12:00:00.000+02:00',
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('never accepts actor roles or assignment scope in mutation bodies', () => {
    const roleRequest = {
      action: 'grant' as const,
      operatorId: ids.operator,
      role: 'room_operator' as const,
      scope: {
        kind: 'session' as const,
        sessionId: ids.session,
        label: 'Růst bez zkratek',
      },
      expectedVersion: 3,
      reason: 'Potvrzené přiřazení k jedné syntetické session.',
    };
    const reservationRequest = {
      action: 'cancel_reservation' as const,
      reservationId: ids.reservation,
      expectedVersion: 4,
      reason: 'Potvrzené zrušení v syntetickém průchodu.',
    };

    expect(adminRoleAssignmentMutationRequestSchema.parse(roleRequest)).toEqual(
      roleRequest,
    );
    expect(
      adminRoleAssignmentMutationRequestSchema.safeParse({
        ...roleRequest,
        actorRole: 'organizer_admin',
      }).success,
    ).toBe(false);
    expect(
      adminReservationMutationRequestSchema.parse(reservationRequest),
    ).toEqual(reservationRequest);
    expect(
      adminReservationMutationRequestSchema.safeParse({
        ...reservationRequest,
        assignedSessionIds: [ids.session],
      }).success,
    ).toBe(false);
    expect(
      adminSessionCapacityMutationRequestSchema.parse({
        sessionId: ids.session,
        expectedVersion: 4,
        reason: 'Potvrzená provozní změna kapacity workshopu.',
        capacity: 42,
      }),
    ).toEqual({
      sessionId: ids.session,
      expectedVersion: 4,
      reason: 'Potvrzená provozní změna kapacity workshopu.',
      capacity: 42,
    });
    expect(
      adminReservationMutationRequestSchema.safeParse({
        action: 'capacity_override',
        reservationId: ids.reservation,
        expectedVersion: 4,
        reason: 'Neúplný starý požadavek musí zůstat odmítnutý.',
      }).success,
    ).toBe(false);
    const legacyCapacityRequest = {
      action: 'capacity_override' as const,
      reservationId: ids.reservation,
      expectedVersion: 4,
      capacity: 42,
      reason: 'Přechodová kompatibilita pro dříve načtenou administraci.',
    };
    expect(
      adminReservationMutationRequestSchema.parse(legacyCapacityRequest),
    ).toEqual(legacyCapacityRequest);
  });

  it('validates available reservation actions against canonical state', () => {
    const record = {
      reservationId: ids.reservation,
      eventId: ids.event,
      sessionId: ids.session,
      sessionTitle: 'Růst bez zkratek',
      participantReference: 'Účastník •001',
      state: 'reserved' as const,
      capacity: 40,
      reservedCount: 38,
      version: 4,
      availableActions: ['capacity_override', 'cancel_reservation'] as const,
    };
    const capacityResponse = {
      eventId: ids.event,
      generatedAt: '2026-07-25T12:00:00.000+02:00',
      items: [
        {
          eventId: ids.event,
          sessionId: ids.session,
          sessionTitle: 'Růst bez zkratek',
          sessionType: 'workshop' as const,
          sessionStatus: 'published' as const,
          capacity: 40,
          confirmedCount: 38,
          version: 4,
        },
      ],
    };
    const response = {
      eventId: ids.event,
      generatedAt: '2026-07-25T12:00:00.000+02:00',
      items: [record],
    };

    expect(
      adminSessionCapacityListResponseSchema.parse(capacityResponse),
    ).toEqual(capacityResponse);
    expect(
      adminSessionCapacityListResponseSchema.parse({
        ...capacityResponse,
        items: [
          {
            ...capacityResponse.items[0],
            sessionId: ids.networkingSession,
            sessionType: 'networking',
            capacity: null,
            confirmedCount: 0,
          },
        ],
      }).items[0],
    ).toMatchObject({ sessionType: 'networking', capacity: null });
    expect(
      adminSessionCapacityListResponseSchema.safeParse({
        ...capacityResponse,
        items: [
          {
            ...capacityResponse.items[0],
            capacity: null,
          },
        ],
      }).success,
    ).toBe(false);
    expect(adminReservationListResponseSchema.parse(response)).toEqual(
      response,
    );
    expect(
      adminReservationListResponseSchema.safeParse({
        ...response,
        capacityItems: capacityResponse.items,
      }).success,
    ).toBe(false);
    expect(
      adminReservationListResponseSchema.safeParse({
        ...response,
        items: [
          {
            ...record,
            state: 'attended',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      adminReservationListResponseSchema.safeParse({
        ...response,
        items: [{ ...record, capacity: 100_001 }],
      }).success,
    ).toBe(false);
  });

  it('validates session-first paginated reservation pages with masked references', () => {
    expect(adminReservationSessionQuerySchema.parse({})).toEqual({ limit: 25 });
    const page = {
      eventId: ids.event,
      generatedAt: '2026-09-02T12:00:00.000+02:00',
      items: [
        {
          eventId: ids.event,
          sessionId: ids.session,
          sessionTitle: 'Růst bez zkratek',
          localDate: '2026-09-19',
          startsAt: '2026-09-19T09:30:00.000+02:00',
          roomLabel: 'Sál Inspirace',
          capacity: 40,
          confirmedCount: 38,
          waitingCount: 2,
          capacityVersion: 4,
          reservations: [
            {
              reservationId: ids.reservation,
              maskedParticipantReference: 'Účastník •001',
              state: 'reserved' as const,
              version: 4,
              availableActions: ['cancel_reservation'] as const,
            },
          ],
        },
      ],
      pageInfo: { nextCursor: 'page-two', hasMore: true },
    };
    expect(adminReservationSessionPageSchema.parse(page)).toEqual(page);
    expect(
      adminReservationSessionPageSchema.safeParse({
        ...page,
        items: [
          {
            ...page.items[0],
            reservations: [
              {
                ...page.items[0]!.reservations[0],
                maskedParticipantReference: 'person@example.test',
              },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      adminReservationSessionPageSchema.safeParse({
        ...page,
        pageInfo: { nextCursor: null, hasMore: true },
      }).success,
    ).toBe(false);
  });

  it('validates safe audit ordering and minimal settings/export writes', () => {
    const auditBase = {
      eventId: ids.event,
      actorLabel: 'Demo administrátor',
      category: 'settings' as const,
      action: 'update_settings',
      targetReference: 'event •001',
      reason: 'Syntetická auditovaná změna.',
      outcome: 'succeeded' as const,
      resultingVersion: 5,
      redacted: false,
    };
    const audits = {
      eventId: ids.event,
      items: [
        {
          ...auditBase,
          auditId: ids.auditNewest,
          createdAt: '2026-07-25T12:00:00.000+02:00',
        },
        {
          ...auditBase,
          auditId: ids.auditOlder,
          createdAt: '2026-07-25T11:00:00.000+02:00',
        },
      ],
      pageInfo: { nextCursor: null, hasMore: false },
    };

    expect(adminAuditResponseSchema.parse(audits)).toEqual(audits);
    expect(
      adminAuditQuerySchema.parse({
        actor: 'system',
        outcome: 'queued',
        action: 'export.queued',
      }),
    ).toEqual({
      actor: 'system',
      outcome: 'queued',
      action: 'export.queued',
    });
    expect(adminAuditActionSchema.safeParse('private.raw_action').success).toBe(
      false,
    );
    expect(
      adminAuditResponseSchema.safeParse({
        ...audits,
        items: [...audits.items].reverse(),
      }).success,
    ).toBe(false);
    expect(
      adminEventSettingsUpdateRequestSchema.parse({
        expectedVersion: 5,
        settings: {
          registrationMode: 'invite_only',
          reservationChangesAllowed: true,
          supportMessage: 'Kontaktujte syntetický registrační pult.',
        },
        reason: 'Potvrzená změna režimu syntetické akce.',
      }).expectedVersion,
    ).toBe(5);
    expect(
      adminExportRequestSchema.parse({
        report: 'reservation_summary',
        format: 'csv',
        range: null,
        reason: 'Syntetický auditovaný export souhrnu.',
      }).report,
    ).toBe('reservation_summary');
  });

  it('enumerates authorization, stale and guard problems', () => {
    const stale = {
      type: problemTypeForCode('STALE_VERSION'),
      title: 'Admin resource is stale',
      status: 409,
      code: 'STALE_VERSION',
      detail: 'Reload the canonical admin resource.',
      requestId: 'request-admin-0001',
      currentVersion: 6,
    };

    expect(adminMutationProblemSchema.parse(stale)).toEqual(stale);
    expect(
      adminMutationProblemSchema.safeParse({
        ...stale,
        type: problemTypeForCode('GLOBAL_SUPERADMIN_REQUIRED'),
        code: 'GLOBAL_SUPERADMIN_REQUIRED',
      }).success,
    ).toBe(false);
  });
});
