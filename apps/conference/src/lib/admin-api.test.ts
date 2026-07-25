import {
  adminOperationsOverviewFixtures,
  adminFixtureIds,
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
  requestAdminOperationsOverview,
} from './admin-api';

const metadata = { requestId: 'admin-api-test-0001' } as const;

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
      method: 'GET',
      retry: 'safe-read',
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
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
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
    });

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
});
