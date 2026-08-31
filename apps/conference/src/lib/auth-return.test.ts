import { describe, expect, it } from 'vitest';

import { resolveAuthReturnTo } from './auth-return.js';

describe('authentication return destination', () => {
  it.each([
    '/app',
    '/app/agenda',
    '/admin',
    '/admin/interakce',
    '/admin/obsah',
  ] as const)('accepts the exact protected destination %s', (value) => {
    expect(resolveAuthReturnTo(value)).toBe(value);
  });

  it.each([
    undefined,
    ['/admin', '/app'],
    'https://evil.example/admin',
    '//evil.example/admin',
    '/admin?token=secret',
    '/admin/../api/auth',
    '/admin/unknown',
  ])('falls back for an untrusted destination %#', (value) => {
    expect(resolveAuthReturnTo(value)).toBe('/app');
  });
});
