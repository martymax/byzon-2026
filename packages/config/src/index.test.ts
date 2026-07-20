import { describe, expect, it } from 'vitest';
import { readConferenceEnv, readWorkerEnv } from './index';

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
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        APP_BASE_URL: 'https://staging-app.byzon.cz',
        PUBLIC_SITE_URL: 'https://byzon.cz',
      }),
    ).toThrow();
  });
});

describe('release environment', () => {
  const staging = {
    NODE_ENV: 'production',
    APP_ENV: 'staging',
    APP_BASE_URL: 'https://staging-app.byzon.cz',
    PUBLIC_SITE_URL: 'https://byzon.cz',
    DATABASE_URL: 'postgresql://example.invalid/byzon',
    BETTER_AUTH_SECRET: 'staging-test-secret-at-least-32-characters',
  } as const;

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
        NODE_ENV: 'production',
        APP_ENV: 'staging',
        APP_BASE_URL: 'https://staging-app.byzon.cz',
        PUBLIC_SITE_URL: 'https://byzon.cz',
        DATABASE_URL: 'postgresql://example.invalid/byzon',
      }),
    ).toThrow();
  });
});
