import { auth, getAuthAppOrigin } from '@/server/auth';
import { handleAdminAnnouncementPreview } from '@/server/admin-announcements';
import { database } from '@/server/database';

export const POST = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  context.params.then(({ eventId }) =>
    handleAdminAnnouncementPreview(request, eventId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
