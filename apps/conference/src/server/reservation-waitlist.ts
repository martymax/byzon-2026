import {
  schema,
  writeAuditLog,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  publishedAgendaReservationWindowsSchema,
  publishedProgramAgendaSnapshotSchema,
} from '@byzon/domain/contracts';
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';

export interface AutomaticWaitlistPromotionInput {
  transaction: DatabaseTransaction;
  eventId: string;
  sessionId: string;
  now: Date;
  requestId: string;
  generateId: () => string;
}

export interface AutomaticWaitlistPromotion {
  waitlistEntryId: string;
  reservationId: string;
  userId: string;
}

const promotionWindowIsOpen = async (
  transaction: DatabaseTransaction,
  eventId: string,
  sessionId: string,
  now: Date,
): Promise<boolean> => {
  const publication = await transaction.query.contentPublications.findFirst({
    columns: { reservationWindows: true, snapshot: true },
    where: eq(schema.contentPublications.eventId, eventId),
    orderBy: [desc(schema.contentPublications.version)],
  });
  const snapshot = publishedProgramAgendaSnapshotSchema.safeParse(
    publication?.snapshot,
  );
  const windows = publishedAgendaReservationWindowsSchema.safeParse(
    publication?.reservationWindows,
  );
  if (!publication || !snapshot.success || !windows.success) return false;
  const published = snapshot.data.program.sessions.find(
    ({ id }) => id === sessionId,
  );
  if (!published || published.status === 'cancelled') return false;
  const close = windows.data[sessionId]?.reservationClosesAt;
  const closesAt =
    close === null || close === undefined
      ? Date.parse(published.startsAt)
      : Date.parse(close);
  return Number.isFinite(closesAt) && now.getTime() < closesAt;
};

const bumpParticipantAgenda = async (
  transaction: DatabaseTransaction,
  eventId: string,
  userId: string,
  now: Date,
): Promise<void> => {
  await transaction
    .insert(schema.participantAgendas)
    .values({ eventId, userId, createdAt: now, updatedAt: now })
    .onConflictDoNothing();
  await transaction
    .update(schema.participantAgendas)
    .set({
      updatedAt: now,
      version: sql`${schema.participantAgendas.version} + 1`,
    })
    .where(
      and(
        eq(schema.participantAgendas.eventId, eventId),
        eq(schema.participantAgendas.userId, userId),
      ),
    );
};

const participantCanBePromoted = async (
  transaction: DatabaseTransaction,
  eventId: string,
  userId: string,
): Promise<boolean> => {
  const membership = await transaction.query.eventMemberships.findFirst({
    columns: { userId: true },
    where: and(
      eq(schema.eventMemberships.eventId, eventId),
      eq(schema.eventMemberships.userId, userId),
      eq(schema.eventMemberships.status, 'active'),
    ),
  });
  if (!membership) return false;
  const role = await transaction.query.eventRoles.findFirst({
    columns: { id: true },
    where: and(
      eq(schema.eventRoles.eventId, eventId),
      eq(schema.eventRoles.userId, userId),
      eq(schema.eventRoles.role, 'participant'),
      isNull(schema.eventRoles.revokedAt),
    ),
  });
  if (!role) return false;
  const ticket = await transaction.query.tickets.findFirst({
    columns: { id: true },
    where: and(
      eq(schema.tickets.eventId, eventId),
      eq(schema.tickets.holderUserId, userId),
      eq(schema.tickets.status, 'activated'),
    ),
  });
  return ticket !== undefined;
};

/**
 * Promotes as many FIFO entries as the current capacity permits. The caller
 * must already hold the canonical content and participant-reservation session
 * locks. PostgreSQL remains authoritative; notification delivery is a later
 * outbox concern and cannot delay the reservation transition.
 */
export const promoteAutomaticWaitlist = async ({
  transaction,
  eventId,
  sessionId,
  now,
  requestId,
  generateId,
}: AutomaticWaitlistPromotionInput): Promise<AutomaticWaitlistPromotion[]> => {
  const session = await transaction.query.programSessions.findFirst({
    columns: {
      capacity: true,
      capacityMode: true,
      status: true,
      waitlistMode: true,
    },
    where: and(
      eq(schema.programSessions.eventId, eventId),
      eq(schema.programSessions.id, sessionId),
    ),
  });
  if (
    !session ||
    session.capacityMode !== 'reservation' ||
    session.capacity === null ||
    session.waitlistMode !== 'auto_confirm' ||
    session.status === 'cancelled' ||
    session.status === 'archived' ||
    !(await promotionWindowIsOpen(transaction, eventId, sessionId, now))
  ) {
    return [];
  }

  const [reservationCount] = await transaction
    .select({ value: count() })
    .from(schema.reservations)
    .where(
      and(
        eq(schema.reservations.eventId, eventId),
        eq(schema.reservations.sessionId, sessionId),
        eq(schema.reservations.status, 'confirmed'),
      ),
    );
  let available = Math.max(
    0,
    session.capacity - (reservationCount?.value ?? 0),
  );
  const promoted: AutomaticWaitlistPromotion[] = [];

  while (available > 0) {
    const waiting = await transaction.query.waitlistEntries.findFirst({
      columns: { id: true, userId: true },
      where: and(
        eq(schema.waitlistEntries.eventId, eventId),
        eq(schema.waitlistEntries.sessionId, sessionId),
        eq(schema.waitlistEntries.status, 'waiting'),
      ),
      orderBy: [
        asc(schema.waitlistEntries.positionSequence),
        asc(schema.waitlistEntries.id),
      ],
    });
    if (!waiting) break;

    if (
      !(await participantCanBePromoted(transaction, eventId, waiting.userId))
    ) {
      await transaction
        .update(schema.waitlistEntries)
        .set({ status: 'cancelled', cancelledAt: now })
        .where(
          and(
            eq(schema.waitlistEntries.eventId, eventId),
            eq(schema.waitlistEntries.id, waiting.id),
            eq(schema.waitlistEntries.status, 'waiting'),
          ),
        );
      await bumpParticipantAgenda(transaction, eventId, waiting.userId, now);
      await writeAuditLog(
        transaction,
        {
          eventId,
          actorId: null,
          actorType: 'system',
          action: 'waitlist.auto_cancelled',
          targetType: 'waitlist_entry',
          targetId: waiting.id,
          requestId,
          reason: 'participant_ineligible',
          after: { sessionId, status: 'cancelled' },
        },
        { generateId },
      );
      continue;
    }

    const existing = await transaction.query.reservations.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.reservations.eventId, eventId),
        eq(schema.reservations.sessionId, sessionId),
        eq(schema.reservations.userId, waiting.userId),
        eq(schema.reservations.status, 'confirmed'),
      ),
    });
    const reservationId = existing?.id ?? generateId();
    if (!existing) {
      await transaction.insert(schema.reservations).values({
        id: reservationId,
        eventId,
        sessionId,
        userId: waiting.userId,
        status: 'confirmed',
        source: 'waitlist_auto',
        version: 1,
        createdAt: now,
      });
      available -= 1;
    }
    await transaction
      .update(schema.waitlistEntries)
      .set({ status: 'promoted', promotedAt: now })
      .where(
        and(
          eq(schema.waitlistEntries.eventId, eventId),
          eq(schema.waitlistEntries.id, waiting.id),
          eq(schema.waitlistEntries.status, 'waiting'),
        ),
      );
    await bumpParticipantAgenda(transaction, eventId, waiting.userId, now);
    await writeAuditLog(
      transaction,
      {
        eventId,
        actorId: null,
        actorType: 'system',
        action: 'waitlist.auto_promoted',
        targetType: 'reservation',
        targetId: reservationId,
        requestId,
        before: { sessionId, waitlistEntryId: waiting.id, status: 'waiting' },
        after: { sessionId, waitlistEntryId: waiting.id, status: 'confirmed' },
      },
      { generateId },
    );
    promoted.push({
      waitlistEntryId: waiting.id,
      reservationId,
      userId: waiting.userId,
    });
  }
  return promoted;
};
