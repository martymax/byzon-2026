import { createHash } from 'node:crypto';
import { sendRecordedEmail, type Database } from '@byzon/database';
import {
  createAuthEmail,
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS,
} from '@byzon/mail';
import type { AuthMailProvider, MagicLinkMessage } from './mail';

/** Render with a harmless placeholder so no bearer token ever reaches the archive. */
export const archivedAuthContent = (
  message: MagicLinkMessage,
  appOrigin: string,
) =>
  createAuthEmail({
    purpose: message.purpose ?? 'sign-in',
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
