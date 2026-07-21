import { auth, getAuthAppOrigin } from '@/server/auth';
import { handleAdminPublication } from '@/server/admin-publication';
import { database } from '@/server/database';
const handle = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  context.params.then(({ eventId }) =>
    handleAdminPublication(request, eventId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
export const GET = handle;
export const POST = handle;
