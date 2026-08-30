import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { handleRatings } from '@/server/questions';

const dependencies = {
  db: database.db,
  allowedOrigin: getAuthAppOrigin(),
  getSession: (headers: Headers) => auth.api.getSession({ headers }),
};

export const GET = (request: Request): Promise<Response> =>
  handleRatings(request, dependencies);
export const POST = (request: Request): Promise<Response> =>
  handleRatings(request, dependencies);
