import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { readConferenceEnv } from '@byzon/config';
import { schema, type Database } from '@byzon/database';
import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';

import { database } from './database';
import { authMailProvider, type AuthMailProvider } from './mail';

export const MAGIC_LINK_EXPIRES_IN_SECONDS = 5 * 60;

export const createAuth = (
  mailProvider: AuthMailProvider,
  db: Database = database.db,
  environment: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
) => {
  const env = readConferenceEnv(environment);
  const appOrigin = new URL(env.APP_BASE_URL).origin;

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
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
        storeToken: 'hashed',
        rateLimit: { window: 60, max: 5 },
        sendMagicLink: ({ email, url }) =>
          mailProvider.sendMagicLink({ to: email, url }),
      }),
    ],
  });
};

export const auth = createAuth(authMailProvider);
