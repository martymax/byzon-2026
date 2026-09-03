import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { readConferenceEnv, type BaseEnv } from '@byzon/config';
import { schema, type Database } from '@byzon/database';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';

import { database } from './database';
import { authMailProvider, type AuthMailProvider } from './mail';
import { stagingEmailLogin } from './staging-email-login';

export const ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS = 24 * 60 * 60;
export const LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS = 30 * 60;
export const SESSION_EXPIRES_IN_SECONDS = 48 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
export const SESSION_FRESH_AGE_SECONDS = 24 * 60 * 60;

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
    },
    plugins: [
      magicLink({
        disableSignUp: true,
        expiresIn:
          options.magicLinkExpiresInSeconds ??
          LOGIN_MAGIC_LINK_EXPIRES_IN_SECONDS,
        storeToken: 'hashed',
        rateLimit: { window: 60, max: options.magicLinkRateLimitMax ?? 5 },
        sendMagicLink: ({ email, url, metadata }) => {
          const invitation =
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
          return mailProvider.sendMagicLink({ to: email, url, ...invitation });
        },
      }),
      stagingEmailLogin({ enabled: env.APP_ENV === 'staging' }),
    ],
  });
};

export const auth = createAuth(authMailProvider);
