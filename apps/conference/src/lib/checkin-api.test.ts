import { describe, expect, it, vi } from 'vitest';

import {
  checkinBootstrapEndpoint,
  checkinConfirmEndpoint,
  checkinLookupEndpoint,
  checkinSearchEndpoint,
  checkinUndoEndpoint,
  requestCheckinConfirm,
  requestCheckinSearch,
  requestCheckinUndo,
} from './checkin-api';
import { createCheckinDemoApi } from './checkin-demo-api';
import { createFetchApiClient } from './api/fetch-client';

describe('CS-CHECKIN-01 API descriptors', () => {
  it('separates read-only lookup from idempotent confirm and undo', () => {
    expect(checkinBootstrapEndpoint.retry).toBe('safe-read');
    expect(checkinSearchEndpoint.retry).toBe('safe-read');
    expect(checkinLookupEndpoint.idempotency).toBe('forbidden');
    expect(checkinConfirmEndpoint.idempotency).toBe('required');
    expect(checkinUndoEndpoint.idempotency).toBe('required');
  });

  it('encodes bounded search input without exposing it elsewhere', async () => {
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json(
          { results: [], limitedTo: 5 },
          {
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'checkin-search-test-0001',
            },
          },
        );
      },
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    await requestCheckinSearch(api, 'Test User');
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/check-in/search?q=Test+User&limit=5',
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
    expect(() => requestCheckinSearch(api, 'x')).toThrow();
  });

  it('sends exact mutation payloads with caller-owned idempotency keys', async () => {
    const api = createCheckinDemoApi();
    const context = await api.request(checkinBootstrapEndpoint, {
      path: '/api/v1/check-in/context',
      cache: 'no-store',
    });
    expect(context.ok).toBe(true);
    if (!context.ok || context.kind !== 'success') return;

    const lookup = await api.request(checkinLookupEndpoint, {
      path: '/api/v1/check-in/lookup',
      body: {
        method: 'manual_code',
        credential: {
          adapter: 'synthetic_demo',
          opaqueValue: 'DEMO-VALID',
        },
      },
    });
    expect(lookup.ok).toBe(true);
    if (!lookup.ok || lookup.kind !== 'success') return;

    const body = {
      lookupId: lookup.data.lookupId,
      stationId: context.data.station.id,
      deviceId: context.data.device.id,
    };
    const first = await requestCheckinConfirm(
      api,
      body,
      'checkin-confirm-test-0001',
    );
    const replay = await requestCheckinConfirm(
      api,
      body,
      'checkin-confirm-test-0001',
    );
    expect(first).toEqual(replay);
    expect(first.ok && first.kind === 'success' && first.data.outcome).toBe(
      'checked_in',
    );

    if (!first.ok || first.kind !== 'success') return;
    const undoBody = { reason: 'Syntetické označení bylo chybné.' };
    const undone = await requestCheckinUndo(
      api,
      first.data.checkin.id,
      undoBody,
      'checkin-undo-test-0001',
    );
    const undoReplay = await requestCheckinUndo(
      api,
      first.data.checkin.id,
      undoBody,
      'checkin-undo-test-0001',
    );
    expect(undone).toEqual(undoReplay);
  });

  it('rejects an idempotency key reused with a different exact mutation', async () => {
    const api = createCheckinDemoApi();
    const context = await api.request(checkinBootstrapEndpoint, {
      path: '/api/v1/check-in/context',
      cache: 'no-store',
    });
    const lookup = await api.request(checkinLookupEndpoint, {
      path: '/api/v1/check-in/lookup',
      body: {
        method: 'manual_code',
        credential: {
          adapter: 'synthetic_demo',
          opaqueValue: 'DEMO-VALID',
        },
      },
    });
    if (
      !context.ok ||
      context.kind !== 'success' ||
      !lookup.ok ||
      lookup.kind !== 'success'
    ) {
      throw new Error('Synthetic setup failed');
    }

    const confirmBody = {
      lookupId: lookup.data.lookupId,
      stationId: context.data.station.id,
      deviceId: context.data.device.id,
    };
    const confirmed = await requestCheckinConfirm(
      api,
      confirmBody,
      'checkin-confirm-collision-0001',
    );
    await expect(
      requestCheckinConfirm(
        api,
        {
          ...confirmBody,
          deviceId: '019f9200-0000-7000-8000-000000000099',
        },
        'checkin-confirm-collision-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
    if (!confirmed.ok || confirmed.kind !== 'success') {
      throw new Error('Synthetic confirm failed');
    }

    await requestCheckinUndo(
      api,
      confirmed.data.checkin.id,
      { reason: 'První dostatečně dlouhý auditní důvod.' },
      'checkin-undo-collision-0001',
    );
    await expect(
      requestCheckinUndo(
        api,
        confirmed.data.checkin.id,
        { reason: 'Jiný dostatečně dlouhý auditní důvod.' },
        'checkin-undo-collision-0001',
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: {
        kind: 'problem',
        problem: { code: 'IDEMPOTENCY_KEY_REUSED' },
      },
    });
  });
});
