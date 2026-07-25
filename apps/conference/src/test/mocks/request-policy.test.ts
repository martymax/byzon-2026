import { describe, expect, it } from 'vitest';

import {
  blockUnhandledMockApiRequest,
  shouldBlockUnhandledMockRequest,
} from './request-policy';

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

  it('blocks without exposing query secrets or request payloads', () => {
    expect(() =>
      blockUnhandledMockApiRequest(
        'POST',
        'http://127.0.0.1:3000/api/v1/private?token=do-not-log',
      ),
    ).toThrowError('Mock API request blocked: POST /api/**');

    try {
      blockUnhandledMockApiRequest(
        'POST',
        'http://127.0.0.1:3000/api/v1/private/path-secret?token=do-not-log',
      );
    } catch (error) {
      expect(String(error)).not.toContain('do-not-log');
      expect(String(error)).not.toContain('path-secret');
    }
  });
});
