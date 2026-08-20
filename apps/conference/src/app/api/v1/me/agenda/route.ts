import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { readParticipantAgenda } from '@/server/participant-agenda';

export const GET = (request: Request): Promise<Response> =>
  readParticipantAgenda(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
