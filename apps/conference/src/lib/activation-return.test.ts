import { describe, expect, it } from 'vitest';

import { resolveActivationReturnTo } from './activation-return.js';

describe('activation return destination', () => {
  it.each(['/app', '/onboarding'] as const)(
    'accepts the allowlisted route %s',
    (value) => {
      expect(resolveActivationReturnTo(value)).toBe(value);
    },
  );

  it.each([
    undefined,
    'https://evil.example/app',
    '//evil.example/app',
    '\\\\evil.example\\app',
    '/app?token=secret',
    '/app#secret',
    '/%2e%2e/app',
    '%252Fapp',
    '/aktivace',
    ['/app', '/onboarding'],
  ])('falls back safely for an untrusted destination %#', (value) => {
    expect(resolveActivationReturnTo(value)).toBe('/onboarding');
  });
});
