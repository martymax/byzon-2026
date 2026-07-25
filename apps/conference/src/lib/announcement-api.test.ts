import {
  participantAnnouncementDetailFixtures,
  participantAnnouncementInboxFixtures,
  participantAnnouncementReadFixtures,
} from '@byzon/test-support/fixtures';
import { describe, expect, it, vi } from 'vitest';

import {
  createFetchApiClient,
  type FetchApiClientOptions,
} from './api/fetch-client';
import {
  markAnnouncementRead,
  participantAnnouncementDetailEndpoint,
  participantAnnouncementInboxEndpoint,
  participantAnnouncementReadEndpoint,
  requestAnnouncementDetail,
  requestAnnouncementInbox,
} from './announcement-api';

const responseHeaders = {
  'content-type': 'application/json',
  'x-request-id': 'announcement-client-0001',
};

type TestFetch = NonNullable<FetchApiClientOptions['fetch']>;

describe('CS-ANN-01 participant browser adapter', () => {
  it('validates and canonically serializes the private inbox query', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(participantAnnouncementInboxFixtures.unread, {
        headers: responseHeaders,
      }),
    );
    const client = createFetchApiClient({ fetch, maxRetries: 0 });

    await expect(
      requestAnnouncementInbox(client, {
        filter: 'unread',
        cursor: 'announcement.cursor.0001',
        limit: 12,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: { unreadCount: 2 },
    });

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/me/announcements?filter=unread&cursor=announcement.cursor.0001&limit=12',
      expect.objectContaining({
        cache: 'no-store',
        method: 'GET',
      }),
    );
    const request = fetch.mock.calls[0]?.[1];
    expect(new Headers(request?.headers).has('idempotency-key')).toBe(false);
    expect(participantAnnouncementInboxEndpoint.retry).toBe('safe-read');
  });

  it('loads one audience-scoped detail through an encoded private path', async () => {
    const fixture = participantAnnouncementDetailFixtures.unread!;
    const fetch = vi.fn(async () =>
      Response.json(fixture, { headers: responseHeaders }),
    );

    await expect(
      requestAnnouncementDetail(
        createFetchApiClient({ fetch, maxRetries: 0 }),
        fixture.announcement.id,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { announcement: { id: fixture.announcement.id } },
    });

    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/me/announcements/${encodeURIComponent(fixture.announcement.id)}`,
      expect.objectContaining({ cache: 'no-store', method: 'GET' }),
    );
    expect(participantAnnouncementDetailEndpoint.problemCodes).toContain(
      'ANNOUNCEMENT_NOT_FOUND',
    );
  });

  it('rejects an invalid inbox query before making a request', () => {
    const fetch = vi.fn();
    const client = createFetchApiClient({ fetch });

    expect(() =>
      requestAnnouncementInbox(client, { filter: 'all', limit: 0 }),
    ).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks read with a required idempotency key and no request body', async () => {
    const fixture = participantAnnouncementReadFixtures.success!;
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(fixture, { headers: responseHeaders }),
    );

    await expect(
      markAnnouncementRead(
        createFetchApiClient({ fetch, maxRetries: 0 }),
        fixture.announcementId,
        'announcement-read-client-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        announcementId: fixture.announcementId,
        state: 'read',
      },
    });

    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe(
      `/api/v1/me/announcements/${encodeURIComponent(fixture.announcementId)}/read`,
    );
    expect(init).toEqual(
      expect.objectContaining({
        cache: 'no-store',
        method: 'POST',
      }),
    );
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      'announcement-read-client-0001',
    );
    expect(participantAnnouncementReadEndpoint.idempotency).toBe('required');
    expect(participantAnnouncementReadEndpoint.retry).toBe('never');
  });

  it('rejects an unknown response field instead of exposing private data', async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        {
          ...participantAnnouncementInboxFixtures.happy,
          recipientSnapshot: ['must-not-reach-the-ui'],
        },
        { headers: responseHeaders },
      ),
    );

    await expect(
      requestAnnouncementInbox(createFetchApiClient({ fetch, maxRetries: 0 }), {
        filter: 'all',
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid_response',
        requestId: 'announcement-client-0001',
      },
    });
  });

  it('declares the complete private failure taxonomy', () => {
    expect(participantAnnouncementInboxEndpoint.problemCodes).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'EVENT_ACCESS_DENIED',
      'ANNOUNCEMENTS_DISABLED',
      'VALIDATION_FAILED',
      'INTERNAL_ERROR',
    ]);
    expect(participantAnnouncementDetailEndpoint.problemCodes).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'EVENT_ACCESS_DENIED',
      'ANNOUNCEMENTS_DISABLED',
      'VALIDATION_FAILED',
      'ANNOUNCEMENT_NOT_FOUND',
      'INTERNAL_ERROR',
    ]);
    expect(participantAnnouncementReadEndpoint.problemCodes).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'EVENT_ACCESS_DENIED',
      'ANNOUNCEMENTS_DISABLED',
      'VALIDATION_FAILED',
      'ANNOUNCEMENT_NOT_FOUND',
      'IDEMPOTENCY_KEY_REUSED',
      'IDEMPOTENCY_IN_PROGRESS',
      'INTERNAL_ERROR',
    ]);
  });
});
