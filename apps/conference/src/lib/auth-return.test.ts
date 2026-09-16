import { describe, expect, it } from 'vitest';

import { resolveAuthReturnTo } from './auth-return.js';

describe('authentication return destination', () => {
  it.each([
    '/app',
    '/app/agenda',
    '/app/program/550e8400-e29b-41d4-a716-446655440000?coaching=choose',
    '/app/program/550e8400-e29b-41d4-a716-446655440000?from=agenda&coaching=choose',
    '/app/dotazy',
    '/host/aktivity',
    '/host/moderace',
    '/host/dotazy',
    '/app/interakce/20000000-0000-4000-8000-000000000001',
    '/host/moderace/20000000-0000-4000-8000-000000000001',
    '/host/dotazy/20000000-0000-4000-8000-000000000001',
    '/app/networking',
    '/app/networking/20000000-0000-4000-8000-000000000001',
    '/admin',
    '/admin/interakce',
    '/admin/obsah',
    '/po-prihlaseni',
  ] as const)('accepts the exact protected destination %s', (value) => {
    expect(resolveAuthReturnTo(value)).toBe(value);
  });

  it.each([
    undefined,
    ['/admin', '/app'],
    '/app/program/550e8400-e29b-41d4-a716-446655440000?coaching=other',
    '/app/program/550e8400-e29b-41d4-a716-446655440000?coaching=choose&next=%2Fapp',
    '/app/program/550e8400-e29b-41d4-a716-446655440000?coaching=choose&coaching=choose',
    '/app/hodnoceni/550e8400-e29b-41d4-a716-446655440000?coaching=choose',
    'https://evil.example/admin',
    '//evil.example/admin',
    '/admin?token=secret',
    '/admin/../api/auth',
    '/admin/unknown',
    '/host/dotazy/../../api/auth',
    '/app/interakce/not-a-uuid',
    '/host/moderace?next=https://evil.example',
  ])('falls back for an untrusted destination %#', (value) => {
    expect(resolveAuthReturnTo(value)).toBe('/app');
  });
});
