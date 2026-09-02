import { readConferenceEnv } from '@byzon/config';

import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { simpleShopPreviewRateLimit } from '@/server/simpleshop-preview-rate-limit';
import { createSimpleShopTicketSourceAdapter } from '@/server/simpleshop-ticket-source';
import { applySimpleShopTicketImport } from '@/server/ticket-import-apply';

const env = readConferenceEnv(process.env);
const sourceAdapter = createSimpleShopTicketSourceAdapter({
  ...(env.SIMPLESHOP_API_EMAIL ? { email: env.SIMPLESHOP_API_EMAIL } : {}),
  ...(env.SIMPLESHOP_API_KEY ? { apiKey: env.SIMPLESHOP_API_KEY } : {}),
  ...(process.env.NODE_ENV === 'test' && env.SIMPLESHOP_API_BASE_URL
    ? {
        baseUrl: env.SIMPLESHOP_API_BASE_URL,
        allowTestBaseUrl: true,
      }
    : {}),
});

export const POST = (
  request: Request,
  context: { params: Promise<{ eventId: string }> },
): Promise<Response> =>
  context.params.then(({ eventId }) =>
    applySimpleShopTicketImport(request, eventId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
      rateLimit: simpleShopPreviewRateLimit,
      sourceAdapter,
    }),
  );
