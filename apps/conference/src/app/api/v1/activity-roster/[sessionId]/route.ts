import { auth } from '@/server/auth';
import { readActivityRoster } from '@/server/activity-roster';
import { database } from '@/server/database';

export const GET = (
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> =>
  context.params.then(({ sessionId }) =>
    readActivityRoster(
      request,
      {
        db: database.db,
        getSession: (headers) => auth.api.getSession({ headers }),
      },
      sessionId,
    ),
  );
