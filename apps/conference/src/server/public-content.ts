import { desc, eq } from 'drizzle-orm';
import { schema, type Database } from '@byzon/database';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { participantContentSchema } from './participant-content';
import { programSnapshotSchema } from './participant-program';

const publicHeaders = (
  requestId: string,
  etag: string,
  contentType = 'application/json',
): HeadersInit => ({
  'cache-control': 'public, max-age=60, stale-while-revalidate=300',
  'content-type': contentType,
  etag,
  'x-request-id': requestId,
});
const loadPublicPublication = async (db: Database, slug: string) => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 128)
    return null;
  const event = await db.query.events.findFirst({
    where: eq(schema.events.slug, slug),
    columns: { id: true },
  });
  if (!event) return null;
  const publication = await db.query.contentPublications.findFirst({
    where: eq(schema.contentPublications.eventId, event.id),
    orderBy: [desc(schema.contentPublications.version)],
    columns: {
      version: true,
      snapshot: true,
      checksumSha256: true,
      publishedAt: true,
    },
  });
  return publication ? { eventId: event.id, ...publication } : null;
};
const notFound = () =>
  new ApiProblemError({
    status: 404,
    code: 'PUBLIC_CONTENT_NOT_FOUND',
    title: 'Content not found',
    detail: 'Published event content is not available.',
  });
const matches = (header: string | null, etag: string) =>
  header
    ?.split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .some((value) => value === '*' || value === etag) ?? false;

export const readPublicContent = async (
  request: Request,
  eventSlug: string,
  kind: 'bootstrap' | 'content' | 'calendar',
  db: Database,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    const publication = await loadPublicPublication(db, eventSlug);
    if (!publication) throw notFound();
    const etag = `"${publication.checksumSha256}-${publication.version}-${kind}"`;
    const contentType =
      kind === 'calendar' ? 'text/calendar; charset=utf-8' : 'application/json';
    if (matches(request.headers.get('if-none-match'), etag))
      return new Response(null, {
        status: 304,
        headers: publicHeaders(requestId, etag, contentType),
      });
    const content = participantContentSchema.safeParse(publication.snapshot);
    const program = programSnapshotSchema.safeParse(publication.snapshot);
    if (!content.success || !program.success) throw notFound();
    if (kind === 'bootstrap')
      return Response.json(
        {
          version: publication.version,
          publishedAt: publication.publishedAt.toISOString(),
          event: content.data.event,
        },
        { headers: publicHeaders(requestId, etag) },
      );
    if (kind === 'content')
      return Response.json(
        {
          version: publication.version,
          publishedAt: publication.publishedAt.toISOString(),
          ...content.data,
          program: program.data.program,
        },
        { headers: publicHeaders(requestId, etag) },
      );
    return new Response(
      toCalendar(
        eventSlug,
        publication.version,
        publication.publishedAt,
        content.data.event.name,
        program.data.program.sessions.map((session) => ({
          ...session,
          location:
            program.data.program.rooms.find(({ id }) => id === session.roomId)
              ?.name ?? undefined,
        })),
      ),
      { headers: publicHeaders(requestId, etag, contentType) },
    );
  } catch (error) {
    return problemResponse(error, requestId);
  }
};

const icsEscape = (value: string) =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r?\n/g, '\\n');
const icsDate = (value: Date | string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
const fold = (line: string) => {
  const chunks: string[] = [];
  let current = '';
  for (const character of line) {
    if (Buffer.byteLength(current + character, 'utf8') > 75) {
      chunks.push(current);
      current = ` ${character}`;
    } else {
      current += character;
    }
  }
  chunks.push(current);
  return chunks.join('\r\n');
};
export const toCalendar = (
  eventSlug: string,
  version: number,
  publishedAt: Date,
  eventName: string,
  sessions: Array<{
    id: string;
    title: string;
    summary?: string | null | undefined;
    description?: string | null | undefined;
    startsAt: string;
    endsAt: string;
    status?: string | undefined;
    roomId: string | null;
    location?: string | undefined;
  }>,
) => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ENJOiT//BYZON Conference//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(eventName)}`,
  ];
  for (const session of sessions) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${session.id}@${eventSlug}.byzon.cz`,
      `SEQUENCE:${version}`,
      `DTSTAMP:${icsDate(publishedAt)}`,
      `DTSTART:${icsDate(session.startsAt)}`,
      `DTEND:${icsDate(session.endsAt)}`,
      `SUMMARY:${icsEscape(session.title)}`,
    );
    if (session.summary || session.description)
      lines.push(
        `DESCRIPTION:${icsEscape(session.description ?? session.summary ?? '')}`,
      );
    if (session.location) lines.push(`LOCATION:${icsEscape(session.location)}`);
    if (session.status === 'cancelled') lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
};
