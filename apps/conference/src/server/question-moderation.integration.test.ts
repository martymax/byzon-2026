import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@byzon/database';
import { and, eq } from 'drizzle-orm';
import { createQuestionFixture } from '../test/server/question-fixture';
import { deleteParticipantData } from './participant-deletion';
import { moderateQuestion } from './question-moderation';
import { readModeratorQuestions, submitQuestion } from './questions';
import { readOwnQuestions } from './own-questions';
import { readSpeakerQuestions } from './speaker-questions';

const suite = process.env.TEST_DATABASE_URL
  ? describe.sequential
  : describe.skip;
suite('question moderation', () => {
  let f: Awaited<ReturnType<typeof createQuestionFixture>>;
  let first: string, second: string, third: string;
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
    const ids: string[] = [];
    for (const [user, text] of [
      [f.users.participant, 'První znění?'],
      [f.users.other, 'Druhé znění?'],
      [f.users.participant, 'Třetí znění?'],
    ]) {
      const response = await submitQuestion(
        f.request('/submit', { text }),
        f.sessionId,
        f.dependencies(user),
      );
      expect(response.status).toBe(201);
      ids.push((await response.json()).questionId);
    }
    [first, second, third] = ids as [string, string, string];
  });
  const mutate = (
    body: unknown,
    user = f.users.moderator,
    key = randomUUID(),
    session = f.sessionId,
  ) =>
    moderateQuestion(
      f.request('/moderate', body, key),
      session,
      f.dependencies(user),
    );
  const feed = async () => {
    const response = await readModeratorQuestions(
      f.request('/feed'),
      f.sessionId,
      f.dependencies(f.users.moderator),
    );
    expect(response.status).toBe(200);
    return (await response.json()).items;
  };
  it('marks answered and reopens, rejects participants and stale edits, replays safely', async () => {
    const body = {
      action: 'answer',
      questionId: first,
      expectedVersion: 1,
      answered: true,
    };
    expect((await mutate(body, f.users.participant)).status).toBe(403);
    const key = randomUUID();
    expect((await mutate(body, f.users.moderator, key)).status).toBe(200);
    const replay = await mutate(body, f.users.moderator, key);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect((await mutate(body)).status).toBe(409);
    expect((await feed())[0]).toMatchObject({
      answeredAt: '2026-09-18T09:30:00.000Z',
      moderationVersion: 2,
    });
    expect(
      (
        await mutate(
          { ...body, expectedVersion: 2, answered: false },
          f.users.admin,
        )
      ).status,
    ).toBe(200);
    expect((await feed())[0].answeredAt).toBeNull();
  });
  it('merges existing groups without changing originals or exposing other authors to participants', async () => {
    await f.client.db.insert(schema.questionAnswers).values({
      id: randomUUID(),
      eventId: f.eventId,
      sessionId: f.sessionId,
      questionId: second,
      speakerProfileId: f.speakerProfileId,
      answeredByUserId: f.users.speaker,
      speakerName: 'Řečník',
      text: 'Soukromá odpověď druhému tazateli',
    });
    expect(
      (
        await mutate({
          action: 'merge',
          questionId: first,
          expectedVersion: 1,
          sourceId: second,
          sourceVersion: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await mutate({
          action: 'merge',
          questionId: third,
          expectedVersion: 1,
          sourceId: first,
          sourceVersion: 2,
        })
      ).status,
    ).toBe(200);
    const items = await feed();
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('Třetí znění?');
    expect(items[0].originals.map((q: { text: string }) => q.text)).toEqual([
      'První znění?',
      'Druhé znění?',
    ]);
    const own = await (
      await readOwnQuestions(f.request('/own'), f.dependencies(f.users.other))
    ).json();
    expect(own.items).toHaveLength(1);
    expect(own.items[0].text).toBe('Druhé znění?');
    expect(own.items[0].answer.text).toBe('Soukromá odpověď druhému tazateli');
    const otherOwner = await (
      await readOwnQuestions(f.request('/own'), f.dependencies())
    ).json();
    expect(JSON.stringify(otherOwner)).not.toContain(
      'Soukromá odpověď druhému tazateli',
    );
    expect(JSON.stringify(items)).not.toContain(
      'Soukromá odpověď druhému tazateli',
    );
    expect(JSON.stringify(own)).not.toContain('První znění?');
    expect(
      (
        await mutate({
          action: 'answer',
          questionId: third,
          expectedVersion: 2,
          answered: true,
        })
      ).status,
    ).toBe(200);
    const updated = await (
      await readOwnQuestions(f.request('/own'), f.dependencies(f.users.other))
    ).json();
    expect(updated.items[0].answeredAt).not.toBeNull();
  });
  it('deletes a merged group from moderator, author and speaker feeds', async () => {
    await mutate({
      action: 'merge',
      questionId: first,
      expectedVersion: 1,
      sourceId: second,
      sourceVersion: 1,
    });
    expect(
      (
        await mutate({
          action: 'delete',
          questionId: first,
          expectedVersion: 2,
        })
      ).status,
    ).toBe(200);
    expect(
      (await feed()).map((q: { questionId: string }) => q.questionId),
    ).toEqual([third]);
    const own = await (
      await readOwnQuestions(f.request('/own'), f.dependencies(f.users.other))
    ).json();
    expect(own.items).toEqual([]);
    f.setNow('2026-09-18T11:00:00Z');
    const speaker = await readSpeakerQuestions(
      f.request('/speaker'),
      f.sessionId,
      f.dependencies(f.users.speaker),
    );
    expect(speaker.status).toBe(200);
    expect(
      (await speaker.json()).items.map(
        (q: { questionId: string }) => q.questionId,
      ),
    ).toEqual([third]);
  });
  it('allows admin without participant role and denies revoked moderator and other sessions', async () => {
    const body = { action: 'delete', questionId: first, expectedVersion: 1 };
    expect(
      (await mutate(body, f.users.moderator, randomUUID(), f.unsupportedId))
        .status,
    ).toBe(403);
    await f.client.db
      .update(schema.eventRoles)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.eventRoles.userId, f.users.moderator),
          eq(schema.eventRoles.role, 'moderator'),
        ),
      );
    expect((await mutate(body)).status).toBe(403);
    await f.client.db
      .update(schema.eventRoles)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.eventRoles.userId, f.users.admin),
          eq(schema.eventRoles.role, 'participant'),
        ),
      );
    expect((await mutate(body, f.users.admin)).status).toBe(200);
    await f.client.db
      .update(schema.eventRoles)
      .set({ revokedAt: null })
      .where(eq(schema.eventRoles.userId, f.users.moderator));
  });
  it('rejects cross-session merges, bad origins and concurrent conflicting mutations', async () => {
    const foreign = randomUUID();
    await f.client.db.insert(schema.questions).values({
      id: foreign,
      eventId: f.eventId,
      sessionId: f.unsupportedId,
      authorUserId: f.users.other,
      text: 'Jiná přednáška',
    });
    expect(
      (
        await mutate({
          action: 'merge',
          questionId: first,
          expectedVersion: 1,
          sourceId: foreign,
          sourceVersion: 1,
        })
      ).status,
    ).toBe(404);
    const body = {
      action: 'answer',
      questionId: first,
      expectedVersion: 1,
      answered: true,
    };
    const bad = f.request('/moderate', body);
    bad.headers.set('origin', 'https://other.test');
    expect(
      (await moderateQuestion(bad, f.sessionId, f.dependencies(f.users.admin)))
        .status,
    ).toBe(422);
    const results = await Promise.all([
      mutate(body),
      mutate({ action: 'delete', questionId: first, expectedVersion: 1 }),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200,
      results.some((response) => response.status === 404) ? 404 : 409,
    ]);
  });
  it('preserves other authors when permanently deleting a merged question owner', async () => {
    await mutate({
      action: 'merge',
      questionId: first,
      expectedVersion: 1,
      sourceId: second,
      sourceVersion: 1,
    });
    await f.client.db.transaction((tx) =>
      deleteParticipantData(tx, {
        eventId: f.eventId,
        participantId: f.users.participant,
        expectedProfileVersion: 1,
        now: new Date('2026-09-18T09:30:00Z'),
        requestId: randomUUID(),
      }),
    );
    const items = await feed();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      questionId: second,
      text: 'Druhé znění?',
      originals: [],
    });
  });
});
