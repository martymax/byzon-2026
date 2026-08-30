import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { moderateNetworkingProfile } from '@/server/networking';

export const PATCH = (
  request: Request,
  context: { params: Promise<{ eventId: string; profileId: string }> },
): Promise<Response> =>
  context.params.then(({ eventId, profileId }) =>
    moderateNetworkingProfile(request, eventId, profileId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
