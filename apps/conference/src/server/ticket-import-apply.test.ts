import type { Database } from '@byzon/database';
import { ticketImportApplyProblemSchema } from '@byzon/domain/contracts/ticket-import';
import { describe, expect, it, vi } from 'vitest';

import { applySimpleShopTicketImport } from './ticket-import-apply';

const appOrigin = 'http://localhost:3000';
const eventId = '01997600-4f00-7000-8000-000000000001';
const actorId = '01997600-4f00-7000-8000-000000000002';
const sourceAdapter = { fetchPreviewSource: vi.fn() };

const request = (body: string, headers: Record<string, string> = {}) =>
  new Request(
    `${appOrigin}/api/v1/admin/events/${eventId}/ticket-imports/apply`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'simpleshop-apply-test-0001',
        origin: appOrigin,
        ...headers,
      },
      body,
    },
  );

const dependencies = (session: { user: { id: string } } | null) => ({
  db: {} as Database,
  allowedOrigin: appOrigin,
  getSession: vi.fn(async () => session),
  sourceAdapter,
});

describe('SimpleShop ticket import apply transport', () => {
  it('rejects an anonymous request before parsing or touching the source', async () => {
    const response = await applySimpleShopTicketImport(
      request('{'),
      eventId,
      dependencies(null),
    );

    expect(response.status).toBe(401);
    expect(
      ticketImportApplyProblemSchema.parse(await response.json()).code,
    ).toBe('AUTHENTICATION_REQUIRED');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(sourceAdapter.fetchPreviewSource).not.toHaveBeenCalled();
  });

  it('returns a private validation problem for malformed JSON before database access', async () => {
    const response = await applySimpleShopTicketImport(
      request('{'),
      eventId,
      dependencies({ user: { id: actorId } }),
    );

    expect(response.status).toBe(422);
    expect(
      ticketImportApplyProblemSchema.parse(await response.json()).code,
    ).toBe('IMPORT_VALIDATION_FAILED');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(sourceAdapter.fetchPreviewSource).not.toHaveBeenCalled();
  });

  it('rejects cross-origin mutation transport before session lookup', async () => {
    const deps = dependencies({ user: { id: actorId } });
    const response = await applySimpleShopTicketImport(
      request('{}', { origin: 'https://attacker.example' }),
      eventId,
      deps,
    );

    expect(response.status).toBe(403);
    expect(
      ticketImportApplyProblemSchema.parse(await response.json()).code,
    ).toBe('EVENT_ACCESS_DENIED');
    expect(deps.getSession).not.toHaveBeenCalled();
  });

  it('returns a contract-valid problem when the idempotency key is missing', async () => {
    const response = await applySimpleShopTicketImport(
      request('{}', { 'idempotency-key': '' }),
      eventId,
      dependencies({ user: { id: actorId } }),
    );

    expect(response.status).toBe(400);
    expect(
      ticketImportApplyProblemSchema.parse(await response.json()).code,
    ).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});
