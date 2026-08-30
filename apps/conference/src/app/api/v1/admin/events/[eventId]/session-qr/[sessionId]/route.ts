import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { handleSessionQr } from '@/server/session-qr';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string; sessionId: string }> },
) =>
  context.params.then(({ eventId, sessionId }) =>
    handleSessionQr(request, eventId, sessionId, {
      db: database.db,
      appOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
