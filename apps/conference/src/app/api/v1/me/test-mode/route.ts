import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { updateTimelessTestMode } from '@/server/timeless-test-settings';

export const POST = (request: Request) =>
  updateTimelessTestMode(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
