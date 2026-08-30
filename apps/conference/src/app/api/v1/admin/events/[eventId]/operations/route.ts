import { auth } from '@/server/auth';
import { database } from '@/server/database';
import { handleAdminOperations } from '@/server/admin-operations';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  context.params.then(({ eventId }) =>
    handleAdminOperations(request, eventId, {
      db: database.db,
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
