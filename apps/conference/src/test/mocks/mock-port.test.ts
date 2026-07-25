import {
  defineApiProblemSchema,
  sessionExpiredProblemSchema,
} from '@byzon/domain/contracts';
import { FixtureValidationError } from '@byzon/test-support';
import {
  activationFixtureCode,
  contentFixtureIds,
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
  consumeActivationLink,
  requestActivationLanding,
  submitActivationClaim,
  submitActivationIdentity,
} from '../../lib/activation-api.js';
import { createMockServer } from './node.js';
import {
  MOCK_REQUEST_ID,
  mockJsonResponse,
  mockProblemResponse,
} from './response.js';
import { resetMockActivationState } from './handlers.js';

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
});
