import { handleAdminParticipantInvite } from '@/server/admin-support';
import { adminSupportRateLimit } from '@/server/admin-support-rate-limit';
import { auth, createAuth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { authMailProvider } from '@/server/mail';

type Context = {
  params: Promise<{ eventId: string; participantId: string }>;
};

const participantInvitationAuth = createAuth(
  authMailProvider,
  database.db,
  process.env,
  { magicLinkRateLimitMax: 30 },
);

export const POST = (request: Request, context: Context) =>
  context.params.then(({ eventId, participantId }) =>
    handleAdminParticipantInvite(request, eventId, participantId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
      rateLimit: adminSupportRateLimit,
      sendParticipantInvitation: async ({ email, recipientName }) => {
        await participantInvitationAuth.api.signInMagicLink({
          headers: new Headers({ origin: getAuthAppOrigin() }),
          body: {
            email,
            callbackURL: '/app',
            errorCallbackURL: '/prihlaseni?returnTo=%2Fapp',
            metadata: {
              purpose: 'participant-invitation',
              recipientName,
            },
          },
        });
      },
    }),
  );
