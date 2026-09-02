import { createHash } from 'node:crypto';

import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  ticketImportApplyRequestSchema,
  ticketImportApplyResponseSchema,
  ticketImportSummarySchema,
  type TicketImportApplyResponse,
  type TicketImportSummary,
} from '@byzon/domain/contracts/ticket-import';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import { EventAccessDeniedError, requireEventPermission } from './policy';
import type { SimpleShopPreviewRateLimiter } from './simpleshop-preview-rate-limit';
import {
  SimpleShopTicketSourceError,
  type SimpleShopTicketSourceAdapter,
} from './simpleshop-ticket-source';

const REQUEST_MAX_BYTES = 16_384;
const PREVIEW_TTL_MS = 20 * 60_000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const PREVIEW_VERSION = 1;
const uuidSchema = z.string().uuid();

export interface TicketImportApplyDependencies {
  readonly db: Database;
  readonly allowedOrigin: string;
  readonly getSession: (
    headers: Headers,
  ) => Promise<{ user: { id: string } } | null>;
  readonly currentEventSlug?: string;
  readonly rateLimit?: SimpleShopPreviewRateLimiter;
  readonly sourceAdapter: SimpleShopTicketSourceAdapter;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

class TicketImportStaleError extends Error {
  constructor(readonly currentPreviewVersion: number) {
    super('Ticket import preview is stale');
    this.name = 'TicketImportStaleError';
  }
}

const apiProblem = (
  status: number,
  code: string,
  title: string,
  detail: string,
  fieldErrors?: Record<string, string[]>,
) =>
  new ApiProblemError({
    status,
    code,
    title,
    detail,
    ...(fieldErrors ? { fieldErrors } : {}),
  });

const authenticationRequired = () =>
  apiProblem(
    401,
    'AUTHENTICATION_REQUIRED',
    'Authentication required',
    'A valid session is required.',
  );

const accessDenied = () =>
  apiProblem(
    403,
    'EVENT_ACCESS_DENIED',
    'Event access denied',
    'The requested administration scope is not available for this account.',
  );

const validationFailed = (fieldErrors?: Record<string, string[]>) =>
  apiProblem(
    422,
    'IMPORT_VALIDATION_FAILED',
    'Import validation failed',
    'The ticket import apply request is invalid.',
    fieldErrors,
  );

const batchNotFound = () =>
  apiProblem(
    404,
    'IMPORT_BATCH_NOT_FOUND',
    'Import batch not found',
    'The requested ticket import preview is unavailable.',
  );

const previewBlocked = (detail: string) =>
  apiProblem(409, 'IMPORT_PREVIEW_BLOCKED', 'Import preview blocked', detail);

const sourceProblem = (error: SimpleShopTicketSourceError): ApiProblemError => {
  switch (error.code) {
    case 'timeout':
      return apiProblem(
        504,
        'IMPORT_SOURCE_TIMEOUT',
        'Ticket source timed out',
        'The ticket source could not be revalidated in time.',
      );
    case 'record_limit_exceeded':
      return validationFailed({
        source: ['The source exceeds the bounded import record limit.'],
      });
    case 'invalid_payload':
    case 'response_too_large':
    case 'invalid_target':
    case 'method_not_allowed':
      return apiProblem(
        502,
        'IMPORT_SOURCE_INVALID',
        'Ticket source response is invalid',
        'The ticket source could not be safely revalidated.',
      );
    case 'credentials_missing':
    case 'unavailable':
      return apiProblem(
        502,
        'IMPORT_SOURCE_UNAVAILABLE',
        'Ticket source is unavailable',
        'The ticket source could not be revalidated.',
      );
  }
};

const privateHeaders = (requestId: string, contentType: string) =>
  new Headers({
    'cache-control': 'private, no-store',
    'content-type': contentType,
    vary: 'Authorization, Cookie',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  });

const privateProblemResponse = (
  error: unknown,
  requestId: string,
): Response => {
  if (error instanceof TicketImportStaleError) {
    return new Response(
      JSON.stringify({
        type: 'urn:byzon:problem:import-preview-stale',
        title: 'Import preview stale',
        status: 409,
        code: 'IMPORT_PREVIEW_STALE',
        detail: 'Load a new immutable SimpleShop preview before applying.',
        requestId,
        currentPreviewVersion: error.currentPreviewVersion,
      }),
      {
        status: 409,
        headers: privateHeaders(requestId, 'application/problem+json'),
      },
    );
  }
  const response = problemResponse(
    error instanceof EventAccessDeniedError ? accessDenied() : error,
    requestId,
  );
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('vary', 'Authorization, Cookie');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
};

const requireTransport = (request: Request, allowedOrigin: string): string => {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0];
  if (request.method !== 'POST') throw validationFailed();
  if (request.headers.get('origin') !== allowedOrigin) throw accessDenied();
  if (
    new URL(request.url).search !== '' ||
    request.headers.has('if-match') ||
    contentType?.trim().toLowerCase() !== 'application/json'
  ) {
    throw validationFailed();
  }
  return readIdempotencyKey(request.headers);
};

const readBody = async (
  request: Request,
): Promise<{ raw: string; value: unknown }> => {
  const declared = request.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > REQUEST_MAX_BYTES)
  ) {
    throw validationFailed({ body: ['The request body is too large.'] });
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > REQUEST_MAX_BYTES) {
    throw validationFailed({ body: ['The request body is too large.'] });
  }
  try {
    return { raw, value: JSON.parse(raw) as unknown };
  } catch {
    throw validationFailed();
  }
};

const summaryMatches = (
  left: TicketImportSummary,
  right: TicketImportSummary,
): boolean =>
  (Object.keys(left) as (keyof TicketImportSummary)[]).every(
    (key) => left[key] === right[key],
  );

const requireAccess = async (
  db: Database | DatabaseTransaction,
  eventId: string,
  actorId: string,
  currentEventSlug: string,
  now: Date,
): Promise<void> => {
  const event = await db.query.events.findFirst({
    columns: { id: true, operationalDataAnonymizesAt: true },
    where: and(
      eq(schema.events.id, eventId),
      eq(schema.events.slug, currentEventSlug),
    ),
  });
  if (!event) throw accessDenied();
  if (
    event.operationalDataAnonymizesAt !== null &&
    event.operationalDataAnonymizesAt <= now
  ) {
    throw accessDenied();
  }
  await requireEventPermission(
    db,
    { userId: actorId },
    eventId,
    'ticket:any:manage',
  );
};

const existingAppliedResponse = async (
  transaction: DatabaseTransaction,
  eventId: string,
  previewId: string,
  completedAt: Date,
  summary: TicketImportSummary,
): Promise<TicketImportApplyResponse> => {
  const audit = await transaction.query.auditLogs.findFirst({
    columns: { id: true },
    where: and(
      eq(schema.auditLogs.eventId, eventId),
      eq(schema.auditLogs.action, 'ticket_import.applied'),
      eq(schema.auditLogs.targetId, previewId),
    ),
  });
  if (!audit)
    throw previewBlocked('The applied import audit receipt is missing.');
  return ticketImportApplyResponseSchema.parse({
    eventId,
    batchId: previewId,
    previewId,
    previewVersion: PREVIEW_VERSION,
    outcome: 'already_applied',
    result: {
      created: summary.new,
      statusChanged: summary.statusChanged,
      unchanged: summary.unchanged,
    },
    completedAt: completedAt.toISOString(),
    audit: { auditId: audit.id },
  });
};

export const applySimpleShopTicketImport = async (
  request: Request,
  eventId: string,
  dependencies: TicketImportApplyDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (!uuidSchema.safeParse(eventId).success) throw accessDenied();
    const key = requireTransport(request, dependencies.allowedOrigin);
    const identity = await dependencies.getSession(request.headers);
    if (!identity || !uuidSchema.safeParse(identity.user.id).success) {
      throw authenticationRequired();
    }
    await dependencies.rateLimit?.(identity.user.id);
    const body = await readBody(request);
    const parsed = ticketImportApplyRequestSchema.safeParse(body.value);
    if (!parsed.success) {
      throw validationFailed(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join('.') || 'body',
            [issue.message],
          ]),
        ),
      );
    }
    if (parsed.data.eventId !== eventId) throw accessDenied();
    const currentEventSlug =
      dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG;
    const requestTime = dependencies.now?.() ?? new Date();
    await requireAccess(
      dependencies.db,
      eventId,
      identity.user.id,
      currentEventSlug,
      requestTime,
    );
    const generateId = dependencies.generateId ?? generateUuidV7;
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId,
        actorId: identity.user.id,
        scope: 'ticket-import.apply',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: body.raw,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now: requestTime,
        generateId,
      },
      async (transaction) => {
        await acquireTransactionLock(
          transaction,
          `ticket-import-apply:${eventId}:${parsed.data.previewId}`,
        );
        await acquireTransactionLock(transaction, `admin-roles:${eventId}`);
        const checkedAt = dependencies.now?.() ?? new Date();
        await requireAccess(
          transaction,
          eventId,
          identity.user.id,
          currentEventSlug,
          checkedAt,
        );
        const batch = await transaction.query.ticketImportBatches.findFirst({
          where: and(
            eq(schema.ticketImportBatches.eventId, eventId),
            eq(schema.ticketImportBatches.id, parsed.data.previewId),
          ),
        });
        if (!batch || batch.source !== 'simpleshop_api') throw batchNotFound();
        const summary = ticketImportSummarySchema.safeParse(batch.summary);
        if (
          !summary.success ||
          !summaryMatches(summary.data, parsed.data.expectedImpact)
        ) {
          throw new TicketImportStaleError(PREVIEW_VERSION);
        }
        if (parsed.data.previewVersion !== PREVIEW_VERSION) {
          throw new TicketImportStaleError(PREVIEW_VERSION);
        }
        if (batch.status === 'applied' && batch.appliedAt) {
          const replay = await existingAppliedResponse(
            transaction,
            eventId,
            batch.id,
            batch.appliedAt,
            summary.data,
          );
          return { status: 200, body: replay, resultReference: batch.id };
        }
        if (batch.status !== 'validated' || !batch.validatedAt) {
          throw previewBlocked('The preview is not in an applicable state.');
        }
        if (
          batch.validatedAt.getTime() + PREVIEW_TTL_MS <=
          checkedAt.getTime()
        ) {
          throw new TicketImportStaleError(PREVIEW_VERSION);
        }
        const snapshot = await dependencies.sourceAdapter.fetchPreviewSource();
        const currentSnapshotHash = createHash('sha256')
          .update(snapshot.snapshotDigest, 'utf8')
          .update('\0', 'utf8')
          .update(batch.id, 'utf8')
          .digest('hex');
        if (currentSnapshotHash !== batch.fileSha256) {
          throw new TicketImportStaleError(PREVIEW_VERSION);
        }
        const rows = await transaction.query.ticketImportRows.findMany({
          where: and(
            eq(schema.ticketImportRows.eventId, eventId),
            eq(schema.ticketImportRows.batchId, batch.id),
          ),
        });
        if (rows.length !== batch.rowCount) {
          throw previewBlocked('The immutable preview rows do not reconcile.');
        }
        if (
          rows.some(
            (row) => {
              if (
                !row.previewStatus ||
                !['new', 'unchanged', 'excluded'].includes(row.previewStatus)
              ) {
                return true;
              }
              if (row.previewStatus === 'excluded') {
                return (
                  !['unpaid', 'cancelled', 'refunded'].includes(
                    row.sourceStatus ?? '',
                  ) ||
                  row.mappedStatus !== null ||
                  !row.validationErrors.includes('source_status_excluded')
                );
              }
              return (
                row.sourceStatus !== 'paid' ||
                row.mappedStatus !== 'valid' ||
                row.validationErrors.length > 0
              );
            },
          )
        ) {
          throw previewBlocked(
            'The preview contains an unsafe or unresolved row.',
          );
        }
        const sourceByExternalId = new Map(
          snapshot.records.map((record) => [record.externalId, record]),
        );
        if (
          sourceByExternalId.size !== snapshot.records.length ||
          snapshot.records.length !== rows.length
        ) {
          throw new TicketImportStaleError(PREVIEW_VERSION);
        }
        const reconciledRows = rows.map((row) => {
          const source = row.externalId
            ? sourceByExternalId.get(row.externalId)
            : undefined;
          if (
            !source ||
            row.orderExternalId !== source.orderExternalId ||
            row.sourceStatus !== source.sourceStatus
          ) {
            throw new TicketImportStaleError(PREVIEW_VERSION);
          }
          return { row, source };
        });
        const relevantRows = reconciledRows.filter(
          ({ row }) =>
            row.previewStatus === 'new' || row.previewStatus === 'unchanged',
        );
        if (
          relevantRows.some(
            ({ source }) =>
              source.sourceStatus !== 'paid' ||
              source.contactEmail === null ||
              source.identitySource === 'manual_review',
          )
        ) {
          throw previewBlocked(
            'The preview contains an unresolved participant identity.',
          );
        }
        const externalIds = relevantRows.map(({ source }) => source.externalId);
        for (const externalId of [...externalIds].sort()) {
          await acquireTransactionLock(
            transaction,
            `ticket-import-source:${eventId}:${externalId}`,
          );
        }
        const [imported, legacyTickets] = await Promise.all([
          transaction
            .select({ externalId: schema.ticketSourceParticipants.externalId })
            .from(schema.ticketSourceParticipants)
            .where(
              and(
                eq(schema.ticketSourceParticipants.eventId, eventId),
                inArray(
                  schema.ticketSourceParticipants.externalId,
                  externalIds,
                ),
              ),
            ),
          transaction
            .select({
              externalId: schema.tickets.externalId,
              status: schema.tickets.status,
            })
            .from(schema.tickets)
            .where(
              and(
                eq(schema.tickets.eventId, eventId),
                inArray(schema.tickets.externalId, externalIds),
              ),
            ),
        ]);
        const existing = new Map<string, 'valid' | 'invalid'>(
          imported.map(({ externalId }) => [externalId, 'valid']),
        );
        for (const ticket of legacyTickets) {
          if (!ticket.externalId) continue;
          existing.set(
            ticket.externalId,
            ticket.status === 'valid' || ticket.status === 'activated'
              ? 'valid'
              : 'invalid',
          );
        }
        for (const { row, source } of relevantRows) {
          const current = existing.get(source.externalId);
          if (
            (row.previewStatus === 'new' && current !== undefined) ||
            (row.previewStatus === 'unchanged' && current !== 'valid')
          ) {
            throw new TicketImportStaleError(PREVIEW_VERSION);
          }
        }
        const newRows = relevantRows.filter(
          ({ row }) => row.previewStatus === 'new',
        );
        const emails = [
          ...new Set(newRows.map(({ source }) => source.contactEmail!)),
        ].sort();
        for (const email of emails) {
          await acquireTransactionLock(
            transaction,
            `ticket-import-identity:${email}`,
          );
        }
        const appliedAt = dependencies.now?.() ?? new Date();
        await requireAccess(
          transaction,
          eventId,
          identity.user.id,
          currentEventSlug,
          appliedAt,
        );
        if (
          batch.validatedAt.getTime() + PREVIEW_TTL_MS <=
          appliedAt.getTime()
        ) {
          throw new TicketImportStaleError(PREVIEW_VERSION);
        }
        for (const { source } of newRows) {
          const email = source.contactEmail!;
          let user = await transaction.query.users.findFirst({
            columns: { id: true },
            where: eq(schema.users.email, email),
          });
          if (!user) {
            user = { id: generateId() };
            await transaction.insert(schema.users).values({
              id: user.id,
              name: source.contactName?.trim() || 'Nový účastník',
              email,
              emailVerified: false,
              createdAt: appliedAt,
              updatedAt: appliedAt,
            });
          }
          const membership = await transaction.query.eventMemberships.findFirst(
            {
              columns: { status: true },
              where: and(
                eq(schema.eventMemberships.eventId, eventId),
                eq(schema.eventMemberships.userId, user.id),
              ),
            },
          );
          if (membership && membership.status !== 'active') {
            throw previewBlocked(
              'An existing participant membership requires manual review.',
            );
          }
          if (!membership) {
            await transaction.insert(schema.eventMemberships).values({
              eventId,
              userId: user.id,
              status: 'active',
            });
          }
          const role = await transaction.query.eventRoles.findFirst({
            columns: { id: true },
            where: and(
              eq(schema.eventRoles.eventId, eventId),
              eq(schema.eventRoles.userId, user.id),
              eq(schema.eventRoles.role, 'participant'),
              isNull(schema.eventRoles.revokedAt),
            ),
          });
          if (!role) {
            await transaction.insert(schema.eventRoles).values({
              id: generateId(),
              eventId,
              userId: user.id,
              role: 'participant',
              grantedBy: identity.user.id,
              grantedAt: appliedAt,
            });
          }
          await transaction.insert(schema.ticketSourceParticipants).values({
            id: generateId(),
            eventId,
            externalId: source.externalId,
            orderExternalId: source.orderExternalId,
            userId: user.id,
            sourceStatus: 'paid',
            importBatchId: batch.id,
            createdAt: appliedAt,
            updatedAt: appliedAt,
          });
        }
        await transaction
          .update(schema.ticketImportBatches)
          .set({
            status: 'applied',
            appliedAt,
            updatedAt: appliedAt,
          })
          .where(
            and(
              eq(schema.ticketImportBatches.eventId, eventId),
              eq(schema.ticketImportBatches.id, batch.id),
              eq(schema.ticketImportBatches.status, 'validated'),
            ),
          );
        const auditId = await writeAuditLog(
          transaction,
          {
            eventId,
            actorId: identity.user.id,
            actorType: 'user',
            action: 'ticket_import.applied',
            targetType: 'ticket_import_batch',
            targetId: batch.id,
            requestId: uuidSchema.safeParse(requestId).success
              ? requestId
              : generateId(),
            reason: parsed.data.reason,
            before: { status: 'validated', previewVersion: PREVIEW_VERSION },
            after: {
              status: 'applied',
              created: summary.data.new,
              unchanged: summary.data.unchanged,
              excluded: summary.data.excluded,
              emailSent: false,
              ticketCredentialCreated: false,
            },
          },
          { generateId },
        );
        const response = ticketImportApplyResponseSchema.parse({
          eventId,
          batchId: batch.id,
          previewId: batch.id,
          previewVersion: PREVIEW_VERSION,
          outcome: 'applied',
          result: {
            created: summary.data.new,
            statusChanged: summary.data.statusChanged,
            unchanged: summary.data.unchanged,
          },
          completedAt: appliedAt.toISOString(),
          audit: { auditId },
        });
        return { status: 200, body: response, resultReference: batch.id };
      },
    );
    const response = ticketImportApplyResponseSchema.parse({
      ...result.body,
      outcome: result.replayed ? 'already_applied' : result.body.outcome,
    });
    return new Response(JSON.stringify(response), {
      status: result.status,
      headers: privateHeaders(requestId, 'application/json'),
    });
  } catch (error) {
    return privateProblemResponse(
      error instanceof SimpleShopTicketSourceError
        ? sourceProblem(error)
        : error,
      requestId,
    );
  }
};
