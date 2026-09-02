import { createDatabaseClient, schema } from '@byzon/database';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  createAuth,
  LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS,
  magicLinkPurposeForAccount,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from './auth';
import { logoutAllSessions } from './logout-all';
import { performIdentitySessionAction } from './identity';
import { FakeAuthMailProvider } from './mail';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const email = 'magic-link-integration@example.com';

describe('authentication session policy', () => {
  it('gives activation links 24 hours and subsequent login links 30 minutes', () => {
    expect(ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS).toBe(24 * 60 * 60);
    expect(LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS).toBe(30 * 60);
  });

  it('selects activation only for a known unverified account', () => {
    expect(magicLinkPurposeForAccount(false)).toBe('account-activation');
    expect(magicLinkPurposeForAccount(true)).toBe('sign-in');
    expect(magicLinkPurposeForAccount(undefined)).toBe('sign-in');
  });

  it('keeps an inactive login valid for 48 hours and refreshes active sessions sooner', () => {
    expect(SESSION_EXPIRES_IN_SECONDS).toBe(48 * 60 * 60);
    expect(SESSION_UPDATE_AGE_SECONDS).toBeLessThan(SESSION_EXPIRES_IN_SECONDS);
  });
});

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
  const activationAuth = createAuth(
    mail,
    client.db,
    {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      APP_BASE_URL: 'http://localhost:3000',
      PUBLIC_SITE_URL: 'http://localhost:8000',
      DATABASE_URL:
        databaseUrl ?? 'postgresql://postgres:postgres@localhost:5432/byzon',
      BETTER_AUTH_SECRET: 'integration-test-secret-at-least-32-characters',
    },
    { magicLinkExpiresInSeconds: ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS },
  );

  beforeEach(async () => {
    mail.clear();
    await client.pool.query(
      `delete from "verification" where "value"::jsonb ->> 'email' = $1`,
      [email],
    );
    await client.pool.query('delete from "user" where email = $1', [email]);
    await client.db.insert(schema.users).values({
      id: crypto.randomUUID(),
      name: '',
      email,
      emailVerified: false,
    });
  });

  afterAll(async () => {
    await client.pool.query(
      `delete from "verification" where "value"::jsonb ->> 'email' = $1`,
      [email],
    );
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

  it('persists the configured 30-minute login and 24-hour activation expirations', async () => {
    const requestLink = async (
      instance: typeof auth,
      expectedSeconds: number,
    ) => {
      const response = await instance.handler(
        new Request('http://localhost:3000/api/auth/sign-in/magic-link', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, callbackURL: '/' }),
        }),
      );
      expect(response.status).toBe(200);
      const stored = await client.pool.query<{
        created_at: Date;
        expires_at: Date;
      }>(
        `select "created_at", "expires_at"
         from "verification"
         where "value"::jsonb ->> 'email' = $1
         order by "created_at" desc
         limit 1`,
        [email],
      );
      expect(stored.rows).toHaveLength(1);
      const row = stored.rows[0]!;
      expect(
        Math.abs(
          (row.expires_at.getTime() - row.created_at.getTime()) / 1_000 -
            expectedSeconds,
        ),
      ).toBeLessThan(2);
    };

    await requestLink(auth, LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS);
    await requestLink(activationAuth, ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS);
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
    expect(firstUse.headers.get('set-cookie')).toContain('HttpOnly');
    expect(firstUse.headers.get('set-cookie')).toContain('SameSite=Lax');

    const secondUse = await auth.handler(new Request(deliveredUrl));
    expect(secondUse.headers.get('location')).toContain('INVALID_TOKEN');
  });

  it('does not create an identity that was not imported or provisioned', async () => {
    const unknownEmail = `unknown-${crypto.randomUUID()}@example.com`;
    const requested = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: unknownEmail, callbackURL: '/' }),
      }),
    );
    expect(requested.status).toBe(200);
    const deliveredUrl = mail.messages.at(-1)?.url;
    expect(deliveredUrl).toBeTruthy();
    const consumed = await auth.handler(new Request(deliveredUrl!));
    expect(consumed.headers.get('location')).toContain(
      'new_user_signup_disabled',
    );
    const users = await client.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, unknownEmail));
    expect(users).toEqual([]);
  });

  it('rejects an expired session at the HTTP boundary', async () => {
    const cookie = await createSession();
    const stored = await client.db
      .select({
        createdAt: schema.sessions.createdAt,
        expiresAt: schema.sessions.expiresAt,
      })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
      .where(eq(schema.users.email, email));

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
    const before = await client.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
      .where(eq(schema.users.email, email));
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

    const remaining = await client.db
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .innerJoin(schema.users, eq(schema.sessions.userId, schema.users.id))
      .where(eq(schema.users.email, email));
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

  it('executes the integrated current-session account action with Better Auth cookies', async () => {
    const cookie = await createSession();
    const before = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(before?.session.id).toBeTruthy();

    const actionRequest = () =>
      new Request('http://localhost:3000/api/v1/me/session-action', {
        method: 'POST',
        headers: {
          cookie,
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
          'idempotency-key': 'auth-session-action-key',
          'x-request-id': 'auth-session-action-request',
        },
        body: JSON.stringify({ action: 'logout_current' }),
      });
    const actionDependencies = {
      auth,
      db: client.db,
      allowedOrigin: 'http://localhost:3000',
      getSession: (headers: Headers) => auth.api.getSession({ headers }),
    };
    const response = await performIdentitySessionAction(
      actionRequest(),
      actionDependencies,
    );

    expect(response.status).toBe(200);
    const firstBody = await response.json();
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^better-auth\.session_token=;.*Max-Age=0.*HttpOnly.*SameSite=Lax/,
        ),
      ]),
    );
    expect(firstBody).toMatchObject({
      action: 'logout_current',
      effect: 'completed',
      state: 'signed_out',
    });
    await expect(
      auth.api.getSession({ headers: new Headers({ cookie }) }),
    ).resolves.toBeNull();

    const replay = await performIdentitySessionAction(
      actionRequest(),
      actionDependencies,
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(await replay.json()).toEqual(firstBody);

    const event = await client.db.query.events.findFirst({
      columns: { id: true },
      where: eq(schema.events.slug, 'byzon-2026'),
    });
    if (event) {
      await client.db
        .delete(schema.idempotencyKeys)
        .where(eq(schema.idempotencyKeys.eventId, event.id));
      await client.db
        .delete(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, before!.session.id));
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
