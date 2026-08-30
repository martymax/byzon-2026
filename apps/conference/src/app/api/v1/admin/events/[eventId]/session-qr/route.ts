import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { handleSessionQr } from '@/server/session-qr';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) =>
  context.params.then(({ eventId }) =>
    handleSessionQr(request, eventId, undefined, {
      db: database.db,
      appOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
