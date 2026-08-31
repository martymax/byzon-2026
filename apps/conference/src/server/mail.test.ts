import { describe, expect, it, vi } from 'vitest';

import {
  createAuthMailProvider,
  FakeAuthMailProvider,
  MailDeliveryUnavailableError,
  ResendAuthMailProvider,
  UnconfiguredAuthMailProvider,
} from './mail';

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

describe('production auth mail provider', () => {
  const productionEnvironment = {
    NODE_ENV: 'production',
    APP_ENV: 'production',
    APP_BASE_URL: 'https://app.byzon.cz',
    PUBLIC_SITE_URL: 'https://byzon.cz',
    DATABASE_URL: 'postgresql://example.invalid/byzon',
    REDIS_URL: 'redis://redis.internal:6379',
    BETTER_AUTH_SECRET: 'production-test-secret-at-least-32-characters',
    RATE_LIMIT_SUBJECT_SECRET:
      'production-rate-limit-secret-at-least-32-characters',
  } as const;

  it('fails closed when delivery is not configured', async () => {
    const provider = createAuthMailProvider(productionEnvironment, vi.fn());
    expect(provider).toBeInstanceOf(UnconfiguredAuthMailProvider);
    await expect(
      provider.sendMagicLink({
        to: 'admin@example.test',
        url: 'https://app.byzon.cz/api/auth/magic-link/verify?token=secret',
      }),
    ).rejects.toBeInstanceOf(MailDeliveryUnavailableError);
  });

  it('sends a bounded Resend request without exposing the API key in content', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response('{"id":"mail-id"}')),
    );
    const provider = new ResendAuthMailProvider({
      apiKey: 're_secret',
      fetch,
      from: 'BYZON <login@app.byzon.cz>',
      replyTo: 'podpora@byzon.cz',
    });
    const url =
      'https://app.byzon.cz/api/auth/magic-link/verify?token=synthetic&callbackURL=%2Fadmin';

    await provider.sendMagicLink({ to: 'admin@example.test', url });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [endpoint, request] = fetch.mock.calls[0]!;
    expect(endpoint).toBe('https://api.resend.com/emails');
    expect(request?.headers).toMatchObject({
      authorization: 'Bearer re_secret',
      'user-agent': 'byzon-conference/2026',
    });
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      from: 'BYZON <login@app.byzon.cz>',
      reply_to: 'podpora@byzon.cz',
      to: ['admin@example.test'],
    });
    expect(body.text).toContain(url);
    expect(body.html).toContain('callbackURL=%2Fadmin');
    expect(JSON.stringify(body)).not.toContain('re_secret');
  });
});
