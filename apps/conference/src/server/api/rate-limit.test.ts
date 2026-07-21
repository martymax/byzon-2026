import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { ApiProblemError } from './problem';
import {
  consumeRateLimit,
  enforceRateLimit,
  type AtomicRateLimitStore,
} from './rate-limit';

const subjectHash = createHash('sha256').update('test-subject').digest('hex');

describe('rate limit abstraction', () => {
  it('passes only an opaque bucket to the atomic store', async () => {
    const consume = vi.fn(async () => ({
      count: 2,
      resetAt: new Date('2026-07-20T12:01:00Z'),
    }));
    const store: AtomicRateLimitStore = { consume };

    await expect(
      consumeRateLimit(store, {
        scope: 'magic_link.send',
        subjectHash,
        limit: 3,
        windowMs: 60_000,
        now: new Date('2026-07-20T12:00:30Z'),
      }),
    ).resolves.toEqual({
      allowed: true,
      limit: 3,
      remaining: 1,
      resetAt: new Date('2026-07-20T12:01:00Z'),
      retryAfterSeconds: 30,
    });
    expect(consume).toHaveBeenCalledWith({
      bucket: `byzon:rate-limit:magic_link.send:${subjectHash}`,
      limit: 3,
      windowMs: 60_000,
      now: new Date('2026-07-20T12:00:30Z'),
    });
  });

  it('rejects raw PII instead of using it as a bucket subject', async () => {
    const store: AtomicRateLimitStore = { consume: vi.fn() };
    await expect(
      consumeRateLimit(store, {
        scope: 'magic_link.send',
        subjectHash: 'person@example.invalid',
        limit: 3,
        windowMs: 60_000,
      }),
    ).rejects.toThrow('Invalid rate limit input');
    expect(store.consume).not.toHaveBeenCalled();
  });

  it('fails closed when the shared store is unavailable', async () => {
    const store: AtomicRateLimitStore = {
      consume: vi.fn().mockRejectedValue(new Error('store unavailable')),
    };
    await expect(
      consumeRateLimit(store, {
        scope: 'ticket.claim',
        subjectHash,
        limit: 5,
        windowMs: 15 * 60_000,
      }),
    ).rejects.toThrow('store unavailable');
  });

  it('maps a denied decision to a generic 429 problem with retry headers', () => {
    expect(() =>
      enforceRateLimit({
        allowed: false,
        limit: 5,
        remaining: 0,
        resetAt: new Date('2026-07-20T12:15:00Z'),
        retryAfterSeconds: 42,
      }),
    ).toThrow(ApiProblemError);

    try {
      enforceRateLimit({
        allowed: false,
        limit: 5,
        remaining: 0,
        resetAt: new Date('2026-07-20T12:15:00Z'),
        retryAfterSeconds: 42,
      });
    } catch (error) {
      expect(error).toMatchObject({
        status: 429,
        code: 'RATE_LIMITED',
        headers: {
          'retry-after': '42',
          'ratelimit-limit': '5',
          'ratelimit-remaining': '0',
          'ratelimit-reset': '42',
        },
      });
    }
  });
});
