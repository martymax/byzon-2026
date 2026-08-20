import { auth, getAuthAppOrigin } from '@/server/auth';
import { readAdminContext } from '@/server/admin-reservations';
import { adminReservationRateLimit } from '@/server/admin-reservations-rate-limit';
import { database } from '@/server/database';

export const GET = (request: Request): Promise<Response> =>
  readAdminContext(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
    rateLimit: adminReservationRateLimit,
  });
