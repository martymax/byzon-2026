import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  handledBy: [] as string[],
}));

vi.mock('better-auth/next-js', () => ({
  toNextJsHandler: (instance: { readonly kind: string }) => ({
    GET: vi.fn(),
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

import { POST } from './route';

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
