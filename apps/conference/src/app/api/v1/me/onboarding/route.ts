import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { completeIdentityOnboarding } from '@/server/identity';

export const POST = (request: Request): Promise<Response> =>
  completeIdentityOnboarding(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
