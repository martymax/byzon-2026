import type { Database } from '@byzon/database';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import {
  ContentPublicationError,
  previewContentPublication,
  publishContent,
} from './content-publication';
import { EventAccessDeniedError, requireEventPermission } from './policy';

export const handleAdminPublication = async (
  request: Request,
  eventId: string,
  dependencies: {
    db: Database;
    allowedOrigin: string;
    getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  },
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (!z.string().uuid().safeParse(eventId).success)
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
        detail: 'A valid session is required.',
      });
    try {
      await requireEventPermission(
        dependencies.db,
        { userId: session.user.id },
        eventId,
        'program:manage',
      );
    } catch (error) {
      if (!(error instanceof EventAccessDeniedError)) throw error;
      throw new ApiProblemError({
        status: 404,
        code: 'CONTENT_NOT_FOUND',
        title: 'Content not found',
        detail: 'The content resource is not available.',
      });
    }
    if (request.method === 'GET') {
      const preview = await previewContentPublication(dependencies.db, eventId);
      return Response.json(
        { ...preview, createdAt: new Date().toISOString(), requestId },
        { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
      );
    }
    if (request.method !== 'POST')
      throw new ApiProblemError({
        status: 405,
        code: 'METHOD_NOT_ALLOWED',
        title: 'Method not allowed',
        detail: 'The method is not supported.',
      });
    if (request.headers.get('origin') !== dependencies.allowedOrigin)
      throw new ApiProblemError({
        status: 403,
        code: 'ORIGIN_REJECTED',
        title: 'Request rejected',
        detail: 'The request origin is not allowed.',
      });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiProblemError({
        status: 400,
        code: 'INVALID_JSON',
        title: 'Invalid JSON',
        detail: 'The request body must contain valid JSON.',
      });
    }
    const parsed = z
      .object({
        expectedPreviousVersion: z.number().int().nonnegative(),
        expectedChecksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
      })
      .safeParse(body);
    if (!parsed.success)
      throw new ApiProblemError({
        status: 400,
        code: 'INVALID_PUBLISH_REQUEST',
        title: 'Invalid publish request',
        detail: 'The expected previous version is required.',
      });
    const publication = await publishContent(dependencies.db, {
      eventId,
      actorId: session.user.id,
      requestId,
      expectedPreviousVersion: parsed.data.expectedPreviousVersion,
      expectedChecksumSha256: parsed.data.expectedChecksumSha256,
    });
    return Response.json(
      {
        version: publication.version,
        checksumSha256: publication.checksumSha256,
        publishedAt: publication.publishedAt,
        requestId,
      },
      {
        status: 201,
        headers: { 'cache-control': 'no-store', 'x-request-id': requestId },
      },
    );
  } catch (error) {
    if (error instanceof ContentPublicationError) {
      const stale =
        error.code === 'STALE_VERSION' || error.code === 'STALE_DRAFT';
      const noChanges = error.code === 'NO_CHANGES';
      return problemResponse(
        new ApiProblemError({
          status: stale ? 409 : 422,
          code: stale
            ? error.code === 'STALE_DRAFT'
              ? 'STALE_PUBLICATION_PREVIEW'
              : 'STALE_PUBLICATION_VERSION'
            : noChanges
              ? 'NO_CONTENT_CHANGES'
              : 'CONTENT_NOT_PUBLISHABLE',
          title: stale
            ? 'Publication changed'
            : noChanges
              ? 'No content changes'
              : 'Content is not publishable',
          detail: stale
            ? error.code === 'STALE_DRAFT'
              ? 'The draft changed after the preview was created.'
              : 'A newer publication already exists.'
            : noChanges
              ? 'The current draft is identical to the latest publication.'
              : 'The draft does not satisfy publication requirements.',
          ...(error.issues.length
            ? { fieldErrors: { content: error.issues } }
            : {}),
        }),
        requestId,
      );
    }
    return problemResponse(error, requestId);
  }
};
