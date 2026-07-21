import { desc, eq } from 'drizzle-orm';
import { schema, type Database } from '@byzon/database';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuid = z.string().uuid();
const status = z.enum(['draft', 'published', 'archived']);
const safeExternalUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value));
export const participantContentSchema = z.object({
  event: z.object({
    id: uuid,
    slug: z.string(),
    name: z.string(),
    timezone: z.string(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
  }),
  speakers: z.array(
    z.object({
      id: uuid,
      slug: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      company: z.string().nullable(),
      jobTitle: z.string().nullable(),
      bioMarkdown: z.string().nullable(),
      linkedinUrl: safeExternalUrl.nullable(),
      websiteUrl: safeExternalUrl.nullable(),
      photoAssetId: uuid.nullable(),
      status,
      sortOrder: z.number().int(),
      version: z.number().int().positive(),
    }),
  ),
  partners: z.array(
    z.object({
      id: uuid,
      slug: z.string(),
      name: z.string(),
      descriptionMarkdown: z.string().nullable(),
      websiteUrl: safeExternalUrl.nullable(),
      category: z.string().nullable(),
      tier: z.string().nullable(),
      logoAssetId: uuid.nullable(),
      status,
      sortOrder: z.number().int(),
      version: z.number().int().positive(),
    }),
  ),
  venues: z.array(
    z.object({
      id: uuid,
      slug: z.string(),
      name: z.string(),
      addressLine1: z.string().nullable(),
      addressLine2: z.string().nullable(),
      city: z.string().nullable(),
      postalCode: z.string().nullable(),
      countryCode: z.string().nullable(),
      mapQuery: z.string().nullable(),
      navigationMarkdown: z.string().nullable(),
      accessibilityMarkdown: z.string().nullable(),
      status,
      sortOrder: z.number().int(),
      version: z.number().int().positive(),
    }),
  ),
  practical: z.object({
    pages: z.array(
      z.object({
        id: uuid,
        slug: z.string(),
        kind: z.enum(['practical', 'marketing', 'other']),
        title: z.string(),
        summary: z.string().nullable(),
        bodyMarkdown: z.string(),
        status,
        sortOrder: z.number().int(),
        version: z.number().int().positive(),
      }),
    ),
    faqs: z.array(
      z.object({
        id: uuid,
        category: z.string().nullable(),
        question: z.string(),
        answerMarkdown: z.string(),
        status,
        sortOrder: z.number().int(),
        version: z.number().int().positive(),
      }),
    ),
  }),
});

export type ParticipantContent = z.infer<typeof participantContentSchema>;

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
      publication && participantContentSchema.safeParse(publication.snapshot);
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
          'cache-control': 'private, max-age=0, must-revalidate',
          vary: 'Cookie, Authorization',
          'x-request-id': requestId,
        },
      });
    return Response.json(
      {
        eventId,
        version: publication.version,
        content: parsed.data,
      },
      {
        headers: {
          etag,
          'cache-control': 'private, max-age=0, must-revalidate',
          vary: 'Cookie, Authorization',
          'x-request-id': requestId,
        },
      },
    );
  } catch (error) {
    return problemResponse(error, requestId);
  }
};
