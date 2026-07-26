import {
  apiProblemSchema,
  defineApiProblemSchema,
} from '@byzon/domain/contracts';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineApiEndpoint } from './endpoint.js';
import {
  ApiRequestConfigurationError,
  createFetchApiClient,
  type FetchApiClientOptions,
} from './fetch-client.js';

const REQUEST_ID = 'request-12345678';
const ETAG = '"publication-42"';
const successSchema = z.strictObject({ value: z.string() });
const capacityProblemSchema = defineApiProblemSchema('CAPACITY_FULL', 409);
const mutationBodySchema = z.strictObject({
  value: z.string().min(1),
  secret: z.string().min(8),
});
type TestFetch = NonNullable<FetchApiClientOptions['fetch']>;

const readEndpoint = defineApiEndpoint({
  method: 'GET',
  requestSchema: null,
  successSchema,
  problemSchema: capacityProblemSchema,
  problemCodes: ['CAPACITY_FULL'],
  responseKind: 'json',
  retry: 'safe-read',
  idempotency: 'forbidden',
});

const broadProblemEndpoint = defineApiEndpoint({
  ...readEndpoint,
  problemSchema: apiProblemSchema,
});

const mutationEndpoint = defineApiEndpoint({
  method: 'POST',
  requestSchema: mutationBodySchema,
  successSchema,
  problemSchema: capacityProblemSchema,
  problemCodes: ['CAPACITY_FULL'],
  responseKind: 'json',
  retry: 'never',
  idempotency: 'required',
});

const emptyEndpoint = defineApiEndpoint({
  method: 'DELETE',
  requestSchema: null,
  successSchema: z.undefined(),
  problemSchema: capacityProblemSchema,
  problemCodes: ['CAPACITY_FULL'],
  responseKind: 'empty',
  retry: 'never',
  idempotency: 'optional',
});

const responseHeaders = (
  contentType = 'application/json',
  extra: HeadersInit = {},
): Headers =>
  new Headers({
    'content-type': contentType,
    'x-request-id': REQUEST_ID,
    ...Object.fromEntries(new Headers(extra)),
  });

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: responseHeaders(
      new Headers(init.headers).get('content-type') ?? 'application/json',
      init.headers,
    ),
  });

const problem = (
  code = 'CAPACITY_FULL',
  status = 409,
  requestId = REQUEST_ID,
) => ({
  type: `urn:byzon:problem:${code.toLowerCase().replaceAll('_', '-')}`,
  title: 'Request rejected',
  status,
  code,
  detail: 'The request cannot be completed.',
  requestId,
});

const clientWith = (options: FetchApiClientOptions) =>
  createFetchApiClient({
    maxRetries: 0,
    ...options,
  });

describe('fetch API client success contract', () => {
  it('validates JSON, metadata and managed same-origin request options', async () => {
    const fetch = vi.fn<TestFetch>(async () =>
      jsonResponse(
        { value: 'accepted' },
        {
          headers: { etag: ETAG, 'content-type': 'application/vnd.byzon+json' },
        },
      ),
    );
    const client = clientWith({ fetch });

    await expect(
      client.request(readEndpoint, { path: '/api/v1/program?day=1' }),
    ).resolves.toEqual({
      ok: true,
      kind: 'success',
      status: 200,
      data: { value: 'accepted' },
      metadata: { requestId: REQUEST_ID, etag: ETAG },
    });

    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe('/api/v1/program?day=1');
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'error',
      referrerPolicy: 'same-origin',
      cache: 'default',
    });
    expect(new Headers(init?.headers).get('accept')).toBe(
      'application/json, application/problem+json',
    );
  });

  it('returns not_modified only when the response repeats the requested ETag', async () => {
    const matchingClient = clientWith({
      fetch: async () =>
        new Response(null, {
          status: 304,
          headers: responseHeaders('application/json', { etag: ETAG }),
        }),
    });
    const mismatchingClient = clientWith({
      fetch: async () =>
        new Response(null, {
          status: 304,
          headers: responseHeaders('application/json', {
            etag: '"other-version"',
          }),
        }),
    });

    await expect(
      matchingClient.request(readEndpoint, {
        path: '/api/v1/program',
        etag: ETAG,
      }),
    ).resolves.toMatchObject({ ok: true, kind: 'not_modified', status: 304 });
    await expect(
      mismatchingClient.request(readEndpoint, {
        path: '/api/v1/program',
        etag: ETAG,
      }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('accepts an explicitly empty success response', async () => {
    const client = clientWith({
      fetch: async () =>
        new Response(null, {
          status: 204,
          headers: { 'x-request-id': REQUEST_ID },
        }),
    });

    await expect(
      client.request(emptyEndpoint, {
        path: '/api/v1/reservations/42',
        idempotencyKey: 'request-key-0001',
      }),
    ).resolves.toMatchObject({
      ok: true,
      kind: 'success',
      status: 204,
      data: undefined,
    });
  });
});

describe('fetch API client response failures', () => {
  it.each([
    ['invalid success body', jsonResponse({ unexpected: true })],
    [
      'wrong success content type',
      new Response(JSON.stringify({ value: 'accepted' }), {
        status: 200,
        headers: responseHeaders('text/plain'),
      }),
    ],
    [
      'missing request ID',
      new Response(JSON.stringify({ value: 'accepted' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
    [
      'oversized declared body',
      new Response(JSON.stringify({ value: 'accepted' }), {
        status: 200,
        headers: responseHeaders('application/json', {
          'content-length': '100',
        }),
      }),
    ],
    ['oversized streamed body', jsonResponse({ value: 'x'.repeat(100) })],
  ])('classifies %s as invalid_response', async (_name, response) => {
    const client = clientWith({
      maxResponseBytes: 32,
      fetch: async () => response,
    });

    await expect(
      client.request(readEndpoint, { path: '/api/v1/program' }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('maps an exact endpoint problem and preserves safe metadata', async () => {
    const client = clientWith({
      fetch: async () =>
        jsonResponse(problem(), {
          status: 409,
          headers: { 'content-type': 'application/problem+json' },
        }),
    });

    await expect(
      client.request(readEndpoint, { path: '/api/v1/program' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 409,
      failure: {
        kind: 'problem',
        problem: { code: 'CAPACITY_FULL', requestId: REQUEST_ID },
      },
      metadata: { requestId: REQUEST_ID },
    });
  });

  it('maps exact session expiry independently of endpoint problem codes', async () => {
    const client = clientWith({
      fetch: async () =>
        jsonResponse(problem('AUTH_SESSION_EXPIRED', 401), {
          status: 401,
          headers: { 'content-type': 'application/problem+json' },
        }),
    });

    await expect(
      client.request(readEndpoint, { path: '/api/v1/program' }),
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      failure: {
        kind: 'session_expired',
        problem: { code: 'AUTH_SESSION_EXPIRED' },
      },
    });
  });

  it.each([
    ['unknown code', problem('UNKNOWN_FAILURE', 409)],
    ['status mismatch', problem('CAPACITY_FULL', 400)],
    ['request ID mismatch', problem('CAPACITY_FULL', 409, 'request-87654321')],
  ])('rejects a problem with %s', async (_name, body) => {
    const client = clientWith({
      fetch: async () =>
        jsonResponse(body, {
          status: 409,
          headers: { 'content-type': 'application/problem+json' },
        }),
    });

    await expect(
      client.request(broadProblemEndpoint, { path: '/api/v1/program' }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid_response' },
    });
  });

  it('classifies response body read errors as transport failures', async () => {
    const client = clientWith({
      fetch: async () =>
        ({
          ok: true,
          status: 200,
          headers: responseHeaders(),
          text: async () => {
            throw new Error('socket interrupted');
          },
        }) as unknown as Response,
    });

    await expect(
      client.request(readEndpoint, { path: '/api/v1/program' }),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'transport' },
    });
  });
});

describe('fetch API client cancellation and retry', () => {
  it('distinguishes caller abort, timeout, offline and transport failures', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const neverCalled = vi.fn();
    const abortedClient = clientWith({ fetch: neverCalled });

    await expect(
      abortedClient.request(readEndpoint, {
        path: '/api/v1/program',
        signal: aborted.signal,
      }),
    ).resolves.toMatchObject({ failure: { kind: 'aborted' } });
    expect(neverCalled).not.toHaveBeenCalled();

    const activeAbort = new AbortController();
    const activeAbortClient = clientWith({
      fetch: async () => new Promise<Response>(() => undefined),
    });
    const activeRequest = activeAbortClient.request(readEndpoint, {
      path: '/api/v1/program',
      signal: activeAbort.signal,
    });
    activeAbort.abort();
    await expect(activeRequest).resolves.toMatchObject({
      failure: { kind: 'aborted' },
    });

    const timeoutClient = clientWith({
      timeoutMs: 100,
      fetch: async () => new Promise<Response>(() => undefined),
    });
    await expect(
      timeoutClient.request(readEndpoint, { path: '/api/v1/program' }),
    ).resolves.toMatchObject({ failure: { kind: 'timeout' } });

    const offlineClient = clientWith({
      fetch: async () => {
        throw new TypeError('network failed');
      },
      isOnline: () => false,
    });
    await expect(
      offlineClient.request(readEndpoint, { path: '/api/v1/program' }),
    ).resolves.toMatchObject({ failure: { kind: 'offline' } });

    const transportClient = clientWith({
      fetch: async () => {
        throw new TypeError('network failed');
      },
      isOnline: () => true,
    });
    await expect(
      transportClient.request(readEndpoint, { path: '/api/v1/program' }),
    ).resolves.toMatchObject({ failure: { kind: 'transport' } });
  });

  it('retries safe reads after transport and bounded Retry-After failures', async () => {
    const delays: number[] = [];
    const fetch = vi
      .fn<TestFetch>()
      .mockRejectedValueOnce(new TypeError('network failed'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(problem('UNAVAILABLE', 503)), {
          status: 503,
          headers: responseHeaders('application/problem+json', {
            'retry-after': '1',
          }),
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ value: 'recovered' }));
    const client = createFetchApiClient({
      fetch,
      maxRetries: 2,
      retryDelayMs: 25,
      maxRetryDelayMs: 1_000,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });

    await expect(
      client.request(readEndpoint, { path: '/api/v1/program' }),
    ).resolves.toMatchObject({
      ok: true,
      data: { value: 'recovered' },
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([25, 1_000]);
  });

  it('never automatically retries a mutation and sends its idempotency key', async () => {
    const fetch = vi.fn<TestFetch>(async () => {
      throw new TypeError('network failed');
    });
    const client = createFetchApiClient({
      fetch,
      maxRetries: 2,
      sleep: async () => undefined,
    });

    await expect(
      client.request(mutationEndpoint, {
        path: '/api/v1/reservations',
        body: { value: 'seat-42', secret: 'top-secret-value' },
        idempotencyKey: 'request-key-0001',
      }),
    ).resolves.toMatchObject({ failure: { kind: 'transport' } });

    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0]![1];
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      'request-key-0001',
    );
    expect(init?.body).toBe(
      JSON.stringify({ value: 'seat-42', secret: 'top-secret-value' }),
    );
  });

  it('rejects a hand-crafted mutation that bypasses the endpoint factory policy', async () => {
    const fetch = vi.fn<TestFetch>();
    const client = createFetchApiClient({ fetch, maxRetries: 2 });
    const unsafeEndpoint = {
      ...mutationEndpoint,
      retry: 'safe-read',
    } as const;

    await expect(
      client.request(unsafeEndpoint, {
        path: '/api/v1/reservations',
        body: { value: 'seat-42', secret: 'top-secret-value' },
        idempotencyKey: 'request-key-0001',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request_policy' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('fetch API client request boundary', () => {
  it.each([
    'https://example.com/api/v1/program',
    '/api/v1/../admin',
    '/api/v1/%2e%2e/admin',
    '/api/v1/program#fragment',
    '/api/v1/%',
    '/api/v10/program',
  ])('rejects unsafe path %s before fetch', async (path) => {
    const fetch = vi.fn();
    const client = clientWith({ fetch });

    await expect(client.request(readEndpoint, { path })).rejects.toMatchObject({
      name: 'ApiRequestConfigurationError',
      code: 'invalid_path',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws safe request errors without reflecting rejected values', async () => {
    const fetch = vi.fn();
    const client = clientWith({ fetch });
    const secret = 'raw-secret-that-must-not-leak';

    await expect(
      client.request(mutationEndpoint, {
        path: '/api/v1/reservations',
        body: { value: '', secret },
        idempotencyKey: 'short',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ApiRequestConfigurationError);
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(String(error)).not.toContain(secret);
      return true;
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires idempotency for configured mutations and rejects read-only headers', async () => {
    const fetch = vi.fn();
    const client = clientWith({ fetch });

    await expect(
      client.request(mutationEndpoint, {
        path: '/api/v1/reservations',
        body: { value: 'seat-42', secret: 'top-secret-value' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request_policy' });
    await expect(
      client.request(readEndpoint, {
        path: '/api/v1/program',
        idempotencyKey: 'request-key-0001',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request_policy' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects cross-origin or path-bearing base URLs', () => {
    expect(() =>
      createFetchApiClient({ baseUrl: 'https://example.com' }),
    ).toThrow('API client base URL must use the current origin');
    expect(() =>
      createFetchApiClient({ baseUrl: 'https://example.com/api' }),
    ).toThrow('Invalid API client base URL');
    expect(() => createFetchApiClient({ baseUrl: 'not a URL' })).toThrow(
      'Invalid API client base URL',
    );
  });
});
