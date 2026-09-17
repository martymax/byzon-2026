import { createDatabaseClient, schema } from '@byzon/database';
import {
  invitationBatchCreatedSchema,
  invitationBatchesSchema,
} from '@byzon/domain/contracts';
import type { MailTransport } from '@byzon/mail/transport';
import { and, eq, inArray } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { dispatchInvitationOnce } from '../../../worker/src/invitations';
import { handleInvitationBatches } from './invitation-batches';
import { createAuth } from './auth';
import { FakeAuthMailProvider } from './mail';

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe.sequential : describe.skip;
integration('durable invitation batches', () => {
  const settings = {
    connectionString: databaseUrl!,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'invitation-queue-tests',
    onUnexpectedError: vi.fn(),
  };
  const client = createDatabaseClient(settings);
  const eventId = crypto.randomUUID();
  const eventSlug = `queue-${eventId}`;
  const adminId = crypto.randomUUID();
  const ids = Array.from({ length: 225 }, () => crypto.randomUUID());
  const appOrigin = 'http://localhost:3000';
  const url = `${appOrigin}/api/v1/admin/events/${eventId}/invitations/batches`;
  const options = {
    appOrigin,
    secret: 'queue-integration-secret-at-least-32-characters',
    sender: 'sender@example.test',
  };
  const send = vi.fn<MailTransport['send']>().mockResolvedValue(undefined);
  const transport: MailTransport = { send };
  const deps = (userId = adminId) => ({
    db: client.db,
    currentEventSlug: eventSlug,
    allowedOrigin: appOrigin,
    getSession: async () => ({ user: { id: userId } }),
  });
  const post = (
    userIds: string[],
    key = crypto.randomUUID(),
    overrides: Record<string, string> = {},
  ) =>
    new Request(url, {
      method: 'POST',
      headers: {
        origin: appOrigin,
        'content-type': 'application/json',
        'idempotency-key': key,
        ...overrides,
      },
      body: JSON.stringify({ userIds }),
    });
  const enqueue = async (userIds = [ids[0]!], key?: string) => {
    const response = await handleInvitationBatches(
      post(userIds, key),
      eventId,
      deps(),
    );
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(
      202,
    );
    return invitationBatchCreatedSchema.parse(await response.json());
  };
  const jobs = () =>
    client.db
      .select()
      .from(schema.invitationDeliveries)
      .where(eq(schema.invitationDeliveries.eventId, eventId));
  const summary = async () => {
    const response = await handleInvitationBatches(
      new Request(url),
      eventId,
      deps(),
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return invitationBatchesSchema.parse(await response.json());
  };
  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: eventSlug,
      name: 'Queue integration',
      startsAt: new Date('2026-09-18'),
      endsAt: new Date('2026-09-19'),
      timezone: 'Europe/Prague',
      status: 'activation_open',
    });
    await client.db.insert(schema.users).values(
      [adminId, ...ids].map((id) => ({
        id,
        name: 'Demo Osoba',
        email: `${id}@example.test`,
      })),
    );
    await client.db
      .insert(schema.eventMemberships)
      .values([adminId, ...ids].map((userId) => ({ eventId, userId })));
    await client.db.insert(schema.eventRoles).values(
      [adminId, ...ids].map((userId) => ({
        id: crypto.randomUUID(),
        eventId,
        userId,
        role:
          userId === adminId
            ? ('organizer_admin' as const)
            : userId === ids[224]
              ? ('participant' as const)
              : ('moderator' as const),
      })),
    );
    await client.db.insert(schema.participantProfiles).values({
      eventId,
      userId: ids[224]!,
      firstName: 'Demo',
      lastName: 'Účastník',
      contactEmail: `${ids[224]}@example.test`,
    });
    await client.db.insert(schema.tickets).values({
      id: crypto.randomUUID(),
      eventId,
      holderUserId: ids[224]!,
      codeHmac: eventId.replaceAll('-', '').repeat(2),
      codeSuffix: 'QUEUE225',
      status: 'activated',
      claimedAt: new Date(),
    });
  });
  beforeEach(async () => {
    send.mockReset().mockResolvedValue(undefined);
    const oldJobs = await jobs();
    if (oldJobs.length)
      await client.db.delete(schema.verifications).where(
        inArray(
          schema.verifications.id,
          oldJobs.map((job) => job.id),
        ),
      );
    await client.db
      .delete(schema.invitationBatches)
      .where(eq(schema.invitationBatches.eventId, eventId));
    await client.db
      .delete(schema.emailMessages)
      .where(eq(schema.emailMessages.eventId, eventId));
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'active' })
      .where(eq(schema.eventMemberships.eventId, eventId));
    await client.db
      .update(schema.events)
      .set({ status: 'activation_open' })
      .where(eq(schema.events.id, eventId));
  });
  afterAll(async () => {
    const oldJobs = await jobs();
    if (oldJobs.length)
      await client.db.delete(schema.verifications).where(
        inArray(
          schema.verifications.id,
          oldJobs.map((job) => job.id),
        ),
      );
    await client.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.eventId, eventId));
    await client.db
      .delete(schema.idempotencyKeys)
      .where(eq(schema.idempotencyKeys.eventId, eventId));
    await client.db
      .delete(schema.tickets)
      .where(eq(schema.tickets.eventId, eventId));
    await client.db.delete(schema.events).where(eq(schema.events.id, eventId));
    await client.db
      .delete(schema.users)
      .where(inArray(schema.users.id, [adminId, ...ids]));
    await client.close();
  });
  it('queues 225 recipients atomically and a separate worker drains them without further browser requests', async () => {
    const queued = await enqueue(ids);
    expect(queued.queued).toBe(225);
    expect(send).not.toHaveBeenCalled();
    expect((await summary()).queuedUserIds).toHaveLength(225);
    const workerClient = createDatabaseClient(settings);
    try {
      let count = 0;
      for (;;) {
        const outcomes = await Promise.all(
          Array.from({ length: 2 }, () =>
            dispatchInvitationOnce(workerClient.db, transport, options),
          ),
        );
        count += outcomes.filter((outcome) => outcome === 'delivered').length;
        if (outcomes.every((outcome) => outcome === 'idle')) break;
        if (count > 225) throw new Error('Unexpected duplicate jobs');
      }
      expect(count).toBe(225);
    } finally {
      await workerClient.close();
    }
    expect(send).toHaveBeenCalledTimes(225);
    expect(new Set(send.mock.calls.map(([mail]) => mail.to)).size).toBe(225);
    expect((await summary()).batches[0]).toMatchObject({
      total: 225,
      delivered: 225,
      pending: 0,
      processing: 0,
      failed: 0,
    });
    expect((await summary()).queuedUserIds).toHaveLength(0);
  }, 30_000);
  it('replays an uncertain enqueue and suppresses overlapping selections from another administrator request', async () => {
    const key = crypto.randomUUID();
    const [first, replay] = await Promise.all([
      enqueue([ids[0]!, ids[1]!], key),
      enqueue([ids[0]!, ids[1]!], key),
    ]);
    expect(replay).toEqual(first);
    expect(await enqueue([ids[1]!, ids[2]!])).toMatchObject({
      queued: 1,
      alreadyQueued: 1,
    });
    expect(await enqueue([ids[0]!])).toMatchObject({
      batchId: null,
      queued: 0,
      alreadyQueued: 1,
    });
    expect(await jobs()).toHaveLength(3);
    const mismatch = await handleInvitationBatches(
      post([ids[2]!], key),
      eventId,
      deps(),
    );
    expect(mismatch.status).toBe(409);
  });
  it('requires authorization, canonical event, same origin and a valid active selection', async () => {
    expect(
      (
        await handleInvitationBatches(post([ids[0]!]), eventId, {
          ...deps(),
          getSession: async () => null,
        })
      ).status,
    ).toBe(401);
    expect(
      (await handleInvitationBatches(post([ids[0]!]), eventId, deps(ids[1])))
        .status,
    ).toBe(403);
    expect(
      (
        await handleInvitationBatches(
          post([ids[0]!]),
          crypto.randomUUID(),
          deps(),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleInvitationBatches(
          post([ids[0]!], undefined, { origin: 'https://elsewhere.test' }),
          eventId,
          deps(),
        )
      ).status,
    ).toBe(403);
    expect(
      (await handleInvitationBatches(post([ids[0]!, ids[0]!]), eventId, deps()))
        .status,
    ).toBe(422);
    expect(
      (
        await handleInvitationBatches(
          post([ids[0]!, crypto.randomUUID()]),
          eventId,
          deps(),
        )
      ).status,
    ).toBe(422);
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'suspended' })
      .where(
        and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, ids[0]!),
        ),
      );
    expect(
      (await handleInvitationBatches(post([ids[0]!]), eventId, deps())).status,
    ).toBe(422);
    await client.db
      .update(schema.events)
      .set({ status: 'archived' })
      .where(eq(schema.events.id, eventId));
    expect(
      (await handleInvitationBatches(post([ids[1]!]), eventId, deps())).status,
    ).toBe(409);
    expect(await jobs()).toHaveLength(0);
  });
  it('retries a temporary transport failure with the same token and message identity, without blocking another recipient', async () => {
    await enqueue([ids[0]!, ids[1]!]);
    const now = new Date();
    send.mockRejectedValueOnce(new Error('temporary SMTP outage'));
    expect(
      await dispatchInvitationOnce(client.db, transport, options, now),
    ).toBe('retried');
    expect(
      await dispatchInvitationOnce(client.db, transport, options, now),
    ).toBe('delivered');
    expect(
      await dispatchInvitationOnce(client.db, transport, options, now),
    ).toBe('idle');
    expect(
      await dispatchInvitationOnce(
        client.db,
        transport,
        options,
        new Date(now.getTime() + 31_000),
      ),
    ).toBe('delivered');
    expect(send.mock.calls[2]).toEqual(send.mock.calls[0]);
    expect((await summary()).batches[0]).toMatchObject({
      delivered: 2,
      failed: 0,
    });
  });
  it('reclaims an expired lease after a worker restart and never double-claims with two workers', async () => {
    await enqueue();
    const [job] = await jobs();
    await client.db
      .update(schema.invitationDeliveries)
      .set({
        status: 'processing',
        leaseToken: crypto.randomUUID(),
        availableAt: new Date(Date.now() + 60_000),
      })
      .where(eq(schema.invitationDeliveries.id, job!.id));
    expect(await dispatchInvitationOnce(client.db, transport, options)).toBe(
      'idle',
    );
    await client.db
      .update(schema.invitationDeliveries)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitationDeliveries.id, job!.id));
    expect(
      (
        await Promise.all([
          dispatchInvitationOnce(client.db, transport, options),
          dispatchInvitationOnce(client.db, transport, options),
        ])
      ).sort(),
    ).toEqual(['delivered', 'idle']);
    expect(send).toHaveBeenCalledTimes(1);
    // Recover after the archive was confirmed but the completion transaction was lost.
    await client.db
      .update(schema.invitationDeliveries)
      .set({
        status: 'processing',
        leaseToken: crypto.randomUUID(),
        availableAt: new Date(Date.now() - 1000),
      })
      .where(eq(schema.invitationDeliveries.id, job!.id));
    expect(await dispatchInvitationOnce(client.db, transport, options)).toBe(
      'delivered',
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('stops retrying after eight failures and exposes only unsuccessful recipients for a new selection', async () => {
    await enqueue();
    send.mockRejectedValue(new Error('SMTP unavailable'));
    for (let attempt = 1; attempt <= 8; attempt++) {
      await client.db
        .update(schema.invitationDeliveries)
        .set({ availableAt: new Date(Date.now() - 1000) })
        .where(eq(schema.invitationDeliveries.eventId, eventId));
      expect(await dispatchInvitationOnce(client.db, transport, options)).toBe(
        attempt === 8 ? 'failed' : 'retried',
      );
    }
    expect(await dispatchInvitationOnce(client.db, transport, options)).toBe(
      'idle',
    );
    expect((await summary()).batches[0]).toMatchObject({
      failed: 1,
      failedUserIds: [ids[0]],
    });
  });
  it('rechecks revoked access and changed addresses before attempting delivery', async () => {
    await enqueue();
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, ids[0]!),
        ),
      );
    expect(await dispatchInvitationOnce(client.db, transport, options)).toBe(
      'skipped',
    );
    expect(send).not.toHaveBeenCalled();
    await enqueue([ids[1]!]);
    send.mockRejectedValueOnce(new Error('network error'));
    expect(await dispatchInvitationOnce(client.db, transport, options)).toBe(
      'retried',
    );
    await client.db
      .update(schema.users)
      .set({ email: `changed-${ids[1]}@example.test` })
      .where(eq(schema.users.id, ids[1]!));
    await client.db
      .update(schema.invitationDeliveries)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitationDeliveries.eventId, eventId));
    expect(await dispatchInvitationOnce(client.db, transport, options)).toBe(
      'skipped',
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('creates a real Better Auth compatible single-use 24-hour login link and keeps it out of the archive', async () => {
    await enqueue([ids[2]!]);
    expect(await dispatchInvitationOnce(client.db, transport, options)).toBe(
      'delivered',
    );
    const message = send.mock.calls[0]![0];
    const deliveredUrl = message.text.match(
      /http:\/\/localhost:3000\/api\/auth\/magic-link\/verify\?\S+/,
    )![0];
    expect(deliveredUrl).toContain('callbackURL=%2Fadmin');
    const [job] = await jobs();
    const verification = await client.db.query.verifications.findFirst({
      where: eq(schema.verifications.id, job!.id),
    });
    expect(verification!.expiresAt.getTime() - job!.preparedAt!.getTime()).toBe(
      24 * 60 * 60_000,
    );
    expect(JSON.stringify(job)).not.toContain(
      new URL(deliveredUrl).searchParams.get('token'),
    );
    const archive = await client.db.query.emailMessages.findFirst({
      where: eq(schema.emailMessages.eventId, eventId),
    });
    expect(archive!.text).toContain('jednorazovy-odkaz-skryt');
    expect(archive!.text).not.toContain(
      new URL(deliveredUrl).searchParams.get('token'),
    );
    expect(message.text).toContain('/navody/moderator');
    const auth = createAuth(new FakeAuthMailProvider(), client.db, {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      APP_BASE_URL: appOrigin,
      PUBLIC_SITE_URL: 'http://localhost:8000',
      DATABASE_URL: databaseUrl!,
      BETTER_AUTH_SECRET: options.secret,
    });
    const consumed = await auth.handler(new Request(deliveredUrl));
    expect(consumed.headers.get('location')).toBe(`${appOrigin}/admin`);
    expect(
      consumed.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith('better-auth.session_token=')),
    ).toBe(true);
    const reused = await auth.handler(new Request(deliveredUrl));
    expect(reused.headers.get('location')).toContain('INVALID_TOKEN');
    expect(
      await client.db.query.verifications.findFirst({
        where: eq(schema.verifications.id, job!.id),
      }),
    ).toBeUndefined();
  });
  it('never recreates a consumed token after an uncertain SMTP result', async () => {
    await enqueue([ids[3]!]);
    send.mockRejectedValueOnce(new Error('SMTP confirmation lost'));
    expect(await dispatchInvitationOnce(client.db, transport, options)).toBe(
      'retried',
    );
    const deliveredUrl = send.mock.calls[0]![0].text.match(
      /http:\/\/localhost:3000\/api\/auth\/magic-link\/verify\?\S+/,
    )![0];
    const auth = createAuth(new FakeAuthMailProvider(), client.db, {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      APP_BASE_URL: appOrigin,
      PUBLIC_SITE_URL: 'http://localhost:8000',
      DATABASE_URL: databaseUrl!,
      BETTER_AUTH_SECRET: options.secret,
    });
    expect(
      (await auth.handler(new Request(deliveredUrl))).headers.get('location'),
    ).toBe(`${appOrigin}/admin`);
    await client.db
      .update(schema.invitationDeliveries)
      .set({ availableAt: new Date(Date.now() - 1000) })
      .where(eq(schema.invitationDeliveries.eventId, eventId));
    expect(await dispatchInvitationOnce(client.db, transport, options)).toBe(
      'skipped',
    );
    expect(send).toHaveBeenCalledTimes(1);
    const [job] = await jobs();
    expect(
      await client.db.query.verifications.findFirst({
        where: eq(schema.verifications.id, job!.id),
      }),
    ).toBeUndefined();
  });
  it('expires stale queued batches without sending or creating login tokens', async () => {
    await enqueue();
    await client.db
      .update(schema.invitationDeliveries)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60_000) })
      .where(eq(schema.invitationDeliveries.eventId, eventId));
    expect(await dispatchInvitationOnce(client.db, transport, options)).toBe(
      'failed',
    );
    expect(send).not.toHaveBeenCalled();
    const [job] = await jobs();
    expect(job!.lastError).toBe('queue_expired');
    expect(job!.preparedAt).toBeNull();
  });
});
