import { auth, getAuthAppOrigin } from '@/server/auth';
import { readAdminReservations } from '@/server/admin-reservations';
import { adminReservationRateLimit } from '@/server/admin-reservations-rate-limit';
import { database } from '@/server/database';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<Response> =>
  context.params.then(({ eventId }) =>
    readAdminReservations(request, eventId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
      rateLimit: adminReservationRateLimit,
    }),
  );
