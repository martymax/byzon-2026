import type { ParticipantAgendaResponse } from './agenda.js';
import {
  calendarUtcDate,
  escapeCalendarText,
  foldCalendarLine,
} from './calendar-format.js';

export const participantAgendaCalendar = (
  agenda: ParticipantAgendaResponse,
): string => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ENJOiT//BYZON Participant Agenda//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:BYZON 2026 – moje agenda',
    `X-WR-TIMEZONE:${agenda.eventTimezone}`,
  ];

  for (const { session } of agenda.items) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${session.calendar.uid}`,
      `SEQUENCE:${String(session.calendar.sequence)}`,
      `DTSTAMP:${calendarUtcDate(agenda.serverNow)}`,
      `DTSTART:${calendarUtcDate(session.startsAt)}`,
      `DTEND:${calendarUtcDate(session.endsAt)}`,
      `SUMMARY:${escapeCalendarText(session.title)}`,
    );
    if (session.room) {
      lines.push(`LOCATION:${escapeCalendarText(session.room.name)}`);
    }
    if (session.status === 'cancelled') lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');

  return `${lines.map(foldCalendarLine).join('\r\n')}\r\n`;
};
