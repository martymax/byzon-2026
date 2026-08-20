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

export type AdminReservationRateLimitKind = 'mutation' | 'read';

export type AdminReservationRateLimiter = (
  kind: AdminReservationRateLimitKind,
  userId: string,
) => Promise<RateLimitDecision>;

export const ADMIN_RESERVATION_RATE_LIMIT_POLICIES = Object.freeze({
  read: Object.freeze({
    scope: 'admin_reservation.read',
    limit: 120,
    windowMs: 60_000,
  }),
  mutation: Object.freeze({
    scope: 'admin_reservation.mutation',
    limit: 30,
    windowMs: 60_000,
  }),
});

interface AdminReservationRateLimiterOptions {
  store: AtomicRateLimitStore;
  subjectSecret: string;
  eventSlug: string;
  now?: () => Date;
}

export const createAdminReservationRateLimiter =
  (options: AdminReservationRateLimiterOptions): AdminReservationRateLimiter =>
  async (kind, userId) => {
    const decision = await consumeRateLimit(options.store, {
      ...ADMIN_RESERVATION_RATE_LIMIT_POLICIES[kind],
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

export const adminReservationRateLimit = createAdminReservationRateLimiter({
  store: rateLimitStore,
  subjectSecret: env.RATE_LIMIT_SUBJECT_SECRET,
  eventSlug: CURRENT_EVENT_SLUG,
});
