import { readConferenceEnv } from '@byzon/config';

import {
  consumeRateLimit,
  enforceRateLimit,
  hashRateLimitSubject,
  type AtomicRateLimitStore,
  type RateLimitDecision,
} from './api/rate-limit';
import { CURRENT_EVENT_SLUG } from './current-event';
import { logger } from './logger';
import { rateLimitStore } from './redis';

export type ParticipantAgendaRateLimitKind = 'mutation' | 'read';

export type ParticipantAgendaRateLimiter = (
  kind: ParticipantAgendaRateLimitKind,
  userId: string,
) => Promise<RateLimitDecision | null>;

export const PARTICIPANT_AGENDA_RATE_LIMIT_POLICIES = Object.freeze({
  read: Object.freeze({
    scope: 'participant_agenda.read',
    limit: 120,
    windowMs: 60_000,
  }),
  mutation: Object.freeze({
    scope: 'participant_agenda.mutation',
    limit: 30,
    windowMs: 60_000,
  }),
});

const READ_FAILURE_LOG_INTERVAL_MS = 60_000;

interface ParticipantAgendaRateLimiterOptions {
  store: AtomicRateLimitStore;
  subjectSecret: string;
  eventSlug: string;
  now?: () => Date;
  onReadStoreUnavailable?: (input: { errorName: string }) => void;
}

export const createParticipantAgendaRateLimiter = (
  options: ParticipantAgendaRateLimiterOptions,
): ParticipantAgendaRateLimiter => {
  let lastReadFailureLogAt: number | null = null;

  return async (kind, userId) => {
    const now = options.now?.() ?? new Date();
    const policy = PARTICIPANT_AGENDA_RATE_LIMIT_POLICIES[kind];
    const subjectHash = hashRateLimitSubject(options.subjectSecret, [
      options.eventSlug,
      userId,
    ]);
    let decision: RateLimitDecision;
    try {
      decision = await consumeRateLimit(options.store, {
        ...policy,
        subjectHash,
        now,
      });
    } catch (error) {
      if (kind !== 'read' || error instanceof TypeError) throw error;
      const nowMs = now.getTime();
      if (
        lastReadFailureLogAt === null ||
        nowMs < lastReadFailureLogAt ||
        nowMs - lastReadFailureLogAt >= READ_FAILURE_LOG_INTERVAL_MS
      ) {
        lastReadFailureLogAt = nowMs;
        options.onReadStoreUnavailable?.({
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      }
      return null;
    }
    enforceRateLimit(decision);
    return decision;
  };
};

const env = readConferenceEnv(process.env);

export const participantAgendaRateLimit = createParticipantAgendaRateLimiter({
  store: rateLimitStore,
  subjectSecret: env.RATE_LIMIT_SUBJECT_SECRET,
  eventSlug: CURRENT_EVENT_SLUG,
  onReadStoreUnavailable: ({ errorName }) =>
    logger.warn(
      { errorName },
      'Participant agenda read rate limit unavailable; proceeding fail-open',
    ),
});
