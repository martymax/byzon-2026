import { describe, expect, it, vi } from 'vitest';

import {
  SIMPLESHOP_API_BASE_URL,
  SimpleShopTicketSourceError,
  assertSimpleShopReadRequest,
  createSimpleShopTicketSourceAdapter,
} from './simpleshop-ticket-source';

const credentials = {
  email: 'api@example.test',
  apiKey: 'test-api-key-never-log',
} as const;

const product = {
  id: '143958',
  type: '9',
  code: '0MnNQ',
  archived: false,
  script_iframe: '<div data-simpleshopform="0MnNQ"></div>',
  test_mode: false,
};

const headers = [
  'ID vstupenky',
  'Kód vstupenky',
  'Počet',
  'ID dokladu',
  'Stav',
  'E-mail',
];

const csv = (rows: readonly (readonly string[])[]) =>
  [headers, ...rows].map((row) => row.join(';')).join('\r\n');

const sourceRows = [
  ['7000001', 'ABC123', '1', '80000001', 'Uhrazeno', 'one@example.test'],
  ['', '', '2', '80000001', 'Uhrazeno', 'one@example.test'],
  ['7000002', 'DEF456', '1', '80000002', 'Neuhrazeno', 'two@example.test'],
  ['7000003', 'GHI789', '1', '80000003', 'STORNO', 'three@example.test'],
] as const;

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  });

const successfulFetch = () =>
  vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    expect(init?.cache).toBe('no-store');
    if (url.pathname === '/2.0/product/143958/') {
      return jsonResponse(product);
    }
    if (url.pathname.endsWith('/export/who-bought/product/143958/')) {
      expect(url.search).toBe('?strict=1');
      return jsonResponse({ csv: csv(sourceRows) });
    }
    throw new Error('Unexpected test URL');
  });

describe('SimpleShopTicketSourceAdapter', () => {
  it('fails before transport when either server credential is missing', async () => {
    const fetch = vi.fn();

    await expect(
      createSimpleShopTicketSourceAdapter({
        fetch,
        maxAttempts: 1,
      }).fetchPreviewSource(),
    ).rejects.toMatchObject({ code: 'credentials_missing' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses only allowlisted GETs and returns a PII/code-free source snapshot', async () => {
    const fetch = successfulFetch();
    const snapshot = await createSimpleShopTicketSourceAdapter({
      ...credentials,
      fetch,
      maxAttempts: 1,
    }).fetchPreviewSource();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(snapshot.source).toMatchObject({
      kind: 'simpleshop_api',
      productId: 143_958,
      formKey: '0MnNQ',
      strict: true,
      pageCount: 1,
      sourceRows: 4,
      ticketRows: 3,
      ignoredSummaryRows: 1,
      multipleQuantitySummaryRows: 1,
      observedStatuses: {
        paid: 1,
        unpaid: 1,
        cancelled: 1,
        refunded: 0,
        unknown: 0,
      },
      codeShape: {
        count: 3,
        minByteLength: 6,
        maxByteLength: 6,
        characterClasses: ['digit', 'upper_ascii'],
      },
    });
    expect(snapshot.records).toEqual([
      {
        sourceRowNumber: 2,
        externalId: '7000001',
        orderExternalId: '80000001',
        sourceStatus: 'paid',
        quantity: 1,
      },
      {
        sourceRowNumber: 4,
        externalId: '7000002',
        orderExternalId: '80000002',
        sourceStatus: 'unpaid',
        quantity: 1,
      },
      {
        sourceRowNumber: 5,
        externalId: '7000003',
        orderExternalId: '80000003',
        sourceStatus: 'cancelled',
        quantity: 1,
      },
    ]);
    const serialized = JSON.stringify(snapshot);
    for (const forbidden of [
      'ABC123',
      'DEF456',
      'GHI789',
      'one@example.test',
      credentials.email,
      credentials.apiKey,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('rejects a different host and every non-GET method', () => {
    expect(() =>
      createSimpleShopTicketSourceAdapter({
        ...credentials,
        baseUrl: 'https://attacker.example/2.0/',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SimpleShopTicketSourceError>>({
        code: 'invalid_target',
      }),
    );
    expect(() =>
      assertSimpleShopReadRequest(
        new URL('https://api.simpleshop.cz/2.0/product/143958/'),
        'POST',
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SimpleShopTicketSourceError>>({
        code: 'method_not_allowed',
      }),
    );
    expect(() =>
      assertSimpleShopReadRequest(
        new URL('https://attacker.example/2.0/product/143958/'),
        'GET',
        new URL(SIMPLESHOP_API_BASE_URL),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<SimpleShopTicketSourceError>>({
        code: 'invalid_target',
      }),
    );
  });

  it('aborts a bounded request and reports only a sanitized timeout code', async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const promise = createSimpleShopTicketSourceAdapter({
      ...credentials,
      fetch,
      timeoutMs: 5,
      maxAttempts: 1,
    }).fetchPreviewSource();

    await expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await promise.catch((error: unknown) => {
      const serialized = JSON.stringify(error);
      expect(serialized).not.toContain(credentials.email);
      expect(serialized).not.toContain(credentials.apiKey);
    });
  });

  it('keeps the timeout active while the response body is streaming', async () => {
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname === '/2.0/product/143958/') {
          return jsonResponse(product);
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"csv":"'));
              init?.signal?.addEventListener('abort', () => {
                controller.error(new DOMException('aborted', 'AbortError'));
              });
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      },
    );

    await expect(
      createSimpleShopTicketSourceAdapter({
        ...credentials,
        fetch,
        timeoutMs: 5,
        maxAttempts: 1,
      }).fetchPreviewSource(),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects pagination metadata instead of following an undocumented page', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname === '/2.0/product/143958/'
        ? jsonResponse(product)
        : jsonResponse({
            csv: csv(sourceRows),
            next: 'https://api.simpleshop.cz/2.0/export/page/2/',
          });
    });

    await expect(
      createSimpleShopTicketSourceAdapter({
        ...credentials,
        fetch,
        maxAttempts: 1,
      }).fetchPreviewSource(),
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('cancels a chunked response as soon as the decompressed byte limit is exceeded', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/2.0/product/143958/') {
        return jsonResponse(product);
      }
      const bytes = new TextEncoder().encode('x'.repeat(1_100));
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice(0, 600));
            controller.enqueue(bytes.slice(600));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });

    await expect(
      createSimpleShopTicketSourceAdapter({
        ...credentials,
        fetch,
        maxAttempts: 1,
        maxResponseBytes: 1_024,
      }).fetchPreviewSource(),
    ).rejects.toMatchObject({ code: 'response_too_large' });
  });

  it.each([
    {
      name: 'wrong product/form binding',
      product: { ...product, code: 'other' },
      envelope: { csv: csv(sourceRows) },
      code: 'invalid_payload',
    },
    {
      name: 'malformed envelope',
      product,
      envelope: { data: csv(sourceRows) },
      code: 'invalid_payload',
    },
    {
      name: 'ambiguous ticket quantity',
      product,
      envelope: {
        csv: csv([
          ['7000001', 'RAWCODE', '2', '80000001', 'Uhrazeno', 'x@example.test'],
        ]),
      },
      code: 'invalid_payload',
    },
    {
      name: 'duplicate ticket code',
      product,
      envelope: {
        csv: csv([
          ['7000001', 'RAWCODE', '1', '80000001', 'Uhrazeno', 'x@example.test'],
          ['7000002', 'RAWCODE', '1', '80000002', 'Uhrazeno', 'y@example.test'],
        ]),
      },
      code: 'invalid_payload',
    },
    {
      name: 'unbounded external identifier',
      product,
      envelope: {
        csv: csv([
          [
            '7'.repeat(65),
            'RAWCODE',
            '1',
            '80000001',
            'Uhrazeno',
            'x@example.test',
          ],
        ]),
      },
      code: 'invalid_payload',
    },
  ])('fails closed for $name without reflecting raw data', async (testCase) => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname === '/2.0/product/143958/'
        ? jsonResponse(testCase.product)
        : jsonResponse(testCase.envelope);
    });
    const promise = createSimpleShopTicketSourceAdapter({
      ...credentials,
      fetch,
      maxAttempts: 1,
    }).fetchPreviewSource();

    await expect(promise).rejects.toMatchObject({ code: testCase.code });
    await promise.catch((error: unknown) => {
      expect(String(error)).not.toContain('RAWCODE');
      expect(String(error)).not.toContain('x@example.test');
    });
  });

  it('stops when the bounded preview record limit is exceeded', async () => {
    const fetch = successfulFetch();
    await expect(
      createSimpleShopTicketSourceAdapter({
        ...credentials,
        fetch,
        maxAttempts: 1,
        maxPreviewRows: 2,
      }).fetchPreviewSource(),
    ).rejects.toMatchObject({ code: 'record_limit_exceeded' });
  });

  it('does not expose credentials when the transport throws them', async () => {
    const fetch = vi.fn(async () => {
      throw new Error(
        `transport ${credentials.email} ${credentials.apiKey} Basic-secret`,
      );
    });
    const promise = createSimpleShopTicketSourceAdapter({
      ...credentials,
      fetch,
      maxAttempts: 1,
    }).fetchPreviewSource();

    await expect(promise).rejects.toMatchObject({ code: 'unavailable' });
    await promise.catch((error: unknown) => {
      expect(String(error)).not.toContain(credentials.email);
      expect(String(error)).not.toContain(credentials.apiKey);
      expect(String(error)).not.toContain('Basic-secret');
    });
  });
});
