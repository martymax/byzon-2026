import { readConferenceEnv } from '@byzon/config';

import {
  consumeRateLimit,
  enforceRateLimit,
  hashRateLimitSubject,
  type AtomicRateLimitStore,
  type RateLimitDecision,
} from './api/rate-limit';
import { CURRENT_EVENT_SLUG } from './current-event';
import { rateLimitStore } from './redis';

export const SIMPLESHOP_PREVIEW_RATE_LIMIT_POLICY = Object.freeze({
  scope: 'admin_simpleshop_preview',
  limit: 6,
  windowMs: 60_000,
});

export type SimpleShopPreviewRateLimiter = (
  userId: string,
) => Promise<RateLimitDecision>;

export const createSimpleShopPreviewRateLimiter =
  (options: {
    readonly store: AtomicRateLimitStore;
    readonly subjectSecret: string;
    readonly eventSlug: string;
    readonly now?: () => Date;
  }): SimpleShopPreviewRateLimiter =>
  async (userId) => {
    const decision = await consumeRateLimit(options.store, {
      ...SIMPLESHOP_PREVIEW_RATE_LIMIT_POLICY,
      subjectHash: hashRateLimitSubject(options.subjectSecret, [
        options.eventSlug,
        userId,
      ]),
      now: options.now?.() ?? new Date(),
    });
    enforceRateLimit(decision);
    return decision;
  };

const env = readConferenceEnv(process.env);

export const simpleShopPreviewRateLimit = createSimpleShopPreviewRateLimiter({
  store: rateLimitStore,
  subjectSecret: env.RATE_LIMIT_SUBJECT_SECRET,
  eventSlug: CURRENT_EVENT_SLUG,
});
