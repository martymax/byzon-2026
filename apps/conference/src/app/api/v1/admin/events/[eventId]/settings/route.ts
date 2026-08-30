import { handleAdminSettings } from '@/server/admin-settings';
import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';

const handle = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  context.params.then(({ eventId }) =>
    handleAdminSettings(request, eventId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );

export const GET = handle;
export const PUT = handle;
