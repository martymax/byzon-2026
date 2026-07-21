import { and, eq, ne } from 'drizzle-orm';
import { schema, type Database } from '@byzon/database';

import type { AdminContentResource } from './admin-content';

export class ContentValidationError extends Error {
  constructor(readonly issues: string[]) {
    super('Content validation failed');
    this.name = 'ContentValidationError';
  }
}

const localDateIn = (instant: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

export const validateContentMutation = async (
  db: Database,
  input: {
    eventId: string;
    resource: AdminContentResource;
    id?: string | null;
    data: Record<string, unknown>;
  },
): Promise<void> => {
  const issues: string[] = [];
  const event = await db.query.events.findFirst({
    where: eq(schema.events.id, input.eventId),
    columns: { timezone: true, startsAt: true, endsAt: true },
  });
  if (!event) throw new ContentValidationError(['event:not_found']);

  if (input.resource === 'rooms' && typeof input.data.venueId === 'string') {
    const venue = await db.query.venues.findFirst({
      where: and(
        eq(schema.venues.eventId, input.eventId),
        eq(schema.venues.id, input.data.venueId),
        ne(schema.venues.status, 'archived'),
      ),
      columns: { id: true },
    });
    if (!venue) issues.push('venue:not_in_event');
  }

  if (input.resource === 'sessions') {
    const existing = input.id
      ? await db.query.programSessions.findFirst({
          where: and(
            eq(schema.programSessions.eventId, input.eventId),
            eq(schema.programSessions.id, input.id),
          ),
        })
      : null;
    const dayId = String(input.data.dayId ?? existing?.dayId ?? '');
    const roomId = (input.data.roomId ?? existing?.roomId ?? null) as
      string | null;
    const startsAt =
      input.data.startsAt instanceof Date
        ? input.data.startsAt
        : existing?.startsAt;
    const endsAt =
      input.data.endsAt instanceof Date ? input.data.endsAt : existing?.endsAt;
    const day = await db.query.eventDays.findFirst({
      where: and(
        eq(schema.eventDays.eventId, input.eventId),
        eq(schema.eventDays.id, dayId),
      ),
      columns: { localDate: true },
    });
    if (!day) issues.push('day:not_in_event');
    if (!startsAt || !endsAt || endsAt <= startsAt)
      issues.push('time:invalid_range');
    if (
      day &&
      startsAt &&
      (localDateIn(startsAt, event.timezone) !== day.localDate ||
        startsAt < event.startsAt ||
        startsAt > event.endsAt)
    )
      issues.push('time:outside_event_day');
    if (roomId) {
      const room = await db.query.rooms.findFirst({
        where: and(
          eq(schema.rooms.eventId, input.eventId),
          eq(schema.rooms.id, roomId),
          ne(schema.rooms.status, 'archived'),
        ),
        columns: { id: true },
      });
      if (!room) issues.push('room:not_in_event');
      if (room && startsAt && endsAt) {
        const sessions = await db.query.programSessions.findMany({
          where: and(
            eq(schema.programSessions.eventId, input.eventId),
            eq(schema.programSessions.roomId, roomId),
            ne(schema.programSessions.status, 'cancelled'),
            ne(schema.programSessions.status, 'archived'),
          ),
          columns: { id: true, startsAt: true, endsAt: true },
        });
        if (
          sessions.some(
            (candidate) =>
              candidate.id !== input.id &&
              startsAt < candidate.endsAt &&
              candidate.startsAt < endsAt,
          )
        )
          issues.push('room:time_collision');
      }
    }
  }

  const slugValue = input.data.slug;
  if (typeof slugValue === 'string') {
    let conflictingId: string | undefined;
    switch (input.resource) {
      case 'rooms':
        conflictingId = (
          await db.query.rooms.findFirst({
            where: and(
              eq(schema.rooms.eventId, input.eventId),
              eq(schema.rooms.slug, slugValue),
            ),
            columns: { id: true },
          })
        )?.id;
        break;
      case 'sessions':
        conflictingId = (
          await db.query.programSessions.findFirst({
            where: and(
              eq(schema.programSessions.eventId, input.eventId),
              eq(schema.programSessions.slug, slugValue),
            ),
            columns: { id: true },
          })
        )?.id;
        break;
      case 'speakers':
        conflictingId = (
          await db.query.speakerProfiles.findFirst({
            where: and(
              eq(schema.speakerProfiles.eventId, input.eventId),
              eq(schema.speakerProfiles.slug, slugValue),
            ),
            columns: { id: true },
          })
        )?.id;
        break;
      case 'partners':
        conflictingId = (
          await db.query.partners.findFirst({
            where: and(
              eq(schema.partners.eventId, input.eventId),
              eq(schema.partners.slug, slugValue),
            ),
            columns: { id: true },
          })
        )?.id;
        break;
      case 'pages':
        conflictingId = (
          await db.query.contentPages.findFirst({
            where: and(
              eq(schema.contentPages.eventId, input.eventId),
              eq(schema.contentPages.slug, slugValue),
            ),
            columns: { id: true },
          })
        )?.id;
        break;
      default:
        break;
    }
    if (conflictingId && conflictingId !== input.id)
      issues.push('slug:duplicate');
  }
  if (issues.length) throw new ContentValidationError([...new Set(issues)]);
};
