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
  identitySessionActionEndpoint,
  requestIdentityBootstrap,
  submitIdentityOnboarding,
  submitIdentitySessionAction,
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
});
