import { handleAdminEmail } from '@/server/admin-email';
import { auth } from '@/server/auth';
import { database } from '@/server/database';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string; messageId: string }> },
) =>
  context.params.then(({ eventId, messageId }) =>
    handleAdminEmail(
      request,
      eventId,
      {
        db: database.db,
        getSession: (headers) => auth.api.getSession({ headers }),
      },
      messageId,
    ),
  );
