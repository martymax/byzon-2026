import Redis, { type RedisOptions } from 'ioredis';

export type RedisFamily = 0 | 4 | 6;
export type RedisConnectionRole = 'web' | 'bullmq-worker';

export interface RedisConnectionConfig {
  readonly url: string;
  readonly family: RedisFamily;
  readonly connectTimeoutMs: number;
  readonly commandTimeoutMs: number;
}

export interface CreateRedisConnectionInput {
  readonly config: RedisConnectionConfig;
  readonly connectionName: string;
  readonly role: RedisConnectionRole;
  readonly onError?: (error: unknown) => void;
  readonly onReady?: () => void;
}

const CONNECTION_NAME_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

const retryDelay = (attempt: number, role: RedisConnectionRole): number => {
  const base = role === 'bullmq-worker' ? 1_000 : 100;
  const ceiling = role === 'bullmq-worker' ? 20_000 : 2_000;
  return Math.min(base * 2 ** Math.min(attempt - 1, 5), ceiling);
};

export const redisOptions = (input: CreateRedisConnectionInput) => {
  if (!CONNECTION_NAME_PATTERN.test(input.connectionName)) {
    throw new TypeError('Invalid Redis connection name');
  }

  const worker = input.role === 'bullmq-worker';
  return {
    family: input.config.family,
    connectTimeout: input.config.connectTimeoutMs,
    ...(worker ? {} : { commandTimeout: input.config.commandTimeoutMs }),
    connectionName: input.connectionName,
    enableOfflineQueue: worker,
    enableReadyCheck: true,
    lazyConnect: true,
    maxRetriesPerRequest: worker ? null : 1,
    autoResendUnfulfilledCommands: worker,
    retryStrategy: (attempt) => retryDelay(attempt, input.role),
  } satisfies RedisOptions;
};

const timeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const waitForReady = (client: Redis, timeoutMs: number): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Redis readiness timed out'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      client.off('ready', onReady);
      client.off('error', onError);
      client.off('end', onEnd);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error('Redis connection ended before becoming ready'));
    };
    client.once('ready', onReady);
    client.once('error', onError);
    client.once('end', onEnd);
  });

export class RedisConnection {
  readonly client: Redis;
  readonly #connectTimeoutMs: number;
  #readyPromise: Promise<void> | undefined;

  constructor(input: CreateRedisConnectionInput) {
    this.#connectTimeoutMs = input.config.connectTimeoutMs;
    this.client = new Redis(input.config.url, redisOptions(input));
    this.client.on('error', (error) => input.onError?.(error));
    this.client.on('ready', () => input.onReady?.());
  }

  async ready(): Promise<void> {
    if (this.client.status === 'ready') return;
    if (!this.#readyPromise) {
      const connect =
        this.client.status === 'wait'
          ? this.client.connect().then(() => undefined)
          : waitForReady(this.client, this.#connectTimeoutMs);
      this.#readyPromise = timeout(
        connect,
        this.#connectTimeoutMs,
        'Redis connection timed out',
      ).finally(() => {
        this.#readyPromise = undefined;
      });
    }
    await this.#readyPromise;
  }

  async ping(): Promise<number> {
    const startedAt = performance.now();
    await this.ready();
    const response = await this.client.ping();
    if (response !== 'PONG') throw new Error('Redis returned an invalid ping');
    return Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10);
  }

  async close(): Promise<void> {
    if (this.client.status === 'end') return;
    if (this.client.status === 'wait') {
      this.client.disconnect(false);
      return;
    }
    try {
      await timeout(
        this.client.quit().then(() => undefined),
        this.#connectTimeoutMs,
        'Redis shutdown timed out',
      );
    } catch {
      this.client.disconnect(false);
    }
  }
}

export const createRedisConnection = (
  input: CreateRedisConnectionInput,
): RedisConnection => new RedisConnection(input);
