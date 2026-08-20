import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { updateIdentityProfile } from '@/server/identity';

export const PATCH = (request: Request): Promise<Response> =>
  updateIdentityProfile(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
