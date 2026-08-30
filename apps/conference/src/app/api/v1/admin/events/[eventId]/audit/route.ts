import { handleAdminAudit } from '@/server/admin-audit';
import { auth } from '@/server/auth';
import { database } from '@/server/database';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  context.params.then(({ eventId }) =>
    handleAdminAudit(request, eventId, {
      db: database.db,
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
