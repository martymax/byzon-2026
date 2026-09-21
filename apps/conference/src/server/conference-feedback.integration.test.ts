import { createDatabaseClient, generateUuidV7, schema } from '@byzon/database';
import { and, eq } from 'drizzle-orm';
import type { DeliveryMessage } from '@byzon/mail/transport';
import { dispatchEmailOnce } from '../../../worker/src/email';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('./current-event', () => ({ CURRENT_EVENT_SLUG: 'byzon-2026' }));
import {
  ensureConferenceFeedbackResponse,
  handleAdminConferenceFeedback,
  handleConferenceFeedback,
  type FeedbackDependencies,
} from './conference-feedback';

const url = process.env.TEST_DATABASE_URL;
const integration = url ? describe.sequential : describe.skip;
integration('scoped conference feedback', () => {
  const client = createDatabaseClient({
    connectionString: url!,
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'feedback-integration',
    onUnexpectedError: vi.fn(),
  });
  const eventId = generateUuidV7();
  const adminId = generateUuidV7();
  const participantId = generateUuidV7();
  const otherId = generateUuidV7();
  const optedOutId = generateUuidV7();
  const origin = 'https://feedback.example.test';
  const deps: FeedbackDependencies = {
    db: client.db,
    getSession: async () => null,
    currentEventSlug: `feedback-${eventId}`,
    allowedOrigin: origin,
    tokenSecret: 'feedback-test-secret'.repeat(4),
  };
  const admin = {
    ...deps,
    getSession: async () => ({ user: { id: adminId } }),
  };
  let token = '';
  const request = (method = 'GET', data?: unknown, requestOrigin = origin) =>
    new Request(`${origin}/api/v1/feedback/${token}`, {
      method,
      headers: { origin: requestOrigin, 'content-type': 'application/json' },
      ...(method !== 'GET' ? { body: JSON.stringify(data ?? {}) } : {}),
    });
  const adminRequest = (path = '', body?: unknown, key = generateUuidV7()) =>
    new Request(`${origin}/api/v1/admin/events/${eventId}/feedback${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        origin,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  beforeAll(async () => {
    await client.db.insert(schema.events).values({
      id: eventId,
      slug: deps.currentEventSlug!,
      name: 'Feedback test',
      status: 'ended',
      timezone: 'Europe/Prague',
      startsAt: new Date('2026-09-18'),
      endsAt: new Date('2026-09-20'),
    });
    for (const userId of [adminId, participantId, otherId, optedOutId]) {
      await client.db.insert(schema.users).values({
        id: userId,
        name: 'Test User',
        email: `${userId}@example.invalid`,
      });
      await client.db
        .insert(schema.eventMemberships)
        .values({ eventId, userId, status: 'active' });
      await client.db.insert(schema.eventRoles).values({
        id: generateUuidV7(),
        eventId,
        userId,
        role: userId === adminId ? 'organizer_admin' : 'participant',
      });
      if (userId !== adminId)
        await client.db.insert(schema.participantProfiles).values({
          eventId,
          userId,
          firstName: 'Test',
          lastName: 'Účastník',
          contactEmail: `${userId}@example.invalid`,
          ratingEmailsEnabled: userId !== optedOutId,
        });
    }
    token = (
      await ensureConferenceFeedbackResponse(
        client.db,
        eventId,
        participantId,
        deps.tokenSecret,
      )
    ).token;
  });
  afterAll(async () => {
    await client.close();
  });
  it('opens repeatedly without a login and returns no email, user ID or token', async () => {
    for (let i = 0; i < 2; i++) {
      const result = await handleConferenceFeedback(request(), token, deps);
      expect(result.status).toBe(200);
      expect(result.headers.get('set-cookie')).toBeNull();
      expect(result.headers.get('referrer-policy')).toBe('no-referrer');
      const body = await result.json();
      expect(body.data.firstName).toBe('Test');
      expect(body.data).not.toHaveProperty('userId');
      expect(body.data).not.toHaveProperty('token');
      expect(body.data).not.toHaveProperty('email');
    }
    expect(
      (
        await ensureConferenceFeedbackResponse(
          client.db,
          eventId,
          participantId,
          deps.tokenSecret,
        )
      ).token,
    ).toBe(token);
    expect(
      (
        await handleConferenceFeedback(
          request(),
          `${token.slice(0, -1)}!`,
          deps,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleConferenceFeedback(request(), token, {
          ...deps,
          currentEventSlug: 'another-event',
        })
      ).status,
    ).toBe(404);
    expect(
      (await handleAdminConferenceFeedback(adminRequest(), eventId, deps))
        .status,
    ).toBe(401);
  });
  it('denies participant credentials access to administrator reports and send actions', async () => {
    const participant = {
      ...deps,
      getSession: async () => ({ user: { id: participantId } }),
    };
    expect(
      (
        await handleAdminConferenceFeedback(
          adminRequest(),
          eventId,
          participant,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleAdminConferenceFeedback(
          adminRequest('/send', {
            kind: 'invitation',
            participantIds: [participantId],
          }),
          eventId,
          participant,
          'send',
        )
      ).status,
    ).toBe(403);
  });
  it('merges simultaneous per-answer saves and resumes after reopening', async () => {
    const results = await Promise.all([
      handleConferenceFeedback(
        request('PATCH', {
          answers: { participantRole: 'speaker', score: '5' },
          currentStep: 'overall',
        }),
        token,
        deps,
      ),
      handleConferenceFeedback(
        request('PATCH', { answers: { musicScore: '4' } }),
        token,
        deps,
      ),
      handleConferenceFeedback(
        request('PATCH', { answers: { collaborationScore: '3' } }),
        token,
        deps,
      ),
    ]);
    expect(results.map((result) => result.status)).toEqual([200, 200, 200]);
    const body = await (
      await handleConferenceFeedback(request(), token, deps)
    ).json();
    expect(body.data.answers).toMatchObject({
      participantRole: 'speaker',
      score: '5',
      musicScore: '4',
      collaborationScore: '3',
    });
    expect(body.data.currentStep).toBe('overall');
    expect(body.data.completedAt).toBeNull();
  });
  it('rejects cross-origin writes, unknown IDs, choices, hostile text and unrelated sessions', async () => {
    expect(
      (
        await handleConferenceFeedback(
          request('PATCH', { answers: { score: '2' } }, 'https://evil.test'),
          token,
          deps,
        )
      ).status,
    ).toBe(403);
    for (const answers of [
      { isAdmin: 'true' },
      { score: '200' },
      { comment: 'a\u0000b' },
      { [`session:${generateUuidV7()}`]: '4' },
    ])
      expect(
        (
          await handleConferenceFeedback(
            request('PATCH', { answers }),
            token,
            deps,
          )
        ).status,
      ).toBe(422);
  });
  it('excludes conditional and previous-role answers from reports while preserving partial data', async () => {
    await handleConferenceFeedback(
      request('PATCH', {
        answers: {
          participantRole: 'attendee',
          coachingAttended: 'no',
          coachingScore: '4',
          djScore: 'skip',
          comment: '=HYPERLINK("bad")',
        },
      }),
      token,
      deps,
    );
    const publicResult = await (
      await handleConferenceFeedback(request(), token, deps)
    ).json();
    expect(publicResult.data.answers).not.toHaveProperty('collaborationScore');
    expect(publicResult.data.answers).not.toHaveProperty('coachingScore');
    const report = await (
      await handleAdminConferenceFeedback(adminRequest(), eventId, admin)
    ).json();
    expect(report.data.summary).toMatchObject({
      total: 3,
      started: 1,
      inProgress: 1,
      completed: 0,
      optedOut: 1,
    });
    expect(
      report.data.questions.find((q: { id: string }) => q.id === 'score'),
    ).toMatchObject({ answered: 1, average: 5 });
    expect(
      report.data.questions.find((q: { id: string }) => q.id === 'djScore'),
    ).toMatchObject({ answered: 1, notApplicable: 1, average: null });
    expect(
      report.data.questions.find(
        (q: { id: string }) => q.id === 'collaborationScore',
      ),
    ).toMatchObject({ answered: 0, eligible: 0 });
    const csv = await (
      await handleAdminConferenceFeedback(
        adminRequest('/export'),
        eventId,
        admin,
        'export',
      )
    ).text();
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain(token);
    expect(csv).not.toContain('@example.invalid');
  });
  it('queues opted-in unverified participants once; does not send messages during creation', async () => {
    const body = {
      kind: 'invitation',
      participantIds: [participantId, otherId, optedOutId],
    };
    const key = generateUuidV7();
    const first = await handleAdminConferenceFeedback(
      adminRequest('/send', body, key),
      eventId,
      admin,
      'send',
    );
    expect(first.status).toBe(202);
    expect((await first.json()).data).toMatchObject({ queued: 2, skipped: 1 });
    expect(
      (
        await (
          await handleAdminConferenceFeedback(
            adminRequest('/send', body, key),
            eventId,
            admin,
            'send',
          )
        ).json()
      ).data,
    ).toMatchObject({ queued: 2, skipped: 1 });
    expect(
      (
        await (
          await handleAdminConferenceFeedback(
            adminRequest('/send', body),
            eventId,
            admin,
            'send',
          )
        ).json()
      ).data,
    ).toMatchObject({ queued: 0, skipped: 3 });
    const jobs = await client.db
      .select()
      .from(schema.emailDeliveries)
      .where(eq(schema.emailDeliveries.eventId, eventId));
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.status === 'pending')).toBe(true);
    expect(
      jobs.find((job) => job.userId === participantId)?.payload.feedbackUrl,
    ).toBe(`${origin}/hodnoceni/${token}`);
  });
  it('uses a fresh provider key and archive on manual retry after a recipient changes address', async () => {
    const where = and(
      eq(schema.emailDeliveries.eventId, eventId),
      eq(schema.emailDeliveries.userId, otherId),
    );
    const original = await client.db.query.emailDeliveries.findFirst({ where });
    expect(original).toBeTruthy();
    const oldAddress = `${otherId}@example.invalid`;
    const newAddress = `changed-${otherId}@example.invalid`;
    const originalArchiveId = generateUuidV7();
    await client.db.insert(schema.emailMessages).values({
      id: originalArchiveId,
      eventId,
      userId: otherId,
      kind: 'conference_feedback',
      deduplicationKey: `notification:${original!.id}`,
      recipient: oldAddress,
      subject: 'Původní zásilka',
      text: 'Zmrazený obsah před změnou kontaktu',
    });
    await client.db
      .update(schema.emailDeliveries)
      .set({
        status: 'failed',
        attempts: 8,
        lastError: 'transport_failed',
        rendered: {
          to: oldAddress,
          subject: 'Původní zásilka',
          text: 'Zmrazený obsah',
          html: '<p>Zmrazený obsah</p>',
        },
      })
      .where(where);
    await client.db
      .update(schema.participantProfiles)
      .set({ contactEmail: newAddress })
      .where(
        and(
          eq(schema.participantProfiles.eventId, eventId),
          eq(schema.participantProfiles.userId, otherId),
        ),
      );
    // Isolate this dispatch from other suites' queues without modifying their data.
    const retryNow = new Date('2024-01-01T12:00:00Z');
    const result = await handleAdminConferenceFeedback(
      adminRequest('/send', { kind: 'invitation', participantIds: [otherId] }),
      eventId,
      { ...admin, now: () => retryNow },
      'send',
    );
    expect(result.status).toBe(202);
    expect((await result.json()).data).toMatchObject({ queued: 1, skipped: 0 });
    const retried = await client.db.query.emailDeliveries.findFirst({ where });
    expect(retried).toMatchObject({
      status: 'pending',
      attempts: 0,
      lastError: null,
      rendered: null,
      deduplicationKey: original!.deduplicationKey,
    });
    expect(retried!.id).not.toBe(original!.id);
    expect(retried!.payload.feedbackUrl).toBe(original!.payload.feedbackUrl);
    const send = vi.fn<(message: DeliveryMessage) => Promise<void>>(
      async () => {},
    );
    expect(await dispatchEmailOnce(client.db, { send }, origin, retryNow)).toBe(
      'delivered',
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      to: newAddress,
      idempotencyKey: `byzon-notification-${retried!.id}`,
    });
    const oldArchive = await client.db.query.emailMessages.findFirst({
      where: eq(schema.emailMessages.id, originalArchiveId),
    });
    const newArchive = await client.db.query.emailMessages.findFirst({
      where: and(
        eq(schema.emailMessages.eventId, eventId),
        eq(
          schema.emailMessages.deduplicationKey,
          `notification:${retried!.id}`,
        ),
      ),
    });
    expect(oldArchive).toMatchObject({
      recipient: oldAddress,
      sentAt: null,
      text: 'Zmrazený obsah před změnou kontaktu',
    });
    expect(newArchive?.recipient).toBe(newAddress);
    expect(newArchive?.sentAt).toEqual(retryNow);
    expect(newArchive?.text).toContain('/hodnoceni/odkaz-skryt');
    expect(newArchive?.text).not.toContain(
      String(retried!.payload.feedbackUrl),
    );
  });
  it('revokes tokens on signing-secret rotation and blocks blank completion', async () => {
    const original = await ensureConferenceFeedbackResponse(
      client.db,
      eventId,
      otherId,
      deps.tokenSecret,
    );
    const rotated = {
      ...deps,
      tokenSecret: 'rotated-feedback-secret'.repeat(3),
    };
    expect(
      (await handleConferenceFeedback(request(), original.token, rotated))
        .status,
    ).toBe(404);
    const replacement = await ensureConferenceFeedbackResponse(
      client.db,
      eventId,
      otherId,
      rotated.tokenSecret,
    );
    expect(replacement.token).not.toBe(original.token);
    expect(
      (await handleConferenceFeedback(request(), replacement.token, rotated))
        .status,
    ).toBe(200);
    expect(
      (
        await handleConferenceFeedback(
          request('POST'),
          replacement.token,
          rotated,
        )
      ).status,
    ).toBe(422);
    await ensureConferenceFeedbackResponse(
      client.db,
      eventId,
      otherId,
      deps.tokenSecret,
    );
  });
  it('suppresses access and new mail for pending deletion', async () => {
    const otherToken = (
      await ensureConferenceFeedbackResponse(
        client.db,
        eventId,
        otherId,
        deps.tokenSecret,
      )
    ).token;
    await client.db.insert(schema.privacyRequests).values({
      id: generateUuidV7(),
      eventId,
      userId: otherId,
      kind: 'data_deletion',
    });
    expect(
      (await handleConferenceFeedback(request(), otherToken, deps)).status,
    ).toBe(404);
    const result = await handleAdminConferenceFeedback(
      adminRequest('/send', { kind: 'reminder', participantIds: [otherId] }),
      eventId,
      admin,
      'send',
    );
    expect((await result.json()).data).toMatchObject({ queued: 0, skipped: 1 });
    const report = await (
      await handleAdminConferenceFeedback(adminRequest(), eventId, admin)
    ).json();
    expect(
      report.data.recipients.some((row: { id: string }) => row.id === otherId),
    ).toBe(false);
  });
  it('cascades private answers and credentials when the participant profile is deleted', async () => {
    const { response, token: optedOutToken } =
      await ensureConferenceFeedbackResponse(
        client.db,
        eventId,
        optedOutId,
        deps.tokenSecret,
      );
    await client.db
      .delete(schema.participantProfiles)
      .where(
        and(
          eq(schema.participantProfiles.eventId, eventId),
          eq(schema.participantProfiles.userId, optedOutId),
        ),
      );
    expect(
      await client.db.query.conferenceFeedbackResponses.findFirst({
        where: eq(schema.conferenceFeedbackResponses.id, response.id),
      }),
    ).toBeUndefined();
    expect(
      (await handleConferenceFeedback(request(), optedOutToken, deps)).status,
    ).toBe(404);
  });
  it('completes idempotently, allows later corrections and honors membership revocation', async () => {
    const completed = await (
      await handleConferenceFeedback(request('POST'), token, deps)
    ).json();
    expect(completed.data.completedAt).toBeTruthy();
    const repeated = await (
      await handleConferenceFeedback(request('POST'), token, deps)
    ).json();
    expect(repeated.data.completedAt).toBe(completed.data.completedAt);
    const updated = await (
      await handleConferenceFeedback(
        request('PATCH', { answers: { score: '4' } }),
        token,
        deps,
      )
    ).json();
    expect(updated.data.answers.score).toBe('4');
    await client.db
      .update(schema.eventMemberships)
      .set({ status: 'suspended' })
      .where(
        and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.userId, participantId),
        ),
      );
    expect(
      (await handleConferenceFeedback(request(), token, deps)).status,
    ).toBe(404);
    expect(
      (
        await handleConferenceFeedback(
          request('PATCH', { answers: { score: '3' } }),
          token,
          deps,
        )
      ).status,
    ).toBe(404);
  });
});
