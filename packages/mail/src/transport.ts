import type { EmailContent } from './contract.js';

export interface DeliveryMessage extends EmailContent {
  to: string;
  idempotencyKey: string;
  category: 'auth' | 'notification';
}
export interface MailTransport {
  send(message: DeliveryMessage): Promise<void>;
}
export class MailDeliveryUnavailableError extends Error {
  constructor() {
    super('Transactional mail delivery is unavailable.');
    this.name = 'MailDeliveryUnavailableError';
  }
}
export interface ResendMailOptions {
  apiKey: string;
  from: string;
  replyTo: string;
  fetch?: typeof globalThis.fetch;
}
export interface MailpitMailOptions {
  apiUrl: string;
  username: string;
  password: string;
  from: string;
  replyTo: string;
  fetch?: typeof globalThis.fetch;
}
export class ResendMailTransport implements MailTransport {
  constructor(private readonly options: ResendMailOptions) {}
  async send(message: DeliveryMessage): Promise<void> {
    let response: Response;
    try {
      response = await (this.options.fetch ?? globalThis.fetch)(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${this.options.apiKey}`,
            'content-type': 'application/json',
            'idempotency-key': message.idempotencyKey,
            'user-agent': 'byzon-conference/2026',
          },
          body: JSON.stringify({
            from: this.options.from,
            to: [message.to],
            reply_to: this.options.replyTo,
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          signal: AbortSignal.timeout(8_000),
        },
      );
    } catch {
      throw new MailDeliveryUnavailableError();
    }
    if (!response.ok) throw new MailDeliveryUnavailableError();
  }
}
export class MailpitMailTransport implements MailTransport {
  constructor(private readonly options: MailpitMailOptions) {}
  async send(message: DeliveryMessage): Promise<void> {
    let response: Response;
    try {
      response = await (this.options.fetch ?? globalThis.fetch)(
        `${this.options.apiUrl.replace(/\/+$/, '')}/api/v1/send`,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Basic ${Buffer.from(`${this.options.username}:${this.options.password}`, 'utf8').toString('base64')}`,
            'content-type': 'application/json',
            'user-agent': 'byzon-conference/2026',
          },
          body: JSON.stringify({
            From: { Email: this.options.from, Name: 'BYZON' },
            To: [{ Email: message.to }],
            ReplyTo: [{ Email: this.options.replyTo }],
            Subject: message.subject,
            Text: message.text,
            HTML: message.html,
            Headers: { 'X-BYZON-Idempotency-Key': message.idempotencyKey },
            Tags: [message.category, 'staging'],
          }),
          signal: AbortSignal.timeout(8_000),
        },
      );
    } catch {
      throw new MailDeliveryUnavailableError();
    }
    if (!response.ok) throw new MailDeliveryUnavailableError();
  }
}
export class SinkMailTransport implements MailTransport {
  readonly messages: DeliveryMessage[] = [];
  async send(message: DeliveryMessage): Promise<void> {
    if (!this.messages.some((m) => m.idempotencyKey === message.idempotencyKey))
      this.messages.push({ ...message });
  }
}
export class UnconfiguredMailTransport implements MailTransport {
  async send(): Promise<void> {
    throw new MailDeliveryUnavailableError();
  }
}
export interface MailConfiguration {
  APP_ENV: string;
  MAIL_PROVIDER?: string | undefined;
  MAIL_API_KEY?: string | undefined;
  MAIL_FROM?: string | undefined;
  MAIL_REPLY_TO?: string | undefined;
  MAILPIT_API_URL?: string | undefined;
  MAILPIT_API_USERNAME?: string | undefined;
  MAILPIT_API_PASSWORD?: string | undefined;
}
/** Input is validated by the application's/worker's configuration reader. */
export const createMailTransport = (
  config: MailConfiguration,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): MailTransport => {
  if (
    config.MAIL_PROVIDER === 'resend' &&
    config.MAIL_API_KEY &&
    config.MAIL_FROM &&
    config.MAIL_REPLY_TO
  )
    return new ResendMailTransport({
      apiKey: config.MAIL_API_KEY,
      from: config.MAIL_FROM,
      replyTo: config.MAIL_REPLY_TO,
      fetch,
    });
  if (
    config.MAIL_PROVIDER === 'mailpit' &&
    config.APP_ENV === 'staging' &&
    config.MAILPIT_API_URL &&
    config.MAILPIT_API_USERNAME &&
    config.MAILPIT_API_PASSWORD &&
    config.MAIL_FROM &&
    config.MAIL_REPLY_TO
  )
    return new MailpitMailTransport({
      apiUrl: config.MAILPIT_API_URL,
      username: config.MAILPIT_API_USERNAME,
      password: config.MAILPIT_API_PASSWORD,
      from: config.MAIL_FROM,
      replyTo: config.MAIL_REPLY_TO,
      fetch,
    });
  if (config.APP_ENV === 'development' || config.APP_ENV === 'test')
    return new SinkMailTransport();
  return new UnconfiguredMailTransport();
};
