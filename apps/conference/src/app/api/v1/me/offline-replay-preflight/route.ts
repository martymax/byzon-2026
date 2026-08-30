import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { preflightParticipantOfflineReplay } from '@/server/participant-offline';

export const POST = (request: Request): Promise<Response> =>
  preflightParticipantOfflineReplay(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
