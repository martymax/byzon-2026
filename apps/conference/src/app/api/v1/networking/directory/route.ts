import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { readNetworkingDirectory } from '@/server/networking';

export const GET = (request: Request): Promise<Response> =>
  readNetworkingDirectory(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
