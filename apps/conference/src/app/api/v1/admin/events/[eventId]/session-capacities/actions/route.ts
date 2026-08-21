import { auth, getAuthAppOrigin } from '@/server/auth';
import { mutateAdminSessionCapacity } from '@/server/admin-reservations';
import { adminReservationRateLimit } from '@/server/admin-reservations-rate-limit';
import { database } from '@/server/database';

export const POST = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<Response> =>
  context.params.then(({ eventId }) =>
    mutateAdminSessionCapacity(request, eventId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
      rateLimit: adminReservationRateLimit,
    }),
  );
