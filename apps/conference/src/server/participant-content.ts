import { schema, type Database } from '@byzon/database';
import {
  contentCachePolicy,
  participantContentResponseSchema,
  publishedContentSnapshotSchema,
} from '@byzon/domain/contracts';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuid = z.string().uuid();

export const readParticipantContent = async (
  request: Request,
  eventId: string,
  dependencies: {
    db: Database;
    getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  },
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (!uuid.safeParse(eventId).success)
      throw new ApiProblemError({
        status: 400,
        code: 'INVALID_EVENT_ID',
        title: 'Invalid event identifier',
        detail: 'The event identifier is invalid.',
      });
    const session = await dependencies.getSession(request.headers);
    if (!session)
      throw new ApiProblemError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Authentication required',
        detail: 'A valid session is required to read event content.',
      });
    try {
      await requireEventPermission(
        dependencies.db,
        { userId: session.user.id },
        eventId,
        'program:published:read',
      );
    } catch (error) {
      if (!(error instanceof EventAccessDeniedError)) throw error;
      throw new ApiProblemError({
        status: 404,
        code: 'CONTENT_NOT_FOUND',
        title: 'Content not found',
        detail: 'Published event content is not available.',
      });
    }
    const publication =
      await dependencies.db.query.contentPublications.findFirst({
        where: eq(schema.contentPublications.eventId, eventId),
        orderBy: [desc(schema.contentPublications.version)],
        columns: { version: true, snapshot: true, checksumSha256: true },
      });
    const parsed =
      publication &&
      publishedContentSnapshotSchema.safeParse(publication.snapshot);
    if (!publication || !parsed || !parsed.success)
      throw new ApiProblemError({
        status: 404,
        code: 'CONTENT_NOT_FOUND',
        title: 'Content not found',
        detail: 'Published event content is not available.',
      });
    const etag = `"${publication.checksumSha256}-${publication.version}"`;
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, {
        status: 304,
        headers: {
          etag,
          'cache-control': contentCachePolicy.participant.cacheControl,
          vary: 'Cookie, Authorization',
          'x-request-id': requestId,
        },
      });
    const body = participantContentResponseSchema.parse({
      eventId,
      version: publication.version,
      content: parsed.data,
    });
    return Response.json(body, {
      headers: {
        etag,
        'cache-control': contentCachePolicy.participant.cacheControl,
        vary: 'Cookie, Authorization',
        'x-request-id': requestId,
      },
    });
  } catch (error) {
    return problemResponse(error, requestId);
  }
};
