import { createDatabaseClient, schema } from '@byzon/database';
import {
  adminTeamInvitationResponseSchema,
  adminTeamMemberListResponseSchema,
  adminTeamMemberMutationResponseSchema,
} from '@byzon/domain/contracts';
import { eq, inArray } from 'drizzle-orm';
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
  const invitedEmail = `team-${eventId}@example.invalid`;
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
    await client.db.insert(schema.users).values({
      id: adminId,
      name: 'Původní administrátor',
      email: `team-admin-${adminId}@example.invalid`,
      emailVerified: true,
    });
    await client.db.insert(schema.eventMemberships).values({
      eventId,
      userId: adminId,
      status: 'active',
    });
    await client.db.insert(schema.eventRoles).values({
      id: crypto.randomUUID(),
      eventId,
      userId: adminId,
      role: 'organizer_admin',
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
        [adminId, invitedId].filter((id): id is string => id !== null),
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
    expect(
      adminTeamInvitationResponseSchema.parse(await invitationResponse.json()),
    ).toMatchObject({ memberId: invitedId, outcome: 'sent' });
    expect(deliveries).toEqual([
      { email: invitedEmail, recipientName: 'Upravená administrátorka' },
    ]);

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
});
