import { describe, expect, it, vi } from 'vitest';

import {
  createRedisConnection,
  redisOptions,
  type CreateRedisConnectionInput,
} from './connection';

const input = (
  role: CreateRedisConnectionInput['role'],
): CreateRedisConnectionInput => ({
  config: {
    url: 'redis://127.0.0.1:6379',
    family: 0,
    connectTimeoutMs: 3_000,
    commandTimeoutMs: 2_000,
  },
  connectionName: `byzon-${role}`,
  role,
});

describe('Redis connection policy', () => {
  it('keeps web commands bounded and out of the offline queue', () => {
    const options = redisOptions(input('web'));

    expect(options).toMatchObject({
      family: 0,
      connectTimeout: 3_000,
      commandTimeout: 2_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      autoResendUnfulfilledCommands: false,
    });
    expect(options.retryStrategy?.(1)).toBe(100);
    expect(options.retryStrategy?.(20)).toBe(2_000);
  });

  it('uses the non-expiring request policy required by BullMQ workers', () => {
    const options = redisOptions(input('bullmq-worker'));

    expect(options).toMatchObject({
      family: 0,
      connectTimeout: 3_000,
      enableOfflineQueue: true,
      lazyConnect: true,
      maxRetriesPerRequest: null,
      autoResendUnfulfilledCommands: true,
    });
    expect(options.commandTimeout).toBeUndefined();
    expect(options.retryStrategy?.(1)).toBe(1_000);
    expect(options.retryStrategy?.(20)).toBe(20_000);
  });

  it('does not connect before the first explicit readiness check', async () => {
    const onError = vi.fn();
    const connection = createRedisConnection({ ...input('web'), onError });

    expect(connection.client.status).toBe('wait');
    await connection.close();
    expect(connection.client.status).toBe('end');
    expect(onError).not.toHaveBeenCalled();
  });

  it('rejects connection names that could carry arbitrary metadata', () => {
    expect(() =>
      redisOptions({ ...input('web'), connectionName: 'redis://secret' }),
    ).toThrow('Invalid Redis connection name');
  });
});
