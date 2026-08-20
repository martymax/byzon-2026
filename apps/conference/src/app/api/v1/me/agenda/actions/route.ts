import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { logger } from '@/server/logger';
import { mutateParticipantAgenda } from '@/server/participant-agenda';
import { participantAgendaRateLimit } from '@/server/participant-agenda-rate-limit';

export const POST = (request: Request): Promise<Response> =>
  mutateParticipantAgenda(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
    onOperationalDrift: (drift) =>
      logger.warn(drift, 'Participant agenda operational drift'),
    rateLimit: participantAgendaRateLimit,
  });
