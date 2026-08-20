import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { createIdentityPrivacyRequest } from '@/server/identity';

export const POST = (request: Request): Promise<Response> =>
  createIdentityPrivacyRequest(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
