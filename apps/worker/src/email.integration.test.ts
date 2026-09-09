import {
  createDatabaseClient,
  enqueueEmailDelivery,
  schema,
} from '@byzon/database';
import {
  notificationPayloadSchema,
  type NotificationPayload,
} from '@byzon/mail';
import type { DeliveryMessage } from '@byzon/mail/transport';
import { and, eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { dispatchEmailOnce, scheduleRatingEmails } from './email';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
integration('transactional email delivery', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 6,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'byzon-email-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    dayId = crypto.randomUUID(),
    sessionId = crypto.randomUUID(),
    publicationId = crypto.randomUUID();
  const slug = `mail-${eventId}`;
  let publicationVersion = 1;
  // Before other integration suites' dates so their queues are not dispatched here.
  const now = new Date('2025-01-21T07:00:00.000Z');
  const ratingNow = new Date('2025-01-23T08:00:00.000Z');
  const session = {
    id: sessionId,
    dayId,
    roomId: null,
    slug: 'workshop',
    title: 'Veřejný workshop',
    summary: null,
    description: null,
    type: 'workshop',
    status: 'published',
    startsAt: '2025-01-21T09:00:00.000Z',
    endsAt: '2025-01-21T10:00:00.000Z',
    sortOrder: 0,
  };
  const snapshot = {
    program: {
      days: [
        { id: dayId, localDate: '2025-01-21', title: 'Úterý', sortOrder: 0 },
      ],
      rooms: [],
      sessions: [session],
    },
  };
  const basePayload = {
    eventName: 'BYZON test',
    timezone: 'Europe/Prague',
    sessions: [
      {
        id: sessionId,
        title: session.title,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        room: null,
        cancelled: false,
      },
    ],
  };
  const rows = () =>
    client.db.query.emailDeliveries.findMany({
      where: eq(schema.emailDeliveries.eventId, eventId),
    });
  const queue = async (
    payload: NotificationPayload,
    key: string = crypto.randomUUID(),
    date = now,
  ) => {
    await client.db.transaction((tx) =>
      enqueueEmailDelivery(tx, {
        eventId,
        userId,
        payload,
        deduplicationKey: key,
        now: date,
        expiresAt: new Date(date.getTime() + 86_400_000),
      }),
    );
  };
  const reservation = async () => {
    const id = crypto.randomUUID();
    await client.db
      .insert(schema.reservations)
      .values({ id, eventId, userId, sessionId, source: 'participant' });
    return notificationPayloadSchema.parse({
      ...basePayload,
      kind: 'reservation_confirmed',
      reservationId: id,
      sessionId,
    });
  };

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug,
      name: 'BYZON test',
      startsAt: new Date('2025-01-20T07:00:00Z'),
      endsAt: new Date('2025-01-22T18:00:00Z'),
      timezone: 'Europe/Prague',
      status: 'live',
    });
    await client.db
      .insert(schema.eventFeatures)
      .values({ eventId, ratingsEnabled: true, announcementsEnabled: true });
    await client.db.insert(schema.users).values({
      id: userId,
      name: 'Martin Novák',
      email: `${userId}@example.invalid`,
      emailVerified: true,
    });
    await client.db.insert(schema.eventMemberships).values({ eventId, userId });
    await client.db.insert(schema.eventRoles).values({
      id: crypto.randomUUID(),
      eventId,
      userId,
      role: 'participant',
    });
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2025-01-21',
      title: 'Úterý',
      sortOrder: 0,
    });
    await client.db.insert(schema.programSessions).values({
      ...session,
      eventId,
      startsAt: new Date(session.startsAt),
      endsAt: new Date(session.endsAt),
      type: 'workshop',
      status: 'draft',
      title: 'NEPUBLIKOVANÝ KONCEPT',
    });
    await client.db.insert(schema.contentPublications).values({
      id: publicationId,
      eventId,
      version: 1,
      snapshot,
      checksumSha256: 'a'.repeat(64),
      publishedBy: userId,
    });
  });
  beforeEach(async () => {
    await client.db
      .delete(schema.emailDeliveries)
      .where(eq(schema.emailDeliveries.eventId, eventId));
    await client.db
      .delete(schema.reservations)
      .where(eq(schema.reservations.eventId, eventId));
    await client.db
      .delete(schema.ratings)
      .where(eq(schema.ratings.eventId, eventId));
    await client.db
      .insert(schema.participantProfiles)
      .values({
        eventId,
        userId,
        firstName: 'Martin',
        lastName: 'Novák',
        contactEmail: `${userId}@example.invalid`,
        onboardingCompletedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.participantProfiles.eventId,
          schema.participantProfiles.userId,
        ],
        set: {
          emailSalutation: null,
          ratingEmailsEnabled: true,
          contactEmail: `${userId}@example.invalid`,
        },
      });
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'active' })
      .where(
        and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, userId),
        ),
      );
    await client.db
      .update(schema.eventFeatures)
      .set({ ratingsEnabled: true })
      .where(eq(schema.eventFeatures.eventId, eventId));
    await client.db.insert(schema.contentPublications).values({
      id: crypto.randomUUID(),
      eventId,
      version: ++publicationVersion,
      snapshot,
      checksumSha256: 'a'.repeat(64),
      publishedBy: userId,
    });
  });
  afterAll(async () => {
    await client.db
      .delete(schema.emailDeliveries)
      .where(eq(schema.emailDeliveries.eventId, eventId));
    await client.close();
  });

  it('commits one delivery per mutation and rolls it back with the transaction', async () => {
    const payload = await reservation();
    await expect(
      client.db.transaction(async (tx) => {
        await enqueueEmailDelivery(tx, {
          eventId,
          userId,
          payload,
          deduplicationKey: 'rolled-back',
          now,
          expiresAt: new Date(now.getTime() + 1000),
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await rows()).toHaveLength(0);
    await queue(payload, 'one');
    await queue(payload, 'one');
    expect(await rows()).toHaveLength(1);
  });

  it('claims concurrently only once, personalizes and sends published content', async () => {
    await queue(await reservation());
    const send = vi.fn<(message: DeliveryMessage) => Promise<void>>(
      async () => {},
    );
    const outcomes = await Promise.all([
      dispatchEmailOnce(client.db, { send }, 'https://app.example.test', now),
      dispatchEmailOnce(client.db, { send }, 'https://app.example.test', now),
    ]);
    expect(outcomes.sort()).toEqual(['delivered', 'idle']);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].text).toContain('Dobrý den, Martine,');
    expect(send.mock.calls[0]![0].text).toContain('Veřejný workshop');
    expect(send.mock.calls[0]![0].text).not.toContain('NEPUBLIKOVANÝ');
    expect((await rows())[0]).toMatchObject({
      status: 'delivered',
      attempts: 1,
      rendered: null,
    });
  });

  it('retries an uncertain send with the same provider key and frozen content', async () => {
    await queue(await reservation());
    const send = vi
      .fn<(message: DeliveryMessage) => Promise<void>>(async () => {})
      .mockRejectedValueOnce(new Error('secret provider payload'));
    expect(
      await dispatchEmailOnce(
        client.db,
        { send },
        'https://app.example.test',
        now,
      ),
    ).toBe('retried');
    expect(
      await dispatchEmailOnce(
        client.db,
        { send },
        'https://app.example.test',
        new Date(now.getTime() + 30_000),
      ),
    ).toBe('idle');
    await client.db
      .update(schema.participantProfiles)
      .set({ emailSalutation: 'Martínku' })
      .where(eq(schema.participantProfiles.eventId, eventId));
    expect(
      await dispatchEmailOnce(
        client.db,
        { send },
        'https://app.example.test',
        new Date(now.getTime() + 60_000),
      ),
    ).toBe('delivered');
    expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0]);
    expect((await rows())[0]).toMatchObject({
      attempts: 2,
      lastError: null,
      rendered: null,
    });
  });

  it('suppresses confirmation after cancellation and stops sending after a newer publication', async () => {
    const payload = await reservation();
    await queue(payload);
    await client.db
      .update(schema.reservations)
      .set({ status: 'cancelled', cancelledAt: now })
      .where(eq(schema.reservations.id, payload.reservationId!));
    const send = vi.fn();
    expect(
      await dispatchEmailOnce(
        client.db,
        { send },
        'https://app.example.test',
        now,
      ),
    ).toBe('skipped');
    await queue(await reservation());
    await client.db.insert(schema.contentPublications).values({
      id: crypto.randomUUID(),
      eventId,
      version: ++publicationVersion,
      checksumSha256: 'b'.repeat(64),
      publishedBy: userId,
      snapshot: {
        program: {
          ...snapshot.program,
          sessions: [{ ...session, startsAt: '2025-01-21T09:30:00.000Z' }],
        },
      },
    });
    expect(
      await dispatchEmailOnce(
        client.db,
        { send },
        'https://app.example.test',
        now,
      ),
    ).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });

  it('checks membership again immediately before delivery', async () => {
    await queue(await reservation());
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'suspended' })
      .where(eq(schema.eventMemberships.eventId, eventId));
    const send = vi.fn();
    expect(
      await dispatchEmailOnce(
        client.db,
        { send },
        'https://app.example.test',
        now,
      ),
    ).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });

  it('clears queued personal content when its profile is deleted', async () => {
    await queue(await reservation());
    await dispatchEmailOnce(
      client.db,
      { send: vi.fn().mockRejectedValue(new Error('timeout')) },
      'https://app.example.test',
      now,
    );
    expect((await rows())[0]!.rendered).not.toBeNull();
    await client.db
      .delete(schema.participantProfiles)
      .where(eq(schema.participantProfiles.eventId, eventId));
    expect(await rows()).toHaveLength(0);
  });

  it('recovers an abandoned lease and bounds retries without logging provider secrets', async () => {
    await queue(await reservation());
    await client.db
      .update(schema.emailDeliveries)
      .set({
        status: 'processing',
        leaseToken: crypto.randomUUID(),
        attempts: 7,
        availableAt: now,
      })
      .where(eq(schema.emailDeliveries.eventId, eventId));
    const send = vi.fn().mockRejectedValue(new Error('secret token'));
    expect(
      await dispatchEmailOnce(
        client.db,
        { send },
        'https://app.example.test',
        now,
      ),
    ).toBe('failed');
    expect((await rows())[0]).toMatchObject({
      status: 'failed',
      attempts: 8,
      rendered: null,
      lastError: 'delivery_unavailable',
    });
    expect(
      await dispatchEmailOnce(
        client.db,
        { send },
        'https://app.example.test',
        now,
      ),
    ).toBe('idle');
  });

  it('schedules one event rating email after 12 hours and delivers to the rating page', async () => {
    expect(
      await scheduleRatingEmails(
        client.db,
        new Date('2025-01-23T05:59:59Z'),
        slug,
      ),
    ).toBe(0);
    expect(await scheduleRatingEmails(client.db, ratingNow, slug)).toBe(1);
    expect(await scheduleRatingEmails(client.db, ratingNow, slug)).toBe(0);
    const send = vi.fn<(message: DeliveryMessage) => Promise<void>>(
      async () => {},
    );
    expect(
      await dispatchEmailOnce(
        client.db,
        { send },
        'https://app.example.test',
        ratingNow,
      ),
    ).toBe('delivered');
    expect(send.mock.calls[0]![0].text).toContain(
      'https://app.example.test/app/hodnoceni',
    );
  });

  it.each(['preference', 'feature', 'rated'] as const)(
    'respects %s changes between scheduling and sending a rating reminder',
    async (reason) => {
      expect(await scheduleRatingEmails(client.db, ratingNow, slug)).toBe(1);
      if (reason === 'preference')
        await client.db
          .update(schema.participantProfiles)
          .set({ ratingEmailsEnabled: false })
          .where(eq(schema.participantProfiles.eventId, eventId));
      if (reason === 'feature')
        await client.db
          .update(schema.eventFeatures)
          .set({ ratingsEnabled: false })
          .where(eq(schema.eventFeatures.eventId, eventId));
      if (reason === 'rated')
        await client.db.insert(schema.ratings).values({
          id: crypto.randomUUID(),
          eventId,
          userId,
          targetType: 'event',
          score: 5,
        });
      const send = vi.fn();
      expect(
        await dispatchEmailOnce(
          client.db,
          { send },
          'https://app.example.test',
          ratingNow,
        ),
      ).toBe('skipped');
      expect(send).not.toHaveBeenCalled();
    },
  );
});
