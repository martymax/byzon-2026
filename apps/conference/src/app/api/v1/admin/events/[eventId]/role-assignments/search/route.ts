import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { handleAdminRolePersonSearch } from '@/server/admin-role-export';

export const POST = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  context.params.then(({ eventId }) =>
    handleAdminRolePersonSearch(request, eventId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
