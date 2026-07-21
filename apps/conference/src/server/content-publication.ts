import { createHash } from 'node:crypto';

import { and, asc, desc, eq, ne } from 'drizzle-orm';
import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  withTransaction,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';

export class ContentPublicationError extends Error {
  constructor(
    readonly code:
      'EVENT_NOT_FOUND' | 'STALE_VERSION' | 'INVALID_DRAFT' | 'NO_CONTENT',
    readonly issues: string[] = [],
  ) {
    super('Content publication failed');
    this.name = 'ContentPublicationError';
  }
}

type SnapshotDatabase = Pick<DatabaseTransaction, 'query'>;

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && !(value instanceof Date))
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  return value instanceof Date ? value.toISOString() : value;
};

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(canonicalize(value));

export const checksumSnapshot = (snapshot: unknown): string =>
  createHash('sha256').update(canonicalJson(snapshot)).digest('hex');

const withoutKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );

export const buildContentSnapshot = async (
  db: SnapshotDatabase,
  eventId: string,
): Promise<Record<string, unknown>> => {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, eventId),
    columns: {
      id: true,
      slug: true,
      name: true,
      timezone: true,
      startsAt: true,
      endsAt: true,
    },
  });
  if (!event) throw new ContentPublicationError('EVENT_NOT_FOUND');
  const days = await db.query.eventDays.findMany({
    where: eq(schema.eventDays.eventId, eventId),
    orderBy: [asc(schema.eventDays.sortOrder), asc(schema.eventDays.id)],
  });
  const rooms = await db.query.rooms.findMany({
    where: and(
      eq(schema.rooms.eventId, eventId),
      ne(schema.rooms.status, 'archived'),
    ),
    orderBy: [asc(schema.rooms.sortOrder), asc(schema.rooms.id)],
  });
  const sessions = await db.query.programSessions.findMany({
    where: and(
      eq(schema.programSessions.eventId, eventId),
      ne(schema.programSessions.status, 'archived'),
    ),
    orderBy: [
      asc(schema.programSessions.startsAt),
      asc(schema.programSessions.sortOrder),
      asc(schema.programSessions.id),
    ],
  });
  const speakers = await db.query.speakerProfiles.findMany({
    where: and(
      eq(schema.speakerProfiles.eventId, eventId),
      ne(schema.speakerProfiles.status, 'archived'),
    ),
    orderBy: [
      asc(schema.speakerProfiles.sortOrder),
      asc(schema.speakerProfiles.id),
    ],
  });
  const speakerLinks = await db.query.sessionSpeakers.findMany({
    where: eq(schema.sessionSpeakers.eventId, eventId),
    orderBy: [asc(schema.sessionSpeakers.sortOrder)],
  });
  const partners = await db.query.partners.findMany({
    where: and(
      eq(schema.partners.eventId, eventId),
      ne(schema.partners.status, 'archived'),
    ),
    orderBy: [asc(schema.partners.sortOrder), asc(schema.partners.id)],
  });
  const venues = await db.query.venues.findMany({
    where: and(
      eq(schema.venues.eventId, eventId),
      ne(schema.venues.status, 'archived'),
    ),
    orderBy: [asc(schema.venues.sortOrder), asc(schema.venues.id)],
  });
  const pages = await db.query.contentPages.findMany({
    where: and(
      eq(schema.contentPages.eventId, eventId),
      ne(schema.contentPages.status, 'archived'),
    ),
    orderBy: [asc(schema.contentPages.sortOrder), asc(schema.contentPages.id)],
  });
  const faqs = await db.query.faqItems.findMany({
    where: and(
      eq(schema.faqItems.eventId, eventId),
      ne(schema.faqItems.status, 'archived'),
    ),
    orderBy: [asc(schema.faqItems.sortOrder), asc(schema.faqItems.id)],
  });
  if (!days.length || !sessions.length)
    throw new ContentPublicationError('NO_CONTENT');

  const issues: string[] = [];
  const dayIds = new Set(days.map(({ id }) => id));
  const roomIds = new Set(rooms.map(({ id }) => id));
  const slugs = new Set<string>();
  for (const session of sessions) {
    if (!dayIds.has(session.dayId)) issues.push(`session:${session.id}:day`);
    if (session.roomId && !roomIds.has(session.roomId))
      issues.push(`session:${session.id}:room`);
    if (session.endsAt <= session.startsAt)
      issues.push(`session:${session.id}:time`);
    if (slugs.has(session.slug)) issues.push(`session:${session.id}:slug`);
    slugs.add(session.slug);
  }
  for (let index = 0; index < sessions.length; index += 1) {
    const left = sessions[index]!;
    if (!left.roomId || left.status === 'cancelled') continue;
    for (
      let otherIndex = index + 1;
      otherIndex < sessions.length;
      otherIndex += 1
    ) {
      const right = sessions[otherIndex]!;
      if (
        right.roomId === left.roomId &&
        right.status !== 'cancelled' &&
        left.startsAt < right.endsAt &&
        right.startsAt < left.endsAt
      )
        issues.push(`room_collision:${left.id}:${right.id}`);
    }
  }
  if (issues.length) throw new ContentPublicationError('INVALID_DRAFT', issues);

  return {
    event: {
      ...event,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
    },
    program: {
      days: days.map((day) =>
        withoutKeys(day, ['eventId', 'createdAt', 'updatedAt']),
      ),
      rooms: rooms.map((room) => ({
        ...withoutKeys(room, ['eventId', 'createdAt', 'updatedAt']),
        status: 'published',
      })),
      sessions: sessions.map((session) => ({
        ...withoutKeys(session, ['eventId', 'createdAt', 'updatedAt']),
        status: session.status === 'cancelled' ? 'cancelled' : 'published',
        startsAt: session.startsAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
        reservationOpensAt: session.reservationOpensAt?.toISOString() ?? null,
        reservationClosesAt: session.reservationClosesAt?.toISOString() ?? null,
        speakerIds: speakerLinks
          .filter(({ sessionId }) => sessionId === session.id)
          .map(({ speakerProfileId }) => speakerProfileId),
      })),
    },
    speakers: speakers.map((speaker) => ({
      ...withoutKeys(speaker, ['eventId', 'userId', 'createdAt', 'updatedAt']),
      status: 'published',
    })),
    partners: partners.map((partner) => ({
      ...withoutKeys(partner, ['eventId', 'createdAt', 'updatedAt']),
      status: 'published',
    })),
    venues: venues.map((venue) => ({
      ...withoutKeys(venue, ['eventId', 'createdAt', 'updatedAt']),
      status: 'published',
    })),
    practical: {
      pages: pages.map((page) => ({
        ...withoutKeys(page, ['eventId', 'createdAt', 'updatedAt']),
        status: 'published',
      })),
      faqs: faqs.map((faq) => ({
        ...withoutKeys(faq, ['eventId', 'createdAt', 'updatedAt']),
        status: 'published',
      })),
    },
  };
};

export interface PublicationPreview {
  version: number;
  checksumSha256: string;
  snapshot: Record<string, unknown>;
}

export const previewContentPublication = async (
  db: Database,
  eventId: string,
): Promise<PublicationPreview> => {
  const [snapshot, previous] = await Promise.all([
    buildContentSnapshot(db, eventId),
    db.query.contentPublications.findFirst({
      where: eq(schema.contentPublications.eventId, eventId),
      orderBy: [desc(schema.contentPublications.version)],
      columns: { version: true, snapshot: true },
    }),
  ]);
  return {
    version: (previous?.version ?? 0) + 1,
    checksumSha256: checksumSnapshot(snapshot),
    snapshot,
  };
};

export const publishContent = async (
  db: Database,
  input: {
    eventId: string;
    actorId: string;
    requestId: string;
    expectedPreviousVersion: number;
  },
): Promise<PublicationPreview> =>
  withTransaction(db, async (transaction) => {
    await acquireTransactionLock(
      transaction,
      `content-publish:${input.eventId}`,
    );
    const previous = await transaction.query.contentPublications.findFirst({
      where: eq(schema.contentPublications.eventId, input.eventId),
      orderBy: [desc(schema.contentPublications.version)],
    });
    if ((previous?.version ?? 0) !== input.expectedPreviousVersion)
      throw new ContentPublicationError('STALE_VERSION');
    const snapshot = await buildContentSnapshot(transaction, input.eventId);
    const result: PublicationPreview = {
      version: input.expectedPreviousVersion + 1,
      checksumSha256: checksumSnapshot(snapshot),
      snapshot,
    };
    const publicationId = generateUuidV7();
    await transaction.insert(schema.contentPublications).values({
      id: publicationId,
      eventId: input.eventId,
      version: result.version,
      snapshot,
      checksumSha256: result.checksumSha256,
      publishedBy: input.actorId,
    });
    await transaction.insert(schema.outboxEvents).values({
      id: generateUuidV7(),
      eventId: input.eventId,
      type: 'content.published',
      aggregateType: 'content_publication',
      aggregateId: publicationId,
      payload: {
        publicationId,
        version: result.version,
        checksumSha256: result.checksumSha256,
      },
      deduplicationKey: `content.published:${result.version}`,
    });
    await writeAuditLog(transaction, {
      eventId: input.eventId,
      actorId: input.actorId,
      actorType: 'user',
      action: 'content.publish',
      targetType: 'content_publication',
      targetId: publicationId,
      requestId: input.requestId,
      after: {
        version: result.version,
        checksumSha256: result.checksumSha256,
      },
    });
    return result;
  });
