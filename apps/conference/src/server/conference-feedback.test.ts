import { describe, expect, it, vi } from 'vitest';
vi.mock('./current-event', () => ({ CURRENT_EVENT_SLUG: 'byzon-2026' }));
import {
  aggregateFeedbackQuestions,
  createFeedbackToken,
  feedbackCsvCell,
  hashFeedbackToken,
  legacyFeedbackAnswers,
  validateFeedbackAnswers,
  visibleFeedbackAnswers,
} from './conference-feedback';

describe('feedback capabilities and report semantics', () => {
  it('uses stable, domain-separated opaque capabilities bound to each event and user', () => {
    const row = { id: 'response', eventId: 'event', userId: 'user' };
    const secret = 's'.repeat(32);
    const token = createFeedbackToken(secret, row);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createFeedbackToken(secret, row)).toBe(token);
    expect(createFeedbackToken(secret, { ...row, eventId: 'other' })).not.toBe(
      token,
    );
    expect(createFeedbackToken(secret, { ...row, userId: 'other' })).not.toBe(
      token,
    );
    expect(createFeedbackToken('z'.repeat(32), row)).not.toBe(token);
    expect(hashFeedbackToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(() => createFeedbackToken('short', row)).toThrow();
  });
  it('counts partial answers, excludes skip from means, and never averages a numeric free-text comment', () => {
    const rows = [
      {
        answers: {
          participantRole: 'attendee',
          score: '4',
          comment: '4',
          djScore: 'skip',
        },
        role: 'attendee' as const,
        status: 'in_progress' as const,
      },
      {
        answers: { participantRole: 'attendee', score: '2', comment: '2' },
        role: 'attendee' as const,
        status: 'completed' as const,
      },
      {
        answers: {},
        role: 'attendee' as const,
        status: 'not_started' as const,
      },
    ];
    const reports = aggregateFeedbackQuestions(rows);
    expect(reports.find((q) => q.id === 'score')).toMatchObject({
      eligible: 3,
      answered: 2,
      average: 3,
    });
    expect(reports.find((q) => q.id === 'comment')).toMatchObject({
      answered: 2,
      average: null,
    });
    expect(reports.find((q) => q.id === 'djScore')).toMatchObject({
      answered: 1,
      notApplicable: 1,
      average: null,
    });
  });
  it('ignores answers hidden after role and attendance changes without destroying their saved data', () => {
    const answers = {
      participantRole: 'attendee',
      speakerSupport: '4',
      collaborationScore: '4',
      coachingAttended: 'no',
      coachingScore: '4',
      score: '3',
    };
    expect(visibleFeedbackAnswers(answers, 'attendee')).toEqual({
      participantRole: 'attendee',
      coachingAttended: 'no',
      score: '3',
    });
    expect(answers.speakerSupport).toBe('4');
  });
  it('preserves legacy survey scale, attended condition and session scores', () => {
    const sessionId = '018f47c0-a8a0-7000-8000-000000000001';
    const answers = legacyFeedbackAnswers({
      score: 5,
      comment: 'Díky',
      survey: {
        coachingAttended: true,
        coachingScore: 4,
        workshopsAttended: false,
        lunchScore: null,
        sessions: [{ sessionId, score: 2 }],
      },
    });
    expect(answers).toMatchObject({
      score: '5',
      comment: 'Díky',
      coachingAttended: 'yes',
      coachingScore: '4',
      workshopsAttended: 'no',
      lunchScore: 'skip',
      [`session:${sessionId}`]: '2',
    });
    expect(() =>
      validateFeedbackAnswers(answers, new Set([sessionId])),
    ).not.toThrow();
  });
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '  =CMD()', '\t=CMD()', '\n=CMD()'])(
    'neutralizes spreadsheet formulas %s',
    (value) => {
      expect(feedbackCsvCell(value)).toBe(`"'${value}"`);
    },
  );
  it('quotes separators, embedded quotes and line breaks without data loss', () => {
    expect(feedbackCsvCell('Český; "text"\nDruhý řádek')).toBe(
      '"Český; ""text""\nDruhý řádek"',
    );
  });
});
