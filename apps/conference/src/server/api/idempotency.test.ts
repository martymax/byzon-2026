import { describe, expect, it } from 'vitest';

import { hashIdempotencyRequest, readIdempotencyKey } from './idempotency';

describe('idempotency request boundary', () => {
  it('requires a bounded Idempotency-Key header', () => {
    expect(
      readIdempotencyKey(
        new Headers({ 'idempotency-key': 'claim-request-123456' }),
      ),
    ).toBe('claim-request-123456');
    expect(() => readIdempotencyKey(new Headers())).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }),
    );
    expect(() =>
      readIdempotencyKey(
        new Headers({ 'idempotency-key': 'contains raw spaces' }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_KEY_INVALID' }),
    );
  });

  it('fingerprints method, route and exact request bytes', () => {
    const first = hashIdempotencyRequest({
      method: 'POST',
      path: '/api/v1/events/event-id/tickets/claim',
      body: '{"code":"masked"}',
    });
    const same = hashIdempotencyRequest({
      method: 'post',
      path: '/api/v1/events/event-id/tickets/claim',
      body: '{"code":"masked"}',
    });
    const different = hashIdempotencyRequest({
      method: 'POST',
      path: '/api/v1/events/event-id/tickets/claim',
      body: '{"code":"different"}',
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(same).toBe(first);
    expect(different).not.toBe(first);
  });
});
