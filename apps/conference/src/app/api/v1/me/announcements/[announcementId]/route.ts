import { auth } from '@/server/auth';
import { database } from '@/server/database';
import { handleParticipantAnnouncement } from '@/server/participant-announcements';

export const GET = (
  request: Request,
  context: { params: Promise<{ announcementId: string }> },
) =>
  context.params.then(({ announcementId }) =>
    handleParticipantAnnouncement(
      request,
      { detailId: announcementId },
      {
        db: database.db,
        getSession: (headers) => auth.api.getSession({ headers }),
      },
    ),
  );
