import { createDatabaseClient, schema } from '@byzon/database';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuth } from './auth';
import { FakeAuthMailProvider } from './mail';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const email = 'magic-link-integration@example.com';

integration('magic-link authentication integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-auth-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const mail = new FakeAuthMailProvider();
  const auth = createAuth(mail, client.db, {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    APP_BASE_URL: 'http://localhost:3000',
    PUBLIC_SITE_URL: 'http://localhost:8000',
    DATABASE_URL:
      databaseUrl ?? 'postgresql://postgres:postgres@localhost:5432/byzon',
    BETTER_AUTH_SECRET: 'integration-test-secret-at-least-32-characters',
  });

  beforeEach(async () => {
    mail.clear();
    await client.pool.query('delete from "user" where email = $1', [email]);
  });

  afterAll(async () => {
    await client.pool.query('delete from "user" where email = $1', [email]);
    await client.close();
  });

  it('stores a hashed token and consumes it on first use', async () => {
    const requested = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, callbackURL: '/' }),
      }),
    );

    expect(requested.status).toBe(200);
    expect(mail.messages).toHaveLength(1);
    const deliveredUrl = mail.messages[0]!.url;
    const token = new URL(deliveredUrl).searchParams.get('token');
    expect(token).toBeTruthy();

    const stored = await client.db
      .select({ value: schema.verifications.value })
      .from(schema.verifications);
    expect(stored.some(({ value }) => value === token)).toBe(false);

    const firstUse = await auth.handler(new Request(deliveredUrl));
    expect(firstUse.status).toBeGreaterThanOrEqual(300);
    expect(firstUse.status).toBeLessThan(400);
    expect(firstUse.headers.get('set-cookie')).toContain(
      'better-auth.session_token',
    );

    const secondUse = await auth.handler(new Request(deliveredUrl));
    expect(secondUse.headers.get('location')).toContain('INVALID_TOKEN');
  });
});
