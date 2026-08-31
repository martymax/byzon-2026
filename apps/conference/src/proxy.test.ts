import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isRetired2026Path, proxy } from './proxy';

afterEach(() => vi.unstubAllEnvs());

describe('2026 retired route boundary', () => {
  it.each([
    '/check-in',
    '/check-in/station',
    '/api/v1/check-in',
    '/api/v1/check-in/context',
  ])('hard-fails %s in production', (pathname) => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = proxy(
      new NextRequest(`https://app.byzon.test${pathname}`),
    );

    expect(isRetired2026Path(pathname)).toBe(true);
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('keeps preview routes available to local component development', () => {
    vi.stubEnv('NODE_ENV', 'test');

    const response = proxy(new NextRequest('https://app.byzon.test/check-in'));

    expect(response.status).toBe(200);
  });

  it('does not block a similarly prefixed participant route', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(isRetired2026Path('/check-information')).toBe(false);
  });
});
