import {
  createDatabaseClient,
  schema,
  sendRecordedEmail,
} from '@byzon/database';
import {
  adminEmailListSchema,
  adminEmailDetailSchema,
} from '@byzon/domain/contracts';
import { eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleAdminEmail } from './admin-email';
import { sendRecordedAuthEmail } from './mail-history';
import { FakeAuthMailProvider } from './mail';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('private sent email archive', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'email-history-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID(),
    otherEventId = crypto.randomUUID(),
    userId = crypto.randomUUID(),
    outsiderId = crypto.randomUUID();
  const dependencies = {
    db: client.db,
    getSession: async () => ({ user: { id: userId } }),
  };
  const request = (search = '') =>
    new Request(
      `https://app.example.test/api/v1/admin/events/${eventId}/emails${search}`,
    );
  const base = {
    eventId,
    userId,
    kind: 'announcement',
    recipient: 'recipient@example.test',
    sender: 'BYZON <sender@example.test>',
    subject: 'Program konference',
    html: '<p>Původní obsah</p>',
    text: 'Původní obsah',
  };
  const now = new Date('2026-09-17T09:00:00Z');

  beforeAll(async () => {
    await client.db.insert(schema.events).values(
      [eventId, otherEventId].map((id) => ({
        id,
        slug: `email-${id}`,
        name: 'Email history test',
        timezone: 'Europe/Prague',
        startsAt: now,
        endsAt: new Date(now.getTime() + 86400000),
        status: 'live' as const,
      })),
    );
    await client.db.insert(schema.users).values(
      [userId, outsiderId].map((id) => ({
        id,
        name: 'Email test',
        email: `${id}@example.test`,
      })),
    );
    await client.db.insert(schema.eventMemberships).values({ eventId, userId });
    await client.db.insert(schema.eventRoles).values({
      id: crypto.randomUUID(),
      eventId,
      userId,
      role: 'organizer_admin',
    });
  });
  afterAll(async () => {
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.db
      .delete(schema.events)
      .where(eq(schema.events.id, otherEventId));
    await client.db.delete(schema.users).where(eq(schema.users.id, userId));
    await client.db.delete(schema.users).where(eq(schema.users.id, outsiderId));
    await client.close();
  });

  it('retains the sent snapshot, hides failed attempts and deduplicates retries', async () => {
    const send = vi.fn(async () => undefined);
    await sendRecordedEmail(
      client.db,
      { ...base, deduplicationKey: 'sent-1' },
      send,
      now,
    );
    await sendRecordedEmail(
      client.db,
      { ...base, subject: 'Changed later', deduplicationKey: 'sent-1' },
      send,
      now,
    );
    expect(send).toHaveBeenCalledTimes(1);
    await expect(
      sendRecordedEmail(
        client.db,
        { ...base, deduplicationKey: 'failed' },
        async () => {
          throw new Error('failed');
        },
        now,
      ),
    ).rejects.toThrow('failed');
    const response = await handleAdminEmail(request(), eventId, dependencies);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const list = adminEmailListSchema.parse(await response.json());
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.subject).toBe(base.subject);
    expect(JSON.stringify(list)).not.toContain(base.html);
    const detail = adminEmailDetailSchema.parse(
      await (
        await handleAdminEmail(
          request(),
          eventId,
          dependencies,
          list.items[0]!.id,
        )
      ).json(),
    );
    expect(detail.html).toBe(base.html);
    expect(detail.authLinkRedacted).toBe(false);
  });

  it('stores auth content without a login token while sending the original link', async () => {
    const provider = new FakeAuthMailProvider();
    const message = {
      to: 'admin@example.test',
      url: 'https://app.example.test/api/auth/magic-link/verify?token=DO-NOT-ARCHIVE&callbackURL=%2Fadmin',
      purpose: 'team-invitation' as const,
      firstName: 'Martin',
      expiresInSeconds: 86400,
    };
    await sendRecordedAuthEmail(client.db, provider, message, {
      eventId,
      userId,
      appOrigin: 'https://app.example.test',
      sender: base.sender,
    });
    expect(provider.messages[0]?.url).toBe(message.url);
    const row = await client.db.query.emailMessages.findFirst({
      where: eq(schema.emailMessages.kind, 'team-invitation'),
    });
    expect(row?.html).toContain('Martine');
    expect(row?.text).toContain('24 hodin');
    expect(JSON.stringify(row)).not.toContain('DO-NOT-ARCHIVE');
    expect(row?.html).toContain('jednorazovy-odkaz-skryt');
  });

  it('enforces authentication, event membership and event isolation on both reads', async () => {
    await sendRecordedEmail(
      client.db,
      { ...base, eventId: otherEventId, deduplicationKey: 'other' },
      async () => undefined,
      now,
    );
    const hidden = await client.db.query.emailMessages.findFirst({
      where: eq(schema.emailMessages.eventId, otherEventId),
    });
    expect(
      (
        await handleAdminEmail(request(), eventId, {
          ...dependencies,
          getSession: async () => null,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await handleAdminEmail(request(), eventId, {
          ...dependencies,
          getSession: async () => ({ user: { id: outsiderId } }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await handleAdminEmail(request(), otherEventId, dependencies)).status,
    ).toBe(403);
    expect(
      (await handleAdminEmail(request(), eventId, dependencies, hidden!.id))
        .status,
    ).toBe(404);
    const list = adminEmailListSchema.parse(
      await (await handleAdminEmail(request(), eventId, dependencies)).json(),
    );
    expect(list.items.every((row) => row.eventId === eventId)).toBe(true);
  });

  it('paginates equal timestamps without duplicates and treats search wildcards literally', async () => {
    await sendRecordedEmail(
      client.db,
      { ...base, subject: '100% program', deduplicationKey: 'sent-2' },
      async () => undefined,
      now,
    );
    const first = adminEmailListSchema.parse(
      await (
        await handleAdminEmail(
          request('?kind=announcement&limit=1'),
          eventId,
          dependencies,
        )
      ).json(),
    );
    expect(first.total).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    const second = adminEmailListSchema.parse(
      await (
        await handleAdminEmail(
          request(`?kind=announcement&limit=1&cursor=${first.nextCursor}`),
          eventId,
          dependencies,
        )
      ).json(),
    );
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(second.nextCursor).toBeNull();
    const filtered = adminEmailListSchema.parse(
      await (
        await handleAdminEmail(request('?search=%25'), eventId, dependencies)
      ).json(),
    );
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.subject).toBe('100% program');
    expect(
      (
        await handleAdminEmail(
          request('?cursor=invalid'),
          eventId,
          dependencies,
        )
      ).status,
    ).toBe(422);
    expect(
      (await handleAdminEmail(request('?limit=1000'), eventId, dependencies))
        .status,
    ).toBe(422);
  });

  it('imports legacy evidence without treating skipped notifications as sent or inventing old content', async () => {
    const sentId = crypto.randomUUID(),
      skippedId = crypto.randomUUID(),
      auditId = crypto.randomUUID();
    const rollback = new Error('rollback migration rehearsal');
    await expect(
      client.db.transaction(async (tx) => {
        await tx.insert(schema.participantProfiles).values({
          eventId,
          userId,
          firstName: 'Test',
          lastName: 'Recipient',
          contactEmail: 'new-address@example.test',
        });
        await tx.insert(schema.emailDeliveries).values(
          [sentId, skippedId].map((id) => ({
            id,
            eventId,
            userId,
            deduplicationKey: id,
            payload: { kind: 'announcement' },
            status: 'delivered' as const,
            deliveredAt: now,
            createdAt: now,
            expiresAt: new Date(now.getTime() + 86400000),
            lastError: id === skippedId ? 'skipped_expired' : null,
          })),
        );
        await tx.insert(schema.auditLogs).values({
          id: auditId,
          eventId,
          actorType: 'user',
          action: 'participant.invitation_sent',
          targetType: 'participant_profile',
          targetId: userId,
          requestId: crypto.randomUUID(),
          createdAt: now,
        });
        const migration = readFileSync(
          new URL(
            '../../../../packages/database/drizzle/0033_email_history.sql',
            import.meta.url,
          ),
          'utf8',
        );
        for (const statement of migration
          .split('--> statement-breakpoint')
          .filter((part) => part.includes('INSERT INTO')))
          await tx.execute(sql.raw(statement));
        const sent = await tx.query.emailMessages.findFirst({
          where: eq(schema.emailMessages.id, sentId),
        });
        const skipped = await tx.query.emailMessages.findFirst({
          where: eq(schema.emailMessages.id, skippedId),
        });
        const invitation = await tx.query.emailMessages.findFirst({
          where: eq(schema.emailMessages.id, auditId),
        });
        expect(sent).toMatchObject({
          recipient: null,
          html: null,
          text: null,
          sentAt: now,
        });
        expect(skipped).toBeUndefined();
        expect(invitation).toMatchObject({
          kind: 'participant-invitation',
          recipient: null,
          html: null,
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
