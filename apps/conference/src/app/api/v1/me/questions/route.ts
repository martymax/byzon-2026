import { readOwnQuestions } from '@/server/own-questions';
import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
export const GET = async (request: Request) => {
  return readOwnQuestions(request, {
    db: database.db,
    allowedOrigin: getAuthAppOrigin(),
    getSession: (headers) => auth.api.getSession({ headers }),
  });
};
