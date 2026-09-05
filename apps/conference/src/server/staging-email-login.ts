import { activationEmailSchema } from '@byzon/domain/contracts';
import { createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

export const STAGING_EMAIL_LOGIN_PATH = '/sign-in/staging-email' as const;

export const stagingEmailLogin = ({
  enabled,
}: {
  readonly enabled: boolean;
}) => {
  return {
    id: 'staging-email-login' as const,
    endpoints: {
      signInStagingEmail: createAuthEndpoint(
        STAGING_EMAIL_LOGIN_PATH,
        {
          method: 'POST',
          requireHeaders: true,
          body: z.strictObject({
            email: activationEmailSchema.transform((email) =>
              email.toLowerCase(),
            ),
          }),
        },
        async (context) => {
          context.setHeader('cache-control', 'private, no-store');
          if (!enabled) throw context.error('NOT_FOUND');

          let user = await context.context.internalAdapter
            .findUserByEmail(context.body.email)
            .then((result) => result?.user);
          if (!user) {
            throw context.error('UNAUTHORIZED', {
              message: 'Account is not available for staging sign-in.',
            });
          }

          if (!user.emailVerified) {
            const currentUser =
              await context.context.internalAdapter.findUserById(user.id);
            if (currentUser && !currentUser.emailVerified) {
              const accounts =
                await context.context.internalAdapter.findAccounts(user.id);
              for (const account of accounts) {
                if (account.providerId === 'credential') {
                  await context.context.internalAdapter.deleteAccount(
                    account.id,
                  );
                }
              }
              await context.context.internalAdapter.deleteUserSessions(user.id);
            }
            user = await context.context.internalAdapter.updateUser(user.id, {
              emailVerified: true,
            });
          }

          const session = await context.context.internalAdapter.createSession(
            user.id,
          );
          if (!session) {
            throw context.error('INTERNAL_SERVER_ERROR', {
              message: 'Could not create staging session.',
            });
          }

          await setSessionCookie(context, { session, user });
          return context.json({ status: true });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path: string) => path === STAGING_EMAIL_LOGIN_PATH,
        window: 60,
        max: 10,
      },
    ],
  };
};
