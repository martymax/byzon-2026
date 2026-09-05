import { describe, expect, it } from 'vitest';

import { isStagingEnvironment } from './staging-environment';

const completeEnvironment = {
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  APP_BASE_URL: 'https://staging.example.test',
  PUBLIC_SITE_URL: 'https://www.example.test',
  DATABASE_URL: 'postgresql://example.invalid/byzon',
  REDIS_URL: 'redis://redis.internal:6379',
  BETTER_AUTH_SECRET: 'staging-test-secret-at-least-32-characters',
  RATE_LIMIT_SUBJECT_SECRET: 'staging-rate-limit-secret-at-least-32-characters',
} as const;

describe('staging environment boundary', () => {
  it('enables the test login only in the explicit staging environment', () => {
    expect(isStagingEnvironment(completeEnvironment)).toBe(true);
    expect(
      isStagingEnvironment({ ...completeEnvironment, APP_ENV: 'production' }),
    ).toBe(false);
  });
});
