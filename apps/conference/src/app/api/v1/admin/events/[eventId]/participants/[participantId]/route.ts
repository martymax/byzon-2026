import {
  handleAdminParticipantDetail,
  handleAdminParticipantUpdate,
} from '@/server/admin-support';
import { adminSupportRateLimit } from '@/server/admin-support-rate-limit';
import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';

type Context = {
  params: Promise<{ eventId: string; participantId: string }>;
};

const dependencies = () => ({
  db: database.db,
  allowedOrigin: getAuthAppOrigin(),
  getSession: (headers: Headers) => auth.api.getSession({ headers }),
  rateLimit: adminSupportRateLimit,
});

export const GET = (request: Request, context: Context) =>
  context.params.then(({ eventId, participantId }) =>
    handleAdminParticipantDetail(
      request,
      eventId,
      participantId,
      dependencies(),
    ),
  );

export const PATCH = (request: Request, context: Context) =>
  context.params.then(({ eventId, participantId }) =>
    handleAdminParticipantUpdate(
      request,
      eventId,
      participantId,
      dependencies(),
    ),
  );
