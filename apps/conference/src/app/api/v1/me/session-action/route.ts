import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { performIdentitySessionAction } from '@/server/identity';

export const POST = (request: Request): Promise<Response> =>
  performIdentitySessionAction(request, {
    auth,
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
