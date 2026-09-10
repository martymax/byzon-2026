import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';
import { readSpeakerSessions } from '@/server/speaker-questions';
const dependencies = {
  db: database.db,
  allowedOrigin: getAuthAppOrigin(),
  getSession: (headers: Headers) => auth.api.getSession({ headers }),
};
export const GET = (request: Request) =>
  readSpeakerSessions(request, dependencies);
