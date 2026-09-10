import { describe, expect, it, vi } from 'vitest';
import {
  czechGreeting,
  createAuthEmail,
  createNotificationEmail,
  notificationPayloadSchema,
  type AuthEmailPurpose,
} from './index.js';
import {
  ResendMailTransport,
  SinkMailTransport,
  MailDeliveryUnavailableError,
} from './transport.js';

describe('Czech greetings', () => {
  it.each([
    ['Martin', 'Martine'],
    ['Jana', 'Jano'],
    ['Petr', 'Petře'],
    ['Pavel', 'Pavle'],
    ['Lucie', 'Lucie'],
    ['Jiří', 'Jiří'],
    ['Luděk', 'Luďku'],
    ['  KATEŘINA ', 'Kateřino'],
    ['S\u030ca\u0301rka', 'Šárko'],
  ])('uses the checked form of %s', (name, expected) =>
    expect(czechGreeting(name)).toBe(`Dobrý den, ${expected},`),
  );
  it.each([
    'Alex',
    'Jean-Pierre',
    'Ing. Petr Novák',
    'Jana Nováková',
    'Pavel Petr',
    '<script>',
    'Martin\nNovák',
    '__proto__',
    '',
    'a'.repeat(200),
  ])('does not guess %s', (name) =>
    expect(czechGreeting(name)).toBe('Dobrý den,'),
  );
  it('respects custom spelling and the explicit choice without a name', () => {
    expect(czechGreeting('Martin', 'Máro')).toBe('Dobrý den, Máro,');
    expect(czechGreeting('Martin', '')).toBe('Dobrý den,');
    expect(czechGreeting('Martin', '<img src=x>')).toBe('Dobrý den,');
    expect(czechGreeting('Martin', null)).toBe('Dobrý den, Martine,');
  });
});
const origin = 'https://app.example.test';
const url = `${origin}/api/auth/magic-link/verify?token=synthetic%26%22&callbackURL=%2Fadmin`;
describe('email templates', () => {
  it.each<AuthEmailPurpose>([
    'participant-invitation',
    'account-activation',
    'sign-in',
    'team-invitation',
  ])(
    'renders %s as HTML and plain text with identical action URLs',
    (purpose) => {
      const content = createAuthEmail({
        purpose,
        url,
        appOrigin: origin,
        expiresInSeconds: 1800,
        firstName: 'Pavel',
      });
      expect(content.text).toContain('Dobrý den, Pavle,');
      expect(content.text).toContain(url);
      expect(content.html).toContain(`href="${url.replaceAll('&', '&amp;')}"`);
      expect(content.html).toContain('v:roundrect');
      expect(content.html).toContain('lang="cs"');
      expect(content.html).toContain(`${origin}/brand/email/logo-light.png`);
      expect(content.text).toContain('30 minut');
      expect(content.html).toContain('returnTo=%2Fadmin');
      expect(content.text).not.toContain('<p>');
      expect(content.html.length).toBeLessThan(50_000);
    },
  );
  it('takes the TTL from the actual token policy even for a nonstandard test lifetime', () => {
    const content = createAuthEmail({
      purpose: 'account-activation',
      url,
      appOrigin: origin,
      expiresInSeconds: 7,
    });
    expect(content.text).toContain('7 sekund');
    expect(content.text).not.toContain('24 hodin');
  });
  it('rejects cross-origin, credential-bearing and script action links', () => {
    for (const unsafe of [
      'https://evil.example/link',
      'javascript:alert(1)',
      'https://name:password@app.example.test/link',
    ]) {
      expect(() =>
        createAuthEmail({
          purpose: 'sign-in',
          url: unsafe,
          appOrigin: origin,
          expiresInSeconds: 1800,
        }),
      ).toThrow();
    }
  });
  it('escapes announcement text and uses public links without auth tokens', () => {
    const p = notificationPayloadSchema.parse({
      kind: 'announcement',
      eventName: 'BYZON 2026',
      timezone: 'Europe/Prague',
      announcementId: '01940000-0000-7000-8000-000000000001',
      title: 'Změna <místa>',
      body: 'Nově <script>alert(1)</script>\nDruhý řádek.',
    });
    const content = createNotificationEmail(p, { firstName: 'Jana' }, origin);
    expect(content.html).toContain('&lt;script&gt;');
    expect(content.html).not.toContain('<script>');
    expect(content.text).toContain('Druhý řádek.');
    expect(content.text).not.toContain('token=');
    expect(content.html).toContain('/app/oznameni/01940000');
  });
  it('shows old/new Czech local times for program changes and states cancellations explicitly', () => {
    const p = notificationPayloadSchema.parse({
      kind: 'program_changed',
      eventName: 'BYZON',
      timezone: 'Europe/Prague',
      sessions: [
        {
          id: '01940000-0000-7000-8000-000000000001',
          title: 'Workshop',
          startsAt: '2026-09-18T10:00:00Z',
          endsAt: '2026-09-18T11:00:00Z',
          room: 'Sál B',
          previous: {
            startsAt: '2026-09-18T09:00:00Z',
            endsAt: '2026-09-18T10:00:00Z',
            room: 'Sál A',
          },
        },
      ],
    });
    const content = createNotificationEmail(p, {}, origin);
    expect(content.text).toContain('Původně:');
    expect(content.text).toContain('Nově:');
    expect(content.text).toContain('12:00');
    p.sessions[0]!.cancelled = true;
    expect(createNotificationEmail(p, {}, origin).text).toContain('zrušena');
  });
});

describe('transport', () => {
  it('sends only intended content with the caller-supplied stable idempotency key', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response('{}'),
    );
    const transport = new ResendMailTransport({
      apiKey: 'secret',
      from: 'BYZON <hello@example.test>',
      replyTo: 'help@example.test',
      fetch,
    });
    const message = {
      to: 'someone@example.test',
      idempotencyKey: 'event-user-transition',
      subject: 'Test',
      text: 'Text',
      html: '<p>Text</p>',
      category: 'notification' as const,
    };
    await transport.send(message);
    await transport.send(message);
    expect(fetch.mock.calls[0]![1]!.body).toEqual(
      fetch.mock.calls[1]![1]!.body,
    );
    expect(fetch.mock.calls[0]![1]!.headers).toMatchObject({
      'idempotency-key': 'event-user-transition',
    });
    expect(String(fetch.mock.calls[0]![1]!.body)).not.toContain('secret');
  });
  it('turns network/provider errors into a redacted failure and keeps sink delivery idempotent', async () => {
    const message = {
      to: 'someone@example.test',
      idempotencyKey: 'same',
      subject: 'Test',
      text: 'Text',
      html: '<p>Text</p>',
      category: 'notification' as const,
    };
    const transport = new ResendMailTransport({
      apiKey: 'secret',
      from: 'hello@example.test',
      replyTo: 'help@example.test',
      fetch: async () => {
        throw new Error('secret');
      },
    });
    await expect(transport.send(message)).rejects.toBeInstanceOf(
      MailDeliveryUnavailableError,
    );
    const sink = new SinkMailTransport();
    await sink.send(message);
    await sink.send(message);
    expect(sink.messages).toHaveLength(1);
  });
});
