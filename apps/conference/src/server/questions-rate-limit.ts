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

export type QuestionsRateLimiter = (
  userId: string,
  sessionId: string,
) => Promise<RateLimitDecision>;

export const createQuestionsRateLimiter =
  (options: {
    store: AtomicRateLimitStore;
    subjectSecret: string;
    eventSlug: string;
    now?: () => Date;
  }): QuestionsRateLimiter =>
  async (userId, sessionId) => {
    const decision = await consumeRateLimit(options.store, {
      scope: 'questions.submit',
      limit: 8,
      windowMs: 60_000,
      subjectHash: hashRateLimitSubject(options.subjectSecret, [
        options.eventSlug,
        userId,
        sessionId,
      ]),
      now: options.now?.() ?? new Date(),
    });
    enforceRateLimit(decision);
    return decision;
  };

const env = readConferenceEnv(process.env);

export const questionsRateLimit = createQuestionsRateLimiter({
  store: rateLimitStore,
  subjectSecret: env.RATE_LIMIT_SUBJECT_SECRET,
  eventSlug: CURRENT_EVENT_SLUG,
});
