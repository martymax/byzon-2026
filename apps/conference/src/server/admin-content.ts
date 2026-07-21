import { and, asc, eq } from 'drizzle-orm';
import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  withTransaction,
  type Database,
} from '@byzon/database';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';
import {
  ContentValidationError,
  validateContentMutation,
} from './content-validation';

const uuid = z.string().uuid();
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(128);
const text = z.string().trim().min(1).max(10_000);
const nullableText = z.string().trim().max(10_000).nullable().optional();
const sortOrder = z.number().int().nonnegative();
const version = z.number().int().positive();
const status = z.enum(['draft', 'published', 'archived']).optional();
const safeExternalUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value))
  .nullable()
  .optional();
const instant = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const adminContentResources = [
  'days',
  'venues',
  'rooms',
  'sessions',
  'speakers',
  'partners',
  'pages',
  'faqs',
] as const;
export type AdminContentResource = (typeof adminContentResources)[number];

const schemas = {
  days: z.object({
    localDate: z.string().date(),
    title: text,
    description: nullableText,
    sortOrder,
  }),
  venues: z.object({
    slug,
    name: text,
    mapQuery: nullableText,
    navigationMarkdown: nullableText,
    sortOrder,
    status,
  }),
  rooms: z.object({
    venueId: uuid,
    slug,
    name: text,
    description: nullableText,
    capacity: z.number().int().positive().nullable().optional(),
    sortOrder,
    status,
  }),
  sessions: z.object({
    dayId: uuid,
    roomId: uuid.nullable().optional(),
    slug,
    title: text,
    summary: nullableText,
    description: nullableText,
    type: z.enum([
      'talk',
      'panel',
      'workshop',
      'mastermind',
      'coaching',
      'networking',
      'break',
      'meal',
      'gala',
      'other',
    ]),
    startsAt: instant,
    endsAt: instant,
    sortOrder,
    status: z.enum(['draft', 'published', 'cancelled', 'archived']).optional(),
    speakerIds: z.array(uuid).max(50).optional(),
  }),
  speakers: z.object({
    slug,
    firstName: text,
    lastName: text,
    company: nullableText,
    jobTitle: nullableText,
    bioMarkdown: nullableText,
    linkedinUrl: safeExternalUrl,
    websiteUrl: safeExternalUrl,
    sortOrder,
    status,
  }),
  partners: z.object({
    slug,
    name: text,
    descriptionMarkdown: nullableText,
    websiteUrl: safeExternalUrl,
    category: nullableText,
    tier: nullableText,
    sortOrder,
    status,
  }),
  pages: z.object({
    slug,
    kind: z.enum(['practical', 'marketing', 'other']),
    title: text,
    summary: nullableText,
    bodyMarkdown: text,
    sortOrder,
    status,
  }),
  faqs: z.object({
    category: nullableText,
    question: text,
    answerMarkdown: text,
    sortOrder,
    status,
  }),
} satisfies Record<AdminContentResource, z.ZodType>;

const resourceOf = (value: string): AdminContentResource => {
  const parsed = z.enum(adminContentResources).safeParse(value);
  if (!parsed.success)
    throw new ApiProblemError({
      status: 404,
      code: 'ADMIN_RESOURCE_NOT_FOUND',
      title: 'Resource not found',
      detail: 'The requested content resource does not exist.',
    });
  return parsed.data;
};

const parseBody = async (
  request: Request,
  resource: AdminContentResource,
  partial: boolean,
) => {
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
  const expectedVersion =
    partial && typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>).version
      : undefined;
  const schemaForResource = partial
    ? schemas[resource].partial()
    : schemas[resource];
  const parsed = schemaForResource.safeParse(body);
  if (!parsed.success)
    throw new ApiProblemError({
      status: 400,
      code: 'INVALID_CONTENT_INPUT',
      title: 'Invalid content input',
      detail: 'The content fields are invalid.',
      fieldErrors: {
        body: parsed.error.issues.map(
          ({ path, message }) => `${path.join('.')}: ${message}`,
        ),
      },
    });
  if (
    partial &&
    resource !== 'days' &&
    !version.safeParse(expectedVersion).success
  )
    throw new ApiProblemError({
      status: 400,
      code: 'VERSION_REQUIRED',
      title: 'Version required',
      detail: 'A positive current version is required for updates.',
    });
  const data = { ...parsed.data } as Record<string, unknown>;
  delete data.version;
  return { data, expectedVersion: expectedVersion as number | undefined };
};

const listRows = async (
  db: Database,
  eventId: string,
  resource: AdminContentResource,
) => {
  switch (resource) {
    case 'days':
      return db.query.eventDays.findMany({
        where: eq(schema.eventDays.eventId, eventId),
        orderBy: [asc(schema.eventDays.sortOrder)],
      });
    case 'rooms':
      return db.query.rooms.findMany({
        where: eq(schema.rooms.eventId, eventId),
        orderBy: [asc(schema.rooms.sortOrder)],
      });
    case 'venues':
      return db.query.venues.findMany({
        where: eq(schema.venues.eventId, eventId),
        orderBy: [asc(schema.venues.sortOrder)],
      });
    case 'sessions': {
      const sessions = await db.query.programSessions.findMany({
        where: eq(schema.programSessions.eventId, eventId),
        orderBy: [asc(schema.programSessions.startsAt)],
      });
      const links = await db.query.sessionSpeakers.findMany({
        where: eq(schema.sessionSpeakers.eventId, eventId),
        orderBy: [asc(schema.sessionSpeakers.sortOrder)],
      });
      return sessions.map((session) => ({
        ...session,
        speakerIds: links
          .filter((link) => link.sessionId === session.id)
          .map((link) => link.speakerProfileId),
      }));
    }
    case 'speakers':
      return db.query.speakerProfiles.findMany({
        where: eq(schema.speakerProfiles.eventId, eventId),
        orderBy: [asc(schema.speakerProfiles.sortOrder)],
      });
    case 'partners':
      return db.query.partners.findMany({
        where: eq(schema.partners.eventId, eventId),
        orderBy: [asc(schema.partners.sortOrder)],
      });
    case 'pages':
      return db.query.contentPages.findMany({
        where: eq(schema.contentPages.eventId, eventId),
        orderBy: [asc(schema.contentPages.sortOrder)],
      });
    case 'faqs':
      return db.query.faqItems.findMany({
        where: eq(schema.faqItems.eventId, eventId),
        orderBy: [asc(schema.faqItems.sortOrder)],
      });
  }
};

const createRow = async (
  db: Database,
  eventId: string,
  resource: AdminContentResource,
  data: Record<string, unknown>,
) => {
  const id = generateUuidV7();
  const { speakerIds, ...persistedData } = data;
  switch (resource) {
    case 'days':
      await db
        .insert(schema.eventDays)
        .values({ id, eventId, ...(data as z.infer<typeof schemas.days>) });
      break;
    case 'rooms':
      await db
        .insert(schema.rooms)
        .values({ id, eventId, ...(data as z.infer<typeof schemas.rooms>) });
      break;
    case 'venues':
      await db.insert(schema.venues).values({
        id,
        eventId,
        ...(data as z.infer<(typeof schemas)['venues']>),
      });
      break;
    case 'sessions':
      await db.insert(schema.programSessions).values({
        id,
        eventId,
        ...(persistedData as z.infer<typeof schemas.sessions>),
      });
      if (Array.isArray(speakerIds) && speakerIds.length)
        await db.insert(schema.sessionSpeakers).values(
          speakerIds.map((speakerProfileId, sortOrder) => ({
            eventId,
            sessionId: id,
            speakerProfileId: String(speakerProfileId),
            sortOrder,
          })),
        );
      break;
    case 'speakers':
      await db
        .insert(schema.speakerProfiles)
        .values({ id, eventId, ...(data as z.infer<typeof schemas.speakers>) });
      break;
    case 'partners':
      await db
        .insert(schema.partners)
        .values({ id, eventId, ...(data as z.infer<typeof schemas.partners>) });
      break;
    case 'pages':
      await db
        .insert(schema.contentPages)
        .values({ id, eventId, ...(data as z.infer<typeof schemas.pages>) });
      break;
    case 'faqs':
      await db
        .insert(schema.faqItems)
        .values({ id, eventId, ...(data as z.infer<typeof schemas.faqs>) });
      break;
  }
  return id;
};

const updateRow = async (
  db: Database,
  eventId: string,
  resource: AdminContentResource,
  id: string,
  data: Record<string, unknown>,
  expectedVersion?: number,
) => {
  const updatedAt = new Date();
  const { speakerIds, ...persistedData } = data;
  let rows: Array<{ id: string }>;
  switch (resource) {
    case 'days':
      rows = await db
        .update(schema.eventDays)
        .set({ ...data, updatedAt })
        .where(
          and(
            eq(schema.eventDays.eventId, eventId),
            eq(schema.eventDays.id, id),
          ),
        )
        .returning({ id: schema.eventDays.id });
      break;
    case 'rooms':
      rows = await db
        .update(schema.rooms)
        .set({ ...persistedData, version: expectedVersion! + 1, updatedAt })
        .where(
          and(
            eq(schema.rooms.eventId, eventId),
            eq(schema.rooms.id, id),
            eq(schema.rooms.version, expectedVersion!),
          ),
        )
        .returning({ id: schema.rooms.id });
      break;
    case 'venues':
      rows = await db
        .update(schema.venues)
        .set({ ...data, version: expectedVersion! + 1, updatedAt })
        .where(
          and(
            eq(schema.venues.eventId, eventId),
            eq(schema.venues.id, id),
            eq(schema.venues.version, expectedVersion!),
          ),
        )
        .returning({ id: schema.venues.id });
      break;
    case 'sessions':
      rows = await db
        .update(schema.programSessions)
        .set({ ...persistedData, version: expectedVersion! + 1, updatedAt })
        .where(
          and(
            eq(schema.programSessions.eventId, eventId),
            eq(schema.programSessions.id, id),
            eq(schema.programSessions.version, expectedVersion!),
          ),
        )
        .returning({ id: schema.programSessions.id });
      break;
    case 'speakers':
      rows = await db
        .update(schema.speakerProfiles)
        .set({ ...data, version: expectedVersion! + 1, updatedAt })
        .where(
          and(
            eq(schema.speakerProfiles.eventId, eventId),
            eq(schema.speakerProfiles.id, id),
            eq(schema.speakerProfiles.version, expectedVersion!),
          ),
        )
        .returning({ id: schema.speakerProfiles.id });
      break;
    case 'partners':
      rows = await db
        .update(schema.partners)
        .set({ ...data, version: expectedVersion! + 1, updatedAt })
        .where(
          and(
            eq(schema.partners.eventId, eventId),
            eq(schema.partners.id, id),
            eq(schema.partners.version, expectedVersion!),
          ),
        )
        .returning({ id: schema.partners.id });
      break;
    case 'pages':
      rows = await db
        .update(schema.contentPages)
        .set({ ...data, version: expectedVersion! + 1, updatedAt })
        .where(
          and(
            eq(schema.contentPages.eventId, eventId),
            eq(schema.contentPages.id, id),
            eq(schema.contentPages.version, expectedVersion!),
          ),
        )
        .returning({ id: schema.contentPages.id });
      break;
    case 'faqs':
      rows = await db
        .update(schema.faqItems)
        .set({ ...data, version: expectedVersion! + 1, updatedAt })
        .where(
          and(
            eq(schema.faqItems.eventId, eventId),
            eq(schema.faqItems.id, id),
            eq(schema.faqItems.version, expectedVersion!),
          ),
        )
        .returning({ id: schema.faqItems.id });
      break;
  }
  if (!rows.length)
    throw new ApiProblemError({
      status: 409,
      code: 'STALE_CONTENT_VERSION',
      title: 'Content changed',
      detail: 'The content no longer has the expected version.',
    });
  if (resource === 'sessions' && Array.isArray(speakerIds)) {
    await db
      .delete(schema.sessionSpeakers)
      .where(
        and(
          eq(schema.sessionSpeakers.eventId, eventId),
          eq(schema.sessionSpeakers.sessionId, id),
        ),
      );
    if (speakerIds.length)
      await db.insert(schema.sessionSpeakers).values(
        speakerIds.map((speakerProfileId, sortOrder) => ({
          eventId,
          sessionId: id,
          speakerProfileId: String(speakerProfileId),
          sortOrder,
        })),
      );
  }
};

const archiveRow = async (
  db: Database,
  eventId: string,
  resource: AdminContentResource,
  id: string,
  expectedVersion?: number,
) => {
  if (resource === 'days') {
    const rows = await db
      .delete(schema.eventDays)
      .where(
        and(eq(schema.eventDays.eventId, eventId), eq(schema.eventDays.id, id)),
      )
      .returning({ id: schema.eventDays.id });
    if (!rows.length)
      throw new ApiProblemError({
        status: 404,
        code: 'CONTENT_NOT_FOUND',
        title: 'Content not found',
        detail: 'The content item does not exist.',
      });
    return;
  }
  await updateRow(
    db,
    eventId,
    resource,
    id,
    { status: 'archived' },
    expectedVersion,
  );
};

export interface AdminContentDependencies {
  db: Database;
  allowedOrigin: string;
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
}

export const handleAdminContent = async (
  request: Request,
  eventId: string,
  resourceValue: string,
  id: string | null,
  dependencies: AdminContentDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (!uuid.safeParse(eventId).success || (id && !uuid.safeParse(id).success))
      throw new ApiProblemError({
        status: 400,
        code: 'INVALID_IDENTIFIER',
        title: 'Invalid identifier',
        detail: 'A content identifier is invalid.',
      });
    const resource = resourceOf(resourceValue);
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
    if (request.method === 'GET')
      return Response.json(
        {
          resource,
          items: await listRows(dependencies.db, eventId, resource),
          requestId,
        },
        { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
      );
    if (request.headers.get('origin') !== dependencies.allowedOrigin)
      throw new ApiProblemError({
        status: 403,
        code: 'ORIGIN_REJECTED',
        title: 'Request rejected',
        detail: 'The request origin is not allowed.',
      });
    const result = await withTransaction(
      dependencies.db,
      async (transaction) => {
        await acquireTransactionLock(transaction, `content-publish:${eventId}`);
        let targetId = id;
        if (request.method === 'POST' && !id) {
          const { data } = await parseBody(request, resource, false);
          await validateContentMutation(transaction, {
            eventId,
            resource,
            data,
          });
          targetId = await createRow(transaction, eventId, resource, data);
        } else if (request.method === 'PATCH' && id) {
          const { data, expectedVersion } = await parseBody(
            request,
            resource,
            true,
          );
          await validateContentMutation(transaction, {
            eventId,
            resource,
            id,
            data,
          });
          await updateRow(
            transaction,
            eventId,
            resource,
            id,
            data,
            expectedVersion,
          );
        } else if (request.method === 'DELETE' && id) {
          const versionHeader = request.headers.get('if-match');
          const expectedVersion = versionHeader
            ? Number(versionHeader.replaceAll('"', ''))
            : undefined;
          if (
            resource !== 'days' &&
            !version.safeParse(expectedVersion).success
          )
            throw new ApiProblemError({
              status: 400,
              code: 'VERSION_REQUIRED',
              title: 'Version required',
              detail: 'If-Match must contain the current numeric version.',
            });
          await archiveRow(transaction, eventId, resource, id, expectedVersion);
        } else
          throw new ApiProblemError({
            status: 405,
            code: 'METHOD_NOT_ALLOWED',
            title: 'Method not allowed',
            detail: 'The method is not supported.',
          });
        await writeAuditLog(transaction, {
          eventId,
          actorId: session.user.id,
          actorType: 'user',
          action: `content.${request.method.toLowerCase()}`,
          targetType: `content_${resource}`,
          targetId,
          requestId: uuid.safeParse(requestId).success
            ? requestId
            : crypto.randomUUID(),
          after: { resource, targetId, httpRequestId: requestId },
        });
        return targetId!;
      },
    );
    return Response.json(
      {
        id: result,
        status:
          request.method === 'POST'
            ? 'created'
            : request.method === 'DELETE'
              ? 'archived'
              : 'updated',
        requestId,
      },
      {
        status: request.method === 'POST' ? 201 : 200,
        headers: { 'cache-control': 'no-store', 'x-request-id': requestId },
      },
    );
  } catch (error) {
    if (error instanceof ContentValidationError)
      return problemResponse(
        new ApiProblemError({
          status: 409,
          code: 'CONTENT_VALIDATION_FAILED',
          title: 'Content validation failed',
          detail: 'The content conflicts with the event program.',
          fieldErrors: { content: error.issues },
        }),
        requestId,
      );
    if (
      typeof error === 'object' &&
      error !== null &&
      'cause' in error &&
      typeof error.cause === 'object' &&
      error.cause !== null &&
      'code' in error.cause &&
      error.cause.code === '23503'
    )
      return problemResponse(
        new ApiProblemError({
          status: 409,
          code: 'CONTENT_IN_USE',
          title: 'Content is in use',
          detail: 'The content cannot be removed while another item uses it.',
        }),
        requestId,
      );
    return problemResponse(error, requestId);
  }
};
