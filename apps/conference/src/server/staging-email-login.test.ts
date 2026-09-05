import { betterAuth } from 'better-auth';
import { describe, expect, it } from 'vitest';

import { stagingEmailLogin } from './staging-email-login';

const email = 'staging-login@example.test';

const createTestAuth = (enabled: boolean) =>
  betterAuth({
    baseURL: 'http://localhost:3000',
    secret: 'staging-email-login-test-secret-with-sufficient-entropy',
    emailAndPassword: { enabled: true },
    plugins: [stagingEmailLogin({ enabled })],
  });

const signInRequest = (address: string) =>
  new Request('http://localhost:3000/api/auth/sign-in/staging-email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ email: address }),
  });

describe('staging e-mail login endpoint', () => {
  it('creates a standard session for a provisioned account', async () => {
    const auth = createTestAuth(true);
    await auth.api.signUpEmail({
      body: { email, name: 'Staging tester', password: 'test-password-123' },
    });

    const response = await auth.handler(signInRequest(email.toUpperCase()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const setCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('better-auth.session_token='));
    expect(setCookie).toBeTruthy();

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: setCookie!.split(';', 1)[0]! }),
    });
    expect(session?.user).toMatchObject({ email, emailVerified: true });
  });

  it('does not create accounts for unknown e-mails', async () => {
    const auth = createTestAuth(true);

    const response = await auth.handler(signInRequest('unknown@example.test'));

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('is unavailable when the explicit staging boundary is disabled', async () => {
    const auth = createTestAuth(false);
    await auth.api.signUpEmail({
      body: { email, name: 'Production user', password: 'test-password-123' },
    });

    const response = await auth.handler(signInRequest(email));

    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
