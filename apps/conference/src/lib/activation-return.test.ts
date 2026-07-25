import { describe, expect, it } from 'vitest';

import { resolveActivationReturnTo } from './activation-return.js';
import { createMockRecoveryLinkToken } from './mock-recovery-link.js';

describe('activation return destination', () => {
  it.each([
    '/app',
    '/onboarding',
    '/app/informace',
    '/app/oznameni?view=unread',
    '/app/program/550e8400-e29b-41d4-a716-446655440000',
    '/app/oznameni/01910000-0000-7000-8000-000000000011',
    '/app/recnici/jana-novakova',
  ] as const)('accepts the allowlisted route %s', (value) => {
    expect(resolveActivationReturnTo(value)).toBe(value);
  });

  it.each([
    undefined,
    'https://evil.example/app',
    '//evil.example/app',
    '\\\\evil.example\\app',
    '/app?token=secret',
    '/app/oznameni?view=unread&next=%2Fapp',
    '/app#secret',
    '/app/program/../profil',
    '/app/program/%2Fprofil',
    '/app/program/%252Fprofil',
    '/app/recnici/Jana-Novakova',
    '/%2e%2e/app',
    '%252Fapp',
    '/aktivace',
    ['/app', '/onboarding'],
  ])('falls back safely for an untrusted destination %#', (value) => {
    expect(resolveActivationReturnTo(value)).toBe('/onboarding');
  });

  it('allows the recovery caller to choose the safe app fallback', () => {
    expect(resolveActivationReturnTo(undefined, '/app')).toBe('/app');
    expect(resolveActivationReturnTo(['/app', '/onboarding'], '/app')).toBe(
      '/app',
    );
    expect(resolveActivationReturnTo('https://evil.example/app', '/app')).toBe(
      '/app',
    );
  });

  it('encodes a validated detail route into a canonical mock recovery token', () => {
    expect(
      createMockRecoveryLinkToken(
        '/app/program/550e8400-e29b-41d4-a716-446655440000',
        '00000000-0000-4000-8000-000000000001',
      ),
    ).toBe(
      'recovery-route:L2FwcC9wcm9ncmFtLzU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMA:00000000-0000-4000-8000-000000000001',
    );
    expect(
      createMockRecoveryLinkToken(
        '/app',
        '00000000-0000-4000-8000-000000000002',
      ),
    ).toBe('recovery-app:00000000-0000-4000-8000-000000000002');
  });

  it('refuses to encode an uncontracted mock recovery destination', () => {
    expect(() =>
      createMockRecoveryLinkToken(
        'https://evil.example/app' as '/app',
        '00000000-0000-4000-8000-000000000003',
      ),
    ).toThrow();
  });
});
