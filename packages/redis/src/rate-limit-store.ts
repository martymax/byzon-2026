import type { RedisConnection } from './connection.js';

const BUCKET_PATTERN =
  /^byzon:rate-limit:[a-z][a-z0-9_.-]{0,127}:[a-f0-9]{64}$/;
const MAX_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface RedisRateLimitStoreInput {
  readonly bucket: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly now: Date;
}

export interface RedisRateLimitStoreResult {
  readonly count: number;
  readonly resetAt: Date;
}

const RATE_LIMIT_SCRIPT = `
local limit = tonumber(ARGV[2])
local existing = redis.call('GET', KEYS[1])
local count
if existing and tonumber(existing) > limit then
  count = limit + 1
else
  count = redis.call('INCR', KEYS[1])
end
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

const parseInteger = (value: unknown, name: string): number => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new TypeError(`Invalid Redis rate-limit ${name}`);
  }
  return parsed;
};

export class RedisRateLimitStore {
  readonly #connection: RedisConnection;

  constructor(connection: RedisConnection) {
    this.#connection = connection;
  }

  async consume(
    input: RedisRateLimitStoreInput,
  ): Promise<RedisRateLimitStoreResult> {
    if (
      !BUCKET_PATTERN.test(input.bucket) ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 1_000_000 ||
      !Number.isInteger(input.windowMs) ||
      input.windowMs < 1_000 ||
      input.windowMs > MAX_WINDOW_MS ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new TypeError('Invalid Redis rate-limit input');
    }
    await this.#connection.ready();
    const result: unknown = await this.#connection.client.eval(
      RATE_LIMIT_SCRIPT,
      1,
      input.bucket,
      String(input.windowMs),
      String(input.limit),
    );
    if (!Array.isArray(result) || result.length !== 2) {
      throw new TypeError('Invalid Redis rate-limit response');
    }
    const count = parseInteger(result[0], 'count');
    const ttlMs = parseInteger(result[1], 'ttl');
    return {
      count,
      resetAt: new Date(input.now.getTime() + ttlMs),
    };
  }
}
