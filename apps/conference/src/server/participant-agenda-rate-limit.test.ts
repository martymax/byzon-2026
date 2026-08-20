import { describe, expect, it, vi } from 'vitest';

import {
  hashRateLimitSubject,
  type AtomicRateLimitStore,
} from './api/rate-limit';
import {
  createParticipantAgendaRateLimiter,
  PARTICIPANT_AGENDA_RATE_LIMIT_POLICIES,
  type ParticipantAgendaRateLimitKind,
} from './participant-agenda-rate-limit';

const subjectSecret = 'test-agenda-rate-limit-secret-at-least-32-chars';
const eventSlug = 'byzon-2026';
const userId = '01930000-0000-7000-8000-000000000001';
const fixedNow = new Date('2026-08-20T18:30:00.000Z');

const expectedBucket = (kind: ParticipantAgendaRateLimitKind): string =>
  `byzon:rate-limit:${PARTICIPANT_AGENDA_RATE_LIMIT_POLICIES[kind].scope}:${hashRateLimitSubject(
    subjectSecret,
    [eventSlug, userId],
  )}`;

describe('participant agenda rate limiter', () => {
  it.each(['read', 'mutation'] as const)(
    'uses the explicit %s policy and an opaque event/user subject',
    async (kind) => {
      const consume = vi.fn(async () => ({
        count: 1,
        resetAt: new Date(fixedNow.getTime() + 60_000),
      }));
      const limiter = createParticipantAgendaRateLimiter({
        store: { consume },
        subjectSecret,
        eventSlug,
        now: () => fixedNow,
      });

      await expect(limiter(kind, userId)).resolves.toMatchObject({
        allowed: true,
        limit: PARTICIPANT_AGENDA_RATE_LIMIT_POLICIES[kind].limit,
        remaining: PARTICIPANT_AGENDA_RATE_LIMIT_POLICIES[kind].limit - 1,
      });
      expect(consume).toHaveBeenCalledWith({
        bucket: expectedBucket(kind),
        limit: PARTICIPANT_AGENDA_RATE_LIMIT_POLICIES[kind].limit,
        windowMs: 60_000,
        now: fixedNow,
      });
      expect(expectedBucket(kind)).not.toContain(userId);
    },
  );

  it.each(['read', 'mutation'] as const)(
    'returns a canonical 429 when the %s bucket is exhausted',
    async (kind) => {
      const policy = PARTICIPANT_AGENDA_RATE_LIMIT_POLICIES[kind];
      const store: AtomicRateLimitStore = {
        consume: vi.fn(async () => ({
          count: policy.limit + 1,
          resetAt: new Date(fixedNow.getTime() + 42_000),
        })),
      };
      const limiter = createParticipantAgendaRateLimiter({
        store,
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

  it('fails read open with a throttled PII-free provider warning', async () => {
    let now = fixedNow;
    const onReadStoreUnavailable = vi.fn();
    const limiter = createParticipantAgendaRateLimiter({
      store: {
        consume: vi.fn(async () => {
          throw new Error('provider details must not escape');
        }),
      },
      subjectSecret,
      eventSlug,
      now: () => now,
      onReadStoreUnavailable,
    });

    await expect(limiter('read', userId)).resolves.toBeNull();
    now = new Date(fixedNow.getTime() + 10_000);
    await expect(limiter('read', userId)).resolves.toBeNull();
    now = new Date(fixedNow.getTime() + 61_000);
    await expect(limiter('read', userId)).resolves.toBeNull();

    expect(onReadStoreUnavailable).toHaveBeenCalledTimes(2);
    expect(onReadStoreUnavailable).toHaveBeenNthCalledWith(1, {
      errorName: 'Error',
    });
    expect(JSON.stringify(onReadStoreUnavailable.mock.calls)).not.toContain(
      'provider details',
    );
  });

  it('fails mutations closed when the shared store is unavailable', async () => {
    const providerError = new Error('Redis unavailable');
    const limiter = createParticipantAgendaRateLimiter({
      store: {
        consume: vi.fn(async () => {
          throw providerError;
        }),
      },
      subjectSecret,
      eventSlug,
      now: () => fixedNow,
    });

    await expect(limiter('mutation', userId)).rejects.toBe(providerError);
  });

  it('does not hide invalid store responses behind the read fail-open policy', async () => {
    const limiter = createParticipantAgendaRateLimiter({
      store: {
        consume: vi.fn(async () => ({
          count: 0,
          resetAt: new Date('invalid'),
        })),
      },
      subjectSecret,
      eventSlug,
      now: () => fixedNow,
    });

    await expect(limiter('read', userId)).rejects.toThrow(
      'Invalid rate limit store result',
    );
  });
});
