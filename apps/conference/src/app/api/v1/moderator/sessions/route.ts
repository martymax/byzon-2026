import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { readModeratorSessions } from '@/server/moderator-sessions';
export const GET = (request: Request) =>
  readModeratorSessions(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
