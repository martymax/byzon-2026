import { describe, expect, it, vi } from 'vitest';

import {
  hashRateLimitSubject,
  type AtomicRateLimitStore,
} from './api/rate-limit';
import {
  ADMIN_RESERVATION_RATE_LIMIT_POLICIES,
  createAdminReservationRateLimiter,
  type AdminReservationRateLimitKind,
} from './admin-reservations-rate-limit';

const subjectSecret = 'test-admin-rate-limit-secret-at-least-32-characters';
const eventSlug = 'byzon-2026';
const userId = '01930000-0000-7000-8000-000000000001';
const fixedNow = new Date('2026-08-21T08:00:00.000Z');

const expectedBucket = (kind: AdminReservationRateLimitKind): string =>
  `byzon:rate-limit:${ADMIN_RESERVATION_RATE_LIMIT_POLICIES[kind].scope}:${hashRateLimitSubject(
    subjectSecret,
    [eventSlug, userId],
  )}`;

describe('admin reservation rate limiter', () => {
  it.each(['read', 'mutation'] as const)(
    'uses the explicit %s policy and an opaque event/user subject',
    async (kind) => {
      const consume = vi.fn(async () => ({
        count: 1,
        resetAt: new Date(fixedNow.getTime() + 60_000),
      }));
      const limiter = createAdminReservationRateLimiter({
        store: { consume },
        subjectSecret,
        eventSlug,
        now: () => fixedNow,
      });

      await expect(limiter(kind, userId)).resolves.toMatchObject({
        allowed: true,
        limit: ADMIN_RESERVATION_RATE_LIMIT_POLICIES[kind].limit,
        remaining: ADMIN_RESERVATION_RATE_LIMIT_POLICIES[kind].limit - 1,
      });
      expect(consume).toHaveBeenCalledWith({
        bucket: expectedBucket(kind),
        limit: ADMIN_RESERVATION_RATE_LIMIT_POLICIES[kind].limit,
        windowMs: 60_000,
        now: fixedNow,
      });
      expect(expectedBucket(kind)).not.toContain(userId);
    },
  );

  it.each(['read', 'mutation'] as const)(
    'returns a canonical 429 when the %s bucket is exhausted',
    async (kind) => {
      const policy = ADMIN_RESERVATION_RATE_LIMIT_POLICIES[kind];
      const limiter = createAdminReservationRateLimiter({
        store: {
          consume: vi.fn(async () => ({
            count: policy.limit + 1,
            resetAt: new Date(fixedNow.getTime() + 42_000),
          })),
        },
        subjectSecret,
        eventSlug,
        now: () => fixedNow,
      });

      await expect(limiter(kind, userId)).rejects.toMatchObject({
        status: 429,
        code: 'RATE_LIMITED',
        headers: {
          'ratelimit-limit': String(policy.limit),
          'ratelimit-remaining': '0',
          'ratelimit-reset': '42',
          'retry-after': '42',
        },
      });
    },
  );

  it.each(['read', 'mutation'] as const)(
    'fails the protected %s operation closed when the store is unavailable',
    async (kind) => {
      const providerError = new Error('Redis unavailable');
      const store: AtomicRateLimitStore = {
        consume: vi.fn(async () => {
          throw providerError;
        }),
      };
      const limiter = createAdminReservationRateLimiter({
        store,
        subjectSecret,
        eventSlug,
        now: () => fixedNow,
      });

      await expect(limiter(kind, userId)).rejects.toBe(providerError);
    },
  );
});
