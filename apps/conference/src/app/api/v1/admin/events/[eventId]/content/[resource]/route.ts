import { auth, getAuthAppOrigin } from '@/server/auth';
import { handleAdminContent } from '@/server/admin-content';
import { database } from '@/server/database';
const handle = (
  request: Request,
  context: { params: Promise<{ eventId: string; resource: string }> },
) =>
  context.params.then(({ eventId, resource }) =>
    handleAdminContent(request, eventId, resource, null, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
export const GET = handle;
export const POST = handle;
