import { createHash } from 'node:crypto';

import { schema, type Database } from '@byzon/database';
import {
  contentCachePolicy,
  participantProgramSessionCalendar,
  participantProgramResponseSchema,
  participantSessionTypeSchema,
  publishedProgramSnapshotSchema,
  type ParticipantProgramResponse,
} from '@byzon/domain/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuid = z.string().uuid();
const filterValue = z.string().trim().min(1).max(128);

interface SessionIdentity {
  user: { id: string };
}

export interface ParticipantProgramDependencies {
  db: Database;
  getSession(headers: Headers): Promise<SessionIdentity | null>;
}

const apiProblem = (
  status: number,
  code: string,
  title: string,
  detail: string,
  fieldErrors?: Record<string, string[]>,
): ApiProblemError =>
  new ApiProblemError({
    status,
    code,
    title,
    detail,
    ...(fieldErrors ? { fieldErrors } : {}),
  });

const parseFilters = (url: URL) => {
  const known = new Set(['day', 'room', 'type', 'version']);
  const unknown = [...url.searchParams.keys()].filter((key) => !known.has(key));
  const repeated = [...known].filter(
    (key) => url.searchParams.getAll(key).length > 1,
  );
  const day = url.searchParams.get('day');
  const room = url.searchParams.get('room');
  const type = url.searchParams.get('type');
  const parsedType = type
    ? participantSessionTypeSchema.safeParse(type)
    : undefined;
  const versionText = url.searchParams.get('version');
  const fieldErrors: Record<string, string[]> = {};
  if (unknown.length) fieldErrors.query = ['Unsupported query parameter.'];
  if (repeated.length) fieldErrors.query = ['Query parameters cannot repeat.'];
  if (day && !filterValue.safeParse(day).success)
    fieldErrors.day = ['Invalid day filter.'];
  if (room && !filterValue.safeParse(room).success)
    fieldErrors.room = ['Invalid room filter.'];
  if (parsedType && !parsedType.success)
    fieldErrors.type = ['Invalid session type.'];
  const version = versionText ? Number(versionText) : undefined;
  if (
    versionText &&
    (!/^\d+$/.test(versionText) ||
      !Number.isSafeInteger(version) ||
      version! < 1)
  )
    fieldErrors.version = ['Version must be a positive integer.'];
  if (Object.keys(fieldErrors).length)
    throw apiProblem(
      400,
      'INVALID_PROGRAM_FILTERS',
      'Invalid program filters',
      'The requested program filters are invalid.',
      fieldErrors,
    );
  return {
    day: day ?? undefined,
    room: room ?? undefined,
    type: parsedType?.success ? parsedType.data : undefined,
    version,
  };
};

const etagFor = (
  checksum: string,
  version: number,
  filters: object,
): string => {
  const representation = createHash('sha256')
    .update(`${checksum}\n${version}\n${JSON.stringify(filters)}`)
    .digest('hex');
  return `"${representation}"`;
};

const responseHeaders = (requestId: string, etag: string): HeadersInit => ({
  'cache-control': contentCachePolicy.participant.cacheControl,
  'content-type': 'application/json',
  etag,
  vary: 'Cookie, Authorization',
  'x-request-id': requestId,
});

const calendarHeaders = (requestId: string, filename: string): HeadersInit => ({
  'cache-control': 'private, no-store',
  'content-disposition': `attachment; filename="${filename}"`,
  'content-type': 'text/calendar; charset=utf-8',
  vary: 'Cookie, Authorization',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const etagMatches = (header: string | null, etag: string): boolean => {
  if (!header) return false;
  const opaque = etag.replace(/^W\//, '');
  return header
    .split(',')
    .map((candidate) => candidate.trim())
    .some(
      (candidate) =>
        candidate === '*' || candidate.replace(/^W\//, '') === opaque,
    );
};

interface ParticipantProgramRepresentation {
  readonly body: ParticipantProgramResponse;
  readonly etag: string;
}

const loadParticipantProgram = async (
  request: Request,
  eventId: string,
  dependencies: ParticipantProgramDependencies,
): Promise<ParticipantProgramRepresentation> => {
  if (!uuid.safeParse(eventId).success)
    throw apiProblem(
      400,
      'INVALID_EVENT_ID',
      'Invalid event identifier',
      'The event identifier is invalid.',
    );
  const filters = parseFilters(new URL(request.url));
  const session = await dependencies.getSession(request.headers);
  if (!session)
    throw apiProblem(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
      'A valid session is required to read the program.',
    );
  try {
    await requireEventPermission(
      dependencies.db,
      { userId: session.user.id },
      eventId,
      'program:published:read',
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw apiProblem(
      404,
      'PROGRAM_NOT_FOUND',
      'Program not found',
      'A published program is not available.',
    );
  }

  const publication = await dependencies.db.query.contentPublications.findFirst(
    {
      where: filters.version
        ? and(
            eq(schema.contentPublications.eventId, eventId),
            eq(schema.contentPublications.version, filters.version),
          )
        : eq(schema.contentPublications.eventId, eventId),
      orderBy: [desc(schema.contentPublications.version)],
      columns: {
        version: true,
        snapshot: true,
        checksumSha256: true,
        publishedAt: true,
      },
    },
  );
  if (!publication)
    throw apiProblem(
      404,
      'PROGRAM_NOT_FOUND',
      'Program not found',
      'A published program is not available.',
    );
  const parsed = publishedProgramSnapshotSchema.safeParse(publication.snapshot);
  if (!parsed.success) throw new Error('Invalid publication snapshot');

  const selectedDay = filters.day
    ? parsed.data.program.days.find(
        (day) => day.id === filters.day || day.localDate === filters.day,
      )
    : undefined;
  const selectedRoom = filters.room
    ? parsed.data.program.rooms.find(
        (room) => room.id === filters.room || room.slug === filters.room,
      )
    : undefined;
  const sessions = parsed.data.program.sessions.filter(
    (programSession) =>
      (!filters.day || programSession.dayId === selectedDay?.id) &&
      (!filters.room || programSession.roomId === selectedRoom?.id) &&
      (!filters.type || programSession.type === filters.type),
  );
  const visibleDayIds = new Set(sessions.map(({ dayId }) => dayId));
  const visibleRoomIds = new Set(
    sessions.flatMap(({ roomId }) => (roomId ? [roomId] : [])),
  );
  const etag = etagFor(
    publication.checksumSha256,
    publication.version,
    filters,
  );
  const body = participantProgramResponseSchema.parse({
    eventId,
    version: publication.version,
    publishedAt: publication.publishedAt.toISOString(),
    program: {
      days: parsed.data.program.days.filter((day) => visibleDayIds.has(day.id)),
      rooms: parsed.data.program.rooms.filter((room) =>
        visibleRoomIds.has(room.id),
      ),
      sessions,
    },
    filters: {
      day: filters.day ?? null,
      room: filters.room ?? null,
      type: filters.type ?? null,
    },
  });
  return { body, etag };
};

export const readParticipantProgram = async (
  request: Request,
  eventId: string,
  dependencies: ParticipantProgramDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    const { body, etag } = await loadParticipantProgram(
      request,
      eventId,
      dependencies,
    );
    if (etagMatches(request.headers.get('if-none-match'), etag))
      return new Response(null, {
        status: 304,
        headers: responseHeaders(requestId, etag),
      });

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: responseHeaders(requestId, etag),
    });
  } catch (error) {
    return problemResponse(error, requestId);
  }
};

export const readParticipantProgramSessionCalendar = async (
  request: Request,
  eventId: string,
  sessionId: string,
  dependencies: ParticipantProgramDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (!uuid.safeParse(sessionId).success)
      throw apiProblem(
        400,
        'INVALID_SESSION_ID',
        'Invalid session identifier',
        'The session identifier is invalid.',
      );
    if (new URL(request.url).search)
      throw apiProblem(
        400,
        'INVALID_CALENDAR_EXPORT_REQUEST',
        'Invalid calendar export request',
        'Calendar export query parameters are not supported.',
      );
    const { body } = await loadParticipantProgram(
      request,
      eventId,
      dependencies,
    );
    const programSession = body.program.sessions.find(
      ({ id }) => id === sessionId,
    );
    if (!programSession)
      throw apiProblem(
        404,
        'SESSION_NOT_FOUND',
        'Session not found',
        'The requested published session was not found.',
      );
    const room = body.program.rooms.find(
      ({ id }) => id === programSession.roomId,
    );
    const calendar = participantProgramSessionCalendar({
      session: programSession,
      ...(room ? { room } : {}),
      version: body.version,
      publishedAt: body.publishedAt,
    });
    return new Response(calendar, {
      status: 200,
      headers: calendarHeaders(
        requestId,
        `byzon-2026-${programSession.slug}.ics`,
      ),
    });
  } catch (error) {
    return problemResponse(error, requestId);
  }
};
