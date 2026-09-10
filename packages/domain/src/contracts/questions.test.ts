import { describe, expect, it } from 'vitest';

import {
  moderatorQuestionFeedSchema,
  questionSubmitRequestSchema,
  ratingSubmitRequestSchema,
} from './questions.js';

describe('simple question and rating contracts', () => {
  it('keeps submit participant-private and rejects markup controls or extra workflow fields', () => {
    expect(questionSubmitRequestSchema.parse({ text: 'Jak začít?' })).toEqual({
      text: 'Jak začít?',
    });
    expect(
      questionSubmitRequestSchema.safeParse({
        text: 'Jak začít?',
        votes: 1,
      }).success,
    ).toBe(false);
    expect(
      questionSubmitRequestSchema.safeParse({ text: 'x\u0000y' }).success,
    ).toBe(false);
  });

  it('models a chronological moderator feed with author names but no contact details', () => {
    const feed = moderatorQuestionFeedSchema.parse({
      eventId: '019fa200-0000-7000-8000-000000000001',
      sessionId: '019fa200-0000-7000-8000-000000000002',
      serverTime: '2026-09-18T09:00:00.000Z',
      items: [
        {
          questionId: '019fa200-0000-7000-8000-000000000003',
          authorName: 'Alex Novák',
          text: 'První dotaz',
          submittedAt: '2026-09-18T08:59:00.000Z',
        },
      ],
      nextCursor: '019fa200-0000-7000-8000-000000000003',
      pollAfterMs: 5_000,
    });
    expect(feed.items[0]?.authorName).toBe('Alex Novák');
    expect(feed.items[0]).not.toHaveProperty('contactEmail');
    expect(feed.items[0]).not.toHaveProperty('status');
  });

  it('accepts one-to-five ratings and rejects unsupported targets', () => {
    expect(
      ratingSubmitRequestSchema.safeParse({
        targetType: 'session',
        sessionId: '019fa200-0000-7000-8000-000000000002',
        score: 5,
        comment: null,
      }).success,
    ).toBe(true);
    expect(
      ratingSubmitRequestSchema.safeParse({
        targetType: 'speaker',
        score: 5,
        comment: null,
      }).success,
    ).toBe(false);
  });
});

import {
  questionAnswerPublishSchema,
  questionAnswerEditSchema,
  speakerQuestionSchema,
  ownQuestionsQuerySchema,
} from './questions.js';

describe('private question follow-up contracts', () => {
  it('requires explicit creation or optimistic edit versions and safe bounded text', () => {
    expect(
      questionAnswerPublishSchema.safeParse({
        text: 'Odpověď',
        expectedVersion: 0,
      }).success,
    ).toBe(true);
    expect(
      questionAnswerPublishSchema.safeParse({
        text: 'Odpověď',
        expectedVersion: 1,
      }).success,
    ).toBe(false);
    for (const text of ['', ' ', 'x'.repeat(4001), 'x\u202Ey', 'x\u0000y']) {
      expect(
        questionAnswerPublishSchema.safeParse({ text, expectedVersion: 0 })
          .success,
      ).toBe(false);
    }
    expect(
      questionAnswerEditSchema.safeParse({ text: 'Oprava', expectedVersion: 0 })
        .success,
    ).toBe(false);
    expect(
      questionAnswerEditSchema.safeParse({ text: 'Oprava', expectedVersion: 2 })
        .success,
    ).toBe(true);
  });
  it('rejects author identity in speaker output and incomplete cursors', () => {
    const item = {
      questionId: '019fa200-0000-7000-8000-000000000003',
      text: 'Dotaz?',
      submittedAt: '2026-09-18T09:00:00Z',
      answer: null,
      canEdit: false,
    };
    expect(speakerQuestionSchema.safeParse(item).success).toBe(true);
    for (const key of ['authorName', 'authorUserId', 'email', 'company']) {
      expect(
        speakerQuestionSchema.safeParse({ ...item, [key]: 'private' }).success,
      ).toBe(false);
    }
    expect(
      ownQuestionsQuerySchema.safeParse({ cursor: item.questionId }).success,
    ).toBe(false);
    expect(
      ownQuestionsQuerySchema.safeParse({
        cursor: item.questionId,
        after: item.submittedAt,
      }).success,
    ).toBe(true);
  });
});
