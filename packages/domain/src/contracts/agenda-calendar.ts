import type { ParticipantAgendaResponse } from './agenda.js';

const encoder = new TextEncoder();

const escapeCalendarText = (value: string): string =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r\n|\r|\n/g, '\\n');

const calendarUtcDate = (value: string): string =>
  new Date(value)
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const foldCalendarLine = (line: string): string => {
  const chunks: string[] = [];
  let current = '';
  for (const character of line) {
    if (encoder.encode(current + character).byteLength > 75) {
      chunks.push(current);
      current = ` ${character}`;
    } else {
      current += character;
    }
  }
  chunks.push(current);
  return chunks.join('\r\n');
};

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
