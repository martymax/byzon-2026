import { describe, expect, it } from 'vitest';

import {
  adminAuditResponseSchema,
  adminCachePolicy,
  adminContextResponseSchema,
  adminEventSettingsUpdateRequestSchema,
  adminExportRequestSchema,
  adminMutationProblemSchema,
  adminOperationsOverviewResponseSchema,
  adminReservationListResponseSchema,
  adminReservationMutationRequestSchema,
  adminRoleAssignmentMutationRequestSchema,
  problemTypeForCode,
} from './index.js';

const ids = {
  event: '019fa200-0000-7000-8000-000000000001',
  session: '019fa200-0000-7000-8000-000000000002',
  reservation: '019fa200-0000-7000-8000-000000000003',
  auditNewest: '019fa200-0000-7000-8000-000000000004',
  auditOlder: '019fa200-0000-7000-8000-000000000005',
  operator: '019fa200-0000-7000-8000-000000000006',
} as const;

describe('CS-ADMIN-01 contracts', () => {
  it('returns server-derived actor permissions and scope as private data', () => {
    const context = {
      event: {
        id: ids.event,
        name: 'BYZON 2026 — syntetická ukázka',
        timezone: 'Europe/Prague',
        phase: 'live' as const,
      },
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
    const response = {
      eventId: ids.event,
      generatedAt: '2026-07-25T12:00:00.000+02:00',
      items: [record],
    };

    expect(adminReservationListResponseSchema.parse(response)).toEqual(
      response,
    );
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
