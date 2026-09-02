import { handleAdminTeamInvitation } from '@/server/admin-team-members';
import {
  ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
  auth,
  createAuth,
  getAuthAppOrigin,
} from '@/server/auth';
import { database } from '@/server/database';
import { authMailProvider } from '@/server/mail';

type Context = {
  params: Promise<{ eventId: string; memberId: string }>;
};

const teamInvitationAuth = createAuth(
  authMailProvider,
  database.db,
  process.env,
  {
    magicLinkExpiresInSeconds: ACTIVATION_MAGIC_LINK_EXPIRES_IN_SECONDS,
    magicLinkRateLimitMax: 30,
  },
);

export const POST = (request: Request, context: Context) =>
  context.params.then(({ eventId, memberId }) =>
    handleAdminTeamInvitation(request, eventId, memberId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
      sendTeamInvitation: async ({ email, recipientName }) => {
        await teamInvitationAuth.api.signInMagicLink({
          headers: new Headers({ origin: getAuthAppOrigin() }),
          body: {
            email,
            callbackURL: '/admin',
            errorCallbackURL: '/prihlaseni?returnTo=%2Fadmin',
            metadata: {
              purpose: 'team-invitation',
              recipientName,
            },
          },
        });
      },
    }),
  );
