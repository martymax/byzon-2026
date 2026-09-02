import { describe, expect, it, vi } from 'vitest';

import {
  hashRateLimitSubject,
  type AtomicRateLimitStore,
} from './api/rate-limit';
import {
  ADMIN_SUPPORT_RATE_LIMIT_POLICIES,
  createAdminSupportRateLimiter,
  type AdminSupportRateLimitKind,
} from './admin-support-rate-limit';

const subjectSecret = 'test-support-rate-limit-secret-at-least-32-characters';
const eventSlug = 'byzon-2026';
const userId = '01930000-0000-7000-8000-000000000001';
const fixedNow = new Date('2026-09-02T08:00:00.000Z');

const expectedBucket = (kind: AdminSupportRateLimitKind): string =>
  `byzon:rate-limit:${ADMIN_SUPPORT_RATE_LIMIT_POLICIES[kind].scope}:${hashRateLimitSubject(
    subjectSecret,
    [eventSlug, userId],
  )}`;

describe('admin support rate limiter', () => {
  it.each(['search', 'mutation'] as const)(
    'uses the %s policy without putting PII in the bucket',
    async (kind) => {
      const consume = vi.fn(async () => ({
        count: 1,
        resetAt: new Date(fixedNow.getTime() + 60_000),
      }));
      const limiter = createAdminSupportRateLimiter({
        store: { consume },
        subjectSecret,
        eventSlug,
        now: () => fixedNow,
      });

      await expect(limiter(kind, userId)).resolves.toMatchObject({
        allowed: true,
        limit: ADMIN_SUPPORT_RATE_LIMIT_POLICIES[kind].limit,
      });
      expect(consume).toHaveBeenCalledWith({
        bucket: expectedBucket(kind),
        limit: ADMIN_SUPPORT_RATE_LIMIT_POLICIES[kind].limit,
        windowMs: 60_000,
        now: fixedNow,
      });
      expect(expectedBucket(kind)).not.toContain(userId);
    },
  );

  it.each(['search', 'mutation'] as const)(
    'returns the support-specific 429 for an exhausted %s bucket',
    async (kind) => {
      const policy = ADMIN_SUPPORT_RATE_LIMIT_POLICIES[kind];
      const limiter = createAdminSupportRateLimiter({
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
        code: 'SUPPORT_RATE_LIMITED',
        headers: {
          'ratelimit-limit': String(policy.limit),
          'ratelimit-remaining': '0',
          'ratelimit-reset': '42',
          'retry-after': '42',
        },
      });
    },
  );

  it('fails closed when the shared store is unavailable', async () => {
    const providerError = new Error('Redis unavailable');
    const store: AtomicRateLimitStore = {
      consume: vi.fn(async () => {
        throw providerError;
      }),
    };
    const limiter = createAdminSupportRateLimiter({
      store,
      subjectSecret,
      eventSlug,
      now: () => fixedNow,
    });

    await expect(limiter('search', userId)).rejects.toBe(providerError);
  });
});
