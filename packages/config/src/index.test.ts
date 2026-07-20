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
