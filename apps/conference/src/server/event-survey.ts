import { schema, type Database } from '@byzon/database';
import {
  eventSurveyProgramSchema,
  publishedProgramSnapshotSchema,
  type EventSurvey,
  type EventSurveyProgram,
} from '@byzon/domain/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { ApiProblemError } from './api/problem';

const speakersSchema = z.object({
  speakers: z
    .array(
      z.object({
        id: z.string().uuid(),
        firstName: z.string().max(256),
        lastName: z.string().max(256),
      }),
    )
    .max(2048)
    .optional(),
});

export const loadEventSurveyProgram = async (
  db: Database,
  eventId: string,
  now: Date,
  version?: number,
  timelessTestMode = false,
): Promise<EventSurveyProgram | null> => {
  const publication = await db.query.contentPublications.findFirst({
    columns: { version: true, snapshot: true },
    where: and(
      eq(schema.contentPublications.eventId, eventId),
      version === undefined
        ? undefined
        : eq(schema.contentPublications.version, version),
    ),
    orderBy: desc(schema.contentPublications.version),
  });
  if (!publication) return null;
  const { program } = publishedProgramSnapshotSchema.parse(
    publication.snapshot,
  );
  const names = speakersSchema.parse(publication.snapshot).speakers ?? [];
  return eventSurveyProgramSchema.parse({
    version: publication.version,
    sessions: program.sessions
      .filter(
        (session) =>
          ['talk', 'panel', 'workshop', 'mastermind'].includes(session.type) &&
          session.status !== 'cancelled' &&
          (timelessTestMode || Date.parse(session.endsAt) <= now.getTime()),
      )
      .sort(
        (a, b) =>
          a.startsAt.localeCompare(b.startsAt) || a.sortOrder - b.sortOrder,
      )
      .map((session) => ({
        id: session.id,
        title: session.title,
        type: session.type,
        stage:
          program.rooms.find((room) => room.id === session.roomId)?.name ??
          'Další program',
        day: program.days.find((day) => day.id === session.dayId)!.localDate,
        speakers: (session.speakerIds ?? []).flatMap((id) => {
          const speaker = names.find((item) => item.id === id);
          return speaker ? [`${speaker.firstName} ${speaker.lastName}`] : [];
        }),
      })),
  });
};

export const validateEventSurveyProgram = async (
  db: Database,
  eventId: string,
  now: Date,
  survey: EventSurvey,
  timelessTestMode = false,
) => {
  if (!survey.sessions.length) return;
  const program = await loadEventSurveyProgram(
    db,
    eventId,
    now,
    survey.programVersion!,
    timelessTestMode,
  );
  const valid =
    program &&
    survey.sessions.every((answer) => {
      const session = program.sessions.find(
        (item) => item.id === answer.sessionId,
      );
      return (
        session &&
        (survey.workshopsAttended ||
          !['workshop', 'mastermind'].includes(session.type))
      );
    });
  if (!valid)
    throw new ApiProblemError({
      status: 422,
      code: 'VALIDATION_FAILED',
      title: 'Invalid survey program',
      detail:
        'Session ratings must belong to the published program for this event.',
    });
};
