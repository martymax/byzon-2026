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
  type TicketImportParticipantDetails,
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
  identityRepairMappingKey,
  participantReferenceDigest,
} from './ticket-import-participant-reference';
import {
  SimpleShopTicketSourceError,
  type SimpleShopTicketSourceAdapter,
} from './simpleshop-ticket-source';

const REQUEST_MAX_BYTES = 1_000_000;
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

const sameRowSelection = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length && left.every((rowId) => right.includes(rowId));

const participantNameFrom = (
  contactName: string | null,
): { firstName: string; lastName: string } => {
  const parts = (contactName ?? 'Nový účastník')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    firstName: (parts.shift() ?? 'Nový').slice(0, 128),
    lastName: (parts.join(' ') || 'Účastník').slice(0, 128),
  };
};

const completionDigest = (
  details: readonly TicketImportParticipantDetails[] = [],
): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        [...details].sort((a, b) => a.rowId.localeCompare(b.rowId)),
      ),
    )
    .digest('hex');

const appliedAuditAfterSchema = z.object({
  selectedRowIds: z.array(uuidSchema).min(1),
  completionDigest: z.string().optional(),
  created: z.number().int().nonnegative(),
  statusChanged: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});

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
  requestedRowIds: readonly string[],
  details: readonly TicketImportParticipantDetails[] | undefined,
): Promise<TicketImportApplyResponse> => {
  const audit = await transaction.query.auditLogs.findFirst({
    columns: { id: true, after: true },
    where: and(
      eq(schema.auditLogs.eventId, eventId),
      eq(schema.auditLogs.action, 'ticket_import.applied'),
      eq(schema.auditLogs.targetId, previewId),
    ),
  });
  if (!audit)
    throw previewBlocked('The applied import audit receipt is missing.');
  const after = appliedAuditAfterSchema.safeParse(audit.after);
  if (
    !after.success ||
    !sameRowSelection(after.data.selectedRowIds, requestedRowIds) ||
    (after.data.completionDigest ?? completionDigest()) !==
      completionDigest(details)
  ) {
    throw previewBlocked(
      'The preview was already applied with a different row selection.',
    );
  }
  return ticketImportApplyResponseSchema.parse({
    eventId,
    batchId: previewId,
    previewId,
    previewVersion: PREVIEW_VERSION,
    selectedRowIds: after.data.selectedRowIds,
    outcome: 'already_applied',
    result: {
      created: after.data.created,
      statusChanged: after.data.statusChanged,
      unchanged: after.data.unchanged,
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
            parsed.data.selectedRowIds,
            parsed.data.participantDetails,
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
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        const selectedRows = parsed.data.selectedRowIds.map((rowId) =>
          rowsById.get(rowId),
        );
        if (selectedRows.some((row) => row === undefined)) {
          throw new TicketImportStaleError(PREVIEW_VERSION);
        }
        const detailsByRowId = new Map(
          (parsed.data.participantDetails ?? []).map((details) => [
            details.rowId,
            details,
          ]),
        );
        for (const row of selectedRows) {
          if (!row) throw new TicketImportStaleError(PREVIEW_VERSION);
          const completing = detailsByRowId.has(row.id);
          const eligible = completing
            ? row.previewStatus === 'conflict' &&
              row.validationErrors.length === 1 &&
              row.validationErrors[0] === 'participant_identity_manual_review'
            : row.previewStatus === 'new' &&
              row.mappedStatus === 'valid' &&
              row.validationErrors.length === 0;
          if (!eligible || row.sourceStatus !== 'paid') {
            throw previewBlocked(
              'Only new or explicitly completed participants can be imported.',
            );
          }
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
        const reconciledByRowId = new Map(
          reconciledRows.map((value) => [value.row.id, value]),
        );
        const relevantRows = parsed.data.selectedRowIds.map((rowId) => {
          const reconciled = reconciledByRowId.get(rowId);
          if (!reconciled) throw new TicketImportStaleError(PREVIEW_VERSION);
          const details = detailsByRowId.get(rowId);
          if (!details) return reconciled;
          if (reconciled.source.identitySource !== 'manual_review') {
            throw previewBlocked(
              'Only unresolved participant details can be completed.',
            );
          }
          const contact = {
            contactName: details.contactName,
            contactEmail: details.contactEmail,
            contactCompany: details.contactCompany,
            contactPosition: details.contactPosition,
            contactPhone: details.contactPhone,
          };
          return {
            ...reconciled,
            source: {
              ...reconciled.source,
              ...contact,
              identitySource: 'named_participant' as const,
            },
          };
        });
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
        // Serialize assignments within each order, including partial imports.
        const orderIds = [
          ...new Set(relevantRows.map(({ source }) => source.orderExternalId)),
        ].sort();
        for (const orderId of orderIds) {
          await acquireTransactionLock(
            transaction,
            `ticket-import-order:${eventId}:${orderId}`,
          );
        }
        const assignedContacts = await transaction
          .select({
            externalId: schema.ticketSourceParticipants.externalId,
            orderExternalId: schema.ticketSourceParticipants.orderExternalId,
            email: schema.users.email,
          })
          .from(schema.ticketSourceParticipants)
          .innerJoin(
            schema.users,
            eq(schema.users.id, schema.ticketSourceParticipants.userId),
          )
          .where(
            and(
              eq(schema.ticketSourceParticipants.eventId, eventId),
              inArray(
                schema.ticketSourceParticipants.orderExternalId,
                orderIds,
              ),
            ),
          );
        for (const { source } of relevantRows) {
          const duplicateSelected = relevantRows.some(
            ({ source: other }) =>
              other.externalId !== source.externalId &&
              other.orderExternalId === source.orderExternalId &&
              other.contactEmail === source.contactEmail,
          );
          const duplicateAssigned = assignedContacts.some(
            (other) =>
              other.externalId !== source.externalId &&
              other.orderExternalId === source.orderExternalId &&
              other.email.toLowerCase() === source.contactEmail,
          );
          const duplicateReserved = snapshot.records.some(
            (other) =>
              other.externalId !== source.externalId &&
              other.orderExternalId === source.orderExternalId &&
              other.sourceStatus === 'paid' &&
              other.identitySource !== 'manual_review' &&
              other.contactEmail === source.contactEmail,
          );
          if (duplicateSelected || duplicateAssigned || duplicateReserved) {
            throw previewBlocked(
              'Each participant in an order must have their own email address.',
            );
          }
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
            .select({
              externalId: schema.ticketSourceParticipants.externalId,
              id: schema.ticketSourceParticipants.id,
              userId: schema.ticketSourceParticipants.userId,
              version: schema.ticketSourceParticipants.version,
              orderExternalId: schema.ticketSourceParticipants.orderExternalId,
              importBatchId: schema.ticketSourceParticipants.importBatchId,
              email: schema.users.email,
              membershipStatus: schema.eventMemberships.status,
            })
            .from(schema.ticketSourceParticipants)
            .innerJoin(
              schema.users,
              eq(schema.users.id, schema.ticketSourceParticipants.userId),
            )
            .innerJoin(
              schema.eventMemberships,
              and(
                eq(
                  schema.eventMemberships.eventId,
                  schema.ticketSourceParticipants.eventId,
                ),
                eq(
                  schema.eventMemberships.userId,
                  schema.ticketSourceParticipants.userId,
                ),
              ),
            )
            .where(
              and(
                eq(schema.ticketSourceParticipants.eventId, eventId),
                inArray(
                  schema.ticketSourceParticipants.externalId,
                  externalIds,
                ),
              ),
            )
            .for('update'),
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
        const existing = new Map(imported.map((row) => [row.externalId, row]));
        const legacyIds = new Set(legacyTickets.map((row) => row.externalId));
        for (const { source } of relevantRows) {
          const current = existing.get(source.externalId);
          const expectedReference =
            batch.mapping[identityRepairMappingKey(source.externalId)];
          if (
            legacyIds.has(source.externalId) ||
            (expectedReference
              ? !current ||
                participantReferenceDigest(current) !== expectedReference ||
                current.orderExternalId !== source.orderExternalId ||
                current.membershipStatus !== 'active' ||
                current.email.toLowerCase() === source.contactEmail ||
                source.identitySource !== 'named_participant' ||
                source.orderTicketCount < 2
              : current !== undefined)
          ) {
            throw new TicketImportStaleError(PREVIEW_VERSION);
          }
        }
        const newRows = relevantRows;
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
          const profile = await transaction.query.participantProfiles.findFirst(
            {
              columns: { userId: true },
              where: and(
                eq(schema.participantProfiles.eventId, eventId),
                eq(schema.participantProfiles.userId, user.id),
              ),
            },
          );
          if (!profile) {
            const name = participantNameFrom(source.contactName);
            await transaction.insert(schema.participantProfiles).values({
              eventId,
              userId: user.id,
              ...name,
              contactEmail: email,
              company: source.contactCompany,
              jobTitle: source.contactPosition,
              phone:
                source.contactPhone &&
                /^\+[1-9]\d{7,14}$/.test(source.contactPhone)
                  ? source.contactPhone
                  : null,
              networkingEnabled: false,
              createdAt: appliedAt,
              updatedAt: appliedAt,
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
          const previous = existing.get(source.externalId);
          if (previous) {
            const updated = await transaction
              .update(schema.ticketSourceParticipants)
              .set({
                userId: user.id,
                importBatchId: batch.id,
                version: previous.version + 1,
                updatedAt: appliedAt,
              })
              .where(
                and(
                  eq(schema.ticketSourceParticipants.eventId, eventId),
                  eq(schema.ticketSourceParticipants.id, previous.id),
                  eq(schema.ticketSourceParticipants.userId, previous.userId),
                  eq(schema.ticketSourceParticipants.version, previous.version),
                ),
              )
              .returning({ id: schema.ticketSourceParticipants.id });
            if (updated.length !== 1)
              throw new TicketImportStaleError(PREVIEW_VERSION);
            await writeAuditLog(
              transaction,
              {
                eventId,
                actorId: identity.user.id,
                actorType: 'user',
                action: 'ticket_import.participant_reassigned',
                targetType: 'ticket_source_participant',
                targetId: previous.id,
                requestId: uuidSchema.safeParse(requestId).success
                  ? requestId
                  : generateId(),
                reason: parsed.data.reason,
                before: {
                  userId: previous.userId,
                  version: previous.version,
                  importBatchId: previous.importBatchId,
                },
                after: {
                  userId: user.id,
                  version: previous.version + 1,
                  importBatchId: batch.id,
                  emailSent: false,
                },
              },
              { generateId },
            );
          } else {
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
              selectedRowIds: parsed.data.selectedRowIds,
              selectedCount: parsed.data.selectedRowIds.length,
              created: newRows.length,
              identityRepaired: existing.size,
              manuallyCompletedRowIds: [...detailsByRowId.keys()],
              completionDigest: completionDigest(
                parsed.data.participantDetails,
              ),
              statusChanged: 0,
              unchanged: 0,
              skipped: summary.data.total - parsed.data.selectedRowIds.length,
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
          selectedRowIds: parsed.data.selectedRowIds,
          outcome: 'applied',
          result: {
            created: newRows.length,
            statusChanged: 0,
            unchanged: 0,
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
