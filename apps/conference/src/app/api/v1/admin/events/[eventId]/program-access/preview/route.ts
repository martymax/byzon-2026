import { handleProgramAccess } from '@/server/admin-program-access';
import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
export const POST = async (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) => {
  const { eventId } = await context.params;
  return handleProgramAccess(request, eventId, 'preview', {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
};
