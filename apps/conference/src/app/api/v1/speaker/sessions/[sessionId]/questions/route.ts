import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { readSpeakerQuestions } from '@/server/speaker-questions';
const dependencies = {
  db: database.db,
  allowedOrigin: getAuthAppOrigin(),
  getSession: (headers: Headers) => auth.api.getSession({ headers }),
};
export const GET = (
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) =>
  context.params.then(({ sessionId }) =>
    readSpeakerQuestions(request, sessionId, dependencies),
  );
