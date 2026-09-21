import { readConferenceEnv } from '@byzon/config';
import { auth, getAuthAppOrigin } from './auth';
import { database } from './database';
import { rateLimitStore } from './redis';
import {
  consumeRateLimit,
  enforceRateLimit,
  hashRateLimitSubject,
} from './api/rate-limit';
import type { FeedbackDependencies } from './conference-feedback';
const env = readConferenceEnv(process.env);
export const conferenceFeedbackDependencies: FeedbackDependencies = {
  db: database.db,
  getSession: (headers) => auth.api.getSession({ headers }),
  allowedOrigin: getAuthAppOrigin(),
  tokenSecret: env.BETTER_AUTH_SECRET,
  async rateLimit(digest) {
    enforceRateLimit(
      await consumeRateLimit(rateLimitStore, {
        scope: 'conference_feedback',
        subjectHash: hashRateLimitSubject(env.RATE_LIMIT_SUBJECT_SECRET, [
          digest,
        ]),
        limit: 180,
        windowMs: 60_000,
      }),
    );
  },
};
