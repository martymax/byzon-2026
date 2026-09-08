import { createDatabaseClient, schema } from '@byzon/database';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  handleAdminAnnouncementDelete,
  handleAdminAnnouncementList,
  handleAdminAnnouncementPreview,
  handleAdminAnnouncementSend,
} from './admin-announcements';
import { handleParticipantAnnouncement } from './participant-announcements';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('announcement deletion across admin and participant APIs', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'byzon-announcement-delete-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const otherEventId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const users = [crypto.randomUUID(), crypto.randomUUID()];
  const slug = `announcement-delete-${eventId}`;
  const origin = 'http://localhost:3000';
  const path = `${origin}/api/v1/admin/events/${eventId}/announcements`;
  const now = new Date('2026-09-08T10:00:00Z');
  const dependencies = (userId = adminId) => ({
    db: client.db,
    allowedOrigin: origin,
    getSession: async () => ({ user: { id: userId } }),
    now: () => now,
  });
  const participantDependencies = (userId: string) => ({
    ...dependencies(userId),
    currentEventSlug: slug,
  });
  const mutation = (url: string, method: string, key: string, body?: unknown) =>
    new Request(url, {
      method,
      headers: {
        origin,
        'idempotency-key': key,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const announcements: {
    id: string;
    previewId: string;
    previewVersion: number;
  }[] = [];

  beforeAll(async () => {
    await client.db.insert(schema.events).values(
      [eventId, otherEventId].map((id) => ({
        id,
        slug: id === eventId ? slug : `announcement-other-${id}`,
        name: 'Announcement test',
        startsAt: now,
        endsAt: new Date('2026-09-20T10:00:00Z'),
        timezone: 'Europe/Prague',
        status: 'live' as const,
      })),
    );
    await client.db.insert(schema.users).values(
      [adminId, ...users].map((id) => ({
        id,
        name: 'Test user',
        email: `${id}@example.invalid`,
      })),
    );
    await client.db.insert(schema.eventMemberships).values(
      [eventId, otherEventId].flatMap((eventId) =>
        [adminId, ...users].map((userId) => ({
          eventId,
          userId,
          status: 'active' as const,
        })),
      ),
    );
    await client.db.insert(schema.eventRoles).values(
      [eventId, otherEventId].flatMap((eventId) =>
        [adminId, ...users].map((userId) => ({
          id: crypto.randomUUID(),
          eventId,
          userId,
          role:
            userId === adminId
              ? ('organizer_admin' as const)
              : ('participant' as const),
        })),
      ),
    );
    await client.db.insert(schema.eventFeatures).values(
      [eventId, otherEventId].map((eventId) => ({
        eventId,
        announcementsEnabled: true,
      })),
    );
    for (let i = 0; i < 22; i += 1) {
      const preview = await handleAdminAnnouncementPreview(
        mutation(`${path}/preview`, 'POST', `preview-${i}`, {
          draft: {
            title: `Oznámení ${i}`,
            bodyText: 'Změna programu akce.',
            severity: 'critical',
            audience: { kind: 'event' },
          },
        }),
        eventId,
        dependencies(),
      );
      expect(preview.status).toBe(201);
      const { previewId, previewVersion } = await preview.json();
      const sent = await handleAdminAnnouncementSend(
        mutation(`${path}/send`, 'POST', `send-test-${i}`, {
          previewId,
          previewVersion,
          reason: 'Test odeslání oznámení.',
        }),
        eventId,
        dependencies(),
      );
      expect(sent.status).toBe(201);
      const { announcementId } = await sent.json();
      announcements.push({ id: announcementId, previewId, previewVersion });
    }
  });

  afterAll(async () => {
    for (const table of [
      schema.announcements,
      schema.auditLogs,
      schema.idempotencyKeys,
    ]) {
      await client.db
        .delete(table)
        .where(inArray(table.eventId, [eventId, otherEventId]));
    }
    await client.db
      .delete(schema.announcementPreviews)
      .where(
        inArray(schema.announcementPreviews.eventId, [eventId, otherEventId]),
      );
    await client.db
      .delete(schema.events)
      .where(inArray(schema.events.id, [eventId, otherEventId]));
    await client.db
      .delete(schema.users)
      .where(inArray(schema.users.id, [adminId, ...users]));
    await client.close();
  });

  it('rejects participants, foreign origins, missing sessions, and cross-event deletes', async () => {
    const id = announcements[0]!.id;
    const request = () => mutation(`${path}/${id}`, 'DELETE', 'denied-delete');
    expect(
      (
        await handleAdminAnnouncementDelete(
          request(),
          eventId,
          id,
          dependencies(users[0]),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleAdminAnnouncementList(
          new Request(path),
          eventId,
          dependencies(users[0]),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleAdminAnnouncementDelete(request(), eventId, id, {
          ...dependencies(),
          getSession: async () => null,
        })
      ).status,
    ).toBe(401);
    const foreign = request();
    foreign.headers.set('origin', 'https://other.invalid');
    expect(
      (
        await handleAdminAnnouncementDelete(
          foreign,
          eventId,
          id,
          dependencies(),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleAdminAnnouncementDelete(
          request(),
          otherEventId,
          id,
          dependencies(),
        )
      ).status,
    ).toBe(404);
    expect(
      await client.db.query.announcements.findFirst({
        where: eq(schema.announcements.id, id),
      }),
    ).toBeDefined();
  });

  it('lists all sent messages through stable private pagination', async () => {
    const response = await handleAdminAnnouncementList(
      new Request(path),
      eventId,
      dependencies(),
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const first = await response.json();
    expect(first.items).toHaveLength(20);
    expect(first.items[0].recipientCount).toBe(2);
    const second = await (
      await handleAdminAnnouncementList(
        new Request(`${path}?cursor=${first.nextCursor}`),
        eventId,
        dependencies(),
      )
    ).json();
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(22);
    expect(
      (
        await handleAdminAnnouncementList(
          new Request(`${path}?cursor=invalid`),
          eventId,
          dependencies(),
        )
      ).status,
    ).toBe(422);
  });

  it('removes read and unread deliveries, detail access, and unread counts, with one audit on retry', async () => {
    const id = announcements[0]!.id;
    await client.db
      .update(schema.announcementRecipients)
      .set({ readAt: now })
      .where(
        and(
          eq(schema.announcementRecipients.announcementId, id),
          eq(schema.announcementRecipients.userId, users[0]!),
        ),
      );
    const inbox = async (userId: string) =>
      (
        await handleParticipantAnnouncement(
          new Request(`${origin}/api/v1/me/announcements?limit=50`),
          'inbox',
          participantDependencies(userId),
        )
      ).json();
    const before = await inbox(users[1]!);
    const request = () =>
      mutation(`${path}/${id}`, 'DELETE', 'delete-test-once');
    const removed = await handleAdminAnnouncementDelete(
      request(),
      eventId,
      id,
      dependencies(),
    );
    expect(removed.status).toBe(200);
    expect(removed.headers.get('cache-control')).toBe('private, no-store');
    const replay = await handleAdminAnnouncementDelete(
      request(),
      eventId,
      id,
      dependencies(),
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    for (const userId of users) {
      expect(
        (await inbox(userId)).items.some(
          (item: { id: string }) => item.id === id,
        ),
      ).toBe(false);
      for (const action of [{ detailId: id }, { readId: id }]) {
        const request =
          'readId' in action
            ? mutation(
                `${origin}/api/v1/me/announcements/${id}/read`,
                'POST',
                'read-deleted',
              )
            : new Request(`${origin}/api/v1/me/announcements/${id}`);
        expect(
          (
            await handleParticipantAnnouncement(
              request,
              action,
              participantDependencies(userId),
            )
          ).status,
        ).toBe(404);
      }
    }
    expect((await inbox(users[1]!)).unreadCount).toBe(before.unreadCount - 1);
    expect(
      await client.db.query.announcementRecipients.findMany({
        where: eq(schema.announcementRecipients.announcementId, id),
      }),
    ).toHaveLength(0);
    expect(
      await client.db.query.auditLogs.findMany({
        where: and(
          eq(schema.auditLogs.targetId, id),
          eq(schema.auditLogs.action, 'announcement.delete'),
        ),
      }),
    ).toHaveLength(1);
    const history = await (
      await handleAdminAnnouncementList(
        new Request(`${path}?cursor=${announcements[2]!.id}`),
        eventId,
        dependencies(),
      )
    ).json();
    expect(history.items.some((item: { id: string }) => item.id === id)).toBe(
      false,
    );
  });

  it('cannot recreate a deleted announcement by resending its old preview', async () => {
    const { id, previewId, previewVersion } = announcements[0]!;
    const response = await handleAdminAnnouncementSend(
      mutation(`${path}/send`, 'POST', 'send-after-delete', {
        previewId,
        previewVersion,
        reason: 'Opakovaný pokus o odeslání.',
      }),
      eventId,
      dependencies(),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).outcome).toBe('already_sent');
    expect(
      await client.db.query.announcements.findFirst({
        where: eq(schema.announcements.id, id),
      }),
    ).toBeUndefined();
    const concurrent = announcements[1]!.id;
    const results = await Promise.all(
      ['concurrent-one', 'concurrent-two'].map((key) =>
        handleAdminAnnouncementDelete(
          mutation(`${path}/${concurrent}`, 'DELETE', key),
          eventId,
          concurrent,
          dependencies(),
        ),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([200, 404]);
  });
});
