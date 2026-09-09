import { createHash } from 'node:crypto';
import { readConferenceEnv } from '@byzon/config';
import {
  createAuthEmail,
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS,
  type AuthEmailPurpose,
} from '@byzon/mail';
import {
  MailDeliveryUnavailableError,
  ResendMailTransport,
  MailpitMailTransport,
  type MailTransport,
  type ResendMailOptions,
  type MailpitMailOptions,
} from '@byzon/mail/transport';

export { MailDeliveryUnavailableError };
export interface MagicLinkMessage {
  to: string;
  url: string;
  purpose?: AuthEmailPurpose;
  /** Legacy display name is intentionally not parsed into a first name. */
  recipientName?: string;
  firstName?: string | null;
  emailSalutation?: string | null;
  expiresInSeconds?: number;
}
export interface AuthMailProvider {
  sendMagicLink(message: MagicLinkMessage): Promise<void>;
}
export class FakeAuthMailProvider implements AuthMailProvider {
  readonly messages: MagicLinkMessage[] = [];
  async sendMagicLink(message: MagicLinkMessage): Promise<void> {
    this.messages.push({ ...message });
  }
  clear(): void {
    this.messages.length = 0;
  }
}
export class UnconfiguredAuthMailProvider implements AuthMailProvider {
  async sendMagicLink(): Promise<void> {
    throw new MailDeliveryUnavailableError();
  }
}
export type ResendAuthMailProviderOptions = ResendMailOptions;
export type MailpitAuthMailProviderOptions = MailpitMailOptions;
const send = (
  transport: MailTransport,
  message: MagicLinkMessage,
  appOrigin?: string,
): Promise<void> => {
  const purpose = message.purpose ?? 'sign-in';
  const content = createAuthEmail({
    purpose,
    url: message.url,
    appOrigin: appOrigin ?? new URL(message.url).origin,
    expiresInSeconds:
      message.expiresInSeconds ??
      (purpose === 'sign-in'
        ? LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS
        : ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS),
    firstName: message.firstName ?? null,
    emailSalutation: message.emailSalutation ?? null,
  });
  return transport.send({
    ...content,
    to: message.to,
    category: 'auth',
    idempotencyKey: `byzon-magic-link-${createHash('sha256').update(message.url).digest('hex')}`,
  });
};
export class ResendAuthMailProvider implements AuthMailProvider {
  private readonly transport: MailTransport;
  constructor(
    options: ResendAuthMailProviderOptions,
    private readonly appOrigin?: string,
  ) {
    this.transport = new ResendMailTransport(options);
  }
  sendMagicLink(message: MagicLinkMessage): Promise<void> {
    return send(this.transport, message, this.appOrigin);
  }
}
export class MailpitAuthMailProvider implements AuthMailProvider {
  private readonly transport: MailTransport;
  constructor(
    options: MailpitAuthMailProviderOptions,
    private readonly appOrigin?: string,
  ) {
    this.transport = new MailpitMailTransport(options);
  }
  sendMagicLink(message: MagicLinkMessage): Promise<void> {
    return send(this.transport, message, this.appOrigin);
  }
}
export const createAuthMailProvider = (
  environment: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): AuthMailProvider => {
  const env = readConferenceEnv(environment);
  if (env.MAIL_PROVIDER === 'resend')
    return new ResendAuthMailProvider(
      {
        apiKey: env.MAIL_API_KEY!,
        fetch,
        from: env.MAIL_FROM!,
        replyTo: env.MAIL_REPLY_TO!,
      },
      env.APP_BASE_URL,
    );
  if (env.MAIL_PROVIDER === 'mailpit')
    return new MailpitAuthMailProvider(
      {
        apiUrl: env.MAILPIT_API_URL!,
        username: env.MAILPIT_API_USERNAME!,
        password: env.MAILPIT_API_PASSWORD!,
        fetch,
        from: env.MAIL_FROM!,
        replyTo: env.MAIL_REPLY_TO!,
      },
      env.APP_BASE_URL,
    );
  if (env.APP_ENV === 'development' || env.APP_ENV === 'test')
    return new FakeAuthMailProvider();
  return new UnconfiguredAuthMailProvider();
};
export const authMailProvider = createAuthMailProvider();
