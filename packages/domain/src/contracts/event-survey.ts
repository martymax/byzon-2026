import { z } from 'zod';

// Keep the four-point scale from the 2025 questionnaire. Null means not used,
// never a zero rating. The overall conference score remains on its 1–5 scale.
const score = z.number().int().min(1).max(4);
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) =>
        !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/.test(
          value,
        ),
      'Text contains unsafe control characters',
    )
    .nullable();

export const eventSurveyProgramSchema = z.strictObject({
  version: z.number().int().positive(),
  sessions: z
    .array(
      z.strictObject({
        id: z.string().uuid(),
        title: z.string().min(1).max(512),
        stage: z.string().min(1).max(256),
        day: z.string().date(),
        speakers: z.array(z.string().min(1).max(513)).max(50),
        type: z.enum(['talk', 'panel', 'workshop', 'mastermind']),
      }),
    )
    .max(4096),
});

export const eventSurveySchema = z
  .strictObject({
    version: z.literal(1),
    gender: z.enum(['man', 'woman', 'other', 'prefer_not_to_say']).nullable(),
    genderOther: text(128),
    city: text(256),
    ticketSource: z
      .enum(['company', 'self', 'team', 'speaker', 'other'])
      .nullable(),
    programVersion: z.number().int().positive().nullable(),
    sessions: z
      .array(
        z.strictObject({
          sessionId: z.string().uuid(),
          score: score.nullable(),
        }),
      )
      .max(200),
    coachingAttended: z.boolean(),
    coachingScore: score.nullable(),
    coachingComment: text(2000),
    workshopsAttended: z.boolean(),
    workshopsScore: score.nullable(),
    workshopsComment: text(2000),
    lunchScore: score.nullable(),
    lunchComment: text(2000),
    breaksScore: score.nullable(),
    breaksComment: text(2000),
    networkingScore: score.nullable(),
    networkingComment: text(2000),
    websiteScore: score.nullable(),
    websiteComment: text(2000),
    appScore: score.nullable(),
    appComment: text(2000),
    partners: text(2000),
    organizationBefore: score,
    organizationDuring: score,
    returnIntention: z.enum([
      'definitely_yes',
      'probably_yes',
      'probably_no',
      'definitely_no',
    ]),
    instagram: z
      .enum(['yes', 'will_follow', 'no_account', 'no_interest'])
      .nullable(),
    nextSpeaker: text(2000),
  })
  .superRefine((survey, context) => {
    for (const activity of ['coaching', 'workshops'] as const) {
      if (
        survey[`${activity}Attended`] !==
        (survey[`${activity}Score`] !== null)
      ) {
        context.addIssue({
          code: 'custom',
          path: [`${activity}Score`],
          message: 'Rate only attended activities',
        });
      }
    }
    if (survey.sessions.length && survey.programVersion === null) {
      context.addIssue({
        code: 'custom',
        path: ['programVersion'],
        message: 'Program version is required for session ratings',
      });
    }
    if (
      new Set(survey.sessions.map((session) => session.sessionId)).size !==
      survey.sessions.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sessions'],
        message: 'Session ratings must be unique',
      });
    }
    if (survey.gender !== 'other' && survey.genderOther !== null) {
      context.addIssue({
        code: 'custom',
        path: ['genderOther'],
        message: 'Other gender text requires the other option',
      });
    }
  });

export type EventSurvey = z.infer<typeof eventSurveySchema>;
export type EventSurveyProgram = z.infer<typeof eventSurveyProgramSchema>;
