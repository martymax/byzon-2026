import { describe, expect, it } from 'vitest';

import { resolveLoginMode } from './login-mode';

describe('login mode allowlist', () => {
  it.each([
    [undefined, 'identity'],
    ['identity', 'identity'],
    ['recovery', 'recovery'],
    ['switch', 'switch'],
  ] as const)('resolves %s to %s', (value, expected) => {
    expect(resolveLoginMode(value)).toBe(expected);
  });

  it.each([
    ['unknown'],
    ['recovery&returnTo=https://attacker.example'],
    [['recovery', 'switch']],
  ])('fails closed for %j', (value) => {
    expect(resolveLoginMode(value)).toBe('identity');
  });
});
