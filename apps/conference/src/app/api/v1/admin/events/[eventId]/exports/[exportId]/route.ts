import { handleAdminExportDownload } from '@/server/admin-export-download';
import { auth } from '@/server/auth';
import { database } from '@/server/database';

export const GET = (
  request: Request,
  context: { params: Promise<{ eventId: string; exportId: string }> },
) =>
  context.params.then(({ eventId, exportId }) =>
    handleAdminExportDownload(request, eventId, exportId, {
      db: database.db,
      getSession: (headers) => auth.api.getSession({ headers }),
    }),
  );
