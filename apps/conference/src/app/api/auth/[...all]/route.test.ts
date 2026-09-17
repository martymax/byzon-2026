import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  handledBy: [] as string[],
  verify: vi.fn(
    async () =>
      new Response(null, { status: 302, headers: { location: '/app' } }),
  ),
}));

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: (instance: { readonly kind: string }) => ({
    GET: routeMocks.verify,
    POST: async (request: Request) => {
      routeMocks.handledBy.push(instance.kind);
      return Response.json({
        body: await request.json(),
        handledBy: instance.kind,
      });
    },
  }),
}));

vi.mock('@/server/auth', () => ({
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS: 86_400,
  auth: { kind: 'login' },
  createAuth: vi.fn(() => ({ kind: 'activation' })),
  getAuthAppOrigin: () => 'https://app.example.test',
  magicLinkPurposeForAccount: (emailVerified: boolean | undefined) =>
    emailVerified === false ? 'account-activation' : 'sign-in',
}));

vi.mock('@/server/database', () => ({
  database: {
    db: {
      query: { users: { findFirst: routeMocks.findFirst } },
    },
  },
}));

vi.mock('@/server/mail', () => ({ authMailProvider: {} }));

import { GET, POST } from './route';

it.each(['forget-password', 'email-verification', 'change-email'])(
  'does not expose %s through the login-code sender',
  async (type) => {
    const response = await POST(
      new Request(
        'https://app.example.test/api/auth/email-otp/send-verification-otp',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type, email: 'participant@example.test' }),
        },
      ),
    );
    expect(response.status).toBe(400);
  },
);

describe('public magic-link confirmation boundary', () => {
  beforeEach(() => routeMocks.verify.mockClear());

  it.each(['GET', 'HEAD'])(
    'never verifies a token on %s, including old email links',
    async (method) => {
      const response = await GET(
        new Request(
          'https://app.example.test/api/auth/magic-link/verify?token=secret&callbackURL=%2Fapp',
          { method },
        ),
      );
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(
        'https://app.example.test/prihlaseni/potvrzeni?token=secret&callbackURL=%2Fapp',
      );
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('set-cookie')).toBeNull();
      expect(routeMocks.verify).not.toHaveBeenCalled();
    },
  );

  it('verifies only on a same-origin form submission and redirects with GET', async () => {
    const response = await POST(
      new Request('https://app.example.test/api/auth/magic-link/verify', {
        method: 'POST',
        headers: { origin: 'https://app.example.test' },
        body: new URLSearchParams({ token: 'secret', callbackURL: '/app' }),
      }),
    );
    expect(response.status).toBe(303);
    expect(routeMocks.verify).toHaveBeenCalledOnce();
  });

  it.each([undefined, 'https://attacker.example'])(
    'rejects an untrusted form origin (%s)',
    async (origin) => {
      const response = await POST(
        new Request('https://app.example.test/api/auth/magic-link/verify', {
          method: 'POST',
          headers: origin ? { origin } : {},
          body: new URLSearchParams({ token: 'secret' }),
        }),
      );
      expect(response.status).toBe(403);
      expect(routeMocks.verify).not.toHaveBeenCalled();
    },
  );
});

const magicLinkRequest = () =>
  new Request('https://app.example.test/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      callbackURL: '/app/networking',
      email: 'PARTICIPANT@example.test',
      metadata: { purpose: 'team-invitation' },
    }),
  });

describe('self-service magic-link policy', () => {
  beforeEach(() => {
    routeMocks.findFirst.mockReset();
    routeMocks.handledBy.length = 0;
  });

  it('issues a server-controlled activation link for a known unverified account', async () => {
    routeMocks.findFirst.mockResolvedValueOnce({ emailVerified: false });

    const response = await POST(magicLinkRequest());

    expect(await response.json()).toEqual({
      handledBy: 'activation',
      body: {
        callbackURL: '/app/networking',
        email: 'participant@example.test',
        metadata: { purpose: 'account-activation' },
      },
    });
  });

  it.each([
    ['verified', { emailVerified: true }],
    ['unknown', undefined],
  ])(
    'issues a 30-minute sign-in link for a %s account without trusting client metadata',
    async (_label, account) => {
      routeMocks.findFirst.mockResolvedValueOnce(account);

      const response = await POST(magicLinkRequest());

      expect(await response.json()).toEqual({
        handledBy: 'login',
        body: {
          callbackURL: '/app/networking',
          email: 'participant@example.test',
          metadata: { purpose: 'sign-in' },
        },
      });
    },
  );
});
