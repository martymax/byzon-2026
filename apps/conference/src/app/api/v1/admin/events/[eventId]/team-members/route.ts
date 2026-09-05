import {
  handleAdminTeamMemberList,
  handleAdminTeamMemberMutation,
} from '@/server/admin-team-members';
import { auth, getAuthAppOrigin } from '@/server/auth';
import { database } from '@/server/database';

type Context = { params: Promise<{ eventId: string }> };

const dependencies = () => ({
  db: database.db,
  allowedOrigin: getAuthAppOrigin(),
  getSession: (headers: Headers) => auth.api.getSession({ headers }),
});

export const GET = (request: Request, context: Context) =>
  context.params.then(({ eventId }) =>
    handleAdminTeamMemberList(request, eventId, dependencies()),
  );

export const POST = (request: Request, context: Context) =>
  context.params.then(({ eventId }) =>
    handleAdminTeamMemberMutation(request, eventId, dependencies()),
  );
