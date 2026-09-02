import { auth, getAuthAppOrigin } from '@/server/auth';
import { handleAdminAnnouncementTargets } from '@/server/admin-announcements';
import { database } from '@/server/database';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  context.params.then(({ eventId }) =>
    handleAdminAnnouncementTargets(request, eventId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
