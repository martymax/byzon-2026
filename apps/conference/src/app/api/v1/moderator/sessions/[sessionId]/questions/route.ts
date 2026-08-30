import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { readModeratorQuestions } from '@/server/questions';

export const GET = (
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> =>
  context.params.then(({ sessionId }) =>
    readModeratorQuestions(request, sessionId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
