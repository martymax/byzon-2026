import { createDatabaseClient, schema } from '@byzon/database';
import {
  adminParticipantInviteResponseSchema,
  supportMutationResponseSchema,
  supportSearchResponseSchema,
} from '@byzon/domain/contracts/support';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  handleAdminParticipantInvite,
  handleAdminSupportMutation,
  handleAdminSupportSearch,
} from './admin-support';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
const origin = 'http://localhost:3000';
const now = new Date('2026-09-02T08:00:00.000Z');

integration('admin participant support integration', () => {
  const client = createDatabaseClient({
    connectionString: databaseUrl!,
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 1_000,
    applicationName: 'byzon-admin-support-integration-test',
    onUnexpectedError: vi.fn(),
  });
  const eventId = crypto.randomUUID();
  const eventSlug = `admin-support-${eventId}`;
  const adminId = crypto.randomUUID();
  const participantId = crypto.randomUUID();
  const ticketId = crypto.randomUUID();
  const olderTicketId = crypto.randomUUID();
  const searchUrl = `${origin}/api/v1/admin/events/${eventId}/support/search`;
  const mutationUrl = `${origin}/api/v1/admin/events/${eventId}/support/actions`;
  const inviteUrl = `${origin}/api/v1/admin/events/${eventId}/participants/${participantId}/invite`;

  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: eventSlug,
      name: 'Support integration event',
      startsAt: new Date('2026-09-18T06:00:00Z'),
      endsAt: new Date('2026-09-19T16:00:00Z'),
      timezone: 'Europe/Prague',
      status: 'activation_open',
    });
    await client.db.insert(schema.users).values([
      {
        id: adminId,
        name: 'Support admin',
        email: `support-admin-${adminId}@example.invalid`,
      },
      {
        id: participantId,
        name: 'Citlivý účastník',
        email: `private-${participantId}@example.invalid`,
      },
    ]);
    await client.db.insert(schema.eventMemberships).values([
      { eventId, userId: adminId, status: 'active' },
      { eventId, userId: participantId, status: 'active' },
    ]);
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
        userId: participantId,
        role: 'participant',
      },
    ]);
    await client.db.insert(schema.participantProfiles).values({
      eventId,
      userId: participantId,
      firstName: 'Citlivý',
      lastName: 'Účastník',
      contactEmail: `private-${participantId}@example.invalid`,
    });
    await client.db.insert(schema.tickets).values([
      {
        id: olderTicketId,
        eventId,
        codeHmac: 'a'.repeat(64),
        codeSuffix: 'OLD123',
        status: 'activated',
        holderUserId: participantId,
        claimedAt: new Date('2026-08-20T08:00:00Z'),
        createdAt: new Date('2026-08-20T08:00:00Z'),
        updatedAt: new Date('2026-08-20T08:00:00Z'),
      },
      {
        id: ticketId,
        eventId,
        codeHmac: 'b'.repeat(64),
        codeSuffix: 'LIVE9876',
        status: 'activated',
        holderUserId: participantId,
        claimedAt: new Date('2026-08-21T08:00:00Z'),
        createdAt: new Date('2026-08-21T08:00:00Z'),
        updatedAt: new Date('2026-08-21T08:00:00Z'),
      },
    ]);
  });

  afterAll(async () => {
    await client.db
      .delete(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.eventId, eventId));
    await client.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.eventId, eventId));
    await client.db
      .delete(schema.ticketEvents)
      .where(eq(schema.ticketEvents.eventId, eventId));
    await client.db
      .delete(schema.tickets)
      .where(eq(schema.tickets.eventId, eventId));
    await client.db
      .delete(schema.participantProfiles)
      .where(eq(schema.participantProfiles.eventId, eventId));
    await client.db
      .delete(schema.eventRoles)
      .where(eq(schema.eventRoles.eventId, eventId));
    await client.db
      .delete(schema.eventMemberships)
      .where(eq(schema.eventMemberships.eventId, eventId));
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.db
      .delete(schema.users)
      .where(inArray(schema.users.id, [adminId, participantId]));
    await client.close();
  });

  const rateLimit = vi.fn(async () => ({
    allowed: true,
    limit: 30,
    remaining: 29,
    resetAt: new Date(now.getTime() + 60_000),
    retryAfterSeconds: 60,
  }));

  const dependencies = (actorId = adminId) => ({
    db: client.db,
    allowedOrigin: origin,
    currentEventSlug: eventSlug,
    getSession: vi.fn(async () => ({ user: { id: actorId } })),
    now: () => now,
    rateLimit,
  });

  it('searches through a POST body, deduplicates people and masks contact PII', async () => {
    rateLimit.mockClear();
    const request = new Request(searchUrl, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'Citlivý', limit: 5 }),
    });
    expect(new URL(request.url).search).toBe('');

    const response = await handleAdminSupportSearch(
      request,
      eventId,
      dependencies(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('ratelimit-limit')).toBe('30');
    const body = supportSearchResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      outcome: 'single_match',
      matches: [
        {
          participantId,
          ticketId,
          maskedContact: `p***@example.invalid`,
          referenceSuffix: 'LIVE9876',
          availableActions: ['block'],
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(`private-${participantId}@`);
    expect(rateLimit).toHaveBeenCalledWith('search', adminId);
  });

  it('requires same origin, current event and operational read permission', async () => {
    const body = JSON.stringify({ query: 'Citlivý', limit: 5 });
    const wrongOrigin = await handleAdminSupportSearch(
      new Request(searchUrl, {
        method: 'POST',
        headers: { origin: 'https://attacker.invalid' },
        body,
      }),
      eventId,
      dependencies(),
    );
    expect(wrongOrigin.status).toBe(403);

    const wrongEvent = await handleAdminSupportSearch(
      new Request(searchUrl, { method: 'POST', headers: { origin }, body }),
      eventId,
      { ...dependencies(), currentEventSlug: 'not-current' },
    );
    expect(wrongEvent.status).toBe(403);

    const missingPermission = await handleAdminSupportSearch(
      new Request(searchUrl, { method: 'POST', headers: { origin }, body }),
      eventId,
      dependencies(participantId),
    );
    expect(missingPermission.status).toBe(403);
  });

  it('sends one audited participant invitation and replays it without another email', async () => {
    const sendParticipantInvitation = vi.fn(async () => undefined);
    const idempotencyKey = crypto.randomUUID();
    const send = () =>
      handleAdminParticipantInvite(
        new Request(inviteUrl, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({ participantId }),
        }),
        eventId,
        participantId,
        { ...dependencies(), sendParticipantInvitation },
      );

    const first = await send();
    expect(first.status).toBe(200);
    expect(
      adminParticipantInviteResponseSchema.parse(await first.json()),
    ).toMatchObject({
      eventId,
      participantId,
      outcome: 'sent',
      invitation: { status: 'sent', lastSentAt: now.toISOString() },
    });
    expect(sendParticipantInvitation).toHaveBeenCalledWith({
      email: `private-${participantId}@example.invalid`,
      recipientName: 'Citlivý Účastník',
    });

    const replay = await send();
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(
      adminParticipantInviteResponseSchema.parse(await replay.json()).outcome,
    ).toBe('already_sent');
    expect(sendParticipantInvitation).toHaveBeenCalledTimes(1);
    const audits = await client.db.query.auditLogs.findMany({
      where: and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.action, 'participant.invitation_sent'),
        eq(schema.auditLogs.targetId, participantId),
      ),
    });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(`private-${participantId}@`);
  });

  it('fails closed without an audit when invitation delivery is unavailable', async () => {
    const response = await handleAdminParticipantInvite(
      new Request(inviteUrl, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({ participantId }),
      }),
      eventId,
      participantId,
      {
        ...dependencies(),
        sendParticipantInvitation: vi.fn(async () => {
          throw new Error('synthetic delivery failure');
        }),
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'INVITATION_DELIVERY_UNAVAILABLE',
    });
    const audits = await client.db.query.auditLogs.findMany({
      where: and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.action, 'participant.invitation_sent'),
        eq(schema.auditLogs.targetId, participantId),
      ),
    });
    expect(audits).toHaveLength(1);
  });

  it('blocks with manage permission, audit and exact idempotent replay', async () => {
    rateLimit.mockClear();
    const idempotencyKey = crypto.randomUUID();
    const body = JSON.stringify({
      participantId,
      ticketId,
      action: 'block',
      expectedVersion: 1,
      reason: 'Bezpečnostní blokace v integračním testu.',
      targetTicketId: null,
    });
    const send = () =>
      handleAdminSupportMutation(
        new Request(mutationUrl, {
          method: 'POST',
          headers: {
            origin,
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
          },
          body,
        }),
        eventId,
        dependencies(),
      );

    const first = await send();
    expect(first.status).toBe(200);
    expect(first.headers.get('idempotency-replayed')).toBe('false');
    expect(
      supportMutationResponseSchema.parse(await first.json()),
    ).toMatchObject({
      outcome: 'applied',
      record: {
        participantId,
        ticketId,
        ticketState: 'blocked',
        availableActions: ['reactivate'],
        version: 2,
      },
    });

    const replay = await send();
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(
      supportMutationResponseSchema.parse(await replay.json()),
    ).toMatchObject({ outcome: 'already_applied' });
    expect(rateLimit).toHaveBeenCalledWith('mutation', adminId);

    const audits = await client.db.query.auditLogs.findMany({
      where: and(
        eq(schema.auditLogs.eventId, eventId),
        eq(schema.auditLogs.action, 'support.block'),
        eq(schema.auditLogs.targetId, ticketId),
      ),
    });
    expect(audits).toHaveLength(1);
  });
});
