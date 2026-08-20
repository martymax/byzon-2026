import { randomBytes } from 'node:crypto';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRedisConnection, type RedisConnection } from './connection';
import { RedisRateLimitStore } from './rate-limit-store';

const testRedisUrl = process.env.TEST_REDIS_URL;
const describeRedis = testRedisUrl ? describe : describe.skip;

describeRedis('Redis integration', () => {
  const connections: RedisConnection[] = [];
  const keys: string[] = [];

  beforeAll(async () => {
    if (!testRedisUrl) return;
    for (const suffix of ['a', 'b', 'worker']) {
      const connection = createRedisConnection({
        config: {
          url: testRedisUrl,
          family: 0,
          connectTimeoutMs: 2_000,
          commandTimeoutMs: 2_000,
        },
        connectionName: `byzon-test-${suffix}`,
        role: suffix === 'worker' ? 'bullmq-worker' : 'web',
      });
      connections.push(connection);
    }
    await Promise.all(connections.map((connection) => connection.ready()));
  });

  afterAll(async () => {
    const first = connections[0];
    if (first && keys.length > 0) await first.client.del(...keys);
    await Promise.all(connections.map((connection) => connection.close()));
  });

  it('reports a bounded ping metric from a real Redis service', async () => {
    const first = connections[0];
    if (!first) throw new Error('Missing Redis test connection');

    await expect(first.ping()).resolves.toEqual(expect.any(Number));
  });

  it('atomically increments one fixed window across connections', async () => {
    const [first, second] = connections;
    if (!first || !second) throw new Error('Missing Redis test connections');
    const bucket = `byzon:rate-limit:test:${randomBytes(32).toString('hex')}`;
    keys.push(bucket);
    const stores = [
      new RedisRateLimitStore(first),
      new RedisRateLimitStore(second),
    ];
    const now = new Date('2026-08-20T12:00:00.000Z');

    const results = await Promise.all(
      Array.from({ length: 50 }, (_value, index) =>
        stores[index % stores.length]!.consume({
          bucket,
          limit: 50,
          windowMs: 60_000,
          now,
        }),
      ),
    );

    expect(results.map(({ count }) => count).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_value, index) => index + 1),
    );
    for (const result of results) {
      expect(result.resetAt.getTime()).toBeGreaterThan(now.getTime());
      expect(result.resetAt.getTime()).toBeLessThanOrEqual(
        now.getTime() + 60_000,
      );
    }
    await expect(first.client.pttl(bucket)).resolves.toBeGreaterThan(0);
  });

  it('caps a denied bucket instead of incrementing without bound', async () => {
    const first = connections[0];
    if (!first) throw new Error('Missing Redis test connection');
    const bucket = `byzon:rate-limit:test:${randomBytes(32).toString('hex')}`;
    keys.push(bucket);
    const store = new RedisRateLimitStore(first);

    const results = [];
    for (let index = 0; index < 10; index += 1) {
      results.push(
        await store.consume({
          bucket,
          limit: 3,
          windowMs: 60_000,
          now: new Date(),
        }),
      );
    }

    expect(results.map(({ count }) => count)).toEqual([
      1, 2, 3, 4, 4, 4, 4, 4, 4, 4,
    ]);
    await expect(first.client.get(bucket)).resolves.toBe('4');
  });

  it('rejects raw subjects before writing a Redis key', async () => {
    const first = connections[0];
    if (!first) throw new Error('Missing Redis test connection');
    const store = new RedisRateLimitStore(first);
    const rawBucket = 'byzon:rate-limit:test:person@example.invalid';

    await expect(
      store.consume({
        bucket: rawBucket,
        limit: 10,
        windowMs: 60_000,
        now: new Date(),
      }),
    ).rejects.toThrow('Invalid Redis rate-limit input');
    await expect(first.client.exists(rawBucket)).resolves.toBe(0);
  });

  it('is accepted by BullMQ without overriding its worker retry contract', async () => {
    const workerConnection = connections[2];
    if (!workerConnection) throw new Error('Missing BullMQ test connection');
    const queue = new Queue(`connection-${randomBytes(8).toString('hex')}`, {
      connection: workerConnection.client,
      prefix: 'byzon-test',
    });

    try {
      await queue.waitUntilReady();
      expect(workerConnection.client.options.maxRetriesPerRequest).toBeNull();
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});
