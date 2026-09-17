import { createHash } from 'node:crypto';
import { sendRecordedEmail, type Database } from '@byzon/database';
import {
  createAuthEmail,
  createLoginCodeEmail,
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS,
} from '@byzon/mail';
import {
  MailDeliveryUnavailableError,
  type AuthMailProvider,
  type LoginCodeMessage,
  type MagicLinkMessage,
} from './mail';

export const sendRecordedLoginCodeEmail = (
  db: Database,
  provider: AuthMailProvider,
  message: LoginCodeMessage,
  context: {
    eventId: string;
    userId: string;
    appOrigin: string;
    sender: string | null;
  },
) =>
  sendRecordedEmail(
    db,
    {
      eventId: context.eventId,
      userId: context.userId,
      deduplicationKey: `login-code:${crypto.randomUUID()}`,
      kind: 'sign-in',
      recipient: message.to,
      sender: context.sender,
      ...createLoginCodeEmail({
        code: '[jednorázový kód skryt]',
        appOrigin: context.appOrigin,
        expiresInSeconds: message.expiresInSeconds,
      }),
    },
    () => {
      if (!provider.sendLoginCode) throw new MailDeliveryUnavailableError();
      return provider.sendLoginCode(message);
    },
  );

/** Render with a harmless placeholder so no bearer token ever reaches the archive. */
export const archivedAuthContent = (
  message: MagicLinkMessage,
  appOrigin: string,
) =>
  createAuthEmail({
    purpose: message.purpose ?? 'sign-in',
    ...(message.roles ? { roles: message.roles } : {}),
    url: `${appOrigin}/prihlaseni#jednorazovy-odkaz-skryt`,
    appOrigin,
    expiresInSeconds:
      message.expiresInSeconds ??
      (!message.purpose || message.purpose === 'sign-in'
        ? LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS
        : ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS),
    firstName: message.firstName ?? null,
    emailSalutation: message.emailSalutation ?? null,
  });

export const sendRecordedAuthEmail = (
  db: Database,
  provider: AuthMailProvider,
  message: MagicLinkMessage,
  context: {
    eventId: string;
    userId: string;
    appOrigin: string;
    sender: string | null;
  },
) =>
  sendRecordedEmail(
    db,
    {
      eventId: context.eventId,
      userId: context.userId,
      deduplicationKey: `auth:${createHash('sha256').update(message.url).digest('hex')}`,
      kind: message.purpose ?? 'sign-in',
      recipient: message.to,
      sender: context.sender,
      ...archivedAuthContent(message, context.appOrigin),
    },
    () => provider.sendMagicLink(message),
  );
