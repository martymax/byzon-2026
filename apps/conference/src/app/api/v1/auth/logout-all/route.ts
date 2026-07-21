import { auth, getAuthAppOrigin } from '@/server/auth';
import { logoutAllSessions } from '@/server/logout-all';

export const POST = (request: Request): Promise<Response> =>
  logoutAllSessions(request, auth, getAuthAppOrigin());
