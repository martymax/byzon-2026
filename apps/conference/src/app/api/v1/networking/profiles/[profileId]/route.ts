import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { readNetworkingProfile } from '@/server/networking';

export const GET = (
  request: Request,
  context: { params: Promise<{ profileId: string }> },
): Promise<Response> =>
  context.params.then(({ profileId }) =>
    readNetworkingProfile(request, profileId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
