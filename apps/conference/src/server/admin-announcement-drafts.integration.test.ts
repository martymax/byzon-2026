import { createDatabaseClient, schema } from '@byzon/database';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  handleAdminAnnouncementDrafts,
  handleAdminAnnouncementPreview,
  handleAdminAnnouncementSend,
  handleAdminAnnouncementDelete,
} from './admin-announcements';
import { handleParticipantAnnouncement } from './participant-announcements';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('shared announcement drafts', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'announcement-drafts-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const otherEventId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const otherAdminId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const lateParticipantId = crypto.randomUUID();
  const allUsers = [adminId, otherAdminId, participantId, lateParticipantId];
  const origin = 'http://localhost:3000';
  const path = `${origin}/api/v1/admin/events/${eventId}/announcements`;
  let now = new Date('2026-09-17T10:00:00Z');
  const dependencies = (userId = adminId) => ({
    db: client.db,
    allowedOrigin: origin,
    getSession: async () => ({ user: { id: userId } }),
    now: () => now,
  });
  const mutation = (suffix: string, body: unknown, key = crypto.randomUUID()) =>
    new Request(`${path}${suffix}`, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify(body),
    });
  const draft = {
    title: 'Změna programu',
    bodyText: 'Workshop začne o půl hodiny později.',
    severity: 'critical' as const,
    audience: { kind: 'event' as const },
  };
  const save = async (
    draftId: string,
    expectedVersion = 0,
    content = draft,
    userId = adminId,
    key?: string,
  ) =>
    handleAdminAnnouncementDrafts(
      mutation(
        '/drafts',
        { action: 'save', draftId, expectedVersion, draft: content },
        key,
      ),
      eventId,
      dependencies(userId),
    );
  const preview = async (
    draftId: string,
    version = 1,
    content = draft,
    userId = otherAdminId,
  ) =>
    handleAdminAnnouncementPreview(
      mutation('/preview', {
        draft: content,
        sourceDraft: { id: draftId, version },
      }),
      eventId,
      dependencies(userId),
    );
  const send = async (
    body: { previewId: string; previewVersion: number },
    userId = otherAdminId,
    key?: string,
  ) =>
    handleAdminAnnouncementSend(
      mutation(
        '/send',
        {
          previewId: body.previewId,
          previewVersion: body.previewVersion,
          reason: 'Aktuální informace pro účastníky.',
        },
        key,
      ),
      eventId,
      dependencies(userId),
    );

  beforeAll(async () => {
    await client.db.insert(schema.events).values(
      [eventId, otherEventId].map((id) => ({
        id,
        slug: `drafts-${id}`,
        name: 'Koncepty test',
        startsAt: now,
        endsAt: new Date('2026-09-20T18:00:00Z'),
        timezone: 'Europe/Prague',
        status: 'live' as const,
      })),
    );
    await client.db.insert(schema.users).values(
      allUsers.map((id) => ({
        id,
        name: 'Test user',
        email: `${id}@example.invalid`,
      })),
    );
    await client.db.insert(schema.eventMemberships).values(
      [eventId, otherEventId].flatMap((eventId) =>
        allUsers.map((userId) => ({
          eventId,
          userId,
          status: 'active' as const,
        })),
      ),
    );
    await client.db.insert(schema.eventRoles).values(
      [eventId, otherEventId].flatMap((eventId) =>
        [adminId, otherAdminId, participantId].map((userId) => ({
          id: crypto.randomUUID(),
          eventId,
          userId,
          role:
            userId === participantId
              ? ('participant' as const)
              : ('organizer_admin' as const),
        })),
      ),
    );
    await client.db.insert(schema.participantProfiles).values(
      [participantId, lateParticipantId].map((userId) => ({
        eventId,
        userId,
        firstName: 'Jana',
        lastName: 'Test',
        contactEmail: `${userId}@example.invalid`,
      })),
    );
    await client.db.insert(schema.eventFeatures).values(
      [eventId, otherEventId].map((eventId) => ({
        eventId,
        announcementsEnabled: true,
      })),
    );
  });
  afterAll(async () => {
    for (const table of [
      schema.announcements,
      schema.announcementPreviews,
      schema.announcementDrafts,
      schema.auditLogs,
      schema.idempotencyKeys,
    ])
      await client.db
        .delete(table)
        .where(inArray(table.eventId, [eventId, otherEventId]));
    await client.db
      .delete(schema.events)
      .where(inArray(schema.events.id, [eventId, otherEventId]));
    await client.db
      .delete(schema.users)
      .where(inArray(schema.users.id, allUsers));
    await client.close();
  });

  it('saves incomplete content without recipients, previews, inbox messages or emails; replays safely', async () => {
    const draftId = crypto.randomUUID();
    const key = crypto.randomUUID();
    const content = { ...draft, bodyText: '' };
    const first = await save(draftId, 0, content, adminId, key);
    expect(first.status).toBe(201);
    expect(first.headers.get('cache-control')).toBe('private, no-store');
    const replay = await save(draftId, 0, content, adminId, key);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect((await replay.json()).item.version).toBe(1);
    for (const table of [
      schema.announcements,
      schema.announcementPreviews,
      schema.announcementRecipients,
      schema.emailDeliveries,
    ]) {
      expect(
        await client.db.select().from(table).where(eq(table.eventId, eventId)),
      ).toHaveLength(0);
    }
    const inbox = await handleParticipantAnnouncement(
      new Request(`${origin}/api/v1/me/announcements`),
      'inbox',
      { ...dependencies(participantId), currentEventSlug: `drafts-${eventId}` },
    );
    expect((await inbox.json()).items).toHaveLength(0);
    expect((await preview(draftId, 1, content)).status).toBe(422);
    expect(
      (await save(crypto.randomUUID(), 0, { ...draft, title: '<b>HTML</b>' }))
        .status,
    ).toBe(422);
  });

  it('lets another admin reopen and edit a day later, then calculates current recipients and records the sender', async () => {
    const draftId = crypto.randomUUID();
    expect((await save(draftId)).status).toBe(201);
    now = new Date('2026-09-18T10:00:00Z');
    const loaded = await handleAdminAnnouncementDrafts(
      new Request(`${path}/drafts/${draftId}`),
      eventId,
      dependencies(otherAdminId),
      draftId,
    );
    expect(loaded.status).toBe(200);
    expect((await loaded.json()).item.createdBy).toBe(adminId);
    const content = { ...draft, title: 'Změna programu – upřesnění' };
    const updated = await save(draftId, 1, content, otherAdminId);
    expect((await updated.json()).item).toMatchObject({
      version: 2,
      createdBy: adminId,
      updatedBy: otherAdminId,
    });
    await client.db.insert(schema.eventRoles).values({
      id: crypto.randomUUID(),
      eventId,
      userId: lateParticipantId,
      role: 'participant',
    });
    const checked = await preview(draftId, 2, content);
    expect(checked.status).toBe(201);
    const check = await checked.json();
    expect(check.audience.recipientCount).toBe(2);
    const sent = await send(check);
    expect(sent.status).toBe(201);
    const receipt = await sent.json();
    expect(
      await client.db.query.announcements.findFirst({
        where: eq(schema.announcements.id, receipt.announcementId),
      }),
    ).toMatchObject({ createdBy: otherAdminId, title: content.title });
    expect(
      await client.db.query.emailDeliveries.findMany({
        where: eq(schema.emailDeliveries.eventId, eventId),
      }),
    ).toHaveLength(2);
    const list = await handleAdminAnnouncementDrafts(
      new Request(`${path}/drafts`),
      eventId,
      dependencies(),
    );
    expect(
      (await list.json()).items.some(
        (item: { id: string }) => item.id === draftId,
      ),
    ).toBe(false);
    expect((await save(draftId, 2, content)).status).toBe(409);
  });

  it('rejects foreign events, participants, untrusted origins and disabled announcements', async () => {
    const id = crypto.randomUUID();
    expect((await save(id)).status).toBe(201);
    for (const method of ['GET', 'POST']) {
      const request =
        method === 'GET'
          ? new Request(`${path}/drafts`)
          : mutation('/drafts', {
              action: 'save',
              draftId: crypto.randomUUID(),
              expectedVersion: 0,
              draft,
            });
      expect(
        (
          await handleAdminAnnouncementDrafts(
            request,
            eventId,
            dependencies(participantId),
          )
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await handleAdminAnnouncementDrafts(
          new Request(`${path}/drafts/${id}`),
          otherEventId,
          dependencies(otherAdminId),
          id,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleAdminAnnouncementDrafts(
          mutation('/drafts', {
            action: 'save',
            draftId: id,
            expectedVersion: 1,
            draft,
          }),
          otherEventId,
          dependencies(),
        )
      ).status,
    ).toBe(404);
    const badOrigin = mutation('/drafts', {
      action: 'delete',
      draftId: id,
      expectedVersion: 1,
    });
    badOrigin.headers.set('origin', 'https://untrusted.invalid');
    expect(
      (await handleAdminAnnouncementDrafts(badOrigin, eventId, dependencies()))
        .status,
    ).toBe(403);
    await client.db
      .update(schema.eventFeatures)
      .set({ announcementsEnabled: false })
      .where(eq(schema.eventFeatures.eventId, eventId));
    expect(
      (
        await handleAdminAnnouncementDrafts(
          new Request(`${path}/drafts`),
          eventId,
          dependencies(),
        )
      ).status,
    ).toBe(409);
    await client.db
      .update(schema.eventFeatures)
      .set({ announcementsEnabled: true })
      .where(eq(schema.eventFeatures.eventId, eventId));
  });

  it('preserves the winning concurrent edit and rejects sending an older reviewed version', async () => {
    const id = crypto.randomUUID();
    await save(id);
    const oldPreview = await (await preview(id)).json();
    const results = await Promise.all([
      save(id, 1, { ...draft, title: 'Úprava A' }),
      save(id, 1, { ...draft, title: 'Úprava B' }, otherAdminId),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await (await send(oldPreview)).json()).toMatchObject({
      code: 'ANNOUNCEMENT_DRAFT_STALE',
    });
    expect(await (await preview(id)).json()).toMatchObject({
      code: 'ANNOUNCEMENT_DRAFT_STALE',
    });
    expect(await (await preview(id, 2)).json()).toMatchObject({
      code: 'ANNOUNCEMENT_DRAFT_STALE',
    });
  });

  it('sends a draft only once when two administrators prepare separate previews', async () => {
    const id = crypto.randomUUID();
    await save(id);
    const [one, two] = await Promise.all([
      preview(id, 1, draft, adminId),
      preview(id),
    ]);
    const bodies = await Promise.all([one.json(), two.json()]);
    const sent = await Promise.all([
      send(bodies[0], adminId),
      send(bodies[1], otherAdminId),
    ]);
    expect(sent.map((r) => r.status).sort()).toEqual([201, 409]);
    const winningIndex = sent.findIndex((r) => r.status === 201);
    const receipt = await sent[winningIndex]!.json();
    expect(
      await client.db.query.announcementRecipients.findMany({
        where: eq(
          schema.announcementRecipients.announcementId,
          receipt.announcementId,
        ),
      }),
    ).toHaveLength(2);
    const audit = await client.db.query.auditLogs.findMany({
      where: and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.targetId, receipt.announcementId),
        eq(schema.auditLogs.action, 'announcement.send'),
      ),
    });
    expect(audit).toHaveLength(1);
    expect((await (await send(bodies[winningIndex])).json()).outcome).toBe(
      'already_sent',
    );
    const remove = new Request(`${path}/${receipt.announcementId}`, {
      method: 'DELETE',
      headers: { origin, 'idempotency-key': crypto.randomUUID() },
    });
    expect(
      (
        await handleAdminAnnouncementDelete(
          remove,
          eventId,
          receipt.announcementId,
          dependencies(),
        )
      ).status,
    ).toBe(200);
    expect(await (await preview(id)).json()).toMatchObject({
      code: 'ANNOUNCEMENT_DRAFT_ALREADY_SENT',
    });
  });

  it('lets another admin delete a draft and invalidates its existing previews', async () => {
    const id = crypto.randomUUID();
    await save(id);
    const checked = await (await preview(id)).json();
    const key = crypto.randomUUID();
    const remove = () =>
      handleAdminAnnouncementDrafts(
        mutation(
          '/drafts',
          { action: 'delete', draftId: id, expectedVersion: 1 },
          key,
        ),
        eventId,
        dependencies(otherAdminId),
      );
    expect((await remove()).status).toBe(200);
    expect((await remove()).headers.get('idempotency-replayed')).toBe('true');
    expect(await (await send(checked)).json()).toMatchObject({
      code: 'ANNOUNCEMENT_DRAFT_NOT_FOUND',
    });
    expect(
      (
        await handleAdminAnnouncementDrafts(
          new Request(`${path}/drafts/${id}`),
          eventId,
          dependencies(),
          id,
        )
      ).status,
    ).toBe(404);
  });
  it('paginates newest drafts first without omissions when the cursor draft is deleted', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: crypto.randomUUID(),
      eventId: otherEventId,
      draft,
      createdBy: adminId,
      updatedBy: adminId,
      createdAt: new Date(now.getTime() + i * 1000),
      updatedAt: now,
    }));
    await client.db.insert(schema.announcementDrafts).values(rows);
    const readPage = async (cursor?: string) =>
      (
        await handleAdminAnnouncementDrafts(
          new Request(
            `${origin}/api/v1/admin/events/${otherEventId}/announcements/drafts${cursor ? `?cursor=${cursor}` : ''}`,
          ),
          otherEventId,
          dependencies(otherAdminId),
        )
      ).json();
    const first = await readPage();
    expect(first.items).toHaveLength(20);
    expect(first.items[0].id).toBe(rows[24]!.id);
    await client.db
      .update(schema.announcementDrafts)
      .set({ deletedAt: now })
      .where(eq(schema.announcementDrafts.id, first.nextCursor));
    const second = await readPage(first.nextCursor);
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set(
        [...first.items, ...second.items].map(
          (item: { id: string }) => item.id,
        ),
      ).size,
    ).toBe(25);
  });
});
