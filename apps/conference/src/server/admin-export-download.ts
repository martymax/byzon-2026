import { schema, writeAuditLog, type Database } from '@byzon/database';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuidSchema = z.string().uuid();

export const handleAdminExportDownload = async (
  request: Request,
  eventId: string,
  exportId: string,
  dependencies: {
    db: Database;
    getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
    now?: () => Date;
  },
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (
      request.method !== 'GET' ||
      !uuidSchema.safeParse(eventId).success ||
      !uuidSchema.safeParse(exportId).success
    ) {
      throw new ApiProblemError({
        status: 404,
        code: 'ADMIN_RESOURCE_NOT_FOUND',
        title: 'Export not found',
        detail: 'The export is unavailable.',
      });
    }
    const identity = await dependencies.getSession(request.headers);
    if (!identity) {
      throw new ApiProblemError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Authentication required',
        detail: 'A valid session is required.',
      });
    }
    try {
      await requireEventPermission(
        dependencies.db,
        { userId: identity.user.id },
        eventId,
        'personal-data:operational:export',
        { auditedException: true },
      );
    } catch (error) {
      if (!(error instanceof EventAccessDeniedError)) throw error;
      throw new ApiProblemError({
        status: 403,
        code: 'EVENT_ACCESS_DENIED',
        title: 'Event access denied',
        detail: 'The export is unavailable.',
      });
    }
    const row = await dependencies.db.query.operationalExportRequests.findFirst(
      {
        where: and(
          eq(schema.operationalExportRequests.eventId, eventId),
          eq(schema.operationalExportRequests.id, exportId),
        ),
      },
    );
    const now = dependencies.now?.() ?? new Date();
    if (!row || row.expiresAt <= now) {
      if (row && row.state !== 'expired') {
        await dependencies.db
          .update(schema.operationalExportRequests)
          .set({
            state: 'expired',
            content: null,
            contentType: null,
            checksumSha256: null,
            updatedAt: now,
          })
          .where(eq(schema.operationalExportRequests.id, row.id));
      }
      throw new ApiProblemError({
        status: 404,
        code: 'ADMIN_RESOURCE_NOT_FOUND',
        title: 'Export not found',
        detail: 'The export is unavailable or expired.',
      });
    }
    if (
      row.state !== 'ready' ||
      !row.content ||
      !row.contentType ||
      !row.checksumSha256
    ) {
      throw new ApiProblemError({
        status: 409,
        code: 'EXPORT_UNAVAILABLE',
        title: 'Export not ready',
        detail: 'The export is still being generated.',
      });
    }
    await writeAuditLog(dependencies.db, {
      eventId,
      actorId: identity.user.id,
      actorType: 'user',
      action: 'export.download',
      targetType: 'operational_export',
      targetId: exportId,
      requestId,
      reason: 'authorized_download',
      after: { report: row.report, format: row.format },
    });
    return new Response(row.content, {
      headers: {
        'cache-control': 'private, no-store',
        'content-type': row.contentType,
        'content-disposition': `attachment; filename="byzon-${row.report}-${exportId}.${row.format}"`,
        digest: `sha-256=${Buffer.from(row.checksumSha256, 'hex').toString('base64')}`,
        vary: 'Authorization, Cookie',
        'x-content-type-options': 'nosniff',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    const response = problemResponse(error, requestId);
    response.headers.set('cache-control', 'private, no-store');
    response.headers.set('vary', 'Authorization, Cookie');
    return response;
  }
};
