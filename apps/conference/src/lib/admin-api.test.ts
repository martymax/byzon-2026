import {
  adminEventSettingsFixtures,
  adminEventSettingsUpdateFixtures,
  adminOperationsOverviewFixtures,
  adminFixtureIds,
  adminReservationFixtures,
  adminReservationMutationFixtures,
  adminSessionCapacityFixtures,
  adminSessionCapacityMutationFixtures,
  adminRoleAssignmentFixtures,
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
  adminContextEndpoint,
  adminOperationsOverviewEndpoint,
  adminSupportSearchEndpoint,
  adminTicketImportApplyEndpoint,
  createAdminTicketImportUploadPort,
  requestAdminEventSettingsUpdate,
  requestAdminOperationsOverview,
  requestAdminReservationMutation,
  requestAdminSessionCapacities,
  requestAdminSessionCapacityMutation,
  requestAdminRoleAssignment,
  requestAdminSupportMutation,
  requestAdminSupportSearch,
  requestAdminTicketImportApply,
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
    expect(adminSupportSearchEndpoint).toMatchObject({
      method: 'POST',
      retry: 'never',
      idempotency: 'forbidden',
    });
    expect(adminTicketImportApplyEndpoint).toMatchObject({
      method: 'POST',
      retry: 'never',
      idempotency: 'required',
    });
    expect(adminAnnouncementSendEndpoint).toMatchObject({
      method: 'POST',
      retry: 'never',
      idempotency: 'required',
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

  it('rejects success payloads that do not match the exact mutation intent', async () => {
    const importPreview = ticketImportPreviewFixtures.clean!;
    const importBody = {
      eventId: ticketImportFixtureIds.event,
      previewId: importPreview.previewId,
      previewVersion: importPreview.previewVersion,
      expectedImpact: importPreview.summary,
      reason: 'Bezpečný test přesné korelace importu.',
    };
    const importApi = apiReturning({
      ...ticketImportApplyFixtures.applied!,
      result: {
        ...ticketImportApplyFixtures.applied!.result,
        created: ticketImportApplyFixtures.applied!.result.created + 1,
      },
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
      capacity: capacity.capacity + 2,
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

  it('sends a real multipart File and parses the response through the canonical ApiPort', async () => {
    const file = new File(['reference,state\nT001,active'], 'tickets.csv', {
      type: 'text/csv',
    });
    const preview = {
      ...ticketImportPreviewFixtures.clean!,
      eventId: adminFixtureIds.event,
      source: {
        fileName: file.name,
        mediaType: file.type,
        byteSize: file.size,
      },
    };
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.body).toBeInstanceOf(FormData);
        expect(init?.body).not.toEqual(expect.any(String));
        expect(new Headers(init?.headers).has('content-type')).toBe(false);
        const multipart = init?.body as FormData;
        const uploaded = multipart.get('file');
        expect(uploaded).toBeInstanceOf(Blob);
        expect((uploaded as File).name).toBe(file.name);
        return new Response(JSON.stringify(preview), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': metadata.requestId,
            'cache-control': 'private, no-store',
          },
        });
      },
    );

    const result = await createAdminTicketImportUploadPort(fetch).preview(
      adminFixtureIds.event,
      file,
    );

    expect(result).toMatchObject({
      ok: true,
      kind: 'success',
      data: { eventId: adminFixtureIds.event, source: preview.source },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('accepts an empty browser MIME only for a text-like .csv signature', async () => {
    const file = new File(['reference,state\nT001,active'], 'tickets.csv');
    const preview = {
      ...ticketImportPreviewFixtures.clean!,
      eventId: adminFixtureIds.event,
      source: {
        fileName: file.name,
        mediaType: 'text/csv',
        byteSize: file.size,
      },
    };
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const uploaded = (init?.body as FormData | undefined)?.get('file');
        expect(uploaded).toBeInstanceOf(Blob);
        expect((uploaded as File).name).toBe(file.name);
        expect((uploaded as Blob).type).toBe('text/csv');
        return new Response(JSON.stringify(preview), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-request-id': metadata.requestId,
            'cache-control': 'private, no-store',
          },
        });
      },
    );

    await expect(
      createAdminTicketImportUploadPort(fetch).preview(
        adminFixtureIds.event,
        file,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { source: { mediaType: 'text/csv' } },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects a binary .csv with an empty browser MIME before upload', async () => {
    const file = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])],
      'disguised.csv',
    );
    const fetch = vi.fn();

    await expect(
      createAdminTicketImportUploadPort(fetch).preview(
        adminFixtureIds.event,
        file,
      ),
    ).rejects.toThrow('Unsupported ticket import media type');
    expect(fetch).not.toHaveBeenCalled();
  });
});
