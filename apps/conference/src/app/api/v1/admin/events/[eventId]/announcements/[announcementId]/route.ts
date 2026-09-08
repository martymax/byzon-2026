import { handleAdminAnnouncementDelete } from '@/server/admin-announcements';
import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';

export const DELETE = (
  request: Request,
  context: { params: Promise<{ eventId: string; announcementId: string }> },
) =>
  context.params.then(({ eventId, announcementId }) =>
    handleAdminAnnouncementDelete(request, eventId, announcementId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
