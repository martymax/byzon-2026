import { readConferenceEnv } from '@byzon/config';

import {
  consumeRateLimit,
  hashRateLimitSubject,
  rateLimitHeaders,
  type AtomicRateLimitStore,
  type RateLimitDecision,
} from './api/rate-limit';
import { ApiProblemError } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import { rateLimitStore } from './redis';

export type AdminSupportRateLimitKind = 'search' | 'mutation';

export type AdminSupportRateLimiter = (
  kind: AdminSupportRateLimitKind,
  userId: string,
) => Promise<RateLimitDecision>;

export const ADMIN_SUPPORT_RATE_LIMIT_POLICIES = Object.freeze({
  search: Object.freeze({
    scope: 'admin_support.search',
    limit: 30,
    windowMs: 60_000,
  }),
  mutation: Object.freeze({
    scope: 'admin_support.mutation',
    limit: 10,
    windowMs: 60_000,
  }),
});

export const createAdminSupportRateLimiter =
  (options: {
    readonly store: AtomicRateLimitStore;
    readonly subjectSecret: string;
    readonly eventSlug: string;
    readonly now?: () => Date;
  }): AdminSupportRateLimiter =>
  async (kind, userId) => {
    const decision = await consumeRateLimit(options.store, {
      ...ADMIN_SUPPORT_RATE_LIMIT_POLICIES[kind],
      subjectHash: hashRateLimitSubject(options.subjectSecret, [
        options.eventSlug,
        userId,
      ]),
      now: options.now?.() ?? new Date(),
    });
    if (!decision.allowed) {
      throw new ApiProblemError({
        status: 429,
        code: 'SUPPORT_RATE_LIMITED',
        title: 'Too many support requests',
        detail: 'Too many support requests were received. Try again later.',
        headers: rateLimitHeaders(decision),
      });
    }
    return decision;
  };

const env = readConferenceEnv(process.env);

export const adminSupportRateLimit = createAdminSupportRateLimiter({
  store: rateLimitStore,
  subjectSecret: env.RATE_LIMIT_SUBJECT_SECRET,
  eventSlug: CURRENT_EVENT_SLUG,
});
