import type {
  PublishedProgramRoom,
  PublishedProgramSession,
} from './content.js';
import {
  calendarUtcDate,
  escapeCalendarText,
  foldCalendarLine,
} from './calendar-format.js';

export interface ParticipantProgramSessionCalendarInput {
  readonly session: PublishedProgramSession;
  readonly room?: Pick<PublishedProgramRoom, 'name'> | null;
  readonly version: number;
  readonly publishedAt: string;
}

export const participantProgramSessionCalendar = ({
  session,
  room,
  version,
  publishedAt,
}: ParticipantProgramSessionCalendarInput): string => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ENJOiT//BYZON Program//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeCalendarText(`BYZON 2026 – ${session.title}`)}`,
    'BEGIN:VEVENT',
    `UID:${session.id}@program.byzon.cz`,
    `SEQUENCE:${String(version)}`,
    `DTSTAMP:${calendarUtcDate(publishedAt)}`,
    `DTSTART:${calendarUtcDate(session.startsAt)}`,
    `DTEND:${calendarUtcDate(session.endsAt)}`,
    `SUMMARY:${escapeCalendarText(session.title)}`,
  ];

  if (session.summary || session.description) {
    lines.push(
      `DESCRIPTION:${escapeCalendarText(session.description ?? session.summary ?? '')}`,
    );
  }
  if (room) lines.push(`LOCATION:${escapeCalendarText(room.name)}`);
  if (session.status === 'cancelled') lines.push('STATUS:CANCELLED');
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return `${lines.map(foldCalendarLine).join('\r\n')}\r\n`;
};
