import { randomUUID } from 'node:crypto';
import { enqueueEmailDelivery, schema, type Database } from '@byzon/database';
import { publishedProgramAgendaSnapshotSchema } from '@byzon/domain/contracts';
import {
  createNotificationEmail,
  notificationPayloadSchema,
  type NotificationPayload,
} from '@byzon/mail';
import type { MailTransport } from '@byzon/mail/transport';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

const MAX_ATTEMPTS = 8;
const LEASE_MS = 60_000;
const HOUR = 60 * 60_000;
type Delivery = typeof schema.emailDeliveries.$inferSelect;
type Outcome = 'idle' | 'delivered' | 'skipped' | 'retried' | 'failed';

const claim = (db: Database, now: Date) =>
  db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(schema.emailDeliveries)
      .where(
        and(
          inArray(schema.emailDeliveries.status, ['pending', 'processing']),
          lte(schema.emailDeliveries.availableAt, now),
        ),
      )
      .orderBy(
        asc(schema.emailDeliveries.createdAt),
        asc(schema.emailDeliveries.id),
      )
      .limit(1)
      .for('update', { skipLocked: true });
    if (!candidate) return null;
    const [row] = await transaction
      .update(schema.emailDeliveries)
      .set({
        status: 'processing',
        leaseToken: randomUUID(),
        attempts: candidate.attempts + 1,
        availableAt: new Date(now.getTime() + LEASE_MS),
      })
      .where(eq(schema.emailDeliveries.id, candidate.id))
      .returning();
    return row ?? null;
  });
const owned = (delivery: Delivery) =>
  and(
    eq(schema.emailDeliveries.id, delivery.id),
    eq(schema.emailDeliveries.leaseToken, delivery.leaseToken!),
    eq(schema.emailDeliveries.status, 'processing'),
  );
const finish = async (
  db: Database,
  delivery: Delivery,
  now: Date,
  reason: string | null,
  failed = false,
) => {
  await db
    .update(schema.emailDeliveries)
    .set({
      status: failed ? 'failed' : 'delivered',
      deliveredAt: failed ? null : now,
      leaseToken: null,
      rendered: null,
      lastError: reason,
    })
    .where(owned(delivery));
};

const currentRecipient = async (
  db: Database,
  delivery: Delivery,
  now: Date,
) => {
  const [recipient] = await db
    .select({
      firstName: schema.participantProfiles.firstName,
      emailSalutation: schema.participantProfiles.emailSalutation,
      ratingEmailsEnabled: schema.participantProfiles.ratingEmailsEnabled,
      to: schema.participantProfiles.contactEmail,
      endsAt: schema.events.endsAt,
    })
    .from(schema.participantProfiles)
    .innerJoin(
      schema.eventMemberships,
      and(
        eq(schema.eventMemberships.eventId, schema.participantProfiles.eventId),
        eq(schema.eventMemberships.userId, schema.participantProfiles.userId),
      ),
    )
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.participantProfiles.userId),
    )
    .innerJoin(
      schema.events,
      eq(schema.events.id, schema.participantProfiles.eventId),
    )
    .where(
      and(
        eq(schema.participantProfiles.eventId, delivery.eventId),
        eq(schema.participantProfiles.userId, delivery.userId),
        eq(schema.eventMemberships.status, 'active'),
        eq(schema.users.emailVerified, true),
        inArray(schema.events.status, ['activation_open', 'live', 'ended']),
        or(
          isNull(schema.events.operationalDataAnonymizesAt),
          sql`${schema.events.operationalDataAnonymizesAt} > ${now}`,
        ),
      ),
    )
    .limit(1);
  if (!recipient) return null;
  const [role, deletion] = await Promise.all([
    db.query.eventRoles.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.eventRoles.eventId, delivery.eventId),
        eq(schema.eventRoles.userId, delivery.userId),
        eq(schema.eventRoles.role, 'participant'),
        isNull(schema.eventRoles.revokedAt),
      ),
    }),
    db.query.privacyRequests.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.privacyRequests.eventId, delivery.eventId),
        eq(schema.privacyRequests.userId, delivery.userId),
        inArray(schema.privacyRequests.status, ['pending', 'completed']),
      ),
    }),
  ]);
  return role && !deletion ? recipient : null;
};

const stillRelevant = async (
  db: Database,
  row: Delivery,
  p: NotificationPayload,
  now: Date,
  recipient: NonNullable<Awaited<ReturnType<typeof currentRecipient>>>,
): Promise<boolean> => {
  if (
    [
      'reservation_confirmed',
      'waitlist_joined',
      'waitlist_promoted',
      'program_changed',
    ].includes(p.kind)
  ) {
    const publication = await db.query.contentPublications.findFirst({
      columns: { snapshot: true },
      where: eq(schema.contentPublications.eventId, row.eventId),
      orderBy: [desc(schema.contentPublications.version)],
    });
    if (!publication || !p.sessions.length) return false;
    const program = publishedProgramAgendaSnapshotSchema.parse(
      publication.snapshot,
    ).program;
    // An older queued message must not announce a time/place that a newer publication replaced.
    if (
      !p.sessions.every((s) => {
        const current = program.sessions.find((session) => session.id === s.id);
        if (p.kind === 'program_changed' && s.cancelled)
          return !current || current.status === 'cancelled';
        return (
          current?.status === 'published' &&
          Date.parse(current.endsAt) > now.getTime() &&
          current.startsAt === s.startsAt &&
          current.endsAt === s.endsAt &&
          (program.rooms.find((r) => r.id === current.roomId)?.name ?? null) ===
            s.room
        );
      })
    )
      return false;
    if (p.kind === 'program_changed') {
      const sessions = await db
        .select({
          id: schema.programSessions.id,
          group: schema.programSessions.reservationGroupId,
        })
        .from(schema.programSessions)
        .where(
          and(
            eq(schema.programSessions.eventId, row.eventId),
            inArray(
              schema.programSessions.id,
              p.sessions.map((s) => s.id),
            ),
          ),
        );
      const canonicalIds = sessions.map((s) => s.group ?? s.id);
      const [agenda, reservations, waiting] = await Promise.all([
        db.query.agendaItems.findFirst({
          columns: { sessionId: true },
          where: and(
            eq(schema.agendaItems.eventId, row.eventId),
            eq(schema.agendaItems.userId, row.userId),
            inArray(
              schema.agendaItems.sessionId,
              p.sessions.map((s) => s.id),
            ),
          ),
        }),
        db.query.reservations.findFirst({
          columns: { id: true },
          where: and(
            eq(schema.reservations.eventId, row.eventId),
            eq(schema.reservations.userId, row.userId),
            eq(schema.reservations.status, 'confirmed'),
            inArray(schema.reservations.sessionId, canonicalIds),
          ),
        }),
        db.query.waitlistEntries.findFirst({
          columns: { id: true },
          where: and(
            eq(schema.waitlistEntries.eventId, row.eventId),
            eq(schema.waitlistEntries.userId, row.userId),
            eq(schema.waitlistEntries.status, 'waiting'),
            inArray(schema.waitlistEntries.sessionId, canonicalIds),
          ),
        }),
      ]);
      if (!agenda && !reservations && !waiting) return false;
    }
  }
  if (p.reservationId) {
    const reservation = await db.query.reservations.findFirst({
      where: and(
        eq(schema.reservations.id, p.reservationId),
        eq(schema.reservations.eventId, row.eventId),
        eq(schema.reservations.userId, row.userId),
      ),
    });
    if (
      !reservation ||
      reservation.status !==
        (p.kind === 'reservation_cancelled' ? 'cancelled' : 'confirmed')
    )
      return false;
    if (p.kind === 'reservation_cancelled') {
      const newer = await db.query.reservations.findFirst({
        columns: { id: true },
        where: and(
          eq(schema.reservations.eventId, row.eventId),
          eq(schema.reservations.userId, row.userId),
          eq(schema.reservations.sessionId, reservation.sessionId),
          eq(schema.reservations.status, 'confirmed'),
        ),
      });
      if (newer) return false;
    }
  }
  if (p.waitlistEntryId) {
    const waiting = await db.query.waitlistEntries.findFirst({
      where: and(
        eq(schema.waitlistEntries.id, p.waitlistEntryId),
        eq(schema.waitlistEntries.eventId, row.eventId),
        eq(schema.waitlistEntries.userId, row.userId),
      ),
    });
    const expected =
      p.kind === 'waitlist_left'
        ? 'cancelled'
        : p.kind === 'waitlist_promoted'
          ? 'promoted'
          : 'waiting';
    if (!waiting || waiting.status !== expected) return false;
    if (p.kind === 'waitlist_left') {
      const [again, reserved] = await Promise.all([
        db.query.waitlistEntries.findFirst({
          columns: { id: true },
          where: and(
            eq(schema.waitlistEntries.eventId, row.eventId),
            eq(schema.waitlistEntries.userId, row.userId),
            eq(schema.waitlistEntries.sessionId, waiting.sessionId),
            eq(schema.waitlistEntries.status, 'waiting'),
          ),
        }),
        db.query.reservations.findFirst({
          columns: { id: true },
          where: and(
            eq(schema.reservations.eventId, row.eventId),
            eq(schema.reservations.userId, row.userId),
            eq(schema.reservations.sessionId, waiting.sessionId),
            eq(schema.reservations.status, 'confirmed'),
          ),
        }),
      ]);
      if (again || reserved) return false;
    }
  }
  if (p.kind === 'rating_reminder') {
    if (
      !recipient.ratingEmailsEnabled ||
      now.getTime() < recipient.endsAt.getTime() + 12 * HOUR
    )
      return false;
    const [feature, rating] = await Promise.all([
      db.query.eventFeatures.findFirst({
        columns: { ratingsEnabled: true },
        where: eq(schema.eventFeatures.eventId, row.eventId),
      }),
      db.query.ratings.findFirst({
        columns: { id: true },
        where: and(
          eq(schema.ratings.eventId, row.eventId),
          eq(schema.ratings.userId, row.userId),
          eq(schema.ratings.targetType, 'event'),
        ),
      }),
    ]);
    return feature?.ratingsEnabled === true && !rating;
  }
  if (p.kind === 'announcement') {
    const [feature, target] = await Promise.all([
      db.query.eventFeatures.findFirst({
        columns: { announcementsEnabled: true },
        where: eq(schema.eventFeatures.eventId, row.eventId),
      }),
      db.query.announcementRecipients.findFirst({
        columns: { userId: true },
        where: and(
          eq(schema.announcementRecipients.eventId, row.eventId),
          eq(schema.announcementRecipients.userId, row.userId),
          eq(schema.announcementRecipients.announcementId, p.announcementId!),
        ),
      }),
    ]);
    return feature?.announcementsEnabled === true && Boolean(target);
  }
  return true;
};

/** Network I/O is outside database transactions. A frozen request + stable provider key
 * covers retry after an uncertain response. Lease ownership fences stale workers.
 */
export const dispatchEmailOnce = async (
  db: Database,
  transport: MailTransport,
  appOrigin: string,
  now = new Date(),
): Promise<Outcome> => {
  const delivery = await claim(db, now);
  if (!delivery) return 'idle';
  try {
    if (delivery.expiresAt <= now) {
      await finish(db, delivery, now, 'skipped_expired');
      return 'skipped';
    }
    if (delivery.attempts > MAX_ATTEMPTS) {
      await finish(db, delivery, now, 'attempts_exhausted', true);
      return 'failed';
    }
    const parsed = notificationPayloadSchema.safeParse(delivery.payload);
    if (!parsed.success) {
      await finish(db, delivery, now, 'invalid_payload', true);
      return 'failed';
    }
    const recipient = await currentRecipient(db, delivery, now);
    if (
      !recipient ||
      !(await stillRelevant(db, delivery, parsed.data, now, recipient))
    ) {
      await finish(db, delivery, now, 'skipped_no_longer_relevant');
      return 'skipped';
    }
    // Do not send a frozen retry to a contact address the participant has since replaced.
    if (delivery.rendered && delivery.rendered.to !== recipient.to) {
      await finish(db, delivery, now, 'skipped_recipient_changed');
      return 'skipped';
    }
    const content = delivery.rendered ?? {
      ...createNotificationEmail(parsed.data, recipient, appOrigin),
      to: recipient.to,
    };
    const saved = await db
      .update(schema.emailDeliveries)
      .set({ rendered: content })
      .where(owned(delivery))
      .returning({ id: schema.emailDeliveries.id });
    if (!saved.length) return 'skipped';
    await transport.send({
      ...content,
      category: 'notification',
      idempotencyKey: `byzon-notification-${delivery.id}`,
    });
    await finish(db, delivery, now, null);
    return 'delivered';
  } catch {
    if (delivery.attempts >= MAX_ATTEMPTS) {
      await finish(db, delivery, now, 'delivery_unavailable', true);
      return 'failed';
    }
    await db
      .update(schema.emailDeliveries)
      .set({
        status: 'pending',
        leaseToken: null,
        availableAt: new Date(
          now.getTime() +
            Math.min(60 * 2 ** (delivery.attempts - 1), 3600) * 1000,
        ),
        lastError: 'delivery_unavailable',
      })
      .where(owned(delivery));
    return 'retried';
  }
};

/** One invitation to rate the whole conference, 12h after its end, for at most 7 days.
 * No reminders for individual talks or historical backfill beyond that window.
 */
export const scheduleRatingEmails = async (
  db: Database,
  now = new Date(),
  eventSlug = 'byzon-2026',
): Promise<number> =>
  db.transaction(async (transaction) => {
    const candidates = await transaction
      .select({
        eventId: schema.events.id,
        userId: schema.participantProfiles.userId,
        name: schema.events.name,
        timezone: schema.events.timezone,
        endsAt: schema.events.endsAt,
      })
      .from(schema.events)
      .innerJoin(
        schema.eventFeatures,
        eq(schema.eventFeatures.eventId, schema.events.id),
      )
      .innerJoin(
        schema.participantProfiles,
        eq(schema.participantProfiles.eventId, schema.events.id),
      )
      .innerJoin(
        schema.eventMemberships,
        and(
          eq(schema.eventMemberships.eventId, schema.events.id),
          eq(schema.eventMemberships.userId, schema.participantProfiles.userId),
        ),
      )
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.participantProfiles.userId),
      )
      .where(
        and(
          eq(schema.events.slug, eventSlug),
          inArray(schema.events.status, ['live', 'ended']),
          eq(schema.eventFeatures.ratingsEnabled, true),
          eq(schema.participantProfiles.ratingEmailsEnabled, true),
          eq(schema.users.emailVerified, true),
          eq(schema.eventMemberships.status, 'active'),
          sql`${schema.participantProfiles.onboardingCompletedAt} is not null`,
          sql`${schema.events.endsAt} <= ${new Date(now.getTime() - 12 * HOUR)}`,
          sql`${schema.events.endsAt} > ${new Date(now.getTime() - 7 * 24 * HOUR)}`,
          sql`exists (select 1 from ${schema.eventRoles} where ${schema.eventRoles.eventId} = ${schema.events.id} and ${schema.eventRoles.userId} = ${schema.participantProfiles.userId} and ${schema.eventRoles.role} = 'participant' and ${schema.eventRoles.revokedAt} is null)`,
          sql`not exists (select 1 from ${schema.ratings} where ${schema.ratings.eventId} = ${schema.events.id} and ${schema.ratings.userId} = ${schema.participantProfiles.userId} and ${schema.ratings.targetType} = 'event')`,
          sql`not exists (select 1 from ${schema.emailDeliveries} where ${schema.emailDeliveries.eventId} = ${schema.events.id} and ${schema.emailDeliveries.userId} = ${schema.participantProfiles.userId} and ${schema.emailDeliveries.deduplicationKey} = 'rating_reminder')`,
        ),
      )
      .orderBy(asc(schema.participantProfiles.userId))
      .limit(100);
    for (const candidate of candidates)
      await enqueueEmailDelivery(transaction, {
        eventId: candidate.eventId,
        userId: candidate.userId,
        deduplicationKey: 'rating_reminder',
        payload: notificationPayloadSchema.parse({
          kind: 'rating_reminder',
          eventName: candidate.name.replace(/\s+/g, ' ').trim().slice(0, 200),
          timezone: candidate.timezone,
        }),
        now,
        expiresAt: new Date(candidate.endsAt.getTime() + 7 * 24 * HOUR),
      });
    return candidates.length;
  });
