import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createDatabaseClient, withTransaction } from './client.js';
import * as schema from './schema/index.js';

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration('private question answer integrity', () => {
  const client = createDatabaseClient({
    connectionString: process.env.TEST_DATABASE_URL!,
    max: 2,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 1000,
    applicationName: 'byzon-question-schema-test',
    onUnexpectedError: vi.fn(),
  });
  afterAll(() => client.close());
  const attempt = (
    change: 'duplicate' | 'event' | 'session' | 'speaker' | 'version' | 'text',
  ) =>
    withTransaction(client.db, async (tx) => {
      const eventId = randomUUID(),
        otherEventId = randomUUID(),
        userId = randomUUID(),
        dayId = randomUUID(),
        sessionId = randomUUID(),
        otherSessionId = randomUUID(),
        speakerProfileId = randomUUID(),
        questionId = randomUUID();
      for (const id of [eventId, otherEventId])
        await tx.insert(schema.events).values({
          id,
          slug: id,
          name: 'Test',
          startsAt: new Date('2026-09-18T07:00:00Z'),
          endsAt: new Date('2026-09-19T20:00:00Z'),
          timezone: 'Europe/Prague',
        });
      await tx
        .insert(schema.users)
        .values({ id: userId, name: 'Test', email: `${userId}@example.test` });
      await tx
        .insert(schema.eventMemberships)
        .values(
          [eventId, otherEventId].map((eventId) => ({ eventId, userId })),
        );
      await tx.insert(schema.eventDays).values({
        id: dayId,
        eventId,
        localDate: '2026-09-18',
        title: 'Test',
        sortOrder: 0,
      });
      for (const id of [sessionId, otherSessionId])
        await tx.insert(schema.programSessions).values({
          id,
          eventId,
          dayId,
          slug: id,
          title: 'Test',
          startsAt: new Date('2026-09-18T07:00:00Z'),
          endsAt: new Date('2026-09-18T08:00:00Z'),
          sortOrder: 0,
        });
      await tx.insert(schema.speakerProfiles).values({
        id: speakerProfileId,
        eventId: change === 'speaker' ? otherEventId : eventId,
        userId,
        slug: speakerProfileId,
        firstName: 'Test',
        lastName: 'Speaker',
        sortOrder: 0,
      });
      await tx.insert(schema.questions).values({
        id: questionId,
        eventId,
        sessionId,
        authorUserId: userId,
        text: 'Question',
      });
      const answer = {
        id: randomUUID(),
        eventId,
        sessionId,
        questionId,
        speakerProfileId,
        answeredByUserId: userId,
        speakerName: 'Test Speaker',
        text: 'Answer',
        version: 1,
      };
      if (change === 'duplicate')
        await tx.insert(schema.questionAnswers).values(answer);
      await tx.insert(schema.questionAnswers).values({
        ...answer,
        id: randomUUID(),
        ...(change === 'event' ? { eventId: otherEventId } : {}),
        ...(change === 'session' ? { sessionId: otherSessionId } : {}),
        ...(change === 'version' ? { version: 0 } : {}),
        ...(change === 'text' ? { text: '' } : {}),
      });
      throw new Error('Expected database constraint rejection');
    });
  it.each([
    ['duplicate', 'question_answers_question_unique'],
    ['event', 'question_answers_question_event_session_fk'],
    ['session', 'question_answers_question_event_session_fk'],
    ['speaker', 'question_answers_speaker_event_fk'],
    ['version', 'question_answers_version_check'],
    ['text', 'question_answers_text_length_check'],
  ] as const)(
    'rejects %s without persisting fixture rows',
    async (change, constraint) => {
      await expect(attempt(change)).rejects.toMatchObject({
        cause: expect.objectContaining({ constraint }),
      });
    },
  );
});
