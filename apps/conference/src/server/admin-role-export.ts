import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  adminExportRequestSchema,
  adminExportJobListQuerySchema,
  adminExportJobListResponseSchema,
  adminExportResponseSchema,
  adminRoleAssignmentListQuerySchema,
  adminRoleAssignmentListResponseSchema,
  adminRoleAssignmentMutationRequestSchema,
  adminRoleAssignmentMutationResponseSchema,
  adminRolePersonSearchRequestSchema,
  adminRolePersonSearchResponseSchema,
  adminRoleScopeOptionsRequestSchema,
  adminRoleScopeOptionsResponseSchema,
  type AdminAssignmentRole,
  type AdminAssignmentScope,
} from '@byzon/domain/contracts';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuidSchema = z.string().uuid();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;

export interface AdminRoleExportDependencies {
  db: Database;
  allowedOrigin: string;
  currentEventSlug?: string;
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  now?: () => Date;
}

const privateHeaders = (requestId: string) => ({
  'cache-control': 'private, no-store',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const problem = (
  status: number,
  code: string,
  title: string,
  detail: string,
  extra?: Record<string, unknown>,
) => new ApiProblemError({ status, code, title, detail, ...extra });

const authorize = async (
  request: Request,
  eventId: string,
  permission: 'role:manage' | 'personal-data:operational:export',
  dependencies: AdminRoleExportDependencies,
) => {
  if (!uuidSchema.safeParse(eventId).success) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The administration action is unavailable.',
    );
  }
  const identity = await dependencies.getSession(request.headers);
  if (!identity) {
    throw problem(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
      'A valid session is required.',
    );
  }
  const event = await dependencies.db.query.events.findFirst({
    columns: { status: true },
    where: and(
      eq(schema.events.id, eventId),
      eq(
        schema.events.slug,
        dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
      ),
    ),
  });
  if (!event) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The administration action is unavailable.',
    );
  }
  try {
    await requireEventPermission(
      dependencies.db,
      { userId: identity.user.id },
      eventId,
      permission,
      permission === 'personal-data:operational:export'
        ? { auditedException: true }
        : undefined,
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The administration action is unavailable.',
    );
  }
  return { actorId: identity.user.id, eventStatus: event.status };
};

const validateScope = async (
  db: Database | DatabaseTransaction,
  eventId: string,
  role: 'checkin_operator' | 'moderator' | 'room_operator',
  scope: AdminAssignmentScope,
) => {
  if (role === 'checkin_operator' && scope.kind === 'station') {
    const station = await db.query.checkinStations.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.checkinStations.eventId, eventId),
        eq(schema.checkinStations.id, scope.stationId),
      ),
    });
    if (station) return { stationIds: [scope.stationId] };
  }
  if (
    (role === 'moderator' || role === 'room_operator') &&
    scope.kind === 'session'
  ) {
    const session = await db.query.programSessions.findFirst({
      columns: { id: true, questionsEnabled: true },
      where: and(
        eq(schema.programSessions.eventId, eventId),
        eq(schema.programSessions.id, scope.sessionId),
      ),
    });
    if (session && role === 'room_operator') {
      return { sessionIds: [scope.sessionId] };
    }
    if (session?.questionsEnabled && role === 'moderator') {
      const feature = await db.query.eventFeatures.findFirst({
        columns: { questionsEnabled: true },
        where: eq(schema.eventFeatures.eventId, eventId),
      });
      if (feature?.questionsEnabled) {
        return { sessionIds: [scope.sessionId] };
      }
    }
  }
  if (role === 'room_operator' && scope.kind === 'room') {
    const room = await db.query.rooms.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.rooms.eventId, eventId),
        eq(schema.rooms.id, scope.roomId),
        ne(schema.rooms.status, 'archived'),
      ),
    });
    if (room) return { roomIds: [scope.roomId] };
  }
  throw problem(
    409,
    'ADMIN_INVALID_TRANSITION',
    'Invalid assignment scope',
    'Check-in operators require a station, moderators require a session and activity leaders require a room or session.',
  );
};

const parseBody = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const requireSameOrigin = (
  request: Request,
  dependencies: AdminRoleExportDependencies,
): void => {
  if (request.headers.get('origin') !== dependencies.allowedOrigin) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'The request origin is not allowed.',
    );
  }
};

const safeLabel = (value: string, fallback: string): string => {
  const normalized = value
    .replace(/[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069<>]/g, '')
    .trim()
    .slice(0, 120);
  return normalized || fallback;
};

const maskEmail = (email: string): string => {
  const at = email.lastIndexOf('@');
  return at > 0
    ? `${email.slice(0, 1)}***@${email.slice(at + 1)}`
    : 'x***@invalid.example';
};

const encodeRoleCursor = (id: string): string =>
  Buffer.from(JSON.stringify({ id }), 'utf8').toString('base64url');

const decodeRoleCursor = (value: string): string => {
  try {
    return z
      .strictObject({ id: z.string().uuid() })
      .parse(
        JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown,
      ).id;
  } catch {
    throw problem(
      422,
      'VALIDATION_FAILED',
      'Invalid cursor',
      'The role assignment cursor is invalid.',
    );
  }
};

const exportCursorSchema = z.strictObject({
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

const encodeExportCursor = (createdAt: Date, id: string): string =>
  Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id }),
    'utf8',
  ).toString('base64url');

const decodeExportCursor = (value: string): { createdAt: Date; id: string } => {
  try {
    const parsed = exportCursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown,
    );
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw problem(
      422,
      'VALIDATION_FAILED',
      'Invalid cursor',
      'The export cursor is invalid.',
    );
  }
};

const readResponse = (
  requestId: string,
  body: unknown,
  status = 200,
): Response =>
  Response.json(body, { status, headers: privateHeaders(requestId) });

export const handleAdminRoleAssignmentList = async (
  request: Request,
  eventId: string,
  dependencies: AdminRoleExportDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'GET') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    await authorize(request, eventId, 'role:manage', dependencies);
    const url = new URL(request.url);
    const query = adminRoleAssignmentListQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries()),
    );
    if (!query.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid role filters',
        'The role assignment filters are invalid.',
      );
    }
    await dependencies.db
      .insert(schema.eventAdminVersions)
      .values({ eventId })
      .onConflictDoNothing();
    const version = await dependencies.db.query.eventAdminVersions.findFirst({
      columns: { assignmentsVersion: true },
      where: eq(schema.eventAdminVersions.eventId, eventId),
    });
    const assignmentsVersion = version?.assignmentsVersion ?? 1;
    if (query.data.state === 'scheduled' || query.data.scopeKind === 'event') {
      return readResponse(
        requestId,
        adminRoleAssignmentListResponseSchema.parse({
          eventId,
          assignmentsVersion,
          items: [],
          pageInfo: { nextCursor: null, hasMore: false },
        }),
      );
    }
    const cursor = query.data.cursor
      ? decodeRoleCursor(query.data.cursor)
      : null;
    const scopeCondition = query.data.scopeKind
      ? sql`${schema.eventRoles.scope} ? ${
          query.data.scopeKind === 'station'
            ? 'stationIds'
            : query.data.scopeKind === 'room'
              ? 'roomIds'
              : 'sessionIds'
        }`
      : undefined;
    const rows = await dependencies.db
      .select({
        assignmentId: schema.eventRoles.id,
        eventId: schema.eventRoles.eventId,
        operatorId: schema.eventRoles.userId,
        operatorName: schema.users.name,
        role: schema.eventRoles.role,
        scope: schema.eventRoles.scope,
      })
      .from(schema.eventRoles)
      .innerJoin(schema.users, eq(schema.users.id, schema.eventRoles.userId))
      .where(
        and(
          eq(schema.eventRoles.eventId, eventId),
          inArray(schema.eventRoles.role, [
            'checkin_operator',
            'moderator',
            'room_operator',
          ]),
          isNull(schema.eventRoles.revokedAt),
          query.data.role
            ? eq(schema.eventRoles.role, query.data.role)
            : undefined,
          cursor ? gt(schema.eventRoles.id, cursor) : undefined,
          scopeCondition,
        ),
      )
      .orderBy(asc(schema.eventRoles.id))
      .limit(101);
    const pageRows = rows.slice(0, 100);
    const stationIds = pageRows.flatMap(({ role, scope }) =>
      role === 'checkin_operator' && scope.stationIds?.length === 1
        ? scope.stationIds
        : [],
    );
    const sessionIds = pageRows.flatMap(({ role, scope }) =>
      (role === 'moderator' || role === 'room_operator') &&
      scope.sessionIds?.length === 1
        ? scope.sessionIds
        : [],
    );
    const roomIds = pageRows.flatMap(({ role, scope }) =>
      role === 'room_operator' && scope.roomIds?.length === 1
        ? scope.roomIds
        : [],
    );
    const [stations, rooms, sessions] = await Promise.all([
      stationIds.length
        ? dependencies.db
            .select({
              id: schema.checkinStations.id,
              name: schema.checkinStations.name,
            })
            .from(schema.checkinStations)
            .where(
              and(
                eq(schema.checkinStations.eventId, eventId),
                inArray(schema.checkinStations.id, stationIds),
              ),
            )
        : [],
      roomIds.length
        ? dependencies.db
            .select({ id: schema.rooms.id, name: schema.rooms.name })
            .from(schema.rooms)
            .where(
              and(
                eq(schema.rooms.eventId, eventId),
                inArray(schema.rooms.id, roomIds),
              ),
            )
        : [],
      sessionIds.length
        ? dependencies.db
            .select({
              id: schema.programSessions.id,
              title: schema.programSessions.title,
            })
            .from(schema.programSessions)
            .where(
              and(
                eq(schema.programSessions.eventId, eventId),
                inArray(schema.programSessions.id, sessionIds),
              ),
            )
        : [],
    ]);
    const stationLabels = new Map(stations.map(({ id, name }) => [id, name]));
    const roomLabels = new Map(rooms.map(({ id, name }) => [id, name]));
    const sessionLabels = new Map(sessions.map(({ id, title }) => [id, title]));
    const items = pageRows.map((row) => {
      if (
        row.role === 'checkin_operator' &&
        row.scope.stationIds?.length === 1
      ) {
        const stationId = row.scope.stationIds[0]!;
        const label = stationLabels.get(stationId);
        if (!label) throw new Error('Invalid station-scoped assignment.');
        return {
          assignmentId: row.assignmentId,
          eventId: row.eventId,
          operatorId: row.operatorId,
          operatorLabel: safeLabel(row.operatorName, 'Člen týmu'),
          role: row.role,
          scope: {
            kind: 'station' as const,
            stationId,
            label: safeLabel(label, 'Stanoviště'),
          },
          state: 'active' as const,
          version: assignmentsVersion,
        };
      }
      if (row.role === 'room_operator' && row.scope.roomIds?.length === 1) {
        const roomId = row.scope.roomIds[0]!;
        const label = roomLabels.get(roomId);
        if (!label) throw new Error('Invalid room-scoped assignment.');
        return {
          assignmentId: row.assignmentId,
          eventId: row.eventId,
          operatorId: row.operatorId,
          operatorLabel: safeLabel(row.operatorName, 'Člen týmu'),
          role: row.role,
          scope: {
            kind: 'room' as const,
            roomId,
            label: safeLabel(label, 'Místnost'),
          },
          state: 'active' as const,
          version: assignmentsVersion,
        };
      }
      if (
        (row.role === 'moderator' || row.role === 'room_operator') &&
        row.scope.sessionIds?.length === 1
      ) {
        const sessionId = row.scope.sessionIds[0]!;
        const label = sessionLabels.get(sessionId);
        if (!label) throw new Error('Invalid session-scoped assignment.');
        return {
          assignmentId: row.assignmentId,
          eventId: row.eventId,
          operatorId: row.operatorId,
          operatorLabel: safeLabel(row.operatorName, 'Člen týmu'),
          role: row.role,
          scope: {
            kind: 'session' as const,
            sessionId,
            label: safeLabel(label, 'Aktivita'),
          },
          state: 'active' as const,
          version: assignmentsVersion,
        };
      }
      throw new Error('Invalid role assignment scope.');
    });
    const hasMore = rows.length > 100;
    const last = items.at(-1);
    return readResponse(
      requestId,
      adminRoleAssignmentListResponseSchema.parse({
        eventId,
        assignmentsVersion,
        items,
        pageInfo: {
          nextCursor:
            hasMore && last ? encodeRoleCursor(last.assignmentId) : null,
          hasMore,
        },
      }),
    );
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};

export const handleAdminRolePersonSearch = async (
  request: Request,
  eventId: string,
  dependencies: AdminRoleExportDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'POST') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    requireSameOrigin(request, dependencies);
    await authorize(request, eventId, 'role:manage', dependencies);
    const parsed = adminRolePersonSearchRequestSchema.safeParse(
      await parseBody(request),
    );
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid search',
        'The person search is invalid.',
      );
    }
    const pattern = `%${parsed.data.query.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    const rows = await dependencies.db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
      })
      .from(schema.eventMemberships)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.eventMemberships.userId),
      )
      .where(
        and(
          eq(schema.eventMemberships.eventId, eventId),
          eq(schema.eventMemberships.status, 'active'),
          eq(schema.users.emailVerified, true),
          or(
            ilike(schema.users.name, pattern),
            ilike(schema.users.email, pattern),
          ),
        ),
      )
      .orderBy(asc(schema.users.name), asc(schema.users.id))
      .limit(20);
    return readResponse(
      requestId,
      adminRolePersonSearchResponseSchema.parse({
        eventId,
        items: rows.map((row) => ({
          operatorId: row.id,
          displayName: safeLabel(row.name, 'Člen týmu'),
          maskedVerifiedContact: maskEmail(row.email),
        })),
      }),
    );
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};

export const handleAdminRoleScopeOptions = async (
  request: Request,
  eventId: string,
  dependencies: AdminRoleExportDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'POST') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    requireSameOrigin(request, dependencies);
    await authorize(request, eventId, 'role:manage', dependencies);
    const parsed = adminRoleScopeOptionsRequestSchema.safeParse(
      await parseBody(request),
    );
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid role',
        'The role scope request is invalid.',
      );
    }
    const role: AdminAssignmentRole = parsed.data.role;
    let options: AdminAssignmentScope[];
    if (role === 'checkin_operator') {
      const rows = await dependencies.db
        .select({
          id: schema.checkinStations.id,
          name: schema.checkinStations.name,
        })
        .from(schema.checkinStations)
        .where(eq(schema.checkinStations.eventId, eventId))
        .orderBy(
          asc(schema.checkinStations.name),
          asc(schema.checkinStations.id),
        )
        .limit(200);
      options = rows.map((row) => ({
        kind: 'station',
        stationId: row.id,
        label: safeLabel(row.name, 'Stanoviště'),
      }));
    } else if (role === 'moderator') {
      const features = await dependencies.db.query.eventFeatures.findFirst({
        columns: { questionsEnabled: true },
        where: eq(schema.eventFeatures.eventId, eventId),
      });
      const rows = !features?.questionsEnabled
        ? []
        : await dependencies.db
            .select({
              id: schema.programSessions.id,
              title: schema.programSessions.title,
            })
            .from(schema.programSessions)
            .where(
              and(
                eq(schema.programSessions.eventId, eventId),
                inArray(schema.programSessions.status, ['draft', 'published']),
                eq(schema.programSessions.questionsEnabled, true),
              ),
            )
            .orderBy(
              asc(schema.programSessions.startsAt),
              asc(schema.programSessions.id),
            )
            .limit(200);
      options = rows.map((row) => ({
        kind: 'session',
        sessionId: row.id,
        label: safeLabel(row.title, 'Aktivita'),
      }));
    } else {
      const rooms = await dependencies.db
        .select({ id: schema.rooms.id, name: schema.rooms.name })
        .from(schema.rooms)
        .where(
          and(
            eq(schema.rooms.eventId, eventId),
            ne(schema.rooms.status, 'archived'),
          ),
        )
        .orderBy(asc(schema.rooms.sortOrder), asc(schema.rooms.id))
        .limit(200);
      const sessions =
        rooms.length >= 200
          ? []
          : await dependencies.db
              .select({
                id: schema.programSessions.id,
                title: schema.programSessions.title,
              })
              .from(schema.programSessions)
              .where(
                and(
                  eq(schema.programSessions.eventId, eventId),
                  inArray(schema.programSessions.status, [
                    'draft',
                    'published',
                  ]),
                  eq(schema.programSessions.capacityMode, 'reservation'),
                ),
              )
              .orderBy(
                asc(schema.programSessions.startsAt),
                asc(schema.programSessions.id),
              )
              .limit(200 - rooms.length);
      options = [
        ...rooms.map((room) => ({
          kind: 'room' as const,
          roomId: room.id,
          label: safeLabel(`Místnost: ${room.name}`, 'Místnost'),
        })),
        ...sessions.map((session) => ({
          kind: 'session' as const,
          sessionId: session.id,
          label: safeLabel(`Aktivita: ${session.title}`, 'Aktivita'),
        })),
      ];
    }
    return readResponse(
      requestId,
      adminRoleScopeOptionsResponseSchema.parse({ eventId, role, options }),
    );
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};

export const handleAdminRoleAssignment = async (
  request: Request,
  eventId: string,
  dependencies: AdminRoleExportDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'POST') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    if (request.headers.get('origin') !== dependencies.allowedOrigin) {
      throw problem(
        403,
        'EVENT_ACCESS_DENIED',
        'Event access denied',
        'The request origin is not allowed.',
      );
    }
    const { actorId, eventStatus } = await authorize(
      request,
      eventId,
      'role:manage',
      dependencies,
    );
    const rawBody = await request.text();
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      raw = null;
    }
    const parsed = adminRoleAssignmentMutationRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid role action',
        'The role assignment is invalid.',
      );
    }
    if (
      eventStatus === 'archived' ||
      (eventStatus === 'ended' && parsed.data.action === 'grant')
    ) {
      throw problem(
        409,
        'ADMIN_INVALID_TRANSITION',
        'Role change unavailable',
        'The event phase does not allow this role change.',
      );
    }
    await dependencies.db
      .insert(schema.eventAdminVersions)
      .values({ eventId })
      .onConflictDoNothing();
    const key = readIdempotencyKey(request.headers);
    const changedAt = dependencies.now?.() ?? new Date();
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'admin.role-assignment',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: rawBody,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: changedAt,
      },
      async (transaction) => {
        await acquireTransactionLock(transaction, `admin-roles:${eventId}`);
        const version = await transaction.query.eventAdminVersions.findFirst({
          where: eq(schema.eventAdminVersions.eventId, eventId),
        });
        const currentVersion = version?.assignmentsVersion ?? 1;
        if (currentVersion !== parsed.data.expectedVersion) {
          throw problem(
            409,
            'STALE_VERSION',
            'Assignments changed',
            'Reload operator assignments.',
            { currentVersion },
          );
        }
        let assignment = null;
        let outcome: 'granted' | 'revoked';
        if (parsed.data.action === 'grant') {
          const membership = await transaction.query.eventMemberships.findFirst(
            {
              where: and(
                eq(schema.eventMemberships.eventId, eventId),
                eq(schema.eventMemberships.userId, parsed.data.operatorId),
                eq(schema.eventMemberships.status, 'active'),
              ),
            },
          );
          const operator = await transaction.query.users.findFirst({
            columns: { name: true },
            where: eq(schema.users.id, parsed.data.operatorId),
          });
          if (!membership || !operator) {
            throw problem(
              404,
              'ADMIN_RESOURCE_NOT_FOUND',
              'Operator not found',
              'The operator must have an active event membership.',
            );
          }
          const existing = await transaction.query.eventRoles.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.eventRoles.eventId, eventId),
              eq(schema.eventRoles.userId, parsed.data.operatorId),
              eq(schema.eventRoles.role, parsed.data.role),
              isNull(schema.eventRoles.revokedAt),
            ),
          });
          if (existing) {
            throw problem(
              409,
              'ADMIN_INVALID_TRANSITION',
              'Role already assigned',
              'Revoke the current role before assigning a new scope.',
            );
          }
          const scopeJson = await validateScope(
            transaction,
            eventId,
            parsed.data.role,
            parsed.data.scope,
          );
          const assignmentId = generateUuidV7();
          await transaction.insert(schema.eventRoles).values({
            id: assignmentId,
            eventId,
            userId: parsed.data.operatorId,
            role: parsed.data.role,
            scope: scopeJson,
            grantedBy: actorId,
            grantedAt: changedAt,
          });
          assignment = {
            assignmentId,
            eventId,
            operatorId: parsed.data.operatorId,
            operatorLabel: operator.name,
            role: parsed.data.role,
            scope: parsed.data.scope,
            state: 'active' as const,
            version: currentVersion + 1,
          };
          outcome = 'granted';
        } else {
          const existing = await transaction.query.eventRoles.findFirst({
            where: and(
              eq(schema.eventRoles.eventId, eventId),
              eq(schema.eventRoles.id, parsed.data.assignmentId),
              isNull(schema.eventRoles.revokedAt),
            ),
          });
          if (!existing || existing.role === 'organizer_admin') {
            throw problem(
              404,
              'ADMIN_RESOURCE_NOT_FOUND',
              'Assignment not found',
              'The scoped operator assignment is unavailable.',
            );
          }
          await transaction
            .update(schema.eventRoles)
            .set({ revokedAt: changedAt })
            .where(eq(schema.eventRoles.id, existing.id));
          outcome = 'revoked';
        }
        await transaction
          .update(schema.eventAdminVersions)
          .set({
            assignmentsVersion: sql`${schema.eventAdminVersions.assignmentsVersion} + 1`,
            updatedAt: changedAt,
          })
          .where(eq(schema.eventAdminVersions.eventId, eventId));
        const auditId = await writeAuditLog(transaction, {
          eventId,
          actorId,
          actorType: 'user',
          action: `role.${parsed.data.action}`,
          targetType: 'event_role',
          targetId:
            parsed.data.action === 'grant'
              ? assignment!.assignmentId
              : parsed.data.assignmentId,
          requestId,
          reason: parsed.data.reason,
          after: { outcome, version: currentVersion + 1 },
        });
        const response = adminRoleAssignmentMutationResponseSchema.parse({
          eventId,
          outcome,
          assignmentsVersion: currentVersion + 1,
          assignment,
          changedAt: changedAt.toISOString(),
          audit: { auditId },
        });
        return { status: 200, body: response };
      },
    );
    return Response.json(result.body, {
      status: result.status,
      headers: {
        ...privateHeaders(requestId),
        'idempotency-replayed': String(result.replayed),
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

export const handleAdminExport = async (
  request: Request,
  eventId: string,
  dependencies: AdminRoleExportDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'POST') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    if (request.headers.get('origin') !== dependencies.allowedOrigin) {
      throw problem(
        403,
        'EVENT_ACCESS_DENIED',
        'Event access denied',
        'The request origin is not allowed.',
      );
    }
    const { actorId } = await authorize(
      request,
      eventId,
      'personal-data:operational:export',
      dependencies,
    );
    const rawBody = await request.text();
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      raw = null;
    }
    const parsed = adminExportRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid export request',
        'The export request is invalid.',
      );
    }
    const key = readIdempotencyKey(request.headers);
    const queuedAt = dependencies.now?.() ?? new Date();
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'admin.export',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: rawBody,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: queuedAt,
      },
      async (transaction) => {
        const exportId = generateUuidV7();
        await transaction.insert(schema.operationalExportRequests).values({
          id: exportId,
          eventId,
          requestedBy: actorId,
          report: parsed.data.report,
          format: parsed.data.format,
          rangeFrom: parsed.data.range
            ? new Date(parsed.data.range.from)
            : null,
          rangeTo: parsed.data.range ? new Date(parsed.data.range.to) : null,
          reason: parsed.data.reason,
          state: 'queued',
          expiresAt: new Date(queuedAt.getTime() + 24 * 60 * 60_000),
          createdAt: queuedAt,
          updatedAt: queuedAt,
        });
        await transaction.insert(schema.outboxEvents).values({
          id: generateUuidV7(),
          eventId,
          type: 'export.requested',
          aggregateType: 'operational_export',
          aggregateId: exportId,
          payload: { exportId, report: parsed.data.report },
          deduplicationKey: `export.requested:${exportId}`,
          status: 'pending',
          availableAt: queuedAt,
        });
        const auditId = await writeAuditLog(transaction, {
          eventId,
          actorId,
          actorType: 'user',
          action: 'export.queued',
          targetType: 'operational_export',
          targetId: exportId,
          requestId,
          reason: parsed.data.reason,
          after: {
            report: parsed.data.report,
            format: parsed.data.format,
            status: 'queued',
          },
        });
        const response = adminExportResponseSchema.parse({
          eventId,
          exportId,
          report: parsed.data.report,
          outcome: 'queued',
          state: 'queued',
          queuedAt: queuedAt.toISOString(),
          audit: { auditId },
        });
        return { status: 202, body: response, resultReference: exportId };
      },
    );
    return Response.json(result.body, {
      status: result.status,
      headers: {
        ...privateHeaders(requestId),
        'idempotency-replayed': String(result.replayed),
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

export const handleAdminExportJobList = async (
  request: Request,
  eventId: string,
  dependencies: AdminRoleExportDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'GET') {
      throw problem(
        405,
        'METHOD_NOT_ALLOWED',
        'Method not allowed',
        'The method is not supported.',
      );
    }
    await authorize(
      request,
      eventId,
      'personal-data:operational:export',
      dependencies,
    );
    const url = new URL(request.url);
    const limitValue = url.searchParams.get('limit');
    const parsed = adminExportJobListQuerySchema.safeParse({
      ...(url.searchParams.has('state')
        ? { state: url.searchParams.get('state') }
        : {}),
      ...(url.searchParams.has('cursor')
        ? { cursor: url.searchParams.get('cursor') }
        : {}),
      ...(limitValue === null ? {} : { limit: Number(limitValue) }),
    });
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid export filters',
        'The export filters are invalid.',
      );
    }
    const now = dependencies.now?.() ?? new Date();
    const cursor = parsed.data.cursor
      ? decodeExportCursor(parsed.data.cursor)
      : null;
    const unexpired = gt(schema.operationalExportRequests.expiresAt, now);
    const stateCondition =
      parsed.data.state === 'expired'
        ? or(
            eq(schema.operationalExportRequests.state, 'expired'),
            lte(schema.operationalExportRequests.expiresAt, now),
          )
        : parsed.data.state === 'queued'
          ? and(
              inArray(schema.operationalExportRequests.state, [
                'queued',
                'processing',
              ]),
              unexpired,
            )
          : parsed.data.state
            ? and(
                eq(schema.operationalExportRequests.state, parsed.data.state),
                unexpired,
              )
            : undefined;
    const rows = await dependencies.db
      .select({
        id: schema.operationalExportRequests.id,
        eventId: schema.operationalExportRequests.eventId,
        report: schema.operationalExportRequests.report,
        format: schema.operationalExportRequests.format,
        rangeFrom: schema.operationalExportRequests.rangeFrom,
        rangeTo: schema.operationalExportRequests.rangeTo,
        state: schema.operationalExportRequests.state,
        contentPresent: sql<boolean>`${schema.operationalExportRequests.content} is not null`,
        createdAt: schema.operationalExportRequests.createdAt,
        expiresAt: schema.operationalExportRequests.expiresAt,
        requestedByName: schema.users.name,
      })
      .from(schema.operationalExportRequests)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.operationalExportRequests.requestedBy),
      )
      .where(
        and(
          eq(schema.operationalExportRequests.eventId, eventId),
          stateCondition,
          cursor
            ? or(
                lt(
                  schema.operationalExportRequests.createdAt,
                  cursor.createdAt,
                ),
                and(
                  eq(
                    schema.operationalExportRequests.createdAt,
                    cursor.createdAt,
                  ),
                  lt(schema.operationalExportRequests.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        desc(schema.operationalExportRequests.createdAt),
        desc(schema.operationalExportRequests.id),
      )
      .limit(parsed.data.limit + 1);
    const hasMore = rows.length > parsed.data.limit;
    const pageRows = rows.slice(0, parsed.data.limit);
    const last = pageRows.at(-1);
    const response = adminExportJobListResponseSchema.parse({
      eventId,
      items: pageRows.map((row) => {
        const expired = row.expiresAt <= now || row.state === 'expired';
        const state = expired
          ? 'expired'
          : row.state === 'processing'
            ? 'queued'
            : row.state;
        const ready = state === 'ready' && row.contentPresent;
        return {
          eventId: row.eventId,
          exportId: row.id,
          report: row.report,
          format: row.format,
          range:
            row.rangeFrom && row.rangeTo
              ? {
                  from: row.rangeFrom.toISOString(),
                  to: row.rangeTo.toISOString(),
                }
              : null,
          createdByLabel: safeLabel(row.requestedByName, 'Uživatel'),
          state: ready ? 'ready' : state === 'ready' ? 'failed' : state,
          createdAt: row.createdAt.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          downloadPath: ready
            ? `/api/v1/admin/events/${eventId}/exports/${row.id}`
            : null,
        };
      }),
      pageInfo: {
        hasMore,
        nextCursor:
          hasMore && last ? encodeExportCursor(last.createdAt, last.id) : null,
      },
    });
    return readResponse(requestId, response);
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};
