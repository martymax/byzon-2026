import { readConferenceEnv } from '@byzon/config';
import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { handleAdminContentAsset } from '@/server/admin-content-assets';
import {
  consumeRateLimit,
  enforceRateLimit,
  hashRateLimitSubject,
} from '@/server/api/rate-limit';
import { rateLimitStore } from '@/server/redis';

export const runtime = 'nodejs';
const handle = (
  request: Request,
  context: {
    params: Promise<{ eventId: string; resource: string; id: string }>;
  },
) =>
  context.params.then(({ eventId, resource, id }) =>
    handleAdminContentAsset(request, eventId, resource, id, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
      async rateLimit(kind, userId, eventId) {
        const env = readConferenceEnv(process.env);
        enforceRateLimit(
          await consumeRateLimit(rateLimitStore, {
            scope: `admin_assets.${kind}`,
            limit: kind === 'read' ? 120 : 20,
            windowMs: 60_000,
            subjectHash: hashRateLimitSubject(env.RATE_LIMIT_SUBJECT_SECRET, [
              eventId,
              userId,
            ]),
          }),
        );
      },
    }),
  );
export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
