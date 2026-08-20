import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  databasePing: vi.fn<() => Promise<void>>(),
  redisPing: vi.fn<() => Promise<number>>(),
  warn: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-request-id': 'request-health-test' }),
}));
vi.mock('@byzon/config', () => ({
  readConferenceEnv: () => ({ APP_ENV: 'test', RELEASE_SHA: 'test-sha' }),
}));
vi.mock('@/server/database', () => ({
  database: { ping: mocks.databasePing },
}));
vi.mock('@/server/logger', () => ({ logger: { warn: mocks.warn } }));
vi.mock('@/server/redis', () => ({
  redisConnection: { ping: mocks.redisPing },
}));

import { GET } from './route';

describe('conference readiness', () => {
  beforeEach(() => {
    mocks.databasePing.mockReset().mockResolvedValue();
    mocks.redisPing.mockReset().mockResolvedValue(1.2);
    mocks.warn.mockReset();
  });

  it('reports both dependencies and the Redis latency when ready', async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ready',
      requestId: 'request-health-test',
      dependencies: { database: 'ready', redis: 'ready' },
      metrics: { redisPingMs: 1.2 },
    });
  });

  it('keeps DB readiness while reporting Redis degradation separately', async () => {
    mocks.redisPing.mockRejectedValue(new Error('secret provider detail'));

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'degraded',
      dependencies: { database: 'ready', redis: 'unavailable' },
      metrics: { redisPingMs: null },
    });
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(
      'secret provider detail',
    );
  });

  it('returns 503 when the authoritative database is unavailable', async () => {
    mocks.databasePing.mockRejectedValue(new Error('database unavailable'));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'not_ready',
      dependencies: { database: 'unavailable', redis: 'ready' },
    });
  });
});
