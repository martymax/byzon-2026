import {
  enqueueEmailDelivery,
  schema,
  type DatabaseTransaction,
} from '@byzon/database';
import { publishedProgramAgendaSnapshotSchema } from '@byzon/domain/contracts';
import {
  notificationPayloadSchema,
  type NotificationKind,
  type NotificationSession,
} from '@byzon/mail';
import { and, desc, eq, inArray } from 'drizzle-orm';

type Snapshot = Record<string, unknown>;
const readProgram = (snapshot: unknown) =>
  publishedProgramAgendaSnapshotSchema.parse(snapshot).program;
type Program = ReturnType<typeof readProgram>;
const name = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const sessionDetails = (
  program: Program,
  id: string,
): NotificationSession | null => {
  const session = program.sessions.find((s) => s.id === id);
  if (!session) return null;
  return {
    id,
    title: name(session.title),
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    room: program.rooms.find((r) => r.id === session.roomId)?.name ?? null,
    cancelled: session.status === 'cancelled',
  };
};
const eventInfo = async (transaction: DatabaseTransaction, eventId: string) => {
  const event = await transaction.query.events.findFirst({
    columns: { name: true, timezone: true, endsAt: true },
    where: eq(schema.events.id, eventId),
  });
  if (!event) throw new Error('Email event unavailable');
  return {
    eventName: name(event.name).slice(0, 200),
    timezone: event.timezone,
  };
};

export const queueBookingEmail = async (
  transaction: DatabaseTransaction,
  input: {
    eventId: string;
    userId: string;
    sessionId: string;
    kind: Extract<
      NotificationKind,
      | 'reservation_confirmed'
      | 'reservation_cancelled'
      | 'waitlist_joined'
      | 'waitlist_left'
      | 'waitlist_promoted'
    >;
    reservationId?: string;
    waitlistEntryId?: string;
    cancelledByOrganizer?: boolean;
    now: Date;
  },
): Promise<void> => {
  const publication = await transaction.query.contentPublications.findFirst({
    columns: { snapshot: true },
    where: eq(schema.contentPublications.eventId, input.eventId),
    orderBy: [desc(schema.contentPublications.version)],
  });
  // Booking content comes from the publication participants can actually read, never an unpublished draft.
  if (!publication) return;
  const program = readProgram(publication.snapshot);
  const rows = await transaction
    .select({
      id: schema.programSessions.id,
      group: schema.programSessions.reservationGroupId,
    })
    .from(schema.programSessions)
    .where(eq(schema.programSessions.eventId, input.eventId));
  const ids = rows
    .filter((s) => (s.group ?? s.id) === input.sessionId)
    .map((s) => s.id);
  const sessions = ids
    .map((id) => sessionDetails(program, id))
    .filter((s): s is NotificationSession => s !== null);
  const payload = notificationPayloadSchema.parse({
    ...input,
    now: undefined,
    ...(await eventInfo(transaction, input.eventId)),
    sessions: sessions.slice(0, 20),
    totalChanges: sessions.length,
  });
  await enqueueEmailDelivery(transaction, {
    eventId: input.eventId,
    userId: input.userId,
    deduplicationKey: `${input.kind}:${input.reservationId ?? input.waitlistEntryId}`,
    payload,
    now: input.now,
    expiresAt: new Date(input.now.getTime() + 24 * 60 * 60_000),
  });
};

export const queueProgramChangeEmails = async (
  transaction: DatabaseTransaction,
  input: {
    eventId: string;
    publicationId: string;
    previous: Snapshot | null;
    current: Snapshot;
    sessionIds: string[];
    now: Date;
  },
): Promise<void> => {
  if (!input.previous || !input.sessionIds.length) return;
  const previous = readProgram(input.previous);
  const current = readProgram(input.current);
  const changed = input.sessionIds.filter((id) => {
    const s =
      current.sessions.find((s) => s.id === id) ??
      previous.sessions.find((s) => s.id === id);
    return s && Date.parse(s.endsAt) > input.now.getTime();
  });
  if (!changed.length) return;
  const operational = await transaction
    .select({
      id: schema.programSessions.id,
      group: schema.programSessions.reservationGroupId,
    })
    .from(schema.programSessions)
    .where(eq(schema.programSessions.eventId, input.eventId));
  const canonical = (id: string) =>
    operational.find((s) => s.id === id)?.group ?? id;
  const canonicalIds = [...new Set(changed.map(canonical))];
  const [agenda, reservations, waiting] = await Promise.all([
    transaction
      .select({
        userId: schema.agendaItems.userId,
        sessionId: schema.agendaItems.sessionId,
      })
      .from(schema.agendaItems)
      .where(
        and(
          eq(schema.agendaItems.eventId, input.eventId),
          inArray(schema.agendaItems.sessionId, changed),
        ),
      ),
    transaction
      .select({
        userId: schema.reservations.userId,
        sessionId: schema.reservations.sessionId,
      })
      .from(schema.reservations)
      .where(
        and(
          eq(schema.reservations.eventId, input.eventId),
          eq(schema.reservations.status, 'confirmed'),
          inArray(schema.reservations.sessionId, canonicalIds),
        ),
      ),
    transaction
      .select({
        userId: schema.waitlistEntries.userId,
        sessionId: schema.waitlistEntries.sessionId,
      })
      .from(schema.waitlistEntries)
      .where(
        and(
          eq(schema.waitlistEntries.eventId, input.eventId),
          eq(schema.waitlistEntries.status, 'waiting'),
          inArray(schema.waitlistEntries.sessionId, canonicalIds),
        ),
      ),
  ]);
  const recipients = new Map<string, Set<string>>();
  const add = (userId: string, id: string) => {
    const ids = recipients.get(userId) ?? new Set<string>();
    ids.add(id);
    recipients.set(userId, ids);
  };
  for (const item of agenda) add(item.userId, item.sessionId);
  for (const item of [...reservations, ...waiting])
    for (const id of changed)
      if (canonical(id) === item.sessionId) add(item.userId, id);
  const info = await eventInfo(transaction, input.eventId);
  for (const [userId, ids] of recipients) {
    const sessions = [...ids]
      .map((id) => {
        const before = sessionDetails(previous, id);
        const after = sessionDetails(current, id);
        if (!after) return before ? { ...before, cancelled: true } : null;
        return {
          ...after,
          ...(before
            ? {
                previous: {
                  startsAt: before.startsAt,
                  endsAt: before.endsAt,
                  room: before.room,
                },
              }
            : {}),
        };
      })
      .filter((s): s is NotificationSession => s !== null);
    await enqueueEmailDelivery(transaction, {
      eventId: input.eventId,
      userId,
      deduplicationKey: `program_changed:${input.publicationId}`,
      payload: notificationPayloadSchema.parse({
        ...info,
        kind: 'program_changed',
        sessions: sessions.slice(0, 20),
        totalChanges: sessions.length,
      }),
      now: input.now,
      expiresAt: new Date(input.now.getTime() + 24 * 60 * 60_000),
    });
  }
};

export const queueAnnouncementEmails = async (
  transaction: DatabaseTransaction,
  input: {
    eventId: string;
    announcementId: string;
    userIds: string[];
    title: string;
    body: string;
    now: Date;
  },
): Promise<void> => {
  const info = await eventInfo(transaction, input.eventId);
  const payload = notificationPayloadSchema.parse({
    ...info,
    kind: 'announcement',
    announcementId: input.announcementId,
    title: name(input.title),
    body: input.body,
  });
  for (const userId of new Set(input.userIds))
    await enqueueEmailDelivery(transaction, {
      eventId: input.eventId,
      userId,
      deduplicationKey: `announcement:${input.announcementId}`,
      payload,
      now: input.now,
      expiresAt: new Date(input.now.getTime() + 24 * 60 * 60_000),
    });
};
