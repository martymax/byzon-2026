import { auth } from '@/server/auth';
import { database } from '@/server/database';
import { readParticipantProgram } from '@/server/participant-program';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<Response> =>
  context.params.then(({ eventId }) =>
    readParticipantProgram(request, eventId, {
      db: database.db,
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
