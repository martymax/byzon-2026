import { auth } from '@/server/auth';
import { database } from '@/server/database';
import { readParticipantContent } from '@/server/participant-content';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<Response> =>
  context.params.then(({ eventId }) =>
    readParticipantContent(request, eventId, {
      db: database.db,
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
