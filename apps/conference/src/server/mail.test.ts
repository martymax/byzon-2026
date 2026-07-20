import { describe, expect, it } from 'vitest';

import { FakeAuthMailProvider } from './mail';

describe('fake auth mail provider', () => {
  it('captures a defensive copy of a magic link for local delivery', async () => {
    const provider = new FakeAuthMailProvider();
    const message = {
      to: 'participant@example.com',
      url: 'http://localhost:3000/api/auth/magic-link/verify?token=secret',
    };

    await provider.sendMagicLink(message);
    message.url = 'changed';

    expect(provider.messages).toEqual([
      {
        to: 'participant@example.com',
        url: 'http://localhost:3000/api/auth/magic-link/verify?token=secret',
      },
    ]);

    provider.clear();
    expect(provider.messages).toEqual([]);
  });
});
