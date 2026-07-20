import { ApiProblemError } from './problem';

const SCOPE_PATTERN = /^[a-z][a-z0-9_.-]{0,127}$/;
const SUBJECT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface AtomicRateLimitStoreInput {
  bucket: string;
  limit: number;
  windowMs: number;
  now: Date;
}

export interface AtomicRateLimitStoreResult {
  count: number;
  resetAt: Date;
}

/** Implementations must atomically increment and return the shared bucket. */
export interface AtomicRateLimitStore {
  consume(
    input: AtomicRateLimitStoreInput,
  ): Promise<AtomicRateLimitStoreResult>;
}

export interface ConsumeRateLimitInput {
  scope: string;
  /** HMAC-SHA-256 digest; never pass a raw IP, email, user ID or device value. */
  subjectHash: string;
  limit: number;
  windowMs: number;
  now?: Date;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
}

const validateInput = (input: ConsumeRateLimitInput): void => {
  if (
    !SCOPE_PATTERN.test(input.scope) ||
    !SUBJECT_HASH_PATTERN.test(input.subjectHash) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 1_000_000 ||
    !Number.isInteger(input.windowMs) ||
    input.windowMs < 1_000 ||
    input.windowMs > MAX_WINDOW_MS
  ) {
    throw new TypeError('Invalid rate limit input');
  }
};

export const consumeRateLimit = async (
  store: AtomicRateLimitStore,
  input: ConsumeRateLimitInput,
): Promise<RateLimitDecision> => {
  validateInput(input);
  const now = input.now ?? new Date();
  const result = await store.consume({
    bucket: `byzon:rate-limit:${input.scope}:${input.subjectHash}`,
    limit: input.limit,
    windowMs: input.windowMs,
    now,
  });
  if (
    !Number.isInteger(result.count) ||
    result.count < 1 ||
    !Number.isFinite(result.resetAt.getTime()) ||
    result.resetAt <= now
  ) {
    throw new TypeError('Invalid rate limit store result');
  }
  return {
    allowed: result.count <= input.limit,
    limit: input.limit,
    remaining: Math.max(0, input.limit - result.count),
    resetAt: result.resetAt,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((result.resetAt.getTime() - now.getTime()) / 1_000),
    ),
  };
};

export const rateLimitHeaders = (
  decision: RateLimitDecision,
): Record<string, string> => ({
  'ratelimit-limit': String(decision.limit),
  'ratelimit-remaining': String(decision.remaining),
  'ratelimit-reset': String(Math.ceil(decision.resetAt.getTime() / 1_000)),
  ...(decision.allowed
    ? {}
    : { 'retry-after': String(decision.retryAfterSeconds) }),
});

export const enforceRateLimit = (decision: RateLimitDecision): void => {
  if (decision.allowed) return;
  throw new ApiProblemError({
    status: 429,
    code: 'RATE_LIMITED',
    title: 'Too many requests',
    detail: 'Too many requests were received. Try again later.',
    headers: rateLimitHeaders(decision),
  });
};
