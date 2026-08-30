import { schema } from '@byzon/database';
import { eq, sql } from 'drizzle-orm';

import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { logoutAllSessions } from '@/server/logout-all';

export const POST = (request: Request): Promise<Response> =>
  logoutAllSessions(request, auth, getAuthAppOrigin(), async (headers) => {
    const session = await auth.api.getSession({ headers });
    if (!session) return;
    await database.db
      .update(schema.eventMemberships)
      .set({ offlineRevocationEpoch: sql`gen_random_uuid()` })
      .where(eq(schema.eventMemberships.userId, session.user.id));
  });
