import { describe, expect, it } from 'vitest';
import { readConferenceEnv, clientEnv } from '@byzon/config';

const valid = {
  NODE_ENV: 'production',
  APP_ENV: 'staging',
  APP_BASE_URL: 'https://staging-app.byzon.cz',
  PUBLIC_SITE_URL: 'https://byzon.cz',
  LOG_LEVEL: 'info',
  RELEASE_SHA: 'abc123',
  DATABASE_URL: 'postgresql://postgres.internal:5432/railway',
  BETTER_AUTH_SECRET: 'staging-test-secret-at-least-32-characters',
};

describe('environment schema', () => {
  it('accepts a complete staging configuration', () =>
    expect(readConferenceEnv(valid).APP_ENV).toBe('staging'));
  it('fails before serving when a required value is missing', () =>
    expect(() =>
      readConferenceEnv({ ...valid, APP_BASE_URL: undefined }),
    ).toThrow());
  it('never publishes a secret-shaped client key', () =>
    expect(Object.keys(clientEnv)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/SECRET|TOKEN|PASSWORD|KEY/),
      ]),
    ));
});
