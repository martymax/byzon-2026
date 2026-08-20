import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { mutateParticipantAgenda } from '@/server/participant-agenda';

export const POST = (request: Request): Promise<Response> =>
  mutateParticipantAgenda(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
