import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isRetired2026Path, proxy } from './proxy';
const enforce = vi.hoisted(() => vi.fn());
vi.mock('./server/onboarding-access-runtime', () => ({
  enforceRequestOnboarding: enforce,
}));
beforeEach(() => enforce.mockReset().mockResolvedValue(null));

afterEach(() => vi.unstubAllEnvs());

describe('2026 retired route boundary', () => {
  it.each([
    '/check-in',
    '/check-in/station',
    '/api/v1/check-in',
    '/api/v1/check-in/context',
  ])('hard-fails %s in production', async (pathname) => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await proxy(
      new NextRequest(`https://app.byzon.test${pathname}`),
    );

    expect(isRetired2026Path(pathname)).toBe(true);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('keeps preview routes available to local component development', async () => {
    vi.stubEnv('NODE_ENV', 'test');

    const response = await proxy(
      new NextRequest('https://app.byzon.test/check-in'),
    );

    expect(response.status).toBe(200);
  });

  it('does not block a similarly prefixed participant route', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(isRetired2026Path('/check-information')).toBe(false);
  });
});

describe('onboarding request boundary', () => {
  it.each([
    '/app',
    '/app/program/123',
    '/admin',
    '/host/dotazy',
    '/moderator/123',
    '/api/v1/me/agenda',
    '/api/v1/admin/context',
  ])('checks authenticated access to %s before serving it', async (path) => {
    vi.stubEnv('NODE_ENV', 'production');
    const blocked = new Response(null, { status: 403 });
    enforce.mockResolvedValue(blocked);
    const request = new NextRequest(`https://app.byzon.test${path}`, {
      headers: { cookie: 'session=synthetic' },
    });
    expect(await proxy(request)).toBe(blocked);
    expect(enforce).toHaveBeenCalledWith(request);
  });
  it.each([
    '/onboarding',
    '/app/soukromi',
    '/app/nastaveni',
    '/api/v1/me/bootstrap',
    '/api/v1/me/onboarding',
    '/api/v1/me/session-action',
    '/api/v1/me/privacy-requests',
    '/api/auth/sign-out',
    '/health/ready',
    '/api/v1/public/events/byzon-2026/content',
  ])('keeps recovery and public route %s available', async (path) => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = await proxy(
      new NextRequest(`https://app.byzon.test${path}`, {
        headers: { cookie: 'session=synthetic' },
      }),
    );
    expect(response.status).toBe(200);
    expect(enforce).not.toHaveBeenCalled();
  });
  it('does not trust a preview flag in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_BYZON_API_MOCKS', 'enabled');
    await proxy(
      new NextRequest('https://app.byzon.test/app', {
        headers: { cookie: 'session=synthetic' },
      }),
    );
    expect(enforce).toHaveBeenCalledOnce();
  });
});
