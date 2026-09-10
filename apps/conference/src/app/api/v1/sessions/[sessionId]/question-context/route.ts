import { readQuestionContext } from '@/server/own-questions';
import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
export const GET = async (
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) => {
  const { sessionId } = await context.params;
  return readQuestionContext(request, sessionId, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
};
