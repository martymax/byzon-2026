import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createQuestionFixture } from '../test/server/question-fixture';
import { handleAdminEngagement } from './admin-engagement';
import { readQuestionContext, readOwnQuestions } from './own-questions';
import { readModeratorQuestions, submitQuestion } from './questions';
import { readSpeakerQuestions, writeQuestionAnswer } from './speaker-questions';
const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('complete Q&A handler rehearsal', () => {
  it('runs admin OFF preparation through collection, moderator feed, private answer and rollback', async () => {
    const f = await createQuestionFixture();
    try {
      const admin = f.dependencies(f.users.admin);
      const flags = async (
        questionsEnabled: boolean,
        questionFollowUpsEnabled: boolean,
      ) => {
        const state = await (
          await handleAdminEngagement(f.request('/admin'), f.eventId, admin)
        ).json();
        const result = await handleAdminEngagement(
          f.request('/admin', {
            action: 'update_features',
            expectedSettingsVersion: state.settingsVersion,
            features: {
              networkingEnabled: false,
              ratingsEnabled: false,
              questionsEnabled,
              questionFollowUpsEnabled,
            },
            reason: 'Syntetický úplný Q&A rehearsal',
          }),
          f.eventId,
          admin,
        );
        expect(result.status).toBe(200);
      };
      await flags(false, false);
      expect(
        (
          await readSpeakerQuestions(
            f.request('/speaker'),
            f.sessionId,
            f.dependencies(f.users.speaker),
          )
        ).status,
      ).toBe(409);
      await flags(true, false);
      f.setNow('2026-09-18T09:00:00Z');
      expect(
        (
          await (
            await readQuestionContext(
              f.request('/context'),
              f.sessionId,
              f.dependencies(),
            )
          ).json()
        ).canSubmit,
      ).toBe(true);
      const receipt = await submitQuestion(
        f.request('/submit', { text: 'Jak provést změnu?' }),
        f.sessionId,
        f.dependencies(),
      );
      expect(receipt.status).toBe(201);
      const { questionId } = await receipt.json();
      const feed = await readModeratorQuestions(
        f.request('/moderator'),
        f.sessionId,
        f.dependencies(f.users.moderator),
      );
      expect(feed.status).toBe(200);
      expect((await feed.json()).items).toHaveLength(1);
      f.setNow('2026-09-18T10:30:00Z');
      expect(
        (
          await submitQuestion(
            f.request('/submit', { text: 'Příliš pozdě' }),
            f.sessionId,
            f.dependencies(),
          )
        ).status,
      ).toBe(409);
      await flags(false, true);
      const anonymous = await (
        await readSpeakerQuestions(
          f.request('/speaker'),
          f.sessionId,
          f.dependencies(f.users.speaker),
        )
      ).json();
      expect(anonymous.items[0].authorName).toBeUndefined();
      const answer = await writeQuestionAnswer(
        new Request(`${f.origin}/answer`, {
          method: 'PUT',
          headers: {
            origin: f.origin,
            'content-type': 'application/json',
            'idempotency-key': randomUUID(),
          },
          body: JSON.stringify({
            text: 'Začněte malým ověřitelným krokem.',
            expectedVersion: 0,
          }),
        }),
        questionId,
        f.dependencies(f.users.speaker),
      );
      expect(answer.status).toBe(201);
      await flags(false, false);
      const own = await (
        await readOwnQuestions(f.request('/own'), f.dependencies())
      ).json();
      expect(own.items[0].answer.text).toBe(
        'Začněte malým ověřitelným krokem.',
      );
      expect(
        (
          await (
            await readOwnQuestions(
              f.request('/own'),
              f.dependencies(f.users.other),
            )
          ).json()
        ).items,
      ).toHaveLength(0);
      expect(
        (
          await readSpeakerQuestions(
            f.request('/speaker'),
            f.sessionId,
            f.dependencies(f.users.speaker),
          )
        ).status,
      ).toBe(409);
      expect(
        (
          await readModeratorQuestions(
            f.request('/moderator'),
            f.sessionId,
            f.dependencies(f.users.admin),
          )
        ).status,
      ).toBe(200);
    } finally {
      await f.cleanup();
    }
  });
});
