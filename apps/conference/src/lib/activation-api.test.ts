import {
  activationClaimFixtures,
  activationLandingFixtures,
  activationRecoveryFixtures,
} from '@byzon/test-support/fixtures';
import { describe, expect, it, vi } from 'vitest';

import {
  createFetchApiClient,
  type FetchApiClientOptions,
} from './api/fetch-client';
import {
  activationClaimEndpoint,
  activationRecoveryEndpoint,
  requestActivationLanding,
  submitActivationClaim,
  submitActivationRecovery,
} from './activation-api';

describe('activation API port', () => {
  it('loads the no-store activation landing through the typed port', async () => {
    const fetch = vi.fn(async () =>
      Response.json(activationLandingFixtures.anonymous, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-activation-0001',
        },
      }),
    );
    const result = await requestActivationLanding(
      createFetchApiClient({ fetch, maxRetries: 0 }),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { flow: { state: 'anonymous' } },
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/activation',
      expect.objectContaining({ cache: 'no-store', method: 'GET' }),
    );
  });

  it('requires an idempotency key and preserves the opaque claim code', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      Response.json(activationClaimFixtures.identity_required, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-activation-0002',
        },
        status: init?.method === 'POST' ? 200 : 500,
      }),
    );
    const code = 'TST-OPAQUE-2026';
    const result = await submitActivationClaim(
      createFetchApiClient({ fetch, maxRetries: 0 }),
      { code, method: 'manual_code' },
      'claim-idempotency-0001',
    );

    expect(result.ok).toBe(true);
    const requestInit = fetch.mock.calls[0]?.[1];
    expect(new Headers(requestInit?.headers).get('idempotency-key')).toBe(
      'claim-idempotency-0001',
    );
    expect(requestInit?.body).toBe(
      JSON.stringify({ code, method: 'manual_code' }),
    );
    expect(activationClaimEndpoint.idempotency).toBe('required');
  });

  it('rejects an uncontracted landing field', async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        {
          ...activationLandingFixtures.anonymous,
          currentUserEmail: 'must-not-cross@example.test',
        },
        {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'request-activation-0003',
          },
        },
      ),
    );

    await expect(
      requestActivationLanding(createFetchApiClient({ fetch, maxRetries: 0 })),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid_response',
        requestId: 'request-activation-0003',
      },
    });
  });

  it('submits recovery neutrally without putting the email in the URL', async () => {
    const fetch = vi.fn<NonNullable<FetchApiClientOptions['fetch']>>(async () =>
      Response.json(activationRecoveryFixtures.accepted, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'request-recovery-0001',
        },
      }),
    );
    const result = await submitActivationRecovery(
      createFetchApiClient({ fetch, maxRetries: 0 }),
      { email: 'alex@example.test', returnTo: '/app' },
      'recovery-idempotency-0001',
    );

    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/activation/recovery',
      expect.objectContaining({
        body: JSON.stringify({
          email: 'alex@example.test',
          returnTo: '/app',
        }),
        cache: 'no-store',
        method: 'POST',
      }),
    );
    const init = fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      'recovery-idempotency-0001',
    );
    expect(activationRecoveryEndpoint.problemCodes).toEqual([
      'CLAIM_RATE_LIMITED',
      'IDEMPOTENCY_KEY_REUSED',
      'IDEMPOTENCY_IN_PROGRESS',
      'INTERNAL_ERROR',
    ]);
  });
});
