import { createDatabaseClient, schema } from '@byzon/database';
import {
  adminTeamInvitationResponseSchema,
  adminTeamMemberListResponseSchema,
  adminTeamMemberMutationResponseSchema,
} from '@byzon/domain/contracts';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  handleAdminTeamInvitation,
  handleAdminTeamMemberList,
  handleAdminTeamMemberMutation,
} from './admin-team-members';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const origin = 'http://localhost:3000';

integration('admin team member integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-admin-team-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const eventSlug = `admin-team-${eventId}`;
  const adminId = crypto.randomUUID();
  const leaderId = crypto.randomUUID();
  const venueId = crypto.randomUUID();
  const roomId = crypto.randomUUID();
  const invitedEmail = `team-${eventId}@example.invalid`;
  const leaderEmail = `leader-${eventId}@example.invalid`;
  const url = `${origin}/api/v1/admin/events/${eventId}/team-members`;
  let invitedId: string | null = null;

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: eventSlug,
      name: 'Team integration event',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T16:00:00Z'),
      timezone: 'Europe/Prague',
      status: 'activation_open',
    });
    await client.db.insert(schema.users).values([
      {
        id: adminId,
        name: 'Původní administrátor',
        email: `team-admin-${adminId}@example.invalid`,
        emailVerified: true,
      },
      {
        id: leaderId,
        name: 'Tomáš Vedoucí',
        email: leaderEmail,
        emailVerified: true,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values(
      [adminId, leaderId].map((userId) => ({
        eventId,
        userId,
        status: 'active' as const,
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
        userId: leaderId,
        role: 'participant',
      },
    ]);
    await client.db.insert(schema.participantProfiles).values({
      eventId,
      userId: leaderId,
      firstName: 'Tomáš',
      lastName: 'Vedoucí',
      contactEmail: leaderEmail,
    });
    await client.db.insert(schema.venues).values({
      id: venueId,
      eventId,
      slug: `team-venue-${venueId}`,
      name: 'Hotel Passage',
      status: 'published',
      sortOrder: 0,
    });
    await client.db.insert(schema.rooms).values({
      id: roomId,
      eventId,
      venueId,
      slug: `team-room-${roomId}`,
      name: 'Mastermind salonek',
      status: 'published',
      sortOrder: 0,
    });
  });

  afterAll(async () => {
    await client.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.eventId, eventId));
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.db.delete(schema.users).where(
      inArray(
        schema.users.id,
        [adminId, leaderId, invitedId].filter(
          (id): id is string => id !== null,
        ),
      ),
    );
    await client.close();
  });

  const dependencies = () => ({
    db: client.db,
    allowedOrigin: origin,
    currentEventSlug: eventSlug,
    getSession: vi.fn(async () => ({ user: { id: adminId } })),
    now: () => new Date('2026-09-02T10:00:00Z'),
  });

  const mutationRequest = (body: Record<string, unknown>) =>
    new Request(url, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });

  it('adds, edits, invites and removes an event-scoped team member', async () => {
    const addedResponse = await handleAdminTeamMemberMutation(
      mutationRequest({
        action: 'add',
        displayName: 'Nová administrátorka',
        email: invitedEmail,
        access: { role: 'organizer_admin' },
        expectedVersion: 1,
        reason: 'Přidání členky organizačního týmu.',
      }),
      eventId,
      dependencies(),
    );
    expect(addedResponse.status).toBe(200);
    const added = adminTeamMemberMutationResponseSchema.parse(
      await addedResponse.json(),
    );
    expect(added).toMatchObject({ outcome: 'added', teamVersion: 2 });
    invitedId = added.member?.memberId ?? null;
    expect(invitedId).not.toBeNull();

    const listedResponse = await handleAdminTeamMemberList(
      new Request(url),
      eventId,
      dependencies(),
    );
    const listed = adminTeamMemberListResponseSchema.parse(
      await listedResponse.json(),
    );
    expect(listed.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: invitedId,
          email: invitedEmail,
          roles: ['organizer_admin'],
          invitation: expect.objectContaining({ status: 'not_sent' }),
        }),
      ]),
    );

    const updatedResponse = await handleAdminTeamMemberMutation(
      mutationRequest({
        action: 'update',
        memberId: invitedId,
        displayName: 'Upravená administrátorka',
        email: invitedEmail,
        administrator: true,
        expectedVersion: 2,
        reason: 'Oprava jména členky organizačního týmu.',
      }),
      eventId,
      dependencies(),
    );
    expect(
      adminTeamMemberMutationResponseSchema.parse(await updatedResponse.json()),
    ).toMatchObject({
      outcome: 'updated',
      teamVersion: 3,
      member: { displayName: 'Upravená administrátorka' },
    });

    const deliveries: Array<{ email: string; recipientName: string }> = [];
    const invitationResponse = await handleAdminTeamInvitation(
      new Request(`${url}/${invitedId}/invite`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({ memberId: invitedId }),
      }),
      eventId,
      invitedId!,
      {
        ...dependencies(),
        sendTeamInvitation: async (message) => {
          deliveries.push(message);
        },
      },
    );
    const invitation = adminTeamInvitationResponseSchema.parse(
      await invitationResponse.json(),
    );
    expect(invitation).toMatchObject({
      memberId: invitedId,
      outcome: 'sent',
      invitation: {
        status: 'sent',
        lastSentAt: '2026-09-02T10:00:00.000Z',
      },
    });
    expect(deliveries).toEqual([
      { email: invitedEmail, recipientName: 'Upravená administrátorka' },
    ]);

    const listedAfterInvitationResponse = await handleAdminTeamMemberList(
      new Request(url),
      eventId,
      dependencies(),
    );
    const listedAfterInvitation = adminTeamMemberListResponseSchema.parse(
      await listedAfterInvitationResponse.json(),
    );
    expect(listedAfterInvitation.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: invitedId,
          invitation: {
            status: 'sent',
            lastSentAt: '2026-09-02T10:00:00.000Z',
          },
        }),
      ]),
    );

    const removedResponse = await handleAdminTeamMemberMutation(
      mutationRequest({
        action: 'remove',
        memberId: invitedId,
        expectedVersion: 3,
        reason: 'Ukončení členství v organizačním týmu.',
      }),
      eventId,
      dependencies(),
    );
    expect(
      adminTeamMemberMutationResponseSchema.parse(await removedResponse.json()),
    ).toMatchObject({ outcome: 'removed', teamVersion: 4, member: null });
  });

  it('protects the current and last administrator from self-lockout', async () => {
    const response = await handleAdminTeamMemberMutation(
      mutationRequest({
        action: 'remove',
        memberId: adminId,
        expectedVersion: 4,
        reason: 'Negativní test vlastního odebrání administrátora.',
      }),
      eventId,
      dependencies(),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'SELF_LOCKOUT_GUARD' });
  });

  it('adds room leadership to an existing participant identity', async () => {
    const response = await handleAdminTeamMemberMutation(
      mutationRequest({
        action: 'add',
        displayName: 'Tomáš Vedoucí',
        email: leaderEmail,
        access: {
          role: 'room_operator',
          scope: {
            kind: 'room',
            roomId,
            label: 'Mastermind salonek',
          },
        },
        expectedVersion: 4,
        reason: 'Přiřazení vedoucího všech aktivit v mastermind salonku.',
      }),
      eventId,
      dependencies(),
    );
    expect(response.status).toBe(200);
    expect(
      adminTeamMemberMutationResponseSchema.parse(await response.json()),
    ).toMatchObject({
      outcome: 'added',
      teamVersion: 5,
      member: {
        memberId: leaderId,
        email: leaderEmail,
        roles: ['room_operator'],
      },
    });

    const roles = await client.db.query.eventRoles.findMany({
      columns: { role: true, scope: true },
      where: and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.userId, leaderId),
        isNull(schema.eventRoles.revokedAt),
      ),
    });
    expect(roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'participant' }),
        expect.objectContaining({
          role: 'room_operator',
          scope: { roomIds: [roomId] },
        }),
      ]),
    );

    const removedResponse = await handleAdminTeamMemberMutation(
      mutationRequest({
        action: 'remove',
        memberId: leaderId,
        expectedVersion: 5,
        reason: 'Odebrání pouze správy aktivit.',
      }),
      eventId,
      dependencies(),
    );
    expect(removedResponse.status).toBe(200);
    expect(
      adminTeamMemberMutationResponseSchema.parse(await removedResponse.json()),
    ).toMatchObject({ outcome: 'removed', teamVersion: 6, member: null });

    const remainingRoles = await client.db.query.eventRoles.findMany({
      columns: { role: true },
      where: and(
        eq(schema.eventRoles.eventId, eventId),
        eq(schema.eventRoles.userId, leaderId),
        isNull(schema.eventRoles.revokedAt),
      ),
    });
    expect(remainingRoles).toEqual([{ role: 'participant' }]);
    await expect(
      client.db.query.eventMemberships.findFirst({
        columns: { status: true },
        where: and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, leaderId),
        ),
      }),
    ).resolves.toEqual({ status: 'active' });
  });
});
