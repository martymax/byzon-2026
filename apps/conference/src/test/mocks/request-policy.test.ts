import { describe, expect, it } from 'vitest';

import { shouldBlockUnhandledMockRequest } from './request-policy';

describe('development mock request policy', () => {
  const origin = 'http://127.0.0.1:3000';

  it.each([
    ['/api/v1/unhandled', true],
    ['/api/auth/sign-in/magic-link', true],
    ['/app/program?_rsc=synthetic', false],
    ['/_next/static/chunk.js', false],
    ['https://example.test/api/v1/public', false],
  ])('classifies %s without blocking Next navigation', (url, expected) => {
    expect(shouldBlockUnhandledMockRequest(url, origin)).toBe(expected);
  });

  it('fails closed for malformed request or origin input', () => {
    expect(shouldBlockUnhandledMockRequest('http://[invalid', origin)).toBe(
      true,
    );
    expect(
      shouldBlockUnhandledMockRequest('/api/v1/test', 'not-an-origin'),
    ).toBe(true);
  });
});
