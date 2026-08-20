import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { readIdentityBootstrap } from '@/server/identity';

export const GET = (request: Request): Promise<Response> =>
  readIdentityBootstrap(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
