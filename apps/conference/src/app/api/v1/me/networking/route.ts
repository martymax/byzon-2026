import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { handleNetworkingSettings } from '@/server/networking';

const dependencies = {
  db: database.db,
  allowedOrigin: getAuthAppOrigin(),
  getSession: (headers: Headers) => auth.api.getSession({ headers }),
};

export const GET = (request: Request): Promise<Response> =>
  handleNetworkingSettings(request, dependencies);
export const PATCH = (request: Request): Promise<Response> =>
  handleNetworkingSettings(request, dependencies);
