import { describe, expect, it } from 'vitest';
import { readConferenceEnv, readWorkerEnv } from './index';

const stagingBase = {
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  APP_BASE_URL: 'https://staging-app.byzon.cz',
  PUBLIC_SITE_URL: 'https://byzon.cz',
  DATABASE_URL: 'postgresql://example.invalid/byzon',
  REDIS_URL: 'redis://redis.internal:6379',
  BETTER_AUTH_SECRET: 'staging-test-secret-at-least-32-characters',
  RATE_LIMIT_SUBJECT_SECRET: 'staging-rate-limit-secret-at-least-32-characters',
} as const;

describe('worker environment', () => {
  it('validates positive concurrency', () =>
    expect(() => readWorkerEnv({ WORKER_CONCURRENCY_DEFAULT: 0 })).toThrow());
});

describe('database environment', () => {
  it('provides a local-only development URL', () => {
    expect(readConferenceEnv({}).DATABASE_URL).toBe(
      'postgresql://postgres:postgres@localhost:5432/byzon',
    );
  });

  it('requires an explicit PostgreSQL URL in staging', () => {
    expect(() =>
      readConferenceEnv({
        ...stagingBase,
        DATABASE_URL: undefined,
      }),
    ).toThrow();
  });

  it('requires an explicit Redis URL in staging', () => {
    expect(() =>
      readConferenceEnv({ ...stagingBase, REDIS_URL: undefined }),
    ).toThrow();
    expect(() =>
      readConferenceEnv({ ...stagingBase, REDIS_URL: 'redis://' }),
    ).toThrow();
    expect(() =>
      readConferenceEnv({
        ...stagingBase,
        REDIS_URL: 'https://redis.internal',
      }),
    ).toThrow();
  });

  it('supports Railway dual-stack and explicit IP-family overrides', () => {
    expect(readConferenceEnv(stagingBase).REDIS_FAMILY).toBe(0);
    expect(
      readConferenceEnv({ ...stagingBase, REDIS_FAMILY: '6' }).REDIS_FAMILY,
    ).toBe(6);
    expect(() =>
      readConferenceEnv({ ...stagingBase, REDIS_FAMILY: '5' }),
    ).toThrow();
  });
});

describe('release environment', () => {
  const staging = stagingBase;

  it('uses the Railway-provided commit for GitHub deployments', () => {
    expect(
      readConferenceEnv({
        ...staging,
        RAILWAY_GIT_COMMIT_SHA: '6cf483e295b24915c7b203924094e00a3d99c950',
      }).RELEASE_SHA,
    ).toBe('6cf483e295b24915c7b203924094e00a3d99c950');
  });

  it('ignores an empty RELEASE_SHA when Railway provides the commit', () => {
    expect(
      readConferenceEnv({
        ...staging,
        RELEASE_SHA: '',
        RAILWAY_GIT_COMMIT_SHA: 'railway-release',
      }).RELEASE_SHA,
    ).toBe('railway-release');
  });

  it('keeps an explicit non-empty release override', () => {
    expect(
      readConferenceEnv({
        ...staging,
        RELEASE_SHA: 'manual-release',
        RAILWAY_GIT_COMMIT_SHA: 'railway-release',
      }).RELEASE_SHA,
    ).toBe('manual-release');
  });
});

describe('conference authentication environment', () => {
  it('provides a local-only development secret', () => {
    expect(readConferenceEnv({}).BETTER_AUTH_SECRET).toHaveLength(39);
  });

  it('requires an explicit sufficiently long secret in staging', () => {
    expect(() =>
      readConferenceEnv({
        ...stagingBase,
        BETTER_AUTH_SECRET: undefined,
      }),
    ).toThrow();
  });

  it('keeps the rate-limit subject key separate and server-only', () => {
    expect(readConferenceEnv({}).RATE_LIMIT_SUBJECT_SECRET).toHaveLength(46);
    expect(() =>
      readConferenceEnv({
        ...stagingBase,
        RATE_LIMIT_SUBJECT_SECRET: undefined,
      }),
    ).toThrow();
  });
});

describe('SimpleShop server environment', () => {
  it('keeps credentials optional as a pair and server-only', () => {
    expect(readConferenceEnv({}).SIMPLESHOP_API_EMAIL).toBeUndefined();
    expect(() =>
      readConferenceEnv({ SIMPLESHOP_API_EMAIL: 'api@example.test' }),
    ).toThrow();
    expect(
      readConferenceEnv({
        SIMPLESHOP_API_EMAIL: 'api@example.test',
        SIMPLESHOP_API_KEY: 'test-only-key',
      }),
    ).toMatchObject({ SIMPLESHOP_API_EMAIL: 'api@example.test' });
  });

  it('allows the API base override only outside staging and production', () => {
    expect(
      readConferenceEnv({
        SIMPLESHOP_API_BASE_URL: 'https://api.example.test/2.0/',
      }).SIMPLESHOP_API_BASE_URL,
    ).toBe('https://api.example.test/2.0/');
    expect(() =>
      readConferenceEnv({
        ...stagingBase,
        SIMPLESHOP_API_BASE_URL: 'https://api.example.test/2.0/',
      }),
    ).toThrow();
  });
});
