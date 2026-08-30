import { schema, writeAuditLog, type Database } from '@byzon/database';
import {
  adminEventSettingsSchema,
  adminEventSettingsUpdateRequestSchema,
  adminEventSettingsUpdateResponseSchema,
} from '@byzon/domain/contracts';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuidSchema = z.string().uuid();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;

export interface AdminSettingsDependencies {
  db: Database;
  allowedOrigin: string;
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
  dependencies: AdminSettingsDependencies,
) => {
  if (!uuidSchema.safeParse(eventId).success) {
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Settings are unavailable.',
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
  try {
    await requireEventPermission(
      dependencies.db,
      { userId: identity.user.id },
      eventId,
      'event:settings:manage',
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw problem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Settings are unavailable.',
    );
  }
  return identity.user.id;
};

const loadSettings = async (db: Database, eventId: string) => {
  const existing = await db.query.eventOperationalSettings.findFirst({
    where: eq(schema.eventOperationalSettings.eventId, eventId),
  });
  if (existing) return existing;
  const rows = await db
    .insert(schema.eventOperationalSettings)
    .values({ eventId })
    .onConflictDoNothing()
    .returning();
  return (
    rows[0] ??
    (await db.query.eventOperationalSettings.findFirst({
      where: eq(schema.eventOperationalSettings.eventId, eventId),
    }))!
  );
};

export const handleAdminSettings = async (
  request: Request,
  eventId: string,
  dependencies: AdminSettingsDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    const actorId = await authorize(request, eventId, dependencies);
    if (request.method === 'GET') {
      const settings = await loadSettings(dependencies.db, eventId);
      return Response.json(
        adminEventSettingsSchema.parse({
          eventId,
          registrationMode: settings.registrationMode,
          reservationChangesAllowed: settings.reservationChangesAllowed,
          supportMessage: settings.supportMessage,
          version: settings.version,
        }),
        { headers: privateHeaders(requestId) },
      );
    }
    if (request.method !== 'PUT') {
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
    const rawBody = await request.text();
    let raw: unknown;
    try {
      raw = JSON.parse(rawBody);
    } catch {
      raw = null;
    }
    const parsed = adminEventSettingsUpdateRequestSchema.safeParse(raw);
    if (!parsed.success) {
      throw problem(
        422,
        'VALIDATION_FAILED',
        'Invalid settings',
        'The settings update is invalid.',
      );
    }
    await loadSettings(dependencies.db, eventId);
    const key = readIdempotencyKey(request.headers);
    const changedAt = dependencies.now?.() ?? new Date();
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId,
        scope: 'event.settings',
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
        const current =
          await transaction.query.eventOperationalSettings.findFirst({
            where: eq(schema.eventOperationalSettings.eventId, eventId),
          });
        if (!current) {
          throw problem(
            404,
            'ADMIN_RESOURCE_NOT_FOUND',
            'Settings not found',
            'The event settings are unavailable.',
          );
        }
        if (current.version !== parsed.data.expectedVersion) {
          throw problem(
            409,
            'STALE_VERSION',
            'Settings changed',
            'Reload the latest event settings.',
            { currentVersion: current.version },
          );
        }
        await transaction
          .update(schema.eventOperationalSettings)
          .set({
            ...parsed.data.settings,
            updatedAt: changedAt,
            updatedBy: actorId,
            version: sql`${schema.eventOperationalSettings.version} + 1`,
          })
          .where(eq(schema.eventOperationalSettings.eventId, eventId));
        const auditId = await writeAuditLog(transaction, {
          eventId,
          actorId,
          actorType: 'user',
          action: 'settings.update',
          targetType: 'event_settings',
          targetId: eventId,
          requestId,
          reason: parsed.data.reason,
          before: {
            registrationMode: current.registrationMode,
            reservationChangesAllowed: current.reservationChangesAllowed,
            version: current.version,
          },
          after: { ...parsed.data.settings, version: current.version + 1 },
        });
        const response = adminEventSettingsUpdateResponseSchema.parse({
          eventId,
          outcome: 'updated',
          settings: {
            eventId,
            ...parsed.data.settings,
            version: current.version + 1,
          },
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
