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

  it('models a chronological moderator feed without author identity or moderation state', () => {
    const feed = moderatorQuestionFeedSchema.parse({
      eventId: '019fa200-0000-7000-8000-000000000001',
      sessionId: '019fa200-0000-7000-8000-000000000002',
      serverTime: '2026-09-18T09:00:00.000Z',
      items: [
        {
          questionId: '019fa200-0000-7000-8000-000000000003',
          text: 'První dotaz',
          submittedAt: '2026-09-18T08:59:00.000Z',
        },
      ],
      nextCursor: '019fa200-0000-7000-8000-000000000003',
      pollAfterMs: 5_000,
    });
    expect(feed.items[0]).not.toHaveProperty('authorUserId');
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
