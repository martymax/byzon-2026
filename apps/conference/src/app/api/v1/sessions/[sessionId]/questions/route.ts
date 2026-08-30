import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { submitQuestion } from '@/server/questions';
import { questionsRateLimit } from '@/server/questions-rate-limit';

export const POST = (
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
): Promise<Response> =>
  context.params.then(({ sessionId }) =>
    submitQuestion(request, sessionId, {
      db: database.db,
      allowedOrigin: getAuthAppOrigin(),
      getSession: (headers) => auth.api.getSession({ headers }),
      rateLimit: questionsRateLimit,
    }),
  );
