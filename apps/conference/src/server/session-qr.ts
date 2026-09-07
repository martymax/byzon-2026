import { schema, type Database } from '@byzon/database';
import { publishedProgramSnapshotSchema } from '@byzon/domain/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { strToU8, zipSync } from 'fflate';
import QRCode from 'qrcode';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuidSchema = z.string().uuid();

interface SessionQrIdentity {
  user: { id: string };
}

export interface SessionQrDependencies {
  db: Database;
  appOrigin: string;
  getSession(headers: Headers): Promise<SessionQrIdentity | null>;
}

interface PublishedQrSession {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  roomName: string | null;
}

const privateHeaders = (requestId: string) => ({
  'cache-control': 'private, no-store',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const safeFilename = (value: string): string => {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'session';
};

export const buildSessionDeepLink = (
  appOrigin: string,
  sessionId: string,
  target: 'program' | 'questions' = 'program',
): string => {
  const origin = new URL(appOrigin);
  if (origin.protocol !== 'https:' && origin.hostname !== 'localhost') {
    throw new Error('Session QR origin must use HTTPS');
  }
  origin.username = '';
  origin.password = '';
  origin.pathname = `/app/${target === 'questions' ? 'interakce' : 'program'}/${uuidSchema.parse(sessionId)}`;
  origin.search = '';
  origin.hash = '';
  return origin.toString();
};

export const renderSessionQrSvg = async (deepLink: string): Promise<string> =>
  QRCode.toString(deepLink, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 1024,
    color: { dark: '#101114', light: '#ffffff' },
  });

const loadPublishedSessions = async (
  db: Database,
  eventId: string,
  target: 'program' | 'questions',
): Promise<readonly PublishedQrSession[]> => {
  const publication = await db.query.contentPublications.findFirst({
    columns: { snapshot: true },
    where: eq(schema.contentPublications.eventId, eventId),
    orderBy: [desc(schema.contentPublications.version)],
  });
  const snapshot = publishedProgramSnapshotSchema.safeParse(
    publication?.snapshot,
  );
  if (!snapshot.success) {
    throw new ApiProblemError({
      status: 404,
      code: 'PUBLICATION_NOT_FOUND',
      title: 'Publication not found',
      detail: 'No valid published program is available for QR generation.',
    });
  }
  const supported =
    target === 'questions'
      ? new Set(
          (
            await db.query.programSessions.findMany({
              columns: { id: true },
              where: and(
                eq(schema.programSessions.eventId, eventId),
                eq(schema.programSessions.questionMode, 'moderated_follow_up'),
                eq(schema.programSessions.status, 'published'),
              ),
            })
          ).map((s) => s.id),
        )
      : null;
  return snapshot.data.program.sessions
    .filter(
      ({ status, id }) =>
        status !== 'cancelled' && (!supported || supported.has(id)),
    )
    .map(({ id, slug, title, startsAt, endsAt, roomId }) => ({
      id,
      slug,
      title,
      startsAt,
      endsAt,
      roomName:
        snapshot.data.program.rooms.find((r) => r.id === roomId)?.name ?? null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

const authorize = async (
  request: Request,
  eventId: string,
  dependencies: SessionQrDependencies,
): Promise<void> => {
  if (!uuidSchema.safeParse(eventId).success) {
    throw new ApiProblemError({
      status: 400,
      code: 'INVALID_EVENT_ID',
      title: 'Invalid event identifier',
      detail: 'The event identifier is invalid.',
    });
  }
  const session = await dependencies.getSession(request.headers);
  if (!session) {
    throw new ApiProblemError({
      status: 401,
      code: 'AUTHENTICATION_REQUIRED',
      title: 'Authentication required',
      detail: 'A valid session is required.',
    });
  }
  try {
    await requireEventPermission(
      dependencies.db,
      { userId: session.user.id },
      eventId,
      'program:manage',
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw new ApiProblemError({
      status: 404,
      code: 'PUBLICATION_NOT_FOUND',
      title: 'Publication not found',
      detail: 'The published program is not available.',
    });
  }
};

export const handleSessionQr = async (
  request: Request,
  eventId: string,
  sessionId: string | undefined,
  dependencies: SessionQrDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'GET') {
      throw new ApiProblemError({
        status: 405,
        code: 'METHOD_NOT_ALLOWED',
        title: 'Method not allowed',
        detail: 'Only QR downloads are supported.',
      });
    }
    await authorize(request, eventId, dependencies);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = z
      .strictObject({ target: z.enum(['program', 'questions']).optional() })
      .safeParse(query);
    if (!parsed.success)
      throw new ApiProblemError({
        status: 422,
        code: 'VALIDATION_FAILED',
        title: 'Invalid target',
        detail: 'Neplatný cíl QR kódu.',
      });
    const target = parsed.data.target ?? 'program';
    const sessions = await loadPublishedSessions(
      dependencies.db,
      eventId,
      target,
    );

    if (sessionId !== undefined) {
      if (!uuidSchema.safeParse(sessionId).success) {
        throw new ApiProblemError({
          status: 404,
          code: 'SESSION_NOT_FOUND',
          title: 'Session not found',
          detail: 'The published session is not available.',
        });
      }
      const publishedSession = sessions.find(({ id }) => id === sessionId);
      if (!publishedSession) {
        throw new ApiProblemError({
          status: 404,
          code: 'SESSION_NOT_FOUND',
          title: 'Session not found',
          detail: 'The published session is not available.',
        });
      }
      const svg = await renderSessionQrSvg(
        buildSessionDeepLink(dependencies.appOrigin, sessionId, target),
      );
      return new Response(svg, {
        headers: {
          ...privateHeaders(requestId),
          'content-type': 'image/svg+xml; charset=utf-8',
          'content-disposition': `attachment; filename="${safeFilename(publishedSession.slug)}-${sessionId}.svg"`,
        },
      });
    }

    const files: Record<string, Uint8Array> = {};
    const manifest: Array<{
      id: string;
      title: string;
      deepLink: string;
      filename: string;
      startsAt: string;
      endsAt: string;
      roomName: string | null;
    }> = [];
    for (const publishedSession of sessions) {
      const deepLink = buildSessionDeepLink(
        dependencies.appOrigin,
        publishedSession.id,
        target,
      );
      const filename = `${safeFilename(publishedSession.slug)}-${publishedSession.id}.svg`;
      files[filename] = strToU8(await renderSessionQrSvg(deepLink));
      manifest.push({
        id: publishedSession.id,
        title: publishedSession.title,
        startsAt: publishedSession.startsAt,
        endsAt: publishedSession.endsAt,
        roomName: publishedSession.roomName,
        deepLink,
        filename,
      });
    }
    files['manifest.json'] = strToU8(
      `${JSON.stringify({ eventId, target, generatedAt: new Date().toISOString(), sessions: manifest }, null, 2)}\n`,
    );
    const archive = zipSync(files, { level: 6 });
    return new Response(new Uint8Array(archive), {
      headers: {
        ...privateHeaders(requestId),
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="byzon-${target}-qr-${eventId}.zip"`,
      },
    });
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};
