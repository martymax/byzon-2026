import { auth, getAuthAppOrigin } from '@/server/auth';
import { handleAdminAnnouncementDrafts } from '@/server/admin-announcements';
import { database } from '@/server/database';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string; draftId: string }> },
) =>
  context.params.then(({ eventId, draftId }) =>
    handleAdminAnnouncementDrafts(
      request,
      eventId,
      {
        db: database.db,
        allowedOrigin: getAuthAppOrigin(),
        getSession: (headers) => auth.api.getSession({ headers }),
      },
      draftId,
    ),
  );
