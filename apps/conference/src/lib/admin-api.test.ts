import {
  adminAnnouncementTargetFixtures,
  announcementFixtureIds,
  adminEventSettingsFixtures,
  adminEventSettingsUpdateFixtures,
  adminEngagementMutationFixtures,
  adminEngagementOverviewFixtures,
  adminOperationsOverviewFixtures,
  adminFixtureIds,
  adminReservationFixtures,
  adminReservationMutationFixtures,
  adminReservationSessionFixtures,
  adminSessionCapacityFixtures,
  adminSessionCapacityMutationFixtures,
  adminRoleAssignmentFixtures,
  adminRoleAssignmentListFixtures,
  adminRolePersonSearchFixtures,
  adminRoleScopeOptionsFixtures,
  supportFixtureIds,
  supportMutationFixtures,
  supportSearchFixtures,
  ticketImportApplyFixtures,
  ticketImportFixtureIds,
  ticketImportPreviewFixtures,
} from '@byzon/test-support/fixtures';
import { describe, expect, it, vi } from 'vitest';

import type { ApiPort } from './api/endpoint';
import {
  adminAnnouncementSendEndpoint,
  adminAnnouncementTargetsEndpoint,
  adminContextEndpoint,
  adminEngagementMutationEndpoint,
  adminEngagementOverviewEndpoint,
  adminOperationsOverviewEndpoint,
  adminParticipantDetailEndpoint,
  adminParticipantListEndpoint,
  adminParticipantUpdateEndpoint,
  adminReservationSessionsEndpoint,
  adminRoleAssignmentListEndpoint,
  adminRolePersonSearchEndpoint,
  adminRoleScopeOptionsEndpoint,
  adminTeamInvitationEndpoint,
  adminTeamMemberListEndpoint,
  adminTeamMemberMutationEndpoint,
  adminSupportSearchEndpoint,
  adminTicketImportApplyEndpoint,
  adminTicketImportPreviewEndpoint,
  requestAdminEventSettingsUpdate,
  requestAdminAnnouncementTargets,
  requestAdminEngagementMutation,
  requestAdminEngagementOverview,
  requestAdminOperationsOverview,
  requestAdminParticipantList,
  requestAdminReservationMutation,
  requestAdminReservationSessions,
  requestAdminSessionCapacities,
  requestAdminSessionCapacityMutation,
  requestAdminRoleAssignment,
  requestAdminRoleAssignments,
  requestAdminRolePeople,
  requestAdminRoleScopes,
  requestAdminTeamInvitation,
  requestAdminTeamMemberMutation,
  requestAdminTeamMembers,
  requestAdminSupportMutation,
  requestAdminSupportSearch,
  requestAdminTicketImportApply,
  requestAdminTicketImportPreview,
} from './admin-api';

const metadata = { requestId: 'admin-api-test-0001' } as const;
const success = <Value>(data: Value) =>
  ({
    ok: true,
    kind: 'success',
    status: 200,
    data,
    metadata,
  }) as const;
const apiReturning = (data: unknown): ApiPort => ({
  request: vi.fn(async () => success(data)) as unknown as ApiPort['request'],
});

describe('admin API contract policies', () => {
  it('keeps team PII in private bodies and sends invitations without returning a raw link', async () => {
    const memberId = adminFixtureIds.operator;
    const list = {
      eventId: adminFixtureIds.event,
      teamVersion: 1,
      generatedAt: '2026-09-02T10:00:00Z',
      members: [
        {
          memberId,
          displayName: 'Patrik Provozní',
          email: 'patrik@example.test',
          emailVerified: false,
          isCurrentActor: false,
          roles: ['organizer_admin'] as const,
          invitation: { status: 'not_sent' as const, lastSentAt: null },
        },
      ],
      summary: { total: 1, administrators: 1, awaitingInvitation: 1 },
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(success(list))
      .mockResolvedValueOnce(
        success({
          eventId: adminFixtureIds.event,
          outcome: 'updated',
          teamVersion: 2,
          member: { ...list.members[0], emailVerified: true },
          changedAt: '2026-09-02T10:01:00Z',
          audit: { auditId: adminFixtureIds.auditMutation },
        }),
      )
      .mockResolvedValueOnce(
        success({
          eventId: adminFixtureIds.event,
          memberId,
          outcome: 'sent',
          sentAt: '2026-09-02T10:02:00Z',
          invitation: {
            status: 'accepted',
            lastSentAt: '2026-09-02T10:02:00Z',
          },
          audit: { auditId: adminFixtureIds.auditMutation },
        }),
      );
    const api = { request: request as unknown as ApiPort['request'] };

    await requestAdminTeamMembers(api, adminFixtureIds.event);
    await requestAdminTeamMemberMutation(
      api,
      adminFixtureIds.event,
      {
        action: 'update',
        memberId,
        displayName: 'Patrik Provozní',
        email: 'patrik@example.test',
        administrator: true,
        expectedVersion: 1,
        reason: 'Aktualizace člena organizačního týmu.',
      },
      'team-member-api-test',
    );
    await requestAdminTeamInvitation(
      api,
      adminFixtureIds.event,
      { memberId },
      'team-invitation-api-test',
    );

    expect(request.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      adminTeamMemberListEndpoint,
      adminTeamMemberMutationEndpoint,
      adminTeamInvitationEndpoint,
    ]);
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      path: `/api/v1/admin/events/${adminFixtureIds.event}/team-members`,
      cache: 'no-store',
    });
    expect(request.mock.calls[2]?.[1]).toMatchObject({
      path: `/api/v1/admin/events/${adminFixtureIds.event}/team-members/${memberId}/invite`,
      body: { memberId },
    });
    expect(JSON.stringify(request.mock.calls)).not.toContain('invitationUrl');
  });

  it('keeps private reads retry-safe and every side-effecting mutation never-retry', () => {
    expect(adminContextEndpoint).toMatchObject({
      method: 'GET',
      retry: 'safe-read',
      idempotency: 'forbidden',
    });
    expect(adminOperationsOverviewEndpoint).toMatchObject({
      method: 'GET',
      retry: 'safe-read',
      idempotency: 'forbidden',
    });
    expect(adminEngagementOverviewEndpoint).toMatchObject({
      method: 'GET',
      retry: 'safe-read',
      idempotency: 'forbidden',
    });
    expect(adminEngagementMutationEndpoint).toMatchObject({
      method: 'POST',
      retry: 'never',
      idempotency: 'required',
    });
    expect(adminSupportSearchEndpoint).toMatchObject({
      method: 'POST',
      retry: 'never',
      idempotency: 'forbidden',
    });
    expect(adminParticipantListEndpoint).toMatchObject({
      method: 'POST',
      retry: 'never',
      idempotency: 'forbidden',
    });
    expect(adminParticipantDetailEndpoint).toMatchObject({
      method: 'GET',
      retry: 'safe-read',
      idempotency: 'forbidden',
    });
    expect(adminParticipantUpdateEndpoint).toMatchObject({
      method: 'PATCH',
      retry: 'never',
      idempotency: 'required',
    });
    expect(adminTicketImportApplyEndpoint).toMatchObject({
      method: 'POST',
      retry: 'never',
      idempotency: 'required',
    });
    expect(adminTicketImportPreviewEndpoint).toMatchObject({
      method: 'POST',
      retry: 'never',
      idempotency: 'forbidden',
    });
    expect(adminAnnouncementSendEndpoint).toMatchObject({
      method: 'POST',
      retry: 'never',
      idempotency: 'required',
    });
    expect(adminAnnouncementTargetsEndpoint).toMatchObject({
      method: 'GET',
      retry: 'safe-read',
      idempotency: 'forbidden',
    });
    expect(adminRoleAssignmentListEndpoint).toMatchObject({
      method: 'GET',
      retry: 'safe-read',
      idempotency: 'forbidden',
    });
    for (const endpoint of [
      adminRolePersonSearchEndpoint,
      adminRoleScopeOptionsEndpoint,
    ]) {
      expect(endpoint).toMatchObject({
        method: 'POST',
        retry: 'never',
        idempotency: 'forbidden',
      });
    }
  });

  it('uses a bounded URL only for non-PII role filters and POST bodies for people and scopes', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(success(adminRoleAssignmentListFixtures.list!))
      .mockResolvedValueOnce(success(adminRolePersonSearchFixtures.found!))
      .mockResolvedValueOnce(success(adminRoleScopeOptionsFixtures.moderator!));
    const api = {
      request: request as unknown as ApiPort['request'],
    } satisfies ApiPort;

    await requestAdminRoleAssignments(api, adminFixtureIds.event, {
      role: 'moderator',
      state: 'active',
    });
    await requestAdminRolePeople(api, adminFixtureIds.event, {
      query: 'patrik@example.test',
    });
    await requestAdminRoleScopes(api, adminFixtureIds.event, {
      role: 'moderator',
    });

    expect(request.mock.calls[0]?.[1]).toMatchObject({
      path: `/api/v1/admin/events/${adminFixtureIds.event}/role-assignments?role=moderator&state=active`,
      cache: 'no-store',
    });
    expect(request.mock.calls[1]?.[1]).toMatchObject({
      path: `/api/v1/admin/events/${adminFixtureIds.event}/role-assignments/search`,
      body: { query: 'patrik@example.test' },
      cache: 'no-store',
    });
    expect(request.mock.calls[2]?.[1]).toMatchObject({
      path: `/api/v1/admin/events/${adminFixtureIds.event}/role-assignments/scope-options`,
      body: { role: 'moderator' },
      cache: 'no-store',
    });
    expect(JSON.stringify(request.mock.calls[1]?.[1])).not.toContain('?');
  });

  it('loads named announcement targets through a correlated no-store read', async () => {
    const request = vi.fn(async () =>
      success(adminAnnouncementTargetFixtures.available!),
    );
    const api = {
      request: request as unknown as ApiPort['request'],
    } satisfies ApiPort;

    await expect(
      requestAdminAnnouncementTargets(api, announcementFixtureIds.event),
    ).resolves.toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledWith(
      adminAnnouncementTargetsEndpoint,
      expect.objectContaining({
        path: `/api/v1/admin/events/${announcementFixtureIds.event}/announcements/targets`,
        cache: 'no-store',
      }),
    );
  });

  it('loads one no-store engagement snapshot without raw participant contacts', async () => {
    const request = vi.fn(async (...args: [unknown, unknown]) => {
      void args;
      return success(adminEngagementOverviewFixtures.default!);
    });
    const api = {
      request: request as unknown as ApiPort['request'],
    } satisfies ApiPort;

    await expect(
      requestAdminEngagementOverview(api, adminFixtureIds.event),
    ).resolves.toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledWith(
      adminEngagementOverviewEndpoint,
      expect.objectContaining({
        path: `/api/v1/admin/events/${adminFixtureIds.event}/engagement`,
        cache: 'no-store',
      }),
    );
    expect(JSON.stringify(request.mock.calls[0]?.[1])).not.toContain('@');
  });

  it('rejects an engagement mutation response that does not match the requested flags', async () => {
    const overview = adminEngagementOverviewFixtures.default!;
    const body = {
      action: 'update_features' as const,
      expectedSettingsVersion: overview.settingsVersion,
      features: {
        networkingEnabled: true,
        questionsEnabled: true,
        ratingsEnabled: false,
      },
      reason: 'Schválené zapnutí networkingu.',
    };
    const api = apiReturning({
      ...adminEngagementMutationFixtures.features_updated!,
      settingsVersion: body.expectedSettingsVersion + 1,
      features: { ...body.features, networkingEnabled: false },
    });

    await expect(
      requestAdminEngagementMutation(
        api,
        adminFixtureIds.event,
        body,
        'admin-engagement-correlation-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('reads session capacities from a rollout-safe route separate from reservations', async () => {
    const request = vi.fn(async () =>
      success(adminSessionCapacityFixtures.list!),
    );
    const api = {
      request: request as unknown as ApiPort['request'],
    } satisfies ApiPort;

    await expect(
      requestAdminSessionCapacities(api, adminFixtureIds.event),
    ).resolves.toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        path: `/api/v1/admin/events/${adminFixtureIds.event}/session-capacities`,
        cache: 'no-store',
      }),
    );
  });

  it('loads session-first reservations through an encoded no-store cursor', async () => {
    const request = vi.fn(async () =>
      success(adminReservationSessionFixtures.last_page!),
    );
    const api = {
      request: request as unknown as ApiPort['request'],
    } satisfies ApiPort;

    await expect(
      requestAdminReservationSessions(api, adminFixtureIds.event, {
        cursor: 'fixture-reservation-session-page-2',
        limit: 25,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledWith(
      adminReservationSessionsEndpoint,
      expect.objectContaining({
        path: `/api/v1/admin/events/${adminFixtureIds.event}/reservation-sessions?limit=25&cursor=fixture-reservation-session-page-2`,
        cache: 'no-store',
      }),
    );
  });

  it('keeps support P3/S search terms out of the URL and sends a no-store POST body', async () => {
    const request = vi.fn(async (endpoint: unknown, options: unknown) => {
      void endpoint;
      void options;
      return success({
        ...supportSearchFixtures.single_match!,
        eventId: supportFixtureIds.event,
      });
    });
    const api = {
      request: request as unknown as ApiPort['request'],
    } satisfies ApiPort;

    await expect(
      requestAdminSupportSearch(api, supportFixtureIds.event, '  single  '),
    ).resolves.toMatchObject({ ok: true });

    expect(request).toHaveBeenCalledWith(
      adminSupportSearchEndpoint,
      expect.objectContaining({
        path: `/api/v1/admin/events/${supportFixtureIds.event}/support/search`,
        body: { query: 'single', limit: 5 },
        cache: 'no-store',
      }),
    );
    expect(JSON.stringify(request.mock.calls[0]?.[1])).not.toContain('?');
  });

  it('loads the participant directory without a required query and keeps filters in a no-store body', async () => {
    const request = vi.fn(async () =>
      success({
        eventId: supportFixtureIds.event,
        generatedAt: '2026-09-02T10:00:00.000Z',
        items: [],
        pageInfo: { total: 0, offset: 0, hasMore: false },
        summary: {
          total: 0,
          active: 0,
          networkingEnabled: 0,
          checkedIn: 0,
        },
      }),
    );
    const api = {
      request: request as unknown as ApiPort['request'],
    } satisfies ApiPort;

    await expect(
      requestAdminParticipantList(api, supportFixtureIds.event, {
        query: '',
        ticketStates: [],
        networkingStates: [],
        limit: 100,
        offset: 0,
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(request).toHaveBeenCalledWith(
      adminParticipantListEndpoint,
      expect.objectContaining({
        path: `/api/v1/admin/events/${supportFixtureIds.event}/participants/list`,
        cache: 'no-store',
        body: {
          query: '',
          ticketStates: [],
          networkingStates: [],
          limit: 100,
          offset: 0,
        },
      }),
    );
  });

  it('rejects success payloads that do not match the exact mutation intent', async () => {
    const importPreview = ticketImportPreviewFixtures.clean!;
    const importBody = {
      eventId: ticketImportFixtureIds.event,
      previewId: importPreview.previewId,
      previewVersion: importPreview.previewVersion,
      expectedImpact: importPreview.summary,
      selectedRowIds: [ticketImportFixtureIds.rowNew],
      reason: 'Bezpečný test přesné korelace importu.',
    };
    const importApi = apiReturning({
      ...ticketImportApplyFixtures.applied!,
      selectedRowIds: [ticketImportFixtureIds.rowUnchanged],
    });

    const supportRecord = supportSearchFixtures.single_match!.matches[0]!;
    const supportBody = {
      participantId: supportRecord.participantId,
      ticketId: supportRecord.ticketId,
      action: 'block' as const,
      expectedVersion: supportRecord.version,
      reason: 'Bezpečný test přesné korelace podpory.',
      targetTicketId: null,
    };
    const supportApi = apiReturning({
      ...supportMutationFixtures.blocked!,
      record: {
        ...supportMutationFixtures.blocked!.record,
        version: supportBody.expectedVersion + 2,
      },
    });

    const granted = adminRoleAssignmentFixtures.granted!;
    const roleBody = {
      action: 'grant' as const,
      operatorId: granted.assignment!.operatorId,
      role: granted.assignment!.role,
      scope: granted.assignment!.scope,
      expectedVersion: granted.assignmentsVersion - 1,
      reason: 'Bezpečný test přesné korelace role.',
    };
    const roleApi = apiReturning({
      ...granted,
      assignment: { ...granted.assignment!, role: 'moderator' as const },
    });

    const reservation = adminReservationFixtures.list!.items[0]!;
    const reservationBody = {
      reservationId: reservation.reservationId,
      action: 'cancel_reservation' as const,
      expectedVersion: reservation.version,
      reason: 'Bezpečný test přesné korelace rezervace.',
    };
    const reservationApi = apiReturning({
      ...adminReservationMutationFixtures.cancelled!,
      record: {
        ...adminReservationMutationFixtures.cancelled!.record,
        version: reservation.version + 2,
      },
    });

    const capacity = adminSessionCapacityFixtures.list!.items[0]!;
    const capacityBody = {
      sessionId: capacity.sessionId,
      expectedVersion: capacity.version,
      capacity: (capacity.capacity ?? 1) + 2,
      reason: 'Bezpečný test přesné korelace kapacity session.',
    };
    const capacityApi = apiReturning({
      ...adminSessionCapacityMutationFixtures.updated!,
      record: {
        ...adminSessionCapacityMutationFixtures.updated!.record,
        version: capacity.version + 2,
      },
    });

    const settings = adminEventSettingsFixtures.open!;
    const settingsBody = {
      expectedVersion: settings.version,
      settings: {
        registrationMode: 'invite_only' as const,
        reservationChangesAllowed: settings.reservationChangesAllowed,
        supportMessage: settings.supportMessage,
      },
      reason: 'Bezpečný test přesné korelace nastavení.',
    };
    const settingsApi = apiReturning({
      ...adminEventSettingsUpdateFixtures.updated!,
      settings: {
        ...adminEventSettingsUpdateFixtures.updated!.settings,
        supportMessage: 'Jiná syntetická zpráva podpory.',
      },
    });

    const results = await Promise.all([
      requestAdminTicketImportApply(
        importApi,
        ticketImportFixtureIds.event,
        importBody,
        'admin-import-correlation-0001',
      ),
      requestAdminSupportMutation(
        supportApi,
        supportFixtureIds.event,
        supportBody,
        'admin-support-correlation-0001',
      ),
      requestAdminRoleAssignment(
        roleApi,
        adminFixtureIds.event,
        roleBody,
        'admin-role-correlation-0001',
      ),
      requestAdminReservationMutation(
        reservationApi,
        adminFixtureIds.event,
        reservationBody,
        'admin-reservation-correlation-0001',
      ),
      requestAdminSessionCapacityMutation(
        capacityApi,
        adminFixtureIds.event,
        capacityBody,
        'admin-session-capacity-correlation-0001',
      ),
      requestAdminEventSettingsUpdate(
        settingsApi,
        adminFixtureIds.event,
        settingsBody,
        'admin-settings-correlation-0001',
      ),
    ]);

    results.forEach((result) => {
      expect(result).toMatchObject({
        ok: false,
        failure: { kind: 'invalid_response' },
      });
    });
  });

  it('rejects a structurally valid response correlated to another event', async () => {
    const foreign = {
      ...adminOperationsOverviewFixtures.healthy!,
      eventId: '019fb200-0000-7000-8000-000000000099',
    };
    const api: ApiPort = {
      request: vi.fn(async () => ({
        ok: true,
        kind: 'success',
        status: 200,
        data: foreign,
        metadata,
      })) as unknown as ApiPort['request'],
    };

    const result = await requestAdminOperationsOverview(
      api,
      adminFixtureIds.event,
    );

    expect(result).toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('requests a no-store server-side SimpleShop preview without file data', async () => {
    const preview = {
      ...ticketImportPreviewFixtures.simpleshop_readonly!,
      eventId: adminFixtureIds.event,
    };
    const request = vi.fn(async (endpoint: unknown, options: unknown) => {
      void endpoint;
      void options;
      return success(preview);
    });
    const api = {
      request: request as unknown as ApiPort['request'],
    } satisfies ApiPort;

    await expect(
      requestAdminTicketImportPreview(api, adminFixtureIds.event),
    ).resolves.toMatchObject({ ok: true });
    expect(request).toHaveBeenCalledWith(
      adminTicketImportPreviewEndpoint,
      expect.objectContaining({
        path: `/api/v1/admin/events/${adminFixtureIds.event}/ticket-imports/preview`,
        body: { source: 'simpleshop' },
        cache: 'no-store',
      }),
    );
    expect(JSON.stringify(request.mock.calls[0]?.[1])).not.toContain(
      'SIMPLESHOP_API',
    );
  });

  it('rejects a structurally valid file preview from the SimpleShop endpoint', async () => {
    const api = apiReturning({
      ...ticketImportPreviewFixtures.clean!,
      eventId: adminFixtureIds.event,
    });

    await expect(
      requestAdminTicketImportPreview(api, adminFixtureIds.event),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });
});
