import { createDatabaseClient, schema } from '@byzon/database';
import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  authIpAddressHeadersFor,
  createAuth,
  LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS,
  magicLinkPurposeForAccount,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from './auth';
import { logoutAllSessions } from './logout-all';
import { performIdentitySessionAction } from './identity';
import { FakeAuthMailProvider } from './mail';
import {
  confirmMagicLink,
  showMagicLinkConfirmation,
} from './magic-link-confirmation';

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

  it('trusts the Railway-overwritten client IP header only in hosted environments', () => {
    expect(authIpAddressHeadersFor('staging')).toEqual(['x-real-ip']);
    expect(authIpAddressHeadersFor('production')).toEqual(['x-real-ip']);
    expect(authIpAddressHeadersFor('development')).toBeUndefined();
    expect(authIpAddressHeadersFor('test')).toBeUndefined();
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
  const stagingAuth = createAuth(mail, client.db, {
    NODE_ENV: 'test',
    APP_ENV: 'staging',
    APP_BASE_URL: 'http://localhost:3000',
    PUBLIC_SITE_URL: 'http://localhost:8000',
    DATABASE_URL:
      databaseUrl ?? 'postgresql://postgres:postgres@localhost:5432/byzon',
    REDIS_URL: 'redis://127.0.0.1:6379',
    BETTER_AUTH_SECRET: 'integration-test-secret-at-least-32-characters',
    RATE_LIMIT_SUBJECT_SECRET:
      'integration-rate-limit-secret-at-least-32-characters',
  });

  beforeEach(async () => {
    mail.clear();
    await client.pool.query(
      `delete from "verification" where
        case when left("value", 1) = '{' then "value"::jsonb ->> 'email' end = $1
        or "identifier" = 'sign-in-otp-' || $1`,
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

  afterEach(() => vi.useRealTimers());

  afterAll(async () => {
    await client.pool.query(
      `delete from "verification" where
        case when left("value", 1) = '{' then "value"::jsonb ->> 'email' end = $1
        or "identifier" = 'sign-in-otp-' || $1`,
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
    expect(setCookie).toContain('Max-Age=172800');
    return setCookie!.split(';', 1)[0]!;
  };

  it('resolves invitation guides from active roles in the invited event, ignoring supplied and revoked roles', async () => {
    const [user] = await client.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email));
    const eventId = crypto.randomUUID();
    const otherEventId = crypto.randomUUID();
    try {
      await client.db.insert(schema.events).values(
        [eventId, otherEventId].map((id) => ({
          id,
          slug: `guide-invitation-${id}`,
          name: 'Synthetic guide invitation',
          startsAt: new Date('2026-09-18T08:00:00Z'),
          endsAt: new Date('2026-09-18T18:00:00Z'),
          timezone: 'Europe/Prague',
        })),
      );
      await client.db.insert(schema.eventMemberships).values(
        [eventId, otherEventId].map((id) => ({
          eventId: id,
          userId: user!.id,
          status: 'active' as const,
        })),
      );
      await client.db.insert(schema.eventRoles).values([
        { id: crypto.randomUUID(), eventId, userId: user!.id, role: 'speaker' },
        {
          id: crypto.randomUUID(),
          eventId,
          userId: user!.id,
          role: 'moderator',
        },
        {
          id: crypto.randomUUID(),
          eventId,
          userId: user!.id,
          role: 'organizer_admin',
          revokedAt: new Date(),
        },
        {
          id: crypto.randomUUID(),
          eventId: otherEventId,
          userId: user!.id,
          role: 'room_operator',
        },
      ]);
      await activationAuth.api.signInMagicLink({
        headers: new Headers({ origin: 'http://localhost:3000' }),
        body: {
          email,
          callbackURL: '/po-prihlaseni',
          metadata: {
            purpose: 'team-invitation',
            eventId,
            roles: ['organizer_admin'],
          },
        },
      });
      expect(mail.messages.at(-1)?.roles?.toSorted()).toEqual([
        'moderator',
        'speaker',
      ]);
    } finally {
      await client.db
        .delete(schema.events)
        .where(eq(schema.events.id, eventId));
      await client.db
        .delete(schema.events)
        .where(eq(schema.events.id, otherEventId));
    }
  });

  it('signs a provisioned account in directly on staging without sending mail', async () => {
    const response = await stagingAuth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/staging-email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ email: email.toUpperCase() }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(mail.messages).toEqual([]);
    const setCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('better-auth.session_token='));
    expect(setCookie).toBeTruthy();

    const session = await stagingAuth.api.getSession({
      headers: new Headers({ cookie: setCookie!.split(';', 1)[0]! }),
    });
    expect(session?.user.email).toBe(email);

    const user = await client.db.query.users.findFirst({
      columns: { emailVerified: true },
      where: eq(schema.users.email, email),
    });
    expect(user?.emailVerified).toBe(true);
  });

  it('does not create a staging session for an unknown e-mail', async () => {
    const unknownEmail = `unknown-${crypto.randomUUID()}@example.com`;
    const response = await stagingAuth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/staging-email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ email: unknownEmail }),
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mail.messages).toEqual([]);
    const users = await client.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, unknownEmail));
    expect(users).toEqual([]);
  });

  it('keeps direct e-mail login disabled outside staging', async () => {
    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/staging-email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ email }),
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

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

  it('preserves a token through scanner GETs, then consumes it only on confirmed POST', async () => {
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

    for (const method of ['GET', 'HEAD', 'GET']) {
      const scanned = showMagicLinkConfirmation(
        new Request(deliveredUrl, { method }),
        'http://localhost:3000',
      );
      expect(scanned.status).toBe(303);
      expect(scanned.headers.get('set-cookie')).toBeNull();
    }
    const submit = () =>
      confirmMagicLink(
        new Request('http://localhost:3000/api/auth/magic-link/verify', {
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
          body: new URLSearchParams(new URL(deliveredUrl).search),
        }),
        'http://localhost:3000',
        auth.handler,
      );
    const firstUse = await submit();
    expect(firstUse.status).toBeGreaterThanOrEqual(300);
    expect(firstUse.status).toBeLessThan(400);
    expect(firstUse.headers.get('set-cookie')).toContain(
      'better-auth.session_token',
    );
    expect(firstUse.headers.get('set-cookie')).toContain('HttpOnly');
    expect(firstUse.headers.get('set-cookie')).toContain('SameSite=Lax');

    const secondUse = await submit();
    expect(secondUse.headers.get('set-cookie')).toBeNull();
    expect(secondUse.headers.get('location')).toContain('INVALID_TOKEN');
  });

  it.each(['participant-invitation', 'account-activation'] as const)(
    'issues a fresh 24-hour token on repeated %s delivery and recovers an expired link',
    async (purpose) => {
      const requestLink = () =>
        activationAuth.api.signInMagicLink({
          headers: new Headers({ origin: 'http://localhost:3000' }),
          body: {
            email,
            callbackURL: '/app',
            errorCallbackURL: '/prihlaseni?mode=recovery&returnTo=%2Fapp',
            metadata: { purpose },
          },
        });
      await requestLink();
      const original = new URL(mail.messages.at(-1)!.url);
      await client.pool.query(
        `update "verification" set expires_at = now() - interval '1 second'
         where "value"::jsonb ->> 'email' = $1`,
        [email],
      );
      const expired = await confirmMagicLink(
        new Request('http://localhost:3000/api/auth/magic-link/verify', {
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
          body: new URLSearchParams(original.search),
        }),
        'http://localhost:3000',
        auth.handler,
      );
      expect(expired.headers.get('set-cookie')).toBeNull();
      const recovery = new URL(expired.headers.get('location')!);
      expect(recovery.pathname).toBe('/prihlaseni');
      expect(recovery.searchParams.get('mode')).toBe('recovery');
      expect(recovery.searchParams.get('error')).toBe('INVALID_TOKEN');
      expect(recovery.searchParams.get('returnTo')).toBe('/app');

      const startedAt = Date.now();
      await requestLink();
      const renewed = new URL(mail.messages.at(-1)!.url);
      expect(renewed.searchParams.get('token')).not.toBe(
        original.searchParams.get('token'),
      );
      const stored = await client.pool.query<{ expires_at: Date }>(
        `select expires_at from "verification" where "value"::jsonb ->> 'email' = $1`,
        [email],
      );
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]!.expires_at.getTime()).toBeGreaterThanOrEqual(
        startedAt + 24 * 60 * 60 * 1000,
      );
      expect(stored.rows[0]!.expires_at.getTime()).toBeLessThanOrEqual(
        Date.now() + 24 * 60 * 60 * 1000,
      );
      await requestLink();
      const resent = new URL(mail.messages.at(-1)!.url);
      expect(resent.searchParams.get('token')).not.toBe(
        renewed.searchParams.get('token'),
      );
      const activated = await auth.handler(new Request(resent));
      expect(activated.headers.get('location')).toBe(
        'http://localhost:3000/app',
      );
      expect(activated.headers.get('set-cookie')).toContain(
        'better-auth.session_token',
      );
      expect(
        (
          await client.db.query.users.findFirst({
            where: eq(schema.users.email, email),
          })
        )?.emailVerified,
      ).toBe(true);
      expect(mail.messages).toHaveLength(3);
    },
  );

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

  it('keeps an inactive session for 48 hours, but cannot revive it after expiry', async () => {
    const cookie = await createSession();
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now + 47 * 60 * 60 * 1_000);
    expect(
      (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user
        .email,
    ).toBe(email);
    vi.setSystemTime(now + 48 * 60 * 60 * 1_000 + 1_000);
    const expired = await auth.handler(
      new Request('http://localhost:3000/api/auth/get-session', {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost:3000' },
      }),
    );
    expect(await expired.json()).toBeNull();
    expect(expired.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('renews the database and browser cookie together, never during a server read', async () => {
    const cookie = await createSession();
    const original = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now + 47 * 60 * 60 * 1_000);
    const read = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(read?.session.expiresAt).toEqual(original?.session.expiresAt);
    const response = await auth.handler(
      new Request('http://localhost:3000/api/auth/get-session', {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost:3000' },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=172800');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    const renewed = await response.json();
    expect(new Date(renewed.session.expiresAt).getTime()).toBe(
      Date.now() + 48 * 60 * 60 * 1_000,
    );
    vi.setSystemTime(now + 49 * 60 * 60 * 1_000);
    expect(
      (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user
        .email,
    ).toBe(email);
    await client.db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, renewed.session.id));
    expect(
      await auth.api.getSession({ headers: new Headers({ cookie }) }),
    ).toBeNull();
  });

  const requestCode = (address = email) =>
    auth.handler(
      new Request(
        'http://localhost:3000/api/auth/email-otp/send-verification-otp',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
          },
          body: JSON.stringify({ email: address, type: 'sign-in' }),
        },
      ),
    );
  const verifyCode = (otp: string) =>
    auth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ email, otp }),
      }),
    );

  it('signs in the requesting PWA with a hashed one-use code and a persistent 48-hour cookie', async () => {
    expect((await requestCode()).status).toBe(200);
    const code = mail.codes.at(-1)!.code;
    expect(code).toMatch(/^\d{6}$/);
    const stored = await client.db.query.verifications.findFirst({
      where: eq(schema.verifications.identifier, `sign-in-otp-${email}`),
    });
    expect(stored?.value).not.toContain(code);
    expect(mail.messages).toHaveLength(0);
    const archived = await client.db
      .select({
        html: schema.emailMessages.html,
        text: schema.emailMessages.text,
      })
      .from(schema.emailMessages)
      .where(eq(schema.emailMessages.recipient, email));
    expect(archived.length).toBeGreaterThan(0);
    expect(JSON.stringify(archived)).not.toContain(code);
    expect(JSON.stringify(archived)).toContain('jednorázový kód skryt');
    const response = await verifyCode(code);
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .find((value) => value.startsWith('better-auth.session_token='))!;
    expect(cookie).toContain('Max-Age=172800');
    expect(cookie).toContain('HttpOnly');
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie.split(';')[0]! }),
    });
    expect(session?.user.email).toBe(email);
    expect(session?.user.emailVerified).toBe(true);
    expect((await verifyCode(code)).status).toBe(400);
  });

  it('rejects an expired code and locks it after three wrong guesses', async () => {
    await requestCode();
    const code = mail.codes.at(-1)!.code;
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++)
      expect((await verifyCode(wrong)).ok).toBe(false);
    expect((await verifyCode(code)).ok).toBe(false);
    await requestCode();
    await client.db
      .update(schema.verifications)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.verifications.identifier, `sign-in-otp-${email}`));
    expect((await verifyCode(mail.codes.at(-1)!.code)).ok).toBe(false);
  });

  it('does not send codes or create accounts for unknown addresses', async () => {
    const unknown = `unknown-${crypto.randomUUID()}@example.com`;
    expect((await requestCode(unknown)).status).toBe(200);
    expect(mail.codes).toHaveLength(0);
    expect(
      await client.db.query.users.findFirst({
        where: eq(schema.users.email, unknown),
      }),
    ).toBeUndefined();
  });

  it('sets secure persistent cookies and preserves login across auth server instances', async () => {
    const environment = {
      NODE_ENV: 'production',
      APP_ENV: 'test',
      APP_BASE_URL: 'https://app.example.test',
      PUBLIC_SITE_URL: 'https://example.test',
      DATABASE_URL: databaseUrl!,
      BETTER_AUTH_SECRET: 'integration-test-secret-at-least-32-characters',
    };
    const secure = createAuth(mail, client.db, environment);
    await secure.api.signInMagicLink({
      body: { email, callbackURL: '/app' },
      headers: new Headers({ origin: environment.APP_BASE_URL }),
    });
    const response = await secure.handler(
      new Request(mail.messages.at(-1)!.url),
    );
    const cookie = response.headers
      .getSetCookie()
      .find((value) =>
        value.startsWith('__Secure-better-auth.session_token='),
      )!;
    expect(cookie).toContain('Max-Age=172800');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    const restarted = createAuth(mail, client.db, environment);
    const session = await restarted.api.getSession({
      headers: new Headers({ cookie: cookie.split(';')[0]! }),
    });
    expect(session?.user.email).toBe(email);
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
