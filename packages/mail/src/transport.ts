import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
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
  fromName?: string | undefined;
  replyTo: string;
  fetch?: typeof globalThis.fetch;
}
export interface MailpitMailOptions {
  apiUrl: string;
  username: string;
  password: string;
  from: string;
  fromName?: string | undefined;
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
            from: this.options.fromName
              ? `${JSON.stringify(this.options.fromName)} <${this.options.from}>`
              : this.options.from,
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
            From: {
              Email: this.options.from,
              Name: this.options.fromName ?? 'BYZON',
            },
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
export interface SmtpMailOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  fromName?: string | undefined;
  replyTo: string;
}
export class SmtpMailTransport implements MailTransport {
  constructor(private readonly options: SmtpMailOptions) {}
  async send(message: DeliveryMessage): Promise<void> {
    const transport = nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.port === 465,
      requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      auth: { user: this.options.username, pass: this.options.password },
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 8_000,
      dnsTimeout: 8_000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    // Bound the whole send below the worker's 60-second delivery lease.
    const timeout = setTimeout(() => transport.close(), 30_000);
    try {
      const result = await transport.sendMail({
        from: this.options.fromName
          ? { name: this.options.fromName, address: this.options.from }
          : this.options.from,
        replyTo: this.options.replyTo,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        messageId: `<${createHash('sha256').update(message.idempotencyKey).digest('hex')}@byzon.cz>`,
      });
      if (!result.accepted.length || result.rejected.length)
        throw new MailDeliveryUnavailableError();
    } catch {
      // Provider errors may contain credentials, recipients or message content.
      throw new MailDeliveryUnavailableError();
    } finally {
      clearTimeout(timeout);
      transport.close();
    }
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
  SMTP_HOST?: string | undefined;
  SMTP_PORT?: number | undefined;
  SMTP_USERNAME?: string | undefined;
  SMTP_PASSWORD?: string | undefined;
  MAIL_FROM?: string | undefined;
  MAIL_FROM_NAME?: string | undefined;
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
  if (config.MAIL_PROVIDER === 'smtp') {
    if (
      !config.SMTP_HOST ||
      ![465, 587].includes(config.SMTP_PORT ?? 0) ||
      !config.SMTP_USERNAME ||
      !config.SMTP_PASSWORD ||
      !config.MAIL_FROM ||
      !config.MAIL_REPLY_TO
    )
      return new UnconfiguredMailTransport();
    return new SmtpMailTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT!,
      username: config.SMTP_USERNAME,
      password: config.SMTP_PASSWORD,
      from: config.MAIL_FROM,
      fromName: config.MAIL_FROM_NAME,
      replyTo: config.MAIL_REPLY_TO,
    });
  }
  if (
    config.MAIL_PROVIDER === 'resend' &&
    config.MAIL_API_KEY &&
    config.MAIL_FROM &&
    config.MAIL_REPLY_TO
  )
    return new ResendMailTransport({
      apiKey: config.MAIL_API_KEY,
      from: config.MAIL_FROM,
      fromName: config.MAIL_FROM_NAME,
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
      fromName: config.MAIL_FROM_NAME,
      replyTo: config.MAIL_REPLY_TO,
      fetch,
    });
  if (config.APP_ENV === 'development' || config.APP_ENV === 'test')
    return new SinkMailTransport();
  return new UnconfiguredMailTransport();
};
