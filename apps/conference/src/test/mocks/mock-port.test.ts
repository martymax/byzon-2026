import {
  defineApiProblemSchema,
  sessionExpiredProblemSchema,
} from '@byzon/domain/contracts';
import { FixtureValidationError } from '@byzon/test-support';
import {
  activationFixtureCode,
  activationFixtureRecoveryCode,
  announcementFixtureIds,
  contentFixtureIds,
  identityFixtureIds,
  identityFixtureProfile,
  sessionExpiredProblemFixture,
} from '@byzon/test-support/fixtures';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http } from 'msw';
import { z } from 'zod';

import { defineApiEndpoint } from '../../lib/api/endpoint.js';
import {
  createFetchApiClient,
  type FetchApiClientOptions,
} from '../../lib/api/fetch-client.js';
import { requestParticipantProgram } from '../../lib/content-api.js';
import {
  markAnnouncementRead,
  requestAnnouncementDetail,
  requestAnnouncementInbox,
} from '../../lib/announcement-api.js';
import {
  consumeActivationLink,
  requestActivationLanding,
  submitActivationClaim,
  submitActivationIdentity,
  submitActivationRecovery,
} from '../../lib/activation-api.js';
import {
  requestIdentityBootstrap,
  submitIdentityOnboarding,
  submitIdentitySessionAction,
} from '../../lib/identity-api.js';
import { createMockServer } from './node.js';
import {
  MOCK_REQUEST_ID,
  mockJsonResponse,
  mockProblemResponse,
} from './response.js';
import {
  configureMockAnnouncementAccess,
  resetMockActivationState,
  resetMockAnnouncementState,
} from './handlers.js';

const ORIGIN = 'http://mock.byzon.test';
const successSchema = z.strictObject({
  mode: z.literal('mock'),
  count: z.number().int().nonnegative(),
});
const internalErrorSchema = defineApiProblemSchema('INTERNAL_ERROR', 500);
const endpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema,
  problemSchema: internalErrorSchema,
  problemCodes: ['INTERNAL_ERROR'],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'forbidden',
});
const server = createMockServer();
const fetchWithOrigin: NonNullable<FetchApiClientOptions['fetch']> = (
  input,
  init,
) => {
  const rawUrl =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.href
        : input;
  return globalThis.fetch(new URL(rawUrl, ORIGIN), init);
};
const client = createFetchApiClient({ fetch: fetchWithOrigin });

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  server.resetHandlers();
  resetMockActivationState();
  resetMockAnnouncementState();
});
afterAll(() => server.close());

describe('MSW through the production API port', () => {
  it('validates a synthetic success fixture and returns normal ApiPort data', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/foundation`, () =>
        mockJsonResponse(
          successSchema,
          { mode: 'mock', count: 2 },
          { fixtureName: 'foundation.success', etag: '"mock-v1"' },
        ),
      ),
    );

    await expect(
      client.request(endpoint, { path: '/api/v1/foundation' }),
    ).resolves.toEqual({
      ok: true,
      kind: 'success',
      status: 200,
      data: { mode: 'mock', count: 2 },
      metadata: { requestId: MOCK_REQUEST_ID, etag: '"mock-v1"' },
    });
  });

  it('maps a validated problem fixture through the same failure taxonomy', async () => {
    server.use(
      http.get(`${ORIGIN}/api/v1/foundation`, () =>
        mockProblemResponse(
          sessionExpiredProblemSchema,
          sessionExpiredProblemFixture,
          { fixtureName: 'foundation.session-expired' },
        ),
      ),
    );

    await expect(
      client.request(endpoint, { path: '/api/v1/foundation' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      failure: {
        kind: 'session_expired',
        problem: { code: 'AUTH_SESSION_EXPIRED' },
      },
    });
  });

  it('rejects an invalid synthetic payload before MSW can return it', () => {
    let thrown: unknown;
    try {
      mockJsonResponse(
        successSchema,
        { mode: 'mock', count: -1, secret: 'must-not-leak' },
        { fixtureName: 'foundation.invalid' },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FixtureValidationError);
    expect(String(thrown)).not.toContain('must-not-leak');
    expect(JSON.stringify(thrown)).not.toContain('must-not-leak');
  });

  it('serves content only for the canonical synthetic event scope', async () => {
    await expect(
      requestParticipantProgram(client, contentFixtureIds.event),
    ).resolves.toMatchObject({
      ok: true,
      data: { eventId: contentFixtureIds.event },
    });

    await expect(
      requestParticipantProgram(client, '01910000-0000-7000-8000-000000000099'),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
      failure: {
        kind: 'problem',
        problem: { code: 'PROGRAM_NOT_FOUND' },
      },
    });
  });

  it('marks private mock data as no-store and varies by session context', async () => {
    const response = await fetchWithOrigin(
      `/api/v1/events/${contentFixtureIds.event}/program`,
    );

    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('authorization, cookie');
  });

  it('serves a private announcement inbox and updates canonical read state', async () => {
    await expect(
      requestAnnouncementInbox(client, { filter: 'all' }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        eventId: announcementFixtureIds.event,
        unreadCount: 2,
        items: [
          { id: announcementFixtureIds.critical, readAt: null },
          { id: announcementFixtureIds.important, readAt: null },
          {
            id: announcementFixtureIds.information,
            readAt: '2026-09-17T12:15:00.000Z',
          },
        ],
      },
    });

    await expect(
      markAnnouncementRead(
        client,
        announcementFixtureIds.important,
        'announcement-read-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        announcementId: announcementFixtureIds.important,
        state: 'read',
        unreadCount: 1,
      },
    });
    await expect(
      requestAnnouncementDetail(client, announcementFixtureIds.important),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        announcement: {
          id: announcementFixtureIds.important,
          readAt: '2026-09-18T06:35:00.000Z',
        },
      },
    });
    await expect(
      requestAnnouncementInbox(client, { filter: 'unread' }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        unreadCount: 1,
        items: [{ id: announcementFixtureIds.critical, readAt: null }],
      },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        unreadCounts: { announcements: 1 },
      },
    });

    const response = await fetchWithOrigin(
      '/api/v1/me/announcements?filter=all',
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toBe('authorization, cookie');
  });

  it('scopes the announcement inbox and unread count to the current recipient', async () => {
    configureMockAnnouncementAccess({
      recipientAnnouncementIds: [
        announcementFixtureIds.critical,
        announcementFixtureIds.information,
      ],
    });

    await expect(
      requestAnnouncementInbox(client, { filter: 'all' }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        unreadCount: 1,
        items: [
          { id: announcementFixtureIds.critical, readAt: null },
          {
            id: announcementFixtureIds.information,
            readAt: '2026-09-17T12:15:00.000Z',
          },
        ],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    });
    await expect(
      requestAnnouncementInbox(client, { filter: 'unread' }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        unreadCount: 1,
        items: [{ id: announcementFixtureIds.critical, readAt: null }],
      },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: { unreadCounts: { announcements: 1 } },
    });
  });

  it('does not distinguish a cross-recipient announcement from a missing ID', async () => {
    configureMockAnnouncementAccess({
      recipientAnnouncementIds: [
        announcementFixtureIds.critical,
        announcementFixtureIds.information,
      ],
    });
    const missingId = '01920000-0000-7000-8000-000000000099';

    const crossRecipientDetail = await fetchWithOrigin(
      `/api/v1/me/announcements/${announcementFixtureIds.important}`,
    );
    const missingDetail = await fetchWithOrigin(
      `/api/v1/me/announcements/${missingId}`,
    );
    expect(crossRecipientDetail.status).toBe(404);
    expect(missingDetail.status).toBe(404);
    expect(await crossRecipientDetail.text()).toBe(await missingDetail.text());

    const readRequest = {
      method: 'POST',
      headers: {
        'idempotency-key': 'announcement-recipient-probe-0001',
      },
    };
    const crossRecipientRead = await fetchWithOrigin(
      `/api/v1/me/announcements/${announcementFixtureIds.important}/read`,
      readRequest,
    );
    const missingRead = await fetchWithOrigin(
      `/api/v1/me/announcements/${missingId}/read`,
      readRequest,
    );
    expect(crossRecipientRead.status).toBe(404);
    expect(missingRead.status).toBe(404);
    expect(await crossRecipientRead.text()).toBe(await missingRead.text());
  });

  it('replays an exact announcement read and rejects key reuse for another item', async () => {
    const key = 'announcement-read-replay-0001';
    const first = await markAnnouncementRead(
      client,
      announcementFixtureIds.important,
      key,
    );
    const replay = await markAnnouncementRead(
      client,
      announcementFixtureIds.important,
      key,
    );
    expect(replay).toEqual(first);

    await expect(
      markAnnouncementRead(client, announcementFixtureIds.critical, key),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
  });

  it('advances bounded announcement cursors without repeating a page', async () => {
    await expect(
      requestAnnouncementInbox(client, { filter: 'all', limit: 1 }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        items: [{ id: announcementFixtureIds.critical }],
        pageInfo: {
          hasMore: true,
          nextCursor: 'fixture-announcements-offset-1',
        },
      },
    });
    await expect(
      requestAnnouncementInbox(client, {
        filter: 'all',
        cursor: 'fixture-announcements-offset-1',
        limit: 1,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        items: [{ id: announcementFixtureIds.important }],
        pageInfo: {
          hasMore: true,
          nextCursor: 'fixture-announcements-offset-2',
        },
      },
    });
    await expect(
      requestAnnouncementInbox(client, {
        filter: 'all',
        cursor: 'fixture-announcements-offset-2',
        limit: 1,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        items: [{ id: announcementFixtureIds.information }],
        pageInfo: { hasMore: false, nextCursor: null },
      },
    });
  });

  it('fails announcement access closed for auth, feature, scope and missing IDs', async () => {
    configureMockAnnouncementAccess({ featureEnabled: false });
    await expect(
      requestAnnouncementInbox(client, { filter: 'all' }),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'ANNOUNCEMENTS_DISABLED' },
      },
    });

    resetMockAnnouncementState();
    configureMockAnnouncementAccess({ eventAccess: false });
    await expect(
      requestAnnouncementDetail(client, announcementFixtureIds.critical),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'EVENT_ACCESS_DENIED' },
      },
    });

    resetMockAnnouncementState();
    const missingId = '01920000-0000-7000-8000-000000000099';
    await expect(
      requestAnnouncementDetail(client, missingId),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
      failure: {
        kind: 'problem',
        problem: { code: 'ANNOUNCEMENT_NOT_FOUND' },
      },
    });
    await expect(
      markAnnouncementRead(client, missingId, 'announcement-read-missing-0001'),
    ).resolves.toMatchObject({
      ok: false,
      status: 404,
      failure: {
        kind: 'problem',
        problem: { code: 'ANNOUNCEMENT_NOT_FOUND' },
      },
    });

    await expect(
      submitIdentitySessionAction(
        client,
        'logout_current',
        'announcement-logout-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      requestAnnouncementInbox(client, { filter: 'all' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
  });

  it('rejects announcement query failure switches as validation errors', async () => {
    const response = await fetchWithOrigin(
      '/api/v1/me/announcements?filter=all&failure=offline',
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('accepts only the canonical synthetic claim code without enumeration', async () => {
    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureCode, method: 'manual_code' },
        'claim-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'identity_required',
        membershipCreated: false,
        sessionCreated: false,
      },
    });
    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureCode, method: 'manual_code' },
        'claim-mock-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureRecoveryCode, method: 'manual_code' },
        'claim-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });

    await expect(
      submitActivationClaim(
        client,
        { code: 'UNKNOWN-CODE-2026', method: 'manual_code' },
        'claim-mock-port-0002',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'CLAIM_REJECTED' },
      },
    });

    await expect(
      submitActivationClaim(
        client,
        {
          code: 'camera:00000000-0000-4000-8000-000000000001',
          method: 'camera_scan',
        },
        'claim-mock-port-0003',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'identity_required',
        membershipCreated: false,
        sessionCreated: false,
      },
    });
    await expect(
      submitActivationIdentity(
        client,
        {
          flowId: 'flow.synthetic.2026',
          email: 'alex@example.test',
          returnTo: '/onboarding',
        },
        'identity-mock-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      submitActivationIdentity(
        client,
        {
          flowId: 'flow.synthetic.2026',
          email: 'other@example.test',
          returnTo: '/onboarding',
        },
        'identity-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
  });

  it('continues the synthetic identity and one-time-link handoff', async () => {
    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureCode, method: 'manual_code' },
        'claim-mock-port-handoff-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(requestActivationLanding(client)).resolves.toMatchObject({
      ok: true,
      data: {
        flow: {
          state: 'claim_in_progress',
          flowId: 'flow.synthetic.2026',
        },
      },
    });

    await expect(
      submitActivationIdentity(
        client,
        {
          flowId: 'flow.synthetic.2026',
          email: 'alex@example.test',
          returnTo: '/onboarding',
        },
        'identity-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'link_sent',
        membershipCreated: false,
        sessionCreated: false,
      },
    });

    await expect(
      consumeActivationLink(
        client,
        'link:00000000-0000-4000-8000-000000000001',
        'link-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'onboarding_required',
        continueTo: '/onboarding',
      },
    });

    await expect(
      consumeActivationLink(
        client,
        'link:00000000-0000-4000-8000-000000000001',
        'link-mock-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      consumeActivationLink(
        client,
        'link:00000000-0000-4000-8000-000000000001',
        'link-mock-port-0002',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'ACTIVATION_LINK_REJECTED' },
      },
    });
  });

  it('keeps already-active recovery neutral and returns the active branch', async () => {
    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureRecoveryCode, method: 'manual_code' },
        'claim-recovery-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'recovery_required',
        membershipCreated: false,
        sessionCreated: false,
      },
    });
    await expect(
      submitActivationRecovery(
        client,
        { email: 'unknown@example.test', returnTo: '/app' },
        'recovery-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { accepted: true, resendAfterSeconds: 60 },
    });
    await expect(
      submitActivationRecovery(
        client,
        { email: 'unknown@example.test', returnTo: '/app' },
        'recovery-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      submitActivationRecovery(
        client,
        { email: 'other@example.test', returnTo: '/app' },
        'recovery-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });

    const token = 'recovery-app:00000000-0000-4000-8000-000000000001';
    await expect(
      consumeActivationLink(client, token, 'recovery-link-port-0001'),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'active', continueTo: '/app' },
    });
    await expect(
      consumeActivationLink(client, token, 'recovery-link-port-0001'),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'active', continueTo: '/app' },
    });
    await expect(
      consumeActivationLink(
        client,
        'recovery-app:00000000-0000-4000-8000-000000000002',
        'recovery-link-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });

    await expect(
      submitActivationRecovery(
        client,
        { email: 'unknown@example.test', returnTo: '/onboarding' },
        'recovery-port-0002',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      consumeActivationLink(
        client,
        'recovery-onboarding:00000000-0000-4000-8000-000000000003',
        'recovery-link-port-0002',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'onboarding_required', continueTo: '/onboarding' },
    });
  });

  it('completes synthetic onboarding with exact legal versions and replay safety', async () => {
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        dataMode: 'synthetic_preview',
        membership: { access: { state: 'pending_activation' } },
        onboarding: { status: 'profile_required' },
      },
    });
    const request = {
      profile: identityFixtureProfile,
      legal: {
        termsDocumentId: identityFixtureIds.terms,
        termsAccepted: true,
        privacyNoticeDocumentId: identityFixtureIds.privacyNotice,
        privacyAcknowledged: true,
      },
      networking: { enabled: false },
    } as const;

    await expect(
      submitIdentityOnboarding(client, request, 'onboarding-mock-port-0001'),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'complete',
        networkingEnabled: false,
      },
    });
    await expect(
      submitIdentityOnboarding(client, request, 'onboarding-mock-port-0001'),
    ).resolves.toMatchObject({ ok: true });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: {
        onboarding: { status: 'complete' },
        networking: { enabled: false },
      },
    });

    await expect(
      submitIdentityOnboarding(
        client,
        {
          ...request,
          profile: { ...request.profile, firstName: 'Druhý' },
        },
        'onboarding-mock-port-0002',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { profile: { firstName: 'Druhý' } },
    });
    await expect(
      submitIdentityOnboarding(client, request, 'onboarding-mock-port-0001'),
    ).resolves.toMatchObject({
      ok: true,
      data: { profile: { firstName: 'Alex' } },
    });
    await expect(
      submitIdentityOnboarding(
        client,
        {
          ...request,
          profile: { ...request.profile, firstName: 'Jiný' },
        },
        'onboarding-mock-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
  });

  it('replays exact session actions and invalidates the mock owner context', async () => {
    await expect(
      submitIdentitySessionAction(
        client,
        'switch_account',
        'session-action-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        action: 'switch_account',
        effect: 'synthetic_preview',
        personalData: { disposition: 'none_present' },
      },
    });
    await expect(
      submitIdentitySessionAction(
        client,
        'switch_account',
        'session-action-port-0001',
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      submitIdentitySessionAction(
        client,
        'logout_all',
        'session-action-port-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
    await expect(
      submitIdentitySessionAction(
        client,
        'logout_current',
        'session-action-port-0002',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });
  });

  it('keeps the mock owner signed out until a one-time link is consumed', async () => {
    await expect(
      submitIdentitySessionAction(
        client,
        'logout_current',
        'session-action-auth-boundary-0001',
      ),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      submitActivationClaim(
        client,
        { code: activationFixtureCode, method: 'manual_code' },
        'claim-auth-boundary-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        state: 'identity_required',
        membershipCreated: false,
        sessionCreated: false,
      },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'AUTHENTICATION_REQUIRED' },
      },
    });

    await expect(
      consumeActivationLink(
        client,
        'link:00000000-0000-4000-8000-000000000099',
        'link-auth-boundary-0001',
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { state: 'onboarding_required', continueTo: '/onboarding' },
    });
    await expect(requestIdentityBootstrap(client)).resolves.toMatchObject({
      ok: true,
      data: { onboarding: { status: 'profile_required' } },
    });
  });
});
