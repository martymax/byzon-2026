import { createDatabaseClient, schema } from '@byzon/database';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuth, SESSION_EXPIRES_IN_SECONDS } from './auth';
import { logoutAllSessions } from './logout-all';
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

  const createSession = async (): Promise<string> => {
    const requested = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, callbackURL: '/' }),
      }),
    );
    expect(requested.status).toBe(200);

    const deliveredUrl = mail.messages.at(-1)?.url;
    expect(deliveredUrl).toBeTruthy();
    if (!deliveredUrl) throw new Error('Magic link was not delivered');
    const consumed = await auth.handler(new Request(deliveredUrl));
    expect(consumed.status).toBeGreaterThanOrEqual(300);
    expect(consumed.status).toBeLessThan(400);

    const setCookie = consumed.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('better-auth.session_token='));
    expect(setCookie).toBeTruthy();
    return setCookie!.split(';', 1)[0]!;
  };

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
    expect(firstUse.headers.get('set-cookie')).toContain('HttpOnly');
    expect(firstUse.headers.get('set-cookie')).toContain('SameSite=Lax');

    const secondUse = await auth.handler(new Request(deliveredUrl));
    expect(secondUse.headers.get('location')).toContain('INVALID_TOKEN');
  });

  it('rejects an expired session at the HTTP boundary', async () => {
    const cookie = await createSession();
    const stored = await client.db
      .select({
        createdAt: schema.sessions.createdAt,
        expiresAt: schema.sessions.expiresAt,
      })
      .from(schema.sessions);

    expect(stored).toHaveLength(1);
    expect(
      (stored[0]!.expiresAt.getTime() - stored[0]!.createdAt.getTime()) / 1_000,
    ).toBeCloseTo(SESSION_EXPIRES_IN_SECONDS, -1);

    await client.pool.query(
      `update "session"
       set expires_at = now() - interval '1 second'
       where user_id = (select id from "user" where email = $1)`,
      [email],
    );

    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/get-session', {
        headers: { cookie },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it('revokes every session and expires the caller cookie', async () => {
    const firstCookie = await createSession();
    const secondCookie = await createSession();
    const before = await client.db.select().from(schema.sessions);
    expect(before).toHaveLength(2);

    const response = await logoutAllSessions(
      new Request('http://localhost:3000/api/v1/auth/logout-all', {
        method: 'POST',
        headers: {
          cookie: firstCookie,
          origin: 'http://localhost:3000',
          'x-request-id': 'logout-all-test-request',
        },
      }),
      auth,
      'http://localhost:3000',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(
      'logout-all-test-request',
    );
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^better-auth\.session_token=;.*Max-Age=0.*HttpOnly.*SameSite=Lax/,
        ),
      ]),
    );
    expect(await response.json()).toEqual({
      status: 'sessions_revoked',
      requestId: 'logout-all-test-request',
    });

    const remaining = await client.db.select().from(schema.sessions);
    expect(remaining).toHaveLength(0);

    for (const cookie of [firstCookie, secondCookie]) {
      const session = await auth.handler(
        new Request('http://localhost:3000/api/auth/get-session', {
          headers: { cookie },
        }),
      );
      expect(await session.json()).toBeNull();
    }
  });

  it('returns a safe problem response without revoking anonymous sessions', async () => {
    const activeCookie = await createSession();
    const response = await logoutAllSessions(
      new Request('http://localhost:3000/api/v1/auth/logout-all', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'x-request-id': 'anonymous-logout-request',
        },
      }),
      auth,
      'http://localhost:3000',
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
    expect(await response.json()).toMatchObject({
      code: 'AUTHENTICATION_REQUIRED',
      requestId: 'anonymous-logout-request',
    });

    const active = await auth.handler(
      new Request('http://localhost:3000/api/auth/get-session', {
        headers: { cookie: activeCookie },
      }),
    );
    expect(await active.json()).not.toBeNull();
  });

  it('rejects a cross-origin logout without revoking the session', async () => {
    const activeCookie = await createSession();
    const response = await logoutAllSessions(
      new Request('http://localhost:3000/api/v1/auth/logout-all', {
        method: 'POST',
        headers: {
          cookie: activeCookie,
          origin: 'https://attacker.example',
          'x-request-id': 'cross-origin-logout-request',
        },
      }),
      auth,
      'http://localhost:3000',
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'AUTH_REQUEST_REJECTED',
      requestId: 'cross-origin-logout-request',
    });

    const active = await auth.handler(
      new Request('http://localhost:3000/api/auth/get-session', {
        headers: { cookie: activeCookie },
      }),
    );
    expect(await active.json()).not.toBeNull();
  });
});
