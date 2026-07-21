import { describe, expect, it, vi } from 'vitest';

import { logoutAllSessions } from './logout-all';

const request = (): Request =>
  new Request('http://localhost:3000/api/v1/auth/logout-all', {
    method: 'POST',
    headers: {
      cookie: 'better-auth.session_token=signed-token',
      origin: 'http://localhost:3000',
      'x-request-id': 'logout-failure-test',
    },
  });

describe('logout all sessions', () => {
  it.each([
    ['returns an error response', () => new Response(null, { status: 500 })],
    ['throws', () => Promise.reject(new Error('sign-out unavailable'))],
  ])(
    'does not start revocation when cookie clearance %s',
    async (_, signOutResult) => {
      const handler = vi.fn((authRequest: Request) => {
        expect(new URL(authRequest.url).pathname).toBe('/api/auth/sign-out');
        expect(authRequest.headers.has('cookie')).toBe(false);
        return Promise.resolve(signOutResult());
      });

      const response = await logoutAllSessions(
        request(),
        { handler },
        'http://localhost:3000',
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        code: 'AUTH_SESSION_REVOCATION_FAILED',
        requestId: 'logout-failure-test',
      });
      expect(handler).toHaveBeenCalledOnce();
    },
  );

  it('returns Better Auth cookie clearance only after successful revocation', async () => {
    const handler = vi.fn(async (authRequest: Request) => {
      const path = new URL(authRequest.url).pathname;
      if (path === '/api/auth/sign-out') {
        return new Response(null, {
          status: 200,
          headers: {
            'set-cookie':
              '__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
          },
        });
      }

      expect(path).toBe('/api/auth/revoke-sessions');
      expect(authRequest.headers.get('cookie')).toBe(
        'better-auth.session_token=signed-token',
      );
      return new Response(null, { status: 200 });
    });

    const response = await logoutAllSessions(
      request(),
      { handler },
      'http://localhost:3000',
    );

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
      '__Secure-better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
