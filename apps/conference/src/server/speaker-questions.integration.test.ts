import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '@byzon/database';
import { and, eq } from 'drizzle-orm';
import { createQuestionFixture } from '../test/server/question-fixture';
import {
  readSpeakerQuestions,
  readSpeakerSessions,
  writeQuestionAnswer,
} from './speaker-questions';
import { submitQuestion } from './questions';
import { readOwnQuestions } from './own-questions';
const suite = process.env.TEST_DATABASE_URL
  ? describe.sequential
  : describe.skip;
suite('private speaker follow-ups', () => {
  let f: Awaited<ReturnType<typeof createQuestionFixture>>, questionId: string;
  beforeAll(async () => {
    f = await createQuestionFixture();
  });
  afterAll(async () => {
    await f?.cleanup();
  });
  beforeEach(async () => {
    f.setNow('2026-09-18T09:30:00Z');
    await f.client.db
      .update(schema.eventFeatures)
      .set({ questionsEnabled: true, questionFollowUpsEnabled: true })
      .where(eq(schema.eventFeatures.eventId, f.eventId));
    const response = await submitQuestion(
      f.request('/submit', { text: 'Soukromý testovací dotaz' }),
      f.sessionId,
      f.dependencies(),
    );
    questionId = (await response.json()).questionId;
    f.setNow('2026-09-18T10:00:00Z');
  });
  const write = (
    user: string,
    method: 'PUT' | 'PATCH' = 'PUT',
    version = 0,
    key = randomUUID(),
    text = 'Soukromá odpověď',
  ) =>
    writeQuestionAnswer(
      new Request(`${f.origin}/api/v1/speaker/questions/${questionId}/answer`, {
        method,
        headers: {
          origin: f.origin,
          'content-type': 'application/json',
          'idempotency-key': key,
        },
        body: JSON.stringify({ text, expectedVersion: version }),
      }),
      questionId,
      f.dependencies(user),
    );
  it('denies before the end and requires all speaker and participant links', async () => {
    f.setNow('2026-09-18T09:59:59.999Z');
    expect((await write(f.users.speaker)).status).toBe(409);
    expect(
      (
        await readSpeakerQuestions(
          f.request('/feed'),
          f.sessionId,
          f.dependencies(f.users.speaker),
        )
      ).status,
    ).toBe(409);
    f.setNow('2026-09-18T10:00:00Z');
    for (const user of [
      f.users.admin,
      f.users.participant,
      f.users.moderator,
      f.users.unready,
    ])
      expect((await write(user)).status).toBe(403);
    expect((await write(f.users.speaker)).status).toBe(201);
  });
  it('exposes no author fields, and only the question owner reads the answer', async () => {
    expect((await write(f.users.speaker)).status).toBe(201);
    const feed = await (
      await readSpeakerQuestions(
        f.request('/feed?status=all'),
        f.sessionId,
        f.dependencies(f.users.speaker2),
      )
    ).json();
    expect(
      feed.items.find(
        (q: { questionId: string }) => q.questionId === questionId,
      ),
    ).toMatchObject({ canEdit: false, answer: { text: 'Soukromá odpověď' } });
    const raw = JSON.stringify(feed);
    for (const privateValue of [
      'authorName',
      'authorUserId',
      'email',
      f.users.participant,
    ])
      expect(raw).not.toContain(privateValue);
    const own = await (
      await readOwnQuestions(f.request('/own'), f.dependencies())
    ).json();
    expect(
      own.items.find((q: { questionId: string }) => q.questionId === questionId)
        .answer.text,
    ).toBe('Soukromá odpověď');
    expect(
      (
        await (
          await readOwnQuestions(
            f.request('/own'),
            f.dependencies(f.users.other),
          )
        ).json()
      ).items,
    ).toEqual([]);
  });
  it('serializes panel races, exact retries, author-only edits and optimistic versions', async () => {
    const results = await Promise.all([
      write(f.users.speaker),
      write(f.users.speaker2),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner =
      results[0]!.status === 201 ? f.users.speaker : f.users.speaker2;
    const loser =
      winner === f.users.speaker ? f.users.speaker2 : f.users.speaker;
    expect((await write(loser, 'PATCH', 1)).status).toBe(403);
    const key = randomUUID();
    const first = await write(winner, 'PATCH', 1, key, 'Opravená odpověď');
    expect(first.status).toBe(200);
    expect(
      (await write(winner, 'PATCH', 1, key, 'Opravená odpověď')).headers.get(
        'idempotency-replayed',
      ),
    ).toBe('true');
    expect((await write(winner, 'PATCH', 1)).status).toBe(409);
    const edits = await Promise.all([
      write(winner, 'PATCH', 2),
      write(winner, 'PATCH', 2),
    ]);
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
  });
  it('collection OFF keeps follow-ups, follow-up OFF blocks speakers but keeps author history', async () => {
    await f.client.db
      .update(schema.eventFeatures)
      .set({ questionsEnabled: false })
      .where(eq(schema.eventFeatures.eventId, f.eventId));
    expect((await write(f.users.speaker)).status).toBe(201);
    expect(
      (
        await readSpeakerSessions(
          f.request('/list'),
          f.dependencies(f.users.speaker),
        )
      ).status,
    ).toBe(200);
    await f.client.db
      .update(schema.eventFeatures)
      .set({ questionFollowUpsEnabled: false })
      .where(eq(schema.eventFeatures.eventId, f.eventId));
    expect(
      (
        await readSpeakerQuestions(
          f.request('/feed'),
          f.sessionId,
          f.dependencies(f.users.speaker),
        )
      ).status,
    ).toBe(409);
    expect((await write(f.users.speaker, 'PATCH', 1)).status).toBe(409);
    expect(
      (await readOwnQuestions(f.request('/own'), f.dependencies())).status,
    ).toBe(200);
  });
  it('rechecks revoked profile link and keeps private text out of audit and idempotency storage', async () => {
    expect((await write(f.users.speaker)).status).toBe(201);
    const audit = await f.client.db.query.auditLogs.findMany({
      where: eq(schema.auditLogs.eventId, f.eventId),
    });
    expect(JSON.stringify(audit)).not.toContain('Soukromá odpověď');
    expect(JSON.stringify(audit)).not.toContain('Soukromý testovací dotaz');
    await f.client.db
      .update(schema.speakerProfiles)
      .set({ userId: null })
      .where(
        and(
          eq(schema.speakerProfiles.eventId, f.eventId),
          eq(schema.speakerProfiles.id, f.speakerProfileId),
        ),
      );
    expect((await write(f.users.speaker, 'PATCH', 1)).status).toBe(403);
    await f.client.db
      .update(schema.speakerProfiles)
      .set({ userId: f.users.speaker })
      .where(eq(schema.speakerProfiles.id, f.speakerProfileId));
  });
});
