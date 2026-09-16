import { handleAdminInvitationRecipients } from '@/server/admin-invitations';
import { auth } from '@/server/auth';
import { database } from '@/server/database';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  context.params.then(({ eventId }) =>
    handleAdminInvitationRecipients(request, eventId, {
      db: database.db,
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
