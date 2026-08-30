import { auth } from '@/server/auth';
import { database } from '@/server/database';
import { handleParticipantAnnouncement } from '@/server/participant-announcements';

export const GET = (request: Request) =>
  handleParticipantAnnouncement(request, 'inbox', {
    db: database.db,
    getSession: (headers) => auth.api.getSession({ headers }),
  });
