import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@byzon/database';
import { and, eq } from 'drizzle-orm';
import { createQuestionFixture } from '../test/server/question-fixture';
import { readModeratorSessions } from './moderator-sessions';
import { readOwnQuestions, readQuestionContext } from './own-questions';
import { readModeratorQuestions, submitQuestion } from './questions';
const suite = process.env.TEST_DATABASE_URL
  ? describe.sequential
  : describe.skip;
suite('authoritative participant Q&A', () => {
  let f: Awaited<ReturnType<typeof createQuestionFixture>>;
  beforeAll(async () => {
    f = await createQuestionFixture();
  });
  afterAll(async () => {
    await f?.cleanup();
  });
  beforeEach(async () => {
    f.setNow('2026-09-18T09:30:00Z');
    await f.client.db
      .delete(schema.questions)
      .where(eq(schema.questions.eventId, f.eventId));
    await f.client.db
      .update(schema.eventFeatures)
      .set({ questionsEnabled: true })
      .where(eq(schema.eventFeatures.eventId, f.eventId));
  });
  const submit = (
    userId = f.users.participant,
    sessionId = f.sessionId,
    text = 'Jak začít?',
    key = randomUUID(),
  ) =>
    submitQuestion(
      f.request(`/api/v1/sessions/${sessionId}/questions`, { text }, key),
      sessionId,
      f.dependencies(userId),
    );
  it('lists only assigned supported sessions with collection switched off', async () => {
    await f.client.db
      .update(schema.eventFeatures)
      .set({ questionsEnabled: false })
      .where(eq(schema.eventFeatures.eventId, f.eventId));
    const response = await readModeratorSessions(
      f.request('/api/v1/moderator/sessions'),
      f.dependencies(f.users.moderator),
    );
    expect(response.status).toBe(200);
    expect(
      (await response.json()).sessions.map((s: { id: string }) => s.id),
    ).toEqual([f.sessionId]);
    expect(
      (
        await readModeratorSessions(
          f.request('/list'),
          f.dependencies(f.users.admin),
        )
      ).status,
    ).toBe(200);
  });
  it.each([
    ['2026-09-07T08:00:00Z', 201, null],
    ['2026-09-18T08:59:59.999Z', 201, null],
    ['2026-09-18T09:00:00Z', 201, null],
    ['2026-09-18T09:59:59.999Z', 201, null],
    ['2026-09-18T10:00:00Z', 201, null],
    ['2026-09-18T10:29:59.999Z', 201, null],
    ['2026-09-18T10:30:00Z', 409, 'QUESTIONS_CLOSED'],
    ['2026-09-18T10:30:00.001Z', 409, 'QUESTIONS_CLOSED'],
  ] as const)('enforces server time at %s', async (time, status, code) => {
    f.setNow(time);
    if (time < '2026-09-18T09:00:00Z') {
      await f.client.db
        .update(schema.events)
        .set({ status: 'activation_open' })
        .where(eq(schema.events.id, f.eventId));
    }
    const context = await readQuestionContext(
      f.request('/context'),
      f.sessionId,
      f.dependencies(),
    );
    expect(await context.json()).toMatchObject({
      state: code ? 'closed' : 'open',
      canSubmit: status === 201,
    });
    const response = await submit();
    expect(response.status).toBe(status);
    if (code) expect(await response.json()).toMatchObject({ code });
  });
  it('uses live flags despite disabled flags in the immutable publication', async () => {
    const context = () =>
      readQuestionContext(f.request('/context'), f.sessionId, f.dependencies());
    expect(await (await context()).json()).toMatchObject({
      state: 'open',
      canSubmit: true,
    });
    await f.client.db
      .update(schema.eventFeatures)
      .set({ questionsEnabled: false })
      .where(eq(schema.eventFeatures.eventId, f.eventId));
    expect(await (await context()).json()).toMatchObject({
      state: 'disabled',
      canSubmit: false,
      canReadOwn: true,
    });
    expect((await submit()).status).toBe(409);
  });
  it('replays an accepted request after the session closes without duplicating it', async () => {
    const key = randomUUID();
    const first = await submit(undefined, undefined, undefined, key);
    expect(first.status).toBe(201);
    f.setNow('2026-09-18T10:30:00Z');
    const second = await submit(undefined, undefined, undefined, key);
    expect(second.status).toBe(201);
    expect(await second.json()).toEqual(await first.json());
    const rows = await f.client.db.query.questions.findMany({
      where: eq(schema.questions.eventId, f.eventId),
    });
    expect(rows).toHaveLength(1);
  });
  it('denies unsupported/unpublished sessions and missing participant baseline', async () => {
    expect(
      await (await submit(undefined, f.unsupportedId)).json(),
    ).toMatchObject({ code: 'QUESTIONS_UNSUPPORTED' });
    expect((await submit(f.users.unready)).status).toBe(403);
    await f.client.db
      .update(schema.programSessions)
      .set({ status: 'draft' })
      .where(eq(schema.programSessions.id, f.sessionId));
    expect((await submit()).status).toBe(404);
    await f.client.db
      .update(schema.programSessions)
      .set({ status: 'published' })
      .where(eq(schema.programSessions.id, f.sessionId));
  });
  it('keeps owner history and assigned moderator reads when collection is disabled', async () => {
    await submit(f.users.participant, f.sessionId, 'Otázka vlastníka');
    await submit(f.users.other, f.sessionId, 'Soukromý cizí dotaz');
    await f.client.db
      .update(schema.eventFeatures)
      .set({ questionsEnabled: false })
      .where(eq(schema.eventFeatures.eventId, f.eventId));
    f.setNow('2026-09-18T11:00:00Z');
    const own = await readOwnQuestions(
      f.request('/api/v1/me/questions'),
      f.dependencies(),
    );
    expect(own.headers.get('cache-control')).toBe('private, no-store');
    const data = await own.json();
    expect(data.items).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('Soukromý cizí dotaz');
    const feed = await readModeratorQuestions(
      f.request('/feed'),
      f.sessionId,
      f.dependencies(f.users.moderator),
    );
    expect(feed.status).toBe(200);
    expect((await feed.json()).items).toHaveLength(2);
    expect(
      (
        await readModeratorQuestions(
          f.request('/feed'),
          f.sessionId,
          f.dependencies(f.users.admin),
        )
      ).status,
    ).toBe(200);
  });
  it('paginates more than 100 questions with identical timestamps without duplicates', async () => {
    await f.client.db.insert(schema.questions).values(
      Array.from({ length: 125 }, () => ({
        id: randomUUID(),
        eventId: f.eventId,
        sessionId: f.sessionId,
        authorUserId: f.users.participant,
        text: 'Dotaz',
        createdAt: new Date('2026-09-18T09:15:00Z'),
      })),
    );
    const first = await (
      await readOwnQuestions(
        f.request('/api/v1/me/questions'),
        f.dependencies(),
      )
    ).json();
    const last = first.items.at(-1);
    const second = await (
      await readOwnQuestions(
        f.request(
          `/api/v1/me/questions?after=${encodeURIComponent(last.submittedAt)}&cursor=${last.questionId}`,
        ),
        f.dependencies(),
      )
    ).json();
    expect(first.items).toHaveLength(100);
    expect(second.items).toHaveLength(25);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.questionId))
        .size,
    ).toBe(125);
  });
  it('enforces role revocation immediately', async () => {
    await f.client.db
      .update(schema.eventRoles)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.eventRoles.eventId, f.eventId),
          eq(schema.eventRoles.userId, f.users.participant),
          eq(schema.eventRoles.role, 'participant'),
        ),
      );
    expect((await submit()).status).toBe(403);
  });
});
