import { auth } from '@/server/auth';
import { readActivityRoster } from '@/server/activity-roster';
import { database } from '@/server/database';

export const GET = (request: Request): Promise<Response> =>
  readActivityRoster(request, {
    db: database.db,
    getSession: (headers) => auth.api.getSession({ headers }),
  });
