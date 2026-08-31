import { createHash } from 'node:crypto';

import { readConferenceEnv } from '@byzon/config';

export interface MagicLinkMessage {
  to: string;
  url: string;
}

export interface AuthMailProvider {
  sendMagicLink(message: MagicLinkMessage): Promise<void>;
}

/** Development adapter only. A real provider replaces this before production. */
export class FakeAuthMailProvider implements AuthMailProvider {
  readonly messages: MagicLinkMessage[] = [];

  async sendMagicLink(message: MagicLinkMessage): Promise<void> {
    this.messages.push({ ...message });
  }

  clear(): void {
    this.messages.length = 0;
  }
}

export class MailDeliveryUnavailableError extends Error {
  constructor() {
    super('Transactional mail delivery is unavailable.');
    this.name = 'MailDeliveryUnavailableError';
  }
}

export class UnconfiguredAuthMailProvider implements AuthMailProvider {
  async sendMagicLink(): Promise<void> {
    throw new MailDeliveryUnavailableError();
  }
}

export interface ResendAuthMailProviderOptions {
  readonly apiKey: string;
  readonly from: string;
  readonly replyTo: string;
  readonly fetch?: typeof globalThis.fetch;
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export class ResendAuthMailProvider implements AuthMailProvider {
  readonly #apiKey: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #from: string;
  readonly #replyTo: string;

  constructor(options: ResendAuthMailProviderOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#from = options.from;
    this.#replyTo = options.replyTo;
  }

  async sendMagicLink(message: MagicLinkMessage): Promise<void> {
    const idempotencyKey = `byzon-magic-link-${createHash('sha256')
      .update(message.url)
      .digest('hex')}`;
    const safeUrl = escapeHtml(message.url);
    let response: Response;
    try {
      response = await this.#fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'user-agent': 'byzon-conference/2026',
        },
        body: JSON.stringify({
          from: this.#from,
          to: [message.to],
          reply_to: this.#replyTo,
          subject: 'Přihlášení do aplikace BYZON 2026',
          text: `Přihlaste se jednorázovým odkazem:\n\n${message.url}\n\nOdkaz platí 5 minut a lze jej použít pouze jednou. Pokud jste o přihlášení nežádali, e-mail ignorujte.`,
          html: `<p>Přihlaste se do aplikace BYZON 2026:</p><p><a href="${safeUrl}">Otevřít bezpečné přihlášení</a></p><p>Odkaz platí 5 minut a lze jej použít pouze jednou. Pokud jste o přihlášení nežádali, e-mail ignorujte.</p>`,
        }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new MailDeliveryUnavailableError();
    }
    if (!response.ok) throw new MailDeliveryUnavailableError();
  }
}

export const createAuthMailProvider = (
  environment: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): AuthMailProvider => {
  const env = readConferenceEnv(environment);
  if (env.MAIL_PROVIDER === 'resend') {
    return new ResendAuthMailProvider({
      apiKey: env.MAIL_API_KEY!,
      fetch,
      from: env.MAIL_FROM!,
      replyTo: env.MAIL_REPLY_TO!,
    });
  }
  if (
    env.MAIL_PROVIDER === 'sink' ||
    (env.APP_ENV !== 'staging' && env.APP_ENV !== 'production')
  ) {
    return new FakeAuthMailProvider();
  }
  return new UnconfiguredAuthMailProvider();
};

export const authMailProvider = createAuthMailProvider();
