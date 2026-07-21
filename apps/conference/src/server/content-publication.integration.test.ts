import { and, count, eq } from 'drizzle-orm';
import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  previewContentPublication,
  publishContent,
} from './content-publication';
const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
integration('content publication integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 2,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-content-publication-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7(),
    publisherId = generateUuidV7(),
    dayId = generateUuidV7(),
    sessionId = generateUuidV7();
  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: `publish-${eventId}`,
      name: 'Publish',
      timezone: 'Europe/Prague',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T20:00:00Z'),
    });
    await client.db.insert(schema.users).values({
      id: publisherId,
      name: 'Publisher',
      email: `${publisherId}@example.invalid`,
    });
    await client.db
      .insert(schema.eventMemberships)
      .values({ eventId, userId: publisherId });
    await client.db.insert(schema.eventDays).values({
      id: dayId,
      eventId,
      localDate: '2026-09-18',
      title: 'Pátek',
      sortOrder: 0,
    });
    await client.db.insert(schema.programSessions).values({
      id: sessionId,
      eventId,
      dayId,
      slug: 'opening',
      title: 'Opening',
      type: 'talk',
      startsAt: new Date('2026-09-18T08:00:00Z'),
      endsAt: new Date('2026-09-18T09:00:00Z'),
      sortOrder: 0,
    });
  });
  afterAll(async () => client.close());
  it('builds deterministic previews and atomically publishes the expected version', async () => {
    const first = await previewContentPublication(client.db, eventId);
    const second = await previewContentPublication(client.db, eventId);
    expect(second).toEqual(first);
    expect(first.version).toBe(1);
    const published = await publishContent(client.db, {
      eventId,
      actorId: publisherId,
      requestId: crypto.randomUUID(),
      expectedPreviousVersion: 0,
      expectedChecksumSha256: first.checksumSha256,
    });
    expect(published.checksumSha256).toBe(first.checksumSha256);
    expect(published.significantSessionIds).toEqual([]);
    const publication = await client.db.query.contentPublications.findFirst({
      where: eq(schema.contentPublications.eventId, eventId),
    });
    expect(publication).toMatchObject({
      version: 1,
      checksumSha256: first.checksumSha256,
    });
    const session = (
      publication!.snapshot.program as {
        sessions: Array<Record<string, unknown>>;
      }
    ).sessions[0]!;
    expect(session).toMatchObject({ id: sessionId, status: 'published' });
    const [audit] = await client.db
      .select({ value: count() })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, eventId),
          eq(schema.auditLogs.action, 'content.publish'),
        ),
      );
    const [outbox] = await client.db
      .select({ value: count() })
      .from(schema.outboxEvents)
      .where(
        and(
          eq(schema.outboxEvents.eventId, eventId),
          eq(schema.outboxEvents.type, 'content.published'),
        ),
      );
    expect(audit!.value).toBe(1);
    expect(outbox!.value).toBe(1);
  });
  it('rejects a stale concurrent publisher without another snapshot', async () => {
    await expect(
      publishContent(client.db, {
        eventId,
        actorId: publisherId,
        requestId: crypto.randomUUID(),
        expectedPreviousVersion: 0,
        expectedChecksumSha256: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'STALE_VERSION' });
    const [publications] = await client.db
      .select({ value: count() })
      .from(schema.contentPublications)
      .where(eq(schema.contentPublications.eventId, eventId));
    expect(publications!.value).toBe(1);
  });

  it('rejects draft changes made after the reviewed preview', async () => {
    const reviewed = await previewContentPublication(client.db, eventId);
    await client.db
      .update(schema.programSessions)
      .set({ title: 'Changed after preview' })
      .where(eq(schema.programSessions.id, sessionId));
    await expect(
      publishContent(client.db, {
        eventId,
        actorId: publisherId,
        requestId: crypto.randomUUID(),
        expectedPreviousVersion: 1,
        expectedChecksumSha256: reviewed.checksumSha256,
      }),
    ).rejects.toMatchObject({ code: 'STALE_DRAFT' });
  });

  it('targets significant program changes through a deduplicated outbox event', async () => {
    await client.db
      .update(schema.programSessions)
      .set({
        startsAt: new Date('2026-09-18T09:00:00Z'),
        endsAt: new Date('2026-09-18T10:00:00Z'),
      })
      .where(eq(schema.programSessions.id, sessionId));
    const published = await publishContent(client.db, {
      eventId,
      actorId: publisherId,
      requestId: crypto.randomUUID(),
      expectedPreviousVersion: 1,
      expectedChecksumSha256: (
        await previewContentPublication(client.db, eventId)
      ).checksumSha256,
    });
    expect(published.significantSessionIds).toEqual([sessionId]);
    const change = await client.db.query.outboxEvents.findFirst({
      where: and(
        eq(schema.outboxEvents.eventId, eventId),
        eq(schema.outboxEvents.type, 'program.changed'),
      ),
    });
    expect(change).toMatchObject({
      deduplicationKey: 'program.changed:2',
      status: 'pending',
      payload: { version: 2, sessionIds: [sessionId] },
    });
  });
});
