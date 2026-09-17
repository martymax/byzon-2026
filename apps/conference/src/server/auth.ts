import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { readConferenceEnv, type BaseEnv } from '@byzon/config';
import { schema, type Database } from '@byzon/database';
import {
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS,
} from '@byzon/mail';
import { and, eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { emailOTP, magicLink } from 'better-auth/plugins';

import { database } from './database';
import {
  authMailProvider,
  MailDeliveryUnavailableError,
  type AuthMailProvider,
  type MagicLinkMessage,
} from './mail';
import { stagingEmailLogin } from './staging-email-login';
import {
  sendRecordedAuthEmail,
  sendRecordedLoginCodeEmail,
} from './mail-history';
import { loadEventPolicy } from './policy';

export {
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS,
};
export const SESSION_EXPIRES_IN_SECONDS = 48 * 60 * 60;
// Browser refreshes are throttled to five minutes and GET reads never renew.
// Every successful POST also repairs cookies left behind by older deployments.
export const SESSION_UPDATE_AGE_SECONDS = 0;
export const SESSION_FRESH_AGE_SECONDS = 24 * 60 * 60;
export const LOGIN_CODE_EXPIRES_IN_SECONDS = 10 * 60;

export const magicLinkPurposeForAccount = (
  emailVerified: boolean | undefined,
): 'account-activation' | 'sign-in' =>
  emailVerified === false ? 'account-activation' : 'sign-in';

export const authIpAddressHeadersFor = (
  appEnvironment: BaseEnv['APP_ENV'],
): string[] | undefined =>
  appEnvironment === 'staging' || appEnvironment === 'production'
    ? ['x-real-ip']
    : undefined;

export const getAuthAppOrigin = (
  environment: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
): string => new URL(readConferenceEnv(environment).APP_BASE_URL).origin;

export const createAuth = (
  mailProvider: AuthMailProvider,
  db: Database = database.db,
  environment: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
  options: {
    readonly magicLinkExpiresInSeconds?: number;
    readonly magicLinkRateLimitMax?: number;
  } = {},
) => {
  const env = readConferenceEnv(environment);
  const appOrigin = getAuthAppOrigin(environment);
  const ipAddressHeaders = authIpAddressHeadersFor(env.APP_ENV);
  const loginCode = emailOTP({
    disableSignUp: true,
    storeOTP: 'hashed',
    expiresIn: LOGIN_CODE_EXPIRES_IN_SECONDS,
    allowedAttempts: 3,
    async sendVerificationOTP({ email, otp, type }) {
      if (type !== 'sign-in' || !mailProvider.sendLoginCode)
        throw new MailDeliveryUnavailableError();
      const message = {
        to: email,
        code: otp,
        expiresInSeconds: LOGIN_CODE_EXPIRES_IN_SECONDS,
      };
      const [profile] = await db
        .select({ eventId: schema.events.id, userId: schema.users.id })
        .from(schema.events)
        .innerJoin(schema.users, eq(schema.users.email, email))
        .where(eq(schema.events.slug, 'byzon-2026'))
        .limit(1);
      if (!profile) return mailProvider.sendLoginCode(message);
      return sendRecordedLoginCodeEmail(db, mailProvider, message, {
        ...profile,
        appOrigin,
        sender: env.MAIL_FROM_NAME
          ? `${env.MAIL_FROM_NAME} <${env.MAIL_FROM}>`
          : (env.MAIL_FROM ?? null),
      });
    },
  });

  return betterAuth({
    appName: 'BYZON 2026',
    baseURL: appOrigin,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [appOrigin],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      useSecureCookies: env.NODE_ENV === 'production',
      ...(ipAddressHeaders ? { ipAddress: { ipAddressHeaders } } : undefined),
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      freshAge: SESSION_FRESH_AGE_SECONDS,
      // Server-side reads cannot reliably forward Set-Cookie to the browser.
      // Refresh through a browser POST so the DB and cookie advance together.
      deferSessionRefresh: true,
    },
    plugins: [
      // Expose only passwordless sign-in, not the plugin's password reset or
      // e-mail change endpoints. Identity ownership remains with Better Auth.
      {
        ...loginCode,
        endpoints: {
          sendVerificationOTP: loginCode.endpoints.sendVerificationOTP,
          signInEmailOTP: loginCode.endpoints.signInEmailOTP,
        },
      },
      magicLink({
        disableSignUp: true,
        expiresIn:
          options.magicLinkExpiresInSeconds ??
          LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS,
        storeToken: 'hashed',
        rateLimit: { window: 60, max: options.magicLinkRateLimitMax ?? 5 },
        sendMagicLink: async ({ email, url, metadata }) => {
          const invitation: Pick<
            MagicLinkMessage,
            'purpose' | 'recipientName'
          > =
            metadata?.purpose === 'account-activation' ||
            metadata?.purpose === 'participant-invitation' ||
            metadata?.purpose === 'team-invitation'
              ? {
                  purpose: metadata.purpose,
                  ...(typeof metadata.recipientName === 'string'
                    ? { recipientName: metadata.recipientName.slice(0, 257) }
                    : {}),
                }
              : {};
          // Public auth requests have their metadata replaced by the API route.
          // Names/preferences always come from the server; never from user input.
          const eventId =
            typeof metadata?.eventId === 'string' &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              metadata.eventId,
            )
              ? metadata.eventId
              : undefined;
          const [profile] = await db
            .select({
              eventId: schema.events.id,
              userId: schema.users.id,
              firstName: schema.participantProfiles.firstName,
              emailSalutation: schema.participantProfiles.emailSalutation,
            })
            .from(schema.events)
            .innerJoin(schema.users, eq(schema.users.email, email))
            .leftJoin(
              schema.participantProfiles,
              and(
                eq(schema.users.id, schema.participantProfiles.userId),
                eq(schema.events.id, schema.participantProfiles.eventId),
              ),
            )
            .where(
              and(
                eq(schema.users.email, email),
                eventId
                  ? eq(schema.events.id, eventId)
                  : eq(schema.events.slug, 'byzon-2026'),
              ),
            )
            .limit(1);
          const policy =
            profile && invitation.purpose
              ? await loadEventPolicy(
                  db,
                  { userId: profile.userId },
                  profile.eventId,
                )
              : null;
          const message = {
            to: email,
            url,
            ...invitation,
            ...(policy ? { roles: policy.roles } : {}),
            firstName: profile?.firstName ?? null,
            emailSalutation: profile?.emailSalutation ?? null,
            expiresInSeconds:
              options.magicLinkExpiresInSeconds ??
              LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS,
          };
          if (!profile) return mailProvider.sendMagicLink(message);
          return sendRecordedAuthEmail(db, mailProvider, message, {
            eventId: profile.eventId,
            userId: profile.userId,
            appOrigin: env.APP_BASE_URL,
            sender: env.MAIL_FROM_NAME
              ? `${env.MAIL_FROM_NAME} <${env.MAIL_FROM}>`
              : (env.MAIL_FROM ?? null),
          });
        },
      }),
      stagingEmailLogin({ enabled: env.APP_ENV === 'staging' }),
    ],
  });
};

export const auth = createAuth(authMailProvider);
