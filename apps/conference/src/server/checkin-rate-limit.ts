import { readConferenceEnv } from '@byzon/config';

import {
  consumeRateLimit,
  hashRateLimitSubject,
  type AtomicRateLimitStore,
  type RateLimitDecision,
} from './api/rate-limit';
import { CURRENT_EVENT_SLUG } from './current-event';
import { rateLimitStore } from './redis';

export type CheckinRateLimitKind = 'read' | 'lookup' | 'mutation';
export type CheckinRateLimiter = (
  kind: CheckinRateLimitKind,
  userId: string,
  deviceId: string,
) => Promise<RateLimitDecision>;

export const CHECKIN_RATE_LIMIT_POLICIES = Object.freeze({
  read: Object.freeze({ scope: 'checkin.read', limit: 180, windowMs: 60_000 }),
  lookup: Object.freeze({
    scope: 'checkin.lookup',
    limit: 120,
    windowMs: 60_000,
  }),
  mutation: Object.freeze({
    scope: 'checkin.mutation',
    limit: 60,
    windowMs: 60_000,
  }),
});

export const createCheckinRateLimiter =
  (options: {
    store: AtomicRateLimitStore;
    subjectSecret: string;
    eventSlug: string;
    now?: () => Date;
  }): CheckinRateLimiter =>
  async (kind, userId, deviceId) =>
    consumeRateLimit(options.store, {
      ...CHECKIN_RATE_LIMIT_POLICIES[kind],
      subjectHash: hashRateLimitSubject(options.subjectSecret, [
        options.eventSlug,
        userId,
        deviceId,
      ]),
      now: options.now?.() ?? new Date(),
    });

const env = readConferenceEnv(process.env);

export const checkinRateLimit = createCheckinRateLimiter({
  store: rateLimitStore,
  subjectSecret: env.RATE_LIMIT_SUBJECT_SECRET,
  eventSlug: CURRENT_EVENT_SLUG,
});
