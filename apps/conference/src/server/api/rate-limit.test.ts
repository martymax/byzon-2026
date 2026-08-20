import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { ApiProblemError } from './problem';
import {
  consumeRateLimit,
  enforceRateLimit,
  hashRateLimitSubject,
  type AtomicRateLimitStore,
} from './rate-limit';

const subjectHash = createHash('sha256').update('test-subject').digest('hex');

describe('rate limit abstraction', () => {
  it('creates environment-keyed opaque subjects with unambiguous parts', () => {
    const secret = 'test-rate-limit-secret-at-least-32-characters';
    const digest = hashRateLimitSubject(secret, [
      'staging',
      'event-id',
      'user-id',
    ]);

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain('user-id');
    expect(hashRateLimitSubject(secret, ['ab', 'c'])).not.toBe(
      hashRateLimitSubject(secret, ['a', 'bc']),
    );
    expect(
      hashRateLimitSubject('another-rate-limit-secret-at-least-32-characters', [
        'staging',
        'event-id',
        'user-id',
      ]),
    ).not.toBe(digest);
  });

  it('rejects weak keys and empty subject parts', () => {
    expect(() => hashRateLimitSubject('too-short', ['user-id'])).toThrow(
      'Invalid rate limit subject',
    );
    expect(() =>
      hashRateLimitSubject('test-rate-limit-secret-at-least-32-characters', [
        '',
      ]),
    ).toThrow('Invalid rate limit subject');
  });

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
