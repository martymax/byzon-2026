import { handleAdminSupportMutation } from '@/server/admin-support';
import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';

export const POST = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  context.params.then(({ eventId }) =>
    handleAdminSupportMutation(request, eventId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
