import { auth, getAuthAppOrigin } from '@/server/auth';
import { handleAdminContent } from '@/server/admin-content';
import { database } from '@/server/database';
const handle = (
  request: Request,
  context: {
    params: Promise<{ eventId: string; resource: string; id: string }>;
  },
) =>
  context.params.then(({ eventId, resource, id }) =>
    handleAdminContent(request, eventId, resource, id, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
export const PATCH = handle;
export const DELETE = handle;
