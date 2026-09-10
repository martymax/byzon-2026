import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { writeQuestionAnswer } from '@/server/speaker-questions';
const dependencies = {
  db: database.db,
  allowedOrigin: getAuthAppOrigin(),
  getSession: (headers: Headers) => auth.api.getSession({ headers }),
};
export const PUT = (
  request: Request,
  context: { params: Promise<{ questionId: string }> },
) =>
  context.params.then(({ questionId }) =>
    writeQuestionAnswer(request, questionId, dependencies),
  );
export const PATCH = (
  request: Request,
  context: { params: Promise<{ questionId: string }> },
) =>
  context.params.then(({ questionId }) =>
    writeQuestionAnswer(request, questionId, dependencies),
  );
