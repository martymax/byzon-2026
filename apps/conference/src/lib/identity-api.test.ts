import {
  identityBootstrapFixtures,
  identityFixtureIds,
  identityFixtureProfile,
  identityOnboardingFixtures,
  identitySessionActionFixtures,
} from '@byzon/test-support/fixtures';
import { describe, expect, it, vi } from 'vitest';

import {
  createFetchApiClient,
  type FetchApiClientOptions,
} from './api/fetch-client';
import {
  identityBootstrapEndpoint,
  identityOnboardingEndpoint,
  identityPrivacyRequestEndpoint,
  identityProfileUpdateEndpoint,
  identitySessionActionEndpoint,
  requestIdentityBootstrap,
  submitIdentityPrivacyRequest,
  submitIdentityOnboarding,
  submitIdentitySessionAction,
  updateIdentityProfile,
} from './identity-api';

type TestFetch = NonNullable<FetchApiClientOptions['fetch']>;

describe('CS-BOOT-01 identity API port', () => {
  it('loads bootstrap privately without an idempotency key', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(identityBootstrapFixtures.profile_required, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-bootstrap-0001',
        },
      }),
    );
    const result = await requestIdentityBootstrap(
      createFetchApiClient({ fetch, maxRetries: 0 }),
    );

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/me/bootstrap',
      expect.objectContaining({
        cache: 'no-store',
        method: 'GET',
      }),
    );
    const init = fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has('idempotency-key')).toBe(false);
    expect(identityBootstrapEndpoint.problemCodes).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'EVENT_ACCESS_DENIED',
      'INTERNAL_ERROR',
    ]);
  });

  it('submits exact legal versions and networking opt-out idempotently', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(identityOnboardingFixtures.opted_out, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-onboarding-0001',
        },
      }),
    );
    const body = {
      profile: identityFixtureProfile,
      legal: {
        termsDocumentId: identityFixtureIds.terms,
        termsAccepted: true,
        privacyNoticeDocumentId: identityFixtureIds.privacyNotice,
        privacyAcknowledged: true,
      },
      networking: { enabled: false },
    } as const;
    const result = await submitIdentityOnboarding(
      createFetchApiClient({ fetch, maxRetries: 0 }),
      body,
      'onboarding-request-0001',
    );

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/me/onboarding',
      expect.objectContaining({
        body: JSON.stringify(body),
        cache: 'no-store',
        method: 'POST',
      }),
    );
    const init = fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      'onboarding-request-0001',
    );
    expect(identityOnboardingEndpoint.problemCodes).toContain(
      'STALE_LEGAL_DOCUMENT',
    );
  });

  it('rejects a malformed bootstrap response', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(
        {
          ...identityBootstrapFixtures.profile_required,
          dataMode: 'live',
        },
        {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'request-bootstrap-0002',
          },
        },
      ),
    );
    const result = await requestIdentityBootstrap(
      createFetchApiClient({ fetch, maxRetries: 0 }),
    );

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid_response',
        requestId: 'request-bootstrap-0002',
      },
    });
  });

  it('submits an exact session action through the no-store idempotent port', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(identitySessionActionFixtures.switch_account, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-session-action-0001',
        },
      }),
    );
    const result = await submitIdentitySessionAction(
      createFetchApiClient({ fetch, maxRetries: 0 }),
      'switch_account',
      'session-action-idempotency-0001',
    );

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/me/session-action',
      expect.objectContaining({
        body: JSON.stringify({ action: 'switch_account' }),
        cache: 'no-store',
        method: 'POST',
      }),
    );
    const init = fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      'session-action-idempotency-0001',
    );
    expect(identitySessionActionEndpoint.problemCodes).toContain(
      'SESSION_ACTION_REJECTED',
    );
  });

  it('updates the own profile with an explicit optimistic version only', async () => {
    const response = {
      eventId: '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
      userId: identityFixtureIds.user,
      profile: {
        ...identityFixtureProfile,
        firstName: 'Alexandra',
      },
      profileManagement: { state: 'editable', version: 2 },
      updatedAt: '2026-07-25T13:00:00.000Z',
    } as const;
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(response, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-profile-update-0001',
        },
      }),
    );
    const body = {
      expectedVersion: 1,
      profile: response.profile,
    } as const;
    const result = await updateIdentityProfile(
      createFetchApiClient({ fetch, maxRetries: 0 }),
      body,
    );

    expect(result).toMatchObject({ ok: true, data: response });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/me/profile',
      expect.objectContaining({
        body: JSON.stringify(body),
        cache: 'no-store',
        method: 'PATCH',
      }),
    );
    const init = fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has('idempotency-key')).toBe(false);
    expect(identityProfileUpdateEndpoint.problemCodes).toEqual([
      'AUTHENTICATION_REQUIRED',
      'AUTH_SESSION_EXPIRED',
      'EVENT_ACCESS_DENIED',
      'PROFILE_NOT_FOUND',
      'PROFILE_NOT_EDITABLE',
      'STALE_VERSION',
      'VALIDATION_FAILED',
      'INTERNAL_ERROR',
    ]);
  });

  it('submits privacy requests online-only with exact replay identity', async () => {
    const response = {
      eventId: '019f7e6f-62ed-7c87-bce7-b742be58ce0b',
      userId: identityFixtureIds.user,
      request: {
        id: '01910000-0000-7000-8000-000000000401',
        kind: 'data_export',
        state: 'pending',
        requestedAt: '2026-07-25T13:05:00.000Z',
      },
    } as const;
    const fetch = vi.fn<TestFetch>(async () =>
      Response.json(response, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-privacy-0001',
        },
      }),
    );
    const body = { kind: 'data_export' } as const;
    const result = await submitIdentityPrivacyRequest(
      createFetchApiClient({ fetch, maxRetries: 0 }),
      body,
      'privacy-request-0001',
    );

    expect(result).toMatchObject({ ok: true, data: response });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/me/privacy-requests',
      expect.objectContaining({
        body: JSON.stringify(body),
        cache: 'no-store',
        method: 'POST',
      }),
    );
    const init = fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      'privacy-request-0001',
    );
    expect(identityPrivacyRequestEndpoint.problemCodes).toContain(
      'PRIVACY_REQUEST_UNAVAILABLE',
    );
  });

  it('does not retry an offline profile or privacy mutation', async () => {
    const fetch = vi.fn<TestFetch>(async () => {
      throw new TypeError('synthetic network loss');
    });
    const api = createFetchApiClient({
      fetch,
      isOnline: () => false,
      maxRetries: 2,
    });

    await expect(
      updateIdentityProfile(api, {
        expectedVersion: 1,
        profile: identityFixtureProfile,
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'offline' },
    });
    await expect(
      submitIdentityPrivacyRequest(
        api,
        { kind: 'data_deletion' },
        'privacy-offline-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'offline' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
