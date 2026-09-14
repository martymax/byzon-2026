import { describe, expect, it } from 'vitest';
import {
  eventSurveySchema,
  ratingSubmitRequestSchema,
} from '@byzon/domain/contracts';
import { eventSurveyFixture } from '../test/fixtures/event-survey';
import { buildEventSurveySubmission } from './event-survey';

describe('conference survey contract', () => {
  it('preserves the original scale, separate digital scores and multiline comments', () => {
    const survey = eventSurveySchema.parse(eventSurveyFixture());
    expect(survey.websiteScore).toBe(3);
    expect(survey.appScore).toBe(4);
    expect(survey.lunchScore).toBeNull();
    expect(survey.appComment).toContain('\n');
    for (const score of [0, 5, 2.5])
      expect(
        eventSurveySchema.safeParse({ ...survey, websiteScore: score }).success,
      ).toBe(false);
  });
  it('rejects contradictory attendance, duplicate sessions and missing published version', () => {
    const survey = eventSurveyFixture();
    expect(
      eventSurveySchema.safeParse({ ...survey, coachingScore: 4 }).success,
    ).toBe(false);
    expect(
      eventSurveySchema.safeParse({ ...survey, workshopsAttended: true })
        .success,
    ).toBe(false);
    const session = {
      sessionId: '44444444-4444-4444-8444-444444444444',
      score: 3,
    };
    expect(
      eventSurveySchema.safeParse({ ...survey, sessions: [session] }).success,
    ).toBe(false);
    expect(
      eventSurveySchema.safeParse({
        ...survey,
        programVersion: 1,
        sessions: [session, session],
      }).success,
    ).toBe(false);
  });
  it('keeps the old overall rating API compatible and excludes surveys from session ratings', () => {
    expect(
      ratingSubmitRequestSchema.safeParse({
        targetType: 'event',
        score: 5,
        comment: null,
      }).success,
    ).toBe(true);
    expect(
      ratingSubmitRequestSchema.safeParse({
        targetType: 'session',
        sessionId: '44444444-4444-4444-8444-444444444444',
        score: 5,
        comment: null,
        survey: eventSurveyFixture(),
      }).success,
    ).toBe(false);
  });
  it('rejects missing digital answers, overlong comments and unexpected identity fields', () => {
    const survey = eventSurveyFixture();
    expect(
      eventSurveySchema.safeParse({ ...survey, appScore: undefined }).success,
    ).toBe(false);
    expect(
      eventSurveySchema.safeParse({ ...survey, appComment: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
    expect(
      eventSurveySchema.safeParse({ ...survey, userId: 'someone-else' })
        .success,
    ).toBe(false);
  });
  it('discards hidden answers when attendance or gender selection changes', () => {
    const result = buildEventSurveySubmission(
      {
        gender: 'prefer_not_to_say',
        genderOther: 'Do not submit',
        coachingAttended: 'no',
        coachingScore: '4',
        coachingComment: 'Do not submit',
        workshopsAttended: 'no',
        workshopsScore: '4',
        workshopsComment: 'Do not submit',
        lunchScore: 'not_used',
        breaksScore: '3',
        networkingScore: 'not_used',
        websiteScore: '3',
        appScore: '4',
        organizationBefore: '4',
        organizationDuring: '3',
        score: '5',
        returnIntention: 'probably_yes',
        'session:44444444-4444-4444-8444-444444444444': '4',
      },
      {
        version: 1,
        sessions: [
          {
            id: '44444444-4444-4444-8444-444444444444',
            title: 'Workshop',
            stage: 'Stage',
            day: '2026-09-19',
            speakers: [],
            type: 'workshop',
          },
        ],
      },
    );
    expect(result.targetType).toBe('event');
    if (result.targetType !== 'event') return;
    expect(result.survey).toMatchObject({
      genderOther: null,
      coachingScore: null,
      coachingComment: null,
      workshopsScore: null,
      workshopsComment: null,
      sessions: [],
      lunchScore: null,
    });
  });
});
