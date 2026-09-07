import { readHostCapabilities } from '@/server/host-capabilities';
import { auth } from '@/server/auth';
import { database } from '@/server/database';
export const GET = (request: Request) =>
  readHostCapabilities(request, {
    db: database.db,
    getSession: (headers) => auth.api.getSession({ headers }),
  });
