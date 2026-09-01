import { describe, expect, it, vi } from 'vitest';

import { ApiProblemError } from './api/problem';
import { EventAccessDeniedError } from './policy';
import {
  SimpleShopTicketSourceError,
  type SimpleShopTicketSourceSnapshot,
} from './simpleshop-ticket-source';
import {
  buildTicketImportPreview,
  previewSimpleShopTickets,
  type TicketImportPreviewDependencies,
  type TicketImportPreviewStore,
} from './ticket-import-preview';

const ids = {
  event: '019fb000-0000-7000-8000-000000000001',
  actor: '019fb000-0000-7000-8000-000000000002',
  request: '019fb000-0000-7000-8000-000000000003',
  preview: '019fb000-0000-7000-8000-000000000004',
  rowPaid: '019fb000-0000-7000-8000-000000000005',
  rowUnpaid: '019fb000-0000-7000-8000-000000000006',
  rowCancelled: '019fb000-0000-7000-8000-000000000007',
} as const;

const snapshot: SimpleShopTicketSourceSnapshot = {
  source: {
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
  },
  records: [
    {
      sourceRowNumber: 2,
      externalId: '7000001',
      orderExternalId: '80000001',
      sourceStatus: 'paid',
      quantity: 1,
      purchasedOn: '2026-08-18',
      discountCoupon: 'EARLYBIRD',
      contactName: 'Alice Participant',
      contactEmail: 'alice@example.test',
      contactCompany: 'Example s.r.o.',
      contactPosition: 'CEO',
      contactPhone: '+420777111222',
      identitySource: 'named_participant',
    },
    {
      sourceRowNumber: 4,
      externalId: '7000002',
      orderExternalId: '80000002',
      sourceStatus: 'unpaid',
      quantity: 1,
      purchasedOn: '2026-08-19',
      discountCoupon: null,
      contactName: 'Unpaid Buyer',
      contactEmail: 'unpaid@example.test',
      contactCompany: null,
      contactPosition: null,
      contactPhone: null,
      identitySource: 'manual_review',
    },
    {
      sourceRowNumber: 5,
      externalId: '7000003',
      orderExternalId: '80000003',
      sourceStatus: 'cancelled',
      quantity: 1,
      purchasedOn: '2026-08-20',
      discountCoupon: 'PARTNER2026',
      contactName: 'Cancelled Participant',
      contactEmail: 'cancelled@example.test',
      contactCompany: null,
      contactPosition: null,
      contactPhone: null,
      identitySource: 'named_participant',
    },
  ],
  snapshotDigest: 'a'.repeat(64),
};

const request = (
  overrides: {
    readonly origin?: string;
    readonly method?: string;
    readonly body?: string;
    readonly contentType?: string;
    readonly query?: string;
    readonly idempotencyKey?: string;
  } = {},
) =>
  new Request(
    `https://staging.example.test/api/ticket-imports/preview${overrides.query ?? ''}`,
    {
      method: overrides.method ?? 'POST',
      headers: {
        'content-type': overrides.contentType ?? 'application/json',
        origin: overrides.origin ?? 'https://staging.example.test',
        'x-request-id': ids.request,
        ...(overrides.idempotencyKey
          ? { 'idempotency-key': overrides.idempotencyKey }
          : {}),
      },
      ...(overrides.method === 'GET'
        ? {}
        : { body: overrides.body ?? JSON.stringify({ source: 'simpleshop' }) }),
    },
  );

const store = (): TicketImportPreviewStore => ({
  authorize: vi.fn(async () => undefined),
  loadExisting: vi.fn(async () => []),
  savePreview: vi.fn(async () => undefined),
});

const dependencies = (
  overrides: Partial<TicketImportPreviewDependencies> = {},
): TicketImportPreviewDependencies => ({
  allowedOrigin: 'https://staging.example.test',
  getSession: vi.fn(async () => ({ user: { id: ids.actor } })),
  sourceAdapter: {
    fetchPreviewSource: vi.fn(async () => snapshot),
  },
  store: store(),
  now: () => new Date('2026-08-30T10:00:00.000Z'),
  generateId: (() => {
    const values = [ids.preview, ids.rowPaid, ids.rowUnpaid, ids.rowCancelled];
    return () => values.shift() ?? crypto.randomUUID();
  })(),
  ...overrides,
});

describe('SimpleShop ticket import preview handler', () => {
  it('authorizes first, returns private operational contacts and persists no PII', async () => {
    const previewStore = store();
    const adapter = { fetchPreviewSource: vi.fn(async () => snapshot) };
    const response = await previewSimpleShopTickets(request(), ids.event, {
      ...dependencies(),
      sourceAdapter: adapter,
      store: previewStore,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(
      vi.mocked(previewStore.authorize).mock.invocationCallOrder[0],
    ).toBeLessThan(adapter.fetchPreviewSource.mock.invocationCallOrder[0]!);
    expect(previewStore.loadExisting).toHaveBeenCalledWith(ids.event, [
      '7000001',
      '7000002',
      '7000003',
    ]);
    expect(previewStore.savePreview).toHaveBeenCalledTimes(1);
    const body = await response.json();
    expect(body.rows[0]).toMatchObject({
      contactName: 'Alice Participant',
      contactEmail: 'alice@example.test',
      contactCompany: 'Example s.r.o.',
      contactPosition: 'CEO',
      contactPhone: '+420777111222',
      identitySource: 'named_participant',
      sourceTicketId: '7000001',
      sourceOrderId: '80000001',
      purchasedOn: '2026-08-18',
      discountCoupon: 'EARLYBIRD',
    });
    const serializedResponse = JSON.stringify(body);
    const serializedPersistence = JSON.stringify(
      vi.mocked(previewStore.savePreview).mock.calls,
    );
    for (const forbidden of [
      'RAW-TICKET-CODE',
      'SIMPLESHOP_API_KEY',
      'SIMPLESHOP_API_EMAIL',
    ]) {
      expect(serializedResponse).not.toContain(forbidden);
      expect(serializedPersistence).not.toContain(forbidden);
    }
    for (const pii of [
      'Alice Participant',
      'alice@example.test',
      'EARLYBIRD',
    ]) {
      expect(serializedResponse).toContain(pii);
      expect(serializedPersistence).not.toContain(pii);
    }
    expect(serializedResponse).toContain('simpleshop_api');
    expect(serializedResponse).toContain('unknown_status');
  });

  it.each([
    {
      name: 'anonymous session',
      request: request(),
      overrides: { getSession: vi.fn(async () => null) },
      status: 401,
      code: 'AUTHENTICATION_REQUIRED',
    },
    {
      name: 'cross-origin request',
      request: request({ origin: 'https://attacker.example' }),
      overrides: {},
      status: 403,
      code: 'EVENT_ACCESS_DENIED',
    },
    {
      name: 'non-POST request',
      request: request({ method: 'GET' }),
      overrides: {},
      status: 422,
      code: 'IMPORT_VALIDATION_FAILED',
    },
    {
      name: 'invalid request body',
      request: request({ body: JSON.stringify({ source: 'file' }) }),
      overrides: {},
      status: 422,
      code: 'IMPORT_VALIDATION_FAILED',
    },
    {
      name: 'request with query metadata',
      request: request({ query: '?page=2' }),
      overrides: {},
      status: 422,
      code: 'IMPORT_VALIDATION_FAILED',
    },
    {
      name: 'request with mutation idempotency metadata',
      request: request({ idempotencyKey: crypto.randomUUID() }),
      overrides: {},
      status: 422,
      code: 'IMPORT_VALIDATION_FAILED',
    },
    {
      name: 'non-JSON request',
      request: request({ contentType: 'text/plain' }),
      overrides: {},
      status: 422,
      code: 'IMPORT_VALIDATION_FAILED',
    },
    {
      name: 'chunked oversized request body',
      request: request({ body: 'x'.repeat(1_025) }),
      overrides: {},
      status: 422,
      code: 'IMPORT_VALIDATION_FAILED',
    },
  ])('fails closed for $name before reading SimpleShop', async (testCase) => {
    const adapter = { fetchPreviewSource: vi.fn(async () => snapshot) };
    const response = await previewSimpleShopTickets(
      testCase.request,
      ids.event,
      dependencies({ ...testCase.overrides, sourceAdapter: adapter }),
    );

    expect(response.status).toBe(testCase.status);
    await expect(response.json()).resolves.toMatchObject({
      code: testCase.code,
    });
    expect(adapter.fetchPreviewSource).not.toHaveBeenCalled();
  });

  it('checks event permission before reading SimpleShop', async () => {
    const previewStore = store();
    vi.mocked(previewStore.authorize).mockRejectedValue(
      new EventAccessDeniedError(),
    );
    const adapter = { fetchPreviewSource: vi.fn(async () => snapshot) };
    const response = await previewSimpleShopTickets(
      request(),
      ids.event,
      dependencies({ store: previewStore, sourceAdapter: adapter }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EVENT_ACCESS_DENIED',
    });
    expect(adapter.fetchPreviewSource).not.toHaveBeenCalled();
  });

  it.each([
    ['timeout', 504, 'IMPORT_SOURCE_TIMEOUT'],
    ['invalid_payload', 502, 'IMPORT_SOURCE_INVALID'],
    ['unavailable', 502, 'IMPORT_SOURCE_UNAVAILABLE'],
  ] as const)(
    'maps the sanitized %s adapter error without reflecting source data',
    async (adapterCode, status, problemCode) => {
      const adapter = {
        fetchPreviewSource: vi.fn(async () => {
          throw new SimpleShopTicketSourceError(adapterCode);
        }),
      };
      const response = await previewSimpleShopTickets(
        request(),
        ids.event,
        dependencies({ sourceAdapter: adapter }),
      );
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(status);
      expect(serialized).toContain(problemCode);
      expect(serialized).not.toContain('RAW-TICKET-CODE');
      expect(serialized).not.toContain('person@example.test');
    },
  );

  it('stops at the dedicated rate limit before reading SimpleShop', async () => {
    const adapter = { fetchPreviewSource: vi.fn(async () => snapshot) };
    const response = await previewSimpleShopTickets(
      request(),
      ids.event,
      dependencies({
        sourceAdapter: adapter,
        rateLimit: vi.fn(async () => {
          throw new ApiProblemError({
            status: 429,
            code: 'RATE_LIMITED',
            title: 'Too many requests',
            detail: 'Try again later.',
            headers: { 'retry-after': '30' },
          });
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('30');
    expect(adapter.fetchPreviewSource).not.toHaveBeenCalled();
  });
});

describe('SimpleShop preview mapping', () => {
  it('maps only paid records and leaves unpaid, storno and transferred states unapproved', () => {
    const values = [ids.rowPaid, ids.rowUnpaid, ids.rowCancelled];
    const built = buildTicketImportPreview({
      eventId: ids.event,
      previewId: ids.preview,
      createdAt: new Date('2026-08-30T10:00:00.000Z'),
      snapshot,
      existing: [
        { externalId: '7000001', status: 'valid' },
        { externalId: '7000003', status: 'transferred' },
      ],
      generateId: () => values.shift()!,
    });

    expect(built.response.rows).toMatchObject([
      {
        sourceStatus: 'paid',
        status: 'unchanged',
        incomingState: 'active',
        currentState: 'active',
      },
      {
        sourceStatus: 'unpaid',
        status: 'unknown',
        incomingState: null,
        currentState: null,
      },
      {
        sourceStatus: 'cancelled',
        status: 'unknown',
        incomingState: null,
        currentState: null,
      },
    ]);
    expect(built.response.summary).toMatchObject({
      unchanged: 1,
      unknown: 2,
      statusChanged: 0,
    });
  });
});
