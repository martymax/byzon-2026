import { describe, expect, it, vi } from 'vitest';
import { confirmMagicLink } from './magic-link-confirmation';

const origin = 'https://app.example.test';
const submit = (body: BodyInit) =>
  new Request(`${origin}/api/auth/magic-link/verify`, {
    method: 'POST',
    headers: { origin },
    body,
  });

describe('magic-link confirmation', () => {
  it('preserves all verification fields, caller cookies, IP and response cookies', async () => {
    const fields = {
      token: 'secret',
      callbackURL: '/app/networking',
      errorCallbackURL: '/prihlaseni?mode=recovery',
      newUserCallbackURL: '/onboarding',
    };
    const request = submit(new URLSearchParams(fields));
    request.headers.set('cookie', 'existing=value');
    request.headers.set('x-real-ip', '192.0.2.1');
    const verify = vi.fn(async (input: Request) => {
      expect(input.method).toBe('GET');
      expect(Object.fromEntries(new URL(input.url).searchParams)).toEqual(
        fields,
      );
      expect(input.headers.get('cookie')).toBe('existing=value');
      expect(input.headers.get('x-real-ip')).toBe('192.0.2.1');
      expect(input.headers.has('content-type')).toBe(false);
      const headers = new Headers({ location: '/app/networking' });
      headers.append('set-cookie', 'session=abc; HttpOnly');
      headers.append('set-cookie', 'other=xyz; HttpOnly');
      return new Response(null, { status: 302, headers });
    });
    const response = await confirmMagicLink(request, origin, verify);
    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie()).toEqual([
      'session=abc; HttpOnly',
      'other=xyz; HttpOnly',
    ]);
  });

  it('sends missing tokens to recovery without calling verification', async () => {
    const verify = vi.fn();
    const response = await confirmMagicLink(
      submit(new URLSearchParams()),
      origin,
      verify,
    );
    expect(response.headers.get('location')).toContain(
      '/prihlaseni?error=INVALID_TOKEN',
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects non-form requests without calling verification', async () => {
    const verify = vi.fn();
    const response = await confirmMagicLink(
      submit('{"token":"secret"}'),
      origin,
      verify,
    );
    expect(response.status).toBe(415);
    expect(verify).not.toHaveBeenCalled();
  });
});
