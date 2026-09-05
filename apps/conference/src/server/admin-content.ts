import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  withTransaction,
  type Database,
} from '@byzon/database';
import {
  participantSessionTypeSchema,
  publishedFaqSchema,
  publishedPartnerSchema,
  publishedPracticalPageSchema,
  publishedProgramDaySchema,
  publishedProgramRoomSchema,
  publishedProgramSessionSchema,
  publishedSpeakerSchema,
  publishedVenueSchema,
} from '@byzon/domain/contracts';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { requireWritableAdminEvent } from './admin-event-writability';
import { EventAccessDeniedError, requireEventPermission } from './policy';
import {
  ContentValidationError,
  validateContentMutation,
} from './content-validation';

const uuid = z.string().uuid();
const slug = publishedVenueSchema.shape.slug;
const sortOrder = publishedProgramDaySchema.shape.sortOrder;
const version = z.number().int().positive();
const status = z.enum(['draft', 'published', 'archived']).optional();
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

export const adminContentListColumns = {
  days: {
    description: true,
    eventId: true,
    id: true,
    localDate: true,
    sortOrder: true,
    title: true,
  },
  venues: {
    eventId: true,
    id: true,
    mapQuery: true,
    name: true,
    navigationMarkdown: true,
    slug: true,
    sortOrder: true,
    status: true,
    version: true,
  },
  rooms: {
    capacity: true,
    description: true,
    eventId: true,
    id: true,
    name: true,
    slug: true,
    sortOrder: true,
    status: true,
    venueId: true,
    version: true,
  },
  sessions: {
    dayId: true,
    description: true,
    endsAt: true,
    eventId: true,
    id: true,
    roomId: true,
    slug: true,
    sortOrder: true,
    startsAt: true,
    status: true,
    summary: true,
    title: true,
    type: true,
    version: true,
  },
  speakers: {
    bioMarkdown: true,
    company: true,
    eventId: true,
    firstName: true,
    id: true,
    jobTitle: true,
    lastName: true,
    linkedinUrl: true,
    instagramUrl: true,
    facebookUrl: true,
    slug: true,
    sortOrder: true,
    status: true,
    version: true,
    websiteUrl: true,
  },
  partners: {
    category: true,
    descriptionMarkdown: true,
    eventId: true,
    id: true,
    name: true,
    slug: true,
    sortOrder: true,
    status: true,
    tier: true,
    version: true,
    websiteUrl: true,
  },
  pages: {
    bodyMarkdown: true,
    eventId: true,
    id: true,
    kind: true,
    slug: true,
    sortOrder: true,
    status: true,
    summary: true,
    title: true,
    version: true,
  },
  faqs: {
    answerMarkdown: true,
    category: true,
    eventId: true,
    id: true,
    question: true,
    sortOrder: true,
    status: true,
    version: true,
  },
} as const;

const schemas = {
  days: z.object({
    localDate: z.string().date(),
    title: publishedProgramDaySchema.shape.title,
    description: publishedProgramDaySchema.shape.description,
    sortOrder,
  }),
  venues: z.object({
    slug,
    name: publishedVenueSchema.shape.name,
    mapQuery: publishedVenueSchema.shape.mapQuery.optional(),
    navigationMarkdown:
      publishedVenueSchema.shape.navigationMarkdown.optional(),
    sortOrder,
    status,
  }),
  rooms: z.object({
    venueId: uuid,
    slug,
    name: publishedProgramRoomSchema.shape.name,
    description: publishedProgramRoomSchema.shape.description,
    capacity: z.number().int().positive().nullable().optional(),
    sortOrder,
    status,
  }),
  sessions: z.object({
    dayId: uuid,
    roomId: uuid.nullable().optional(),
    slug,
    title: publishedProgramSessionSchema.shape.title,
    summary: publishedProgramSessionSchema.shape.summary,
    description: publishedProgramSessionSchema.shape.description,
    type: participantSessionTypeSchema,
    startsAt: instant,
    endsAt: instant,
    sortOrder,
    status: z.enum(['draft', 'published', 'cancelled', 'archived']).optional(),
    speakerIds: z.array(uuid).max(50).optional(),
  }),
  speakers: z.object({
    slug,
    firstName: publishedSpeakerSchema.shape.firstName.max(128),
    lastName: publishedSpeakerSchema.shape.lastName.max(128),
    company: publishedSpeakerSchema.shape.company.optional(),
    jobTitle: publishedSpeakerSchema.shape.jobTitle.optional(),
    bioMarkdown: publishedSpeakerSchema.shape.bioMarkdown.optional(),
    linkedinUrl: publishedSpeakerSchema.shape.linkedinUrl.optional(),
    instagramUrl: publishedSpeakerSchema.shape.instagramUrl,
    facebookUrl: publishedSpeakerSchema.shape.facebookUrl,
    websiteUrl: publishedSpeakerSchema.shape.websiteUrl.optional(),
    accountEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(320)
      .nullable()
      .optional(),
    sessionIds: z.array(uuid).max(50).optional(),
    sortOrder,
    status,
  }),
  partners: z.object({
    slug,
    name: publishedPartnerSchema.shape.name,
    descriptionMarkdown:
      publishedPartnerSchema.shape.descriptionMarkdown.optional(),
    websiteUrl: publishedPartnerSchema.shape.websiteUrl.optional(),
    category: publishedPartnerSchema.shape.category.optional(),
    tier: publishedPartnerSchema.shape.tier.optional(),
    sortOrder,
    status,
  }),
  pages: z.object({
    slug,
    kind: z.enum(['practical', 'marketing', 'other']),
    title: publishedPracticalPageSchema.shape.title,
    summary: publishedPracticalPageSchema.shape.summary.optional(),
    bodyMarkdown: publishedPracticalPageSchema.shape.bodyMarkdown,
    sortOrder,
    status,
  }),
  faqs: z.object({
    category: publishedFaqSchema.shape.category.optional(),
    question: publishedFaqSchema.shape.question,
    answerMarkdown: publishedFaqSchema.shape.answerMarkdown,
    sortOrder,
    status,
  }),
} satisfies Record<AdminContentResource, z.ZodType>;

export const adminContentInputSchemas = schemas;

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
        columns: adminContentListColumns.days,
        where: eq(schema.eventDays.eventId, eventId),
        orderBy: [asc(schema.eventDays.sortOrder)],
      });
    case 'rooms':
      return db.query.rooms.findMany({
        columns: adminContentListColumns.rooms,
        where: eq(schema.rooms.eventId, eventId),
        orderBy: [asc(schema.rooms.sortOrder)],
      });
    case 'venues':
      return db.query.venues.findMany({
        columns: adminContentListColumns.venues,
        where: eq(schema.venues.eventId, eventId),
        orderBy: [asc(schema.venues.sortOrder)],
      });
    case 'sessions': {
      const sessions = await db.query.programSessions.findMany({
        columns: adminContentListColumns.sessions,
        where: eq(schema.programSessions.eventId, eventId),
        orderBy: [asc(schema.programSessions.startsAt)],
      });
      const links = await db.query.sessionSpeakers.findMany({
        columns: { sessionId: true, speakerProfileId: true },
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
    case 'speakers': {
      const [speakers, links] = await Promise.all([
        db.query.speakerProfiles.findMany({
          columns: { ...adminContentListColumns.speakers, userId: true },
          where: eq(schema.speakerProfiles.eventId, eventId),
          orderBy: [asc(schema.speakerProfiles.sortOrder)],
        }),
        db.query.sessionSpeakers.findMany({
          columns: { sessionId: true, speakerProfileId: true },
          where: eq(schema.sessionSpeakers.eventId, eventId),
          orderBy: [asc(schema.sessionSpeakers.sortOrder)],
        }),
      ]);
      const userIds = speakers.flatMap(({ userId }) =>
        userId === null ? [] : [userId],
      );
      const users =
        userIds.length === 0
          ? []
          : await db.query.users.findMany({
              columns: { email: true, id: true },
              where: inArray(schema.users.id, userIds),
            });
      const emailsByUserId = new Map(
        users.map(({ email, id: userId }) => [userId, email.toLowerCase()]),
      );
      return speakers.map(({ userId, ...speaker }) => ({
        ...speaker,
        accountEmail:
          userId === null ? null : (emailsByUserId.get(userId) ?? null),
        sessionIds: links
          .filter((link) => link.speakerProfileId === speaker.id)
          .map((link) => link.sessionId),
      }));
    }
    case 'partners':
      return db.query.partners.findMany({
        columns: adminContentListColumns.partners,
        where: eq(schema.partners.eventId, eventId),
        orderBy: [asc(schema.partners.sortOrder)],
      });
    case 'pages':
      return db.query.contentPages.findMany({
        columns: adminContentListColumns.pages,
        where: eq(schema.contentPages.eventId, eventId),
        orderBy: [asc(schema.contentPages.sortOrder)],
      });
    case 'faqs':
      return db.query.faqItems.findMany({
        columns: adminContentListColumns.faqs,
        where: eq(schema.faqItems.eventId, eventId),
        orderBy: [asc(schema.faqItems.sortOrder)],
      });
  }
};

const syncSpeakerAccount = async (
  db: Database,
  eventId: string,
  speakerProfileId: string,
  accountEmail: string | null,
) => {
  const speaker = await db.query.speakerProfiles.findFirst({
    columns: { userId: true },
    where: and(
      eq(schema.speakerProfiles.eventId, eventId),
      eq(schema.speakerProfiles.id, speakerProfileId),
    ),
  });
  if (!speaker) return;

  const normalizedEmail = accountEmail?.trim().toLowerCase() || null;
  let nextUserId: string | null = null;
  if (normalizedEmail !== null) {
    const user = await db.query.users.findFirst({
      columns: { id: true },
      where: sql<boolean>`lower(${schema.users.email}) = ${normalizedEmail}`,
    });
    if (!user) {
      throw new ApiProblemError({
        status: 409,
        code: 'SPEAKER_ACCOUNT_NOT_FOUND',
        title: 'Participant account not found',
        detail:
          'Create the participant account first, then link it to the speaker.',
        fieldErrors: {
          accountEmail: [
            'Nejdřív vytvořte účastníka s tímto e-mailem v části Účastníci.',
          ],
        },
      });
    }
    const [membership, participantProfile, participantRole, otherSpeaker] =
      await Promise.all([
        db.query.eventMemberships.findFirst({
          columns: { userId: true },
          where: and(
            eq(schema.eventMemberships.eventId, eventId),
            eq(schema.eventMemberships.userId, user.id),
            eq(schema.eventMemberships.status, 'active'),
          ),
        }),
        db.query.participantProfiles.findFirst({
          columns: { userId: true },
          where: and(
            eq(schema.participantProfiles.eventId, eventId),
            eq(schema.participantProfiles.userId, user.id),
          ),
        }),
        db.query.eventRoles.findFirst({
          columns: { id: true },
          where: and(
            eq(schema.eventRoles.eventId, eventId),
            eq(schema.eventRoles.userId, user.id),
            eq(schema.eventRoles.role, 'participant'),
            isNull(schema.eventRoles.revokedAt),
          ),
        }),
        db.query.speakerProfiles.findFirst({
          columns: { id: true },
          where: and(
            eq(schema.speakerProfiles.eventId, eventId),
            eq(schema.speakerProfiles.userId, user.id),
          ),
        }),
      ]);
    if (!membership || !participantProfile || !participantRole) {
      throw new ApiProblemError({
        status: 409,
        code: 'SPEAKER_PARTICIPANT_ACCESS_REQUIRED',
        title: 'Participant access required',
        detail:
          'The linked identity must have an active participant account for this event.',
        fieldErrors: {
          accountEmail: [
            'Tento e-mail nemá aktivní účastnický účet pro tuto akci.',
          ],
        },
      });
    }
    if (otherSpeaker && otherSpeaker.id !== speakerProfileId) {
      throw new ApiProblemError({
        status: 409,
        code: 'SPEAKER_ACCOUNT_ALREADY_LINKED',
        title: 'Participant account already linked',
        detail: 'The participant account is linked to another speaker.',
        fieldErrors: {
          accountEmail: [
            'Tento účastnický účet už je propojený s jiným řečníkem.',
          ],
        },
      });
    }
    nextUserId = user.id;
  }

  if (speaker.userId !== nextUserId) {
    if (speaker.userId !== null) {
      await db
        .update(schema.eventRoles)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.eventRoles.eventId, eventId),
            eq(schema.eventRoles.userId, speaker.userId),
            eq(schema.eventRoles.role, 'speaker'),
            isNull(schema.eventRoles.revokedAt),
          ),
        );
    }
    await db
      .update(schema.speakerProfiles)
      .set({ userId: nextUserId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.speakerProfiles.eventId, eventId),
          eq(schema.speakerProfiles.id, speakerProfileId),
        ),
      );
  }
  if (nextUserId !== null) {
    const role = await db.query.eventRoles.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.userId, nextUserId),
        eq(schema.eventRoles.role, 'speaker'),
        isNull(schema.eventRoles.revokedAt),
      ),
    });
    if (!role) {
      await db.insert(schema.eventRoles).values({
        id: generateUuidV7(),
        eventId,
        userId: nextUserId,
        role: 'speaker',
        scope: {},
      });
    }
  }
};

const publishedItems = (
  snapshot: Record<string, unknown> | null | undefined,
  resource: AdminContentResource,
): readonly Record<string, unknown>[] => {
  if (!snapshot) return [];
  const object = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const collection = (parent: Record<string, unknown> | null, key: string) =>
    Array.isArray(parent?.[key])
      ? (parent[key] as Record<string, unknown>[])
      : [];
  const program = object(snapshot.program);
  const practical = object(snapshot.practical);
  switch (resource) {
    case 'days':
      return collection(program, 'days');
    case 'rooms':
      return collection(program, 'rooms');
    case 'sessions':
      return collection(program, 'sessions');
    case 'speakers':
      return collection(snapshot, 'speakers');
    case 'partners':
      return collection(snapshot, 'partners');
    case 'venues':
      return collection(snapshot, 'venues');
    case 'pages':
      return collection(practical, 'pages');
    case 'faqs':
      return collection(practical, 'faqs');
  }
};

const listRowsWithPublicationState = async (
  db: Database,
  eventId: string,
  resource: AdminContentResource,
) => {
  const [items, publication] = await Promise.all([
    listRows(db, eventId, resource),
    db.query.contentPublications.findFirst({
      columns: { snapshot: true },
      orderBy: [desc(schema.contentPublications.version)],
      where: eq(schema.contentPublications.eventId, eventId),
    }),
  ]);
  const publishedIds = new Set(
    publishedItems(publication?.snapshot, resource).flatMap((item) =>
      typeof item.id === 'string' ? [item.id] : [],
    ),
  );
  return items.map((item) => ({
    ...item,
    publicationState:
      'status' in item && item.status === 'archived'
        ? ('archived' as const)
        : publishedIds.has(item.id)
          ? ('published' as const)
          : ('unpublished' as const),
  }));
};

const syncSpeakerSessions = async (
  db: Database,
  eventId: string,
  speakerProfileId: string,
  sessionIds: readonly string[],
) => {
  const previous = await db.query.sessionSpeakers.findMany({
    columns: { role: true, sessionId: true },
    where: and(
      eq(schema.sessionSpeakers.eventId, eventId),
      eq(schema.sessionSpeakers.speakerProfileId, speakerProfileId),
    ),
  });
  const affectedSessionIds = [
    ...new Set([...previous.map(({ sessionId }) => sessionId), ...sessionIds]),
  ];
  if (affectedSessionIds.length === 0) return;
  const existing = await db.query.sessionSpeakers.findMany({
    columns: {
      role: true,
      sessionId: true,
      speakerProfileId: true,
      sortOrder: true,
    },
    where: and(
      eq(schema.sessionSpeakers.eventId, eventId),
      inArray(schema.sessionSpeakers.sessionId, affectedSessionIds),
    ),
    orderBy: [
      asc(schema.sessionSpeakers.sessionId),
      asc(schema.sessionSpeakers.sortOrder),
    ],
  });
  await db
    .delete(schema.sessionSpeakers)
    .where(
      and(
        eq(schema.sessionSpeakers.eventId, eventId),
        inArray(schema.sessionSpeakers.sessionId, affectedSessionIds),
      ),
    );
  const selected = new Set(sessionIds);
  const replacements = affectedSessionIds.flatMap((sessionId) => {
    const links = existing
      .filter((link) => link.sessionId === sessionId)
      .map(({ role, speakerProfileId: linkedSpeakerId }) => ({
        role,
        speakerProfileId: linkedSpeakerId,
      }));
    const currentIndex = links.findIndex(
      (link) => link.speakerProfileId === speakerProfileId,
    );
    if (selected.has(sessionId) && currentIndex === -1) {
      links.push({
        role: null,
        speakerProfileId,
      });
    } else if (!selected.has(sessionId) && currentIndex !== -1) {
      links.splice(currentIndex, 1);
    }
    return links.map((link, sortOrder) => ({
      eventId,
      sessionId,
      speakerProfileId: link.speakerProfileId,
      sortOrder,
      role: link.role,
    }));
  });
  if (replacements.length) {
    await db.insert(schema.sessionSpeakers).values(replacements);
  }
};

const createRow = async (
  db: Database,
  eventId: string,
  resource: AdminContentResource,
  data: Record<string, unknown>,
) => {
  const id = generateUuidV7();
  const { accountEmail, sessionIds, speakerIds, ...persistedData } = data;
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
      await db.insert(schema.speakerProfiles).values({
        id,
        eventId,
        ...(persistedData as z.infer<typeof schemas.speakers>),
      });
      if (Array.isArray(sessionIds)) {
        await syncSpeakerSessions(db, eventId, id, sessionIds.map(String));
      }
      if (Object.hasOwn(data, 'accountEmail')) {
        await syncSpeakerAccount(
          db,
          eventId,
          id,
          typeof accountEmail === 'string' ? accountEmail : null,
        );
      }
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
  const { accountEmail, sessionIds, speakerIds, ...persistedData } = data;
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
        .set({ ...persistedData, version: expectedVersion! + 1, updatedAt })
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
  if (resource === 'speakers' && Array.isArray(sessionIds)) {
    await syncSpeakerSessions(db, eventId, id, sessionIds.map(String));
  }
  if (resource === 'speakers' && Object.hasOwn(data, 'accountEmail')) {
    await syncSpeakerAccount(
      db,
      eventId,
      id,
      typeof accountEmail === 'string' ? accountEmail : null,
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
          items: await listRowsWithPublicationState(
            dependencies.db,
            eventId,
            resource,
          ),
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
        await requireWritableAdminEvent(transaction, eventId);
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
      (error.cause.code === '23503' || error.cause.code === '23505')
    )
      return problemResponse(
        new ApiProblemError({
          status: 409,
          code:
            error.cause.code === '23503'
              ? 'CONTENT_IN_USE'
              : 'CONTENT_CONFLICT',
          title:
            error.cause.code === '23503'
              ? 'Content is in use'
              : 'Content conflicts with another item',
          detail:
            error.cause.code === '23503'
              ? 'The content cannot be removed while another item uses it.'
              : 'Another content item already uses a unique value.',
        }),
        requestId,
      );
    return problemResponse(error, requestId);
  }
};
