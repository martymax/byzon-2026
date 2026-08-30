import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { readParticipantOfflineLease } from '@/server/participant-offline';

export const GET = (request: Request): Promise<Response> =>
  readParticipantOfflineLease(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
