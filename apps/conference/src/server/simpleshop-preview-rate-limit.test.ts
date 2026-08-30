import { describe, expect, it, vi } from 'vitest';

import type { AtomicRateLimitStore } from './api/rate-limit';
import {
  SIMPLESHOP_PREVIEW_RATE_LIMIT_POLICY,
  createSimpleShopPreviewRateLimiter,
} from './simpleshop-preview-rate-limit';

describe('SimpleShop preview rate limit', () => {
  it('uses an HMAC subject and a dedicated six-per-minute bucket', async () => {
    const now = new Date('2026-08-30T10:00:00.000Z');
    const consume = vi.fn(async () => ({
      count: 1,
      resetAt: new Date(now.getTime() + 60_000),
    }));
    const limiter = createSimpleShopPreviewRateLimiter({
      store: { consume } satisfies AtomicRateLimitStore,
      subjectSecret: 'test-only-subject-secret-at-least-32-bytes',
      eventSlug: 'byzon-2026',
      now: () => now,
    });

    await expect(limiter('operator@example.test')).resolves.toMatchObject({
      allowed: true,
      limit: 6,
      remaining: 5,
    });
    expect(consume).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: SIMPLESHOP_PREVIEW_RATE_LIMIT_POLICY.limit,
        windowMs: SIMPLESHOP_PREVIEW_RATE_LIMIT_POLICY.windowMs,
      }),
    );
    const serialized = JSON.stringify(consume.mock.calls);
    expect(serialized).not.toContain('operator@example.test');
    expect(serialized).not.toContain('byzon-2026');
  });

  it('throws a generic 429 on the first request above the limit', async () => {
    const now = new Date('2026-08-30T10:00:00.000Z');
    const limiter = createSimpleShopPreviewRateLimiter({
      store: {
        consume: vi.fn(async () => ({
          count: 7,
          resetAt: new Date(now.getTime() + 30_000),
        })),
      },
      subjectSecret: 'test-only-subject-secret-at-least-32-bytes',
      eventSlug: 'byzon-2026',
      now: () => now,
    });

    await expect(
      limiter('019fb000-0000-7000-8000-000000000002'),
    ).rejects.toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      headers: { 'retry-after': '30' },
    });
  });
});
