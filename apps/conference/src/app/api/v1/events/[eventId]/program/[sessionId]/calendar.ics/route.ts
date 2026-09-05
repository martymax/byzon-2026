import { auth } from '@/server/auth';
import { database } from '@/server/database';
import { readParticipantProgramSessionCalendar } from '@/server/participant-program';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string; sessionId: string }> },
): Promise<Response> =>
  context.params.then(({ eventId, sessionId }) =>
    readParticipantProgramSessionCalendar(request, eventId, sessionId, {
      db: database.db,
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
