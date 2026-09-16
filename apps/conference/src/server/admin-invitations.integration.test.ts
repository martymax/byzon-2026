import { createDatabaseClient, schema } from '@byzon/database';
import { adminInvitationRecipientsSchema } from '@byzon/domain/contracts';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleAdminInvitationRecipients } from './admin-invitations';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;

integration('central invitation recipients', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'byzon-invitation-tests',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const eventSlug = `invitations-${eventId}`;
  const adminId = crypto.randomUUID();
  const speakerId = crypto.randomUUID();
  const leaderId = crypto.randomUUID();
  const suspendedId = crypto.randomUUID();
  const noAccessId = crypto.randomUUID();
  const extraIds = Array.from({ length: 200 }, () => crypto.randomUUID());
  const userIds = [
    adminId,
    speakerId,
    leaderId,
    suspendedId,
    noAccessId,
    ...extraIds,
  ];
  const url = `http://localhost/api/v1/admin/events/${eventId}/invitations`;
  const dependencies = (actor = adminId) => ({
    db: client.db,
    currentEventSlug: eventSlug,
    getSession: async () => ({ user: { id: actor } }),
  });
  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: eventSlug,
      name: 'Invitation tests',
      startsAt: new Date('2026-09-18'),
      endsAt: new Date('2026-09-19'),
      timezone: 'Europe/Prague',
      status: 'activation_open',
    });
    await client.db.insert(schema.users).values(
      userIds.map((id) => ({
        id,
        name: `Osoba ${id}`,
        email: `${id}@example.test`,
        emailVerified: id === adminId,
      })),
    );
    await client.db.insert(schema.eventMemberships).values(
      userIds.map((userId) => ({
        eventId,
        userId,
        status:
          userId === suspendedId ? ('suspended' as const) : ('active' as const),
      })),
    );
    await client.db.insert(schema.eventRoles).values([
      {
        id: crypto.randomUUID(),
        eventId,
        userId: adminId,
        role: 'organizer_admin',
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: speakerId,
        role: 'participant',
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: speakerId,
        role: 'speaker',
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: speakerId,
        role: 'moderator',
        revokedAt: new Date(),
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: leaderId,
        role: 'room_operator',
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: suspendedId,
        role: 'organizer_admin',
      },
      {
        id: crypto.randomUUID(),
        eventId,
        userId: noAccessId,
        role: 'participant',
      },
      ...extraIds.map((userId) => ({
        id: crypto.randomUUID(),
        eventId,
        userId,
        role: 'participant' as const,
      })),
    ]);
    await client.db.insert(schema.participantProfiles).values({
      eventId,
      userId: speakerId,
      firstName: 'Demo',
      lastName: 'Řečník',
      contactEmail: `contact-${speakerId}@example.test`,
    });
    await client.db.insert(schema.tickets).values({
      id: crypto.randomUUID(),
      eventId,
      holderUserId: speakerId,
      codeHmac: 'a'.repeat(64),
      codeSuffix: 'TEST1234',
      status: 'activated',
      claimedAt: new Date(),
    });
  });
  afterAll(async () => {
    await client.db
      .delete(schema.tickets)
      .where(eq(schema.tickets.eventId, eventId));
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.db
      .delete(schema.users)
      .where(inArray(schema.users.id, userIds));
    await client.close();
  });
  it('paginates every user once, combines roles, excludes revoked roles and suspended memberships', async () => {
    const response = await handleAdminInvitationRecipients(
      new Request(url),
      eventId,
      dependencies(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    const first = adminInvitationRecipientsSchema.parse(await response.json());
    expect(first.items).toHaveLength(200);
    expect(first.nextCursor).not.toBeNull();
    const next = await handleAdminInvitationRecipients(
      new Request(`${url}?cursor=${first.nextCursor}`),
      eventId,
      dependencies(),
    );
    const second = adminInvitationRecipientsSchema.parse(await next.json());
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(all).toHaveLength(204);
    expect(new Set(all.map((row) => row.userId)).size).toBe(204);
    expect(all.some((row) => row.userId === suspendedId)).toBe(false);
    expect(all.find((row) => row.userId === speakerId)).toMatchObject({
      roles: expect.arrayContaining(['speaker', 'participant']),
      email: `${speakerId}@example.test`,
      delivery: 'participant',
    });
    expect(all.find((row) => row.userId === speakerId)?.roles).not.toContain(
      'moderator',
    );
    expect(all.find((row) => row.userId === leaderId)?.delivery).toBe('team');
    expect(all.find((row) => row.userId === adminId)).toMatchObject({
      delivery: 'team',
      invitation: { status: 'accepted' },
    });
    expect(all.find((row) => row.userId === noAccessId)?.delivery).toBeNull();
  });
  it('rejects unauthenticated, non-admin, cross-event and malformed cursor requests', async () => {
    expect(
      (
        await handleAdminInvitationRecipients(new Request(url), eventId, {
          ...dependencies(),
          getSession: async () => null,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await handleAdminInvitationRecipients(
          new Request(url),
          eventId,
          dependencies(speakerId),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleAdminInvitationRecipients(
          new Request(url),
          crypto.randomUUID(),
          dependencies(),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleAdminInvitationRecipients(
          new Request(`${url}?cursor=bad`),
          eventId,
          dependencies(),
        )
      ).status,
    ).toBe(422);
  });
});
