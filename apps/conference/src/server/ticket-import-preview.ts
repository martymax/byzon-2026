import { createHash } from 'node:crypto';

import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  withTransaction,
  writeAuditLog,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import {
  ticketImportCachePolicy,
  ticketImportPreviewRequestSchema,
  ticketImportPreviewResponseSchema,
  type TicketImportPreviewResponse,
  type TicketImportRow,
  type TicketImportSummary,
} from '@byzon/domain/contracts/ticket-import';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { rateLimitHeaders, type RateLimitDecision } from './api/rate-limit';
import { CURRENT_EVENT_SLUG } from './current-event';
import { EventAccessDeniedError, requireEventPermission } from './policy';
import {
  SimpleShopTicketSourceError,
  type SimpleShopTicketSourceAdapter,
  type SimpleShopTicketSourceRecord,
  type SimpleShopTicketSourceSnapshot,
} from './simpleshop-ticket-source';
import type { SimpleShopPreviewRateLimiter } from './simpleshop-preview-rate-limit';

const REQUEST_MAX_BYTES = 1_024;
const PREVIEW_TTL_MS = 20 * 60 * 1_000;
const uuidSchema = z.string().uuid();

type ExistingTicketStatus =
  'valid' | 'activated' | 'cancelled' | 'refunded' | 'transferred' | 'blocked';

export interface ExistingTicketRecord {
  readonly externalId: string;
  readonly status: ExistingTicketStatus;
}

interface PersistedPreviewRow {
  readonly id: string;
  readonly source: Pick<
    SimpleShopTicketSourceRecord,
    'sourceRowNumber' | 'externalId' | 'orderExternalId' | 'sourceStatus'
  >;
  readonly preview: Pick<TicketImportRow, 'incomingState' | 'issues'>;
}

export interface TicketImportPreviewStore {
  readonly authorize: (eventId: string, actorId: string) => Promise<void>;
  readonly loadExisting: (
    eventId: string,
    externalIds: readonly string[],
  ) => Promise<readonly ExistingTicketRecord[]>;
  readonly savePreview: (input: {
    eventId: string;
    actorId: string;
    requestId: string;
    previewId: string;
    snapshot: Pick<SimpleShopTicketSourceSnapshot, 'source' | 'snapshotDigest'>;
    rows: readonly PersistedPreviewRow[];
    summary: TicketImportSummary;
    createdAt: Date;
  }) => Promise<void>;
}

export interface TicketImportPreviewDependencies {
  readonly allowedOrigin: string;
  readonly getSession: (
    headers: Headers,
  ) => Promise<{ user: { id: string } } | null>;
  readonly sourceAdapter: SimpleShopTicketSourceAdapter;
  readonly store: TicketImportPreviewStore;
  readonly rateLimit?: SimpleShopPreviewRateLimiter;
  readonly now?: () => Date;
  readonly generateId?: () => string;
}

class TicketImportAccessDeniedError extends Error {
  constructor() {
    super('Ticket import access denied');
    this.name = 'TicketImportAccessDeniedError';
  }
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
    'The SimpleShop preview request or source data is invalid.',
    fieldErrors,
  );

const sourceProblem = (error: SimpleShopTicketSourceError): ApiProblemError => {
  switch (error.code) {
    case 'timeout':
      return apiProblem(
        504,
        'IMPORT_SOURCE_TIMEOUT',
        'Ticket source timed out',
        'The ticket source did not respond in time.',
      );
    case 'record_limit_exceeded':
      return validationFailed({
        source: ['The source exceeds the bounded preview record limit.'],
      });
    case 'invalid_payload':
    case 'response_too_large':
    case 'invalid_target':
    case 'method_not_allowed':
      return apiProblem(
        502,
        'IMPORT_SOURCE_INVALID',
        'Ticket source response is invalid',
        'The ticket source returned an unsupported or unsafe response.',
      );
    case 'credentials_missing':
    case 'unavailable':
      return apiProblem(
        502,
        'IMPORT_SOURCE_UNAVAILABLE',
        'Ticket source is unavailable',
        'The ticket source could not be read.',
      );
  }
};

const privateHeaders = (
  requestId: string,
  contentType: string,
  extra: Record<string, string> = {},
) =>
  new Headers({
    ...extra,
    'cache-control': ticketImportCachePolicy.cacheControl,
    'content-type': contentType,
    vary: 'Authorization, Cookie',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  });

const withRateLimitHeaders = (
  response: Response,
  decision: RateLimitDecision | null,
): Response => {
  if (!decision) return response;
  for (const [name, value] of Object.entries(rateLimitHeaders(decision))) {
    response.headers.set(name, value);
  }
  return response;
};

const privateProblemResponse = (
  error: unknown,
  requestId: string,
): Response => {
  const mapped =
    error instanceof SimpleShopTicketSourceError
      ? sourceProblem(error)
      : error instanceof TicketImportAccessDeniedError ||
          error instanceof EventAccessDeniedError
        ? accessDenied()
        : error;
  const response = problemResponse(mapped, requestId);
  response.headers.set('cache-control', ticketImportCachePolicy.cacheControl);
  response.headers.set('vary', 'Authorization, Cookie');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
};

const readBoundedJson = async (request: Request): Promise<unknown> => {
  const declared = request.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > REQUEST_MAX_BYTES)
  ) {
    throw validationFailed({ body: ['The request body is too large.'] });
  }
  const reader = request.body?.getReader();
  if (!reader) throw validationFailed();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > REQUEST_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw validationFailed({ body: ['The request body is too large.'] });
    }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw validationFailed();
  }
};

const requireTransport = (request: Request, allowedOrigin: string): void => {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0];
  if (request.method !== 'POST') throw validationFailed();
  if (request.headers.get('origin') !== allowedOrigin) throw accessDenied();
  if (
    new URL(request.url).search !== '' ||
    request.headers.has('idempotency-key') ||
    request.headers.has('if-match') ||
    contentType?.trim().toLowerCase() !== 'application/json'
  ) {
    throw validationFailed();
  }
};

const currentStateFor = (
  status: ExistingTicketStatus,
): TicketImportRow['currentState'] => {
  switch (status) {
    case 'valid':
    case 'activated':
      return 'active';
    case 'blocked':
      return 'blocked';
    case 'cancelled':
      return 'cancelled';
    case 'refunded':
      return 'refunded';
    case 'transferred':
      return null;
  }
};

const referenceSuffix = (rowId: string): string =>
  rowId.replaceAll('-', '').slice(-6).toUpperCase();

const rowFor = (
  source: SimpleShopTicketSourceRecord,
  existing: ExistingTicketRecord | undefined,
  rowId: string,
): TicketImportRow => {
  const suffix = referenceSuffix(rowId);
  const currentState = existing ? currentStateFor(existing.status) : null;
  const participant = {
    referenceSuffix: suffix,
    sourceTicketId: source.externalId,
    sourceOrderId: source.orderExternalId,
    contactName: source.contactName,
    contactEmail: source.contactEmail,
    contactCompany: source.contactCompany,
    contactPosition: source.contactPosition,
    contactPhone: source.contactPhone,
    identitySource: source.identitySource,
  } as const;
  const identityIssue = {
    code: 'participant_identity_manual_review' as const,
    message:
      'Chybí potvrzený účastnický e-mail; kontakt kupujícího slouží pouze pro ruční dořešení.',
  };
  if (source.sourceStatus !== 'paid') {
    return {
      rowId,
      sourceRowNumber: source.sourceRowNumber,
      ...participant,
      sourceStatus: source.sourceStatus,
      status: 'unknown',
      incomingState: null,
      currentState,
      issues: [
        {
          code: 'unknown_status',
          message: 'Zdrojový stav nemá schválené mapování pro apply.',
        },
        ...(source.identitySource === 'manual_review' ? [identityIssue] : []),
      ],
    };
  }
  if (source.identitySource === 'manual_review') {
    return {
      rowId,
      sourceRowNumber: source.sourceRowNumber,
      ...participant,
      sourceStatus: source.sourceStatus,
      status: 'conflict',
      incomingState: null,
      currentState,
      issues: [identityIssue],
    };
  }
  if (!existing) {
    return {
      rowId,
      sourceRowNumber: source.sourceRowNumber,
      ...participant,
      sourceStatus: source.sourceStatus,
      status: 'new',
      incomingState: 'active',
      currentState: null,
      issues: [],
    };
  }
  if (currentState === 'active') {
    return {
      rowId,
      sourceRowNumber: source.sourceRowNumber,
      ...participant,
      sourceStatus: source.sourceStatus,
      status: 'unchanged',
      incomingState: 'active',
      currentState,
      issues: [],
    };
  }
  return {
    rowId,
    sourceRowNumber: source.sourceRowNumber,
    ...participant,
    sourceStatus: source.sourceStatus,
    status: 'conflict',
    incomingState: 'active',
    currentState,
    issues: [
      {
        code: 'state_conflict',
        message: 'Existující ticket má stav, který preview nesmí přepsat.',
      },
    ],
  };
};

const summaryFor = (rows: readonly TicketImportRow[]): TicketImportSummary => ({
  total: rows.length,
  new: rows.filter(({ status }) => status === 'new').length,
  unchanged: rows.filter(({ status }) => status === 'unchanged').length,
  statusChanged: rows.filter(({ status }) => status === 'status_changed')
    .length,
  conflict: rows.filter(({ status }) => status === 'conflict').length,
  unknown: rows.filter(({ status }) => status === 'unknown').length,
});

export const buildTicketImportPreview = (input: {
  readonly eventId: string;
  readonly previewId: string;
  readonly createdAt: Date;
  readonly snapshot: SimpleShopTicketSourceSnapshot;
  readonly existing: readonly ExistingTicketRecord[];
  readonly generateId: () => string;
}): {
  response: TicketImportPreviewResponse;
  rows: readonly PersistedPreviewRow[];
} => {
  const existingById = new Map<string, ExistingTicketRecord>();
  for (const ticket of input.existing) {
    if (existingById.has(ticket.externalId)) {
      throw validationFailed({
        source: ['Existing ticket reference is ambiguous.'],
      });
    }
    existingById.set(ticket.externalId, ticket);
  }
  const rows = input.snapshot.records.map((source) => {
    const id = input.generateId();
    const preview = rowFor(source, existingById.get(source.externalId), id);
    return {
      id,
      source: {
        sourceRowNumber: source.sourceRowNumber,
        externalId: source.externalId,
        orderExternalId: source.orderExternalId,
        sourceStatus: source.sourceStatus,
      },
      preview,
    };
  });
  const previewRows = rows.map(({ preview }) => preview);
  const response = ticketImportPreviewResponseSchema.parse({
    eventId: input.eventId,
    previewId: input.previewId,
    previewVersion: 1,
    source: input.snapshot.source,
    createdAt: input.createdAt.toISOString(),
    expiresAt: new Date(
      input.createdAt.getTime() + PREVIEW_TTL_MS,
    ).toISOString(),
    rows: previewRows,
    summary: summaryFor(previewRows),
  });
  return {
    response,
    rows: rows.map(({ id, source, preview }) => ({
      id,
      source,
      preview: {
        incomingState: preview.incomingState,
        issues: preview.issues,
      },
    })),
  };
};

const requireDatabaseAccess = async (
  db: Database | DatabaseTransaction,
  eventId: string,
  actorId: string,
  currentEventSlug: string,
): Promise<void> => {
  const event = await db.query.events.findFirst({
    columns: { id: true },
    where: and(
      eq(schema.events.id, eventId),
      eq(schema.events.slug, currentEventSlug),
    ),
  });
  if (!event) throw new TicketImportAccessDeniedError();
  try {
    await requireEventPermission(
      db,
      { userId: actorId },
      eventId,
      'ticket:any:manage',
    );
  } catch (error) {
    if (error instanceof EventAccessDeniedError) {
      throw new TicketImportAccessDeniedError();
    }
    throw error;
  }
};

export const createDatabaseTicketImportPreviewStore = (
  db: Database,
  options: {
    readonly currentEventSlug?: string;
    readonly generateId?: () => string;
  } = {},
): TicketImportPreviewStore => {
  const currentEventSlug = options.currentEventSlug ?? CURRENT_EVENT_SLUG;
  const generateId = options.generateId ?? generateUuidV7;
  return {
    authorize: (eventId, actorId) =>
      requireDatabaseAccess(db, eventId, actorId, currentEventSlug),
    loadExisting: async (eventId, externalIds) => {
      if (externalIds.length === 0) return [];
      const rows = await db
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
        );
      return rows.flatMap(({ externalId, status }) =>
        externalId === null ? [] : [{ externalId, status }],
      );
    },
    savePreview: async (input) => {
      await withTransaction(db, async (transaction) => {
        await acquireTransactionLock(
          transaction,
          `ticket-import-preview:${input.eventId}:${input.actorId}`,
        );
        await requireDatabaseAccess(
          transaction,
          input.eventId,
          input.actorId,
          currentEventSlug,
        );
        const fileSha256 = createHash('sha256')
          .update(input.snapshot.snapshotDigest, 'utf8')
          .update('\0', 'utf8')
          .update(input.previewId, 'utf8')
          .digest('hex');
        await transaction.insert(schema.ticketImportBatches).values({
          id: input.previewId,
          eventId: input.eventId,
          source: 'simpleshop_api',
          sourceFilename: 'simpleshop-product-143958-form-0MnNQ',
          fileSha256,
          status: 'validated',
          rowCount: input.rows.length,
          summary: input.summary,
          mapping: {
            paid: 'active',
            unpaid: 'unapproved',
            cancelled: 'unapproved',
            refunded: 'not_observed',
            unknown: 'unapproved',
          },
          createdBy: input.actorId,
          validatedAt: input.createdAt,
          createdAt: input.createdAt,
          updatedAt: input.createdAt,
        });
        await transaction.insert(schema.ticketImportRows).values(
          input.rows.map(({ id, preview, source }) => ({
            id,
            eventId: input.eventId,
            batchId: input.previewId,
            rowNumber: source.sourceRowNumber,
            externalId: source.externalId,
            orderExternalId: source.orderExternalId,
            codeHmac: null,
            codeSuffix: null,
            sourceStatus: source.sourceStatus,
            mappedStatus:
              preview.incomingState === 'active' ? ('valid' as const) : null,
            validationErrors: preview.issues.map(({ code }) => code),
            createdAt: input.createdAt,
          })),
        );
        await writeAuditLog(
          transaction,
          {
            eventId: input.eventId,
            actorId: input.actorId,
            actorType: 'user',
            action: 'ticket_import.preview_created',
            targetType: 'ticket_import_batch',
            targetId: input.previewId,
            requestId: input.requestId,
            after: {
              source: 'simpleshop_api',
              productId: input.snapshot.source.productId,
              sourceRows: input.snapshot.source.sourceRows,
              ticketRows: input.snapshot.source.ticketRows,
              observedStatuses: input.snapshot.source.observedStatuses,
              summary: input.summary,
              applyAvailable: false,
            },
          },
          { generateId },
        );
      });
    },
  };
};

export const previewSimpleShopTickets = async (
  request: Request,
  eventId: string,
  dependencies: TicketImportPreviewDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  let rateLimitDecision: RateLimitDecision | null = null;
  try {
    requireTransport(request, dependencies.allowedOrigin);
    if (!uuidSchema.safeParse(eventId).success) throw accessDenied();
    const session = await dependencies.getSession(request.headers);
    if (!session || !uuidSchema.safeParse(session.user.id).success) {
      throw authenticationRequired();
    }
    const body = ticketImportPreviewRequestSchema.safeParse(
      await readBoundedJson(request),
    );
    if (!body.success) {
      throw validationFailed(
        Object.fromEntries(
          body.error.issues.map((issue) => [
            issue.path.join('.') || 'body',
            [issue.message],
          ]),
        ),
      );
    }
    await dependencies.store.authorize(eventId, session.user.id);
    rateLimitDecision =
      (await dependencies.rateLimit?.(session.user.id)) ?? null;
    const snapshot = await dependencies.sourceAdapter.fetchPreviewSource();
    const existing = await dependencies.store.loadExisting(
      eventId,
      snapshot.records.map(({ externalId }) => externalId),
    );
    const createdAt = dependencies.now?.() ?? new Date();
    const generateId = dependencies.generateId ?? generateUuidV7;
    const previewId = generateId();
    const built = buildTicketImportPreview({
      eventId,
      previewId,
      createdAt,
      snapshot,
      existing,
      generateId,
    });
    await dependencies.store.savePreview({
      eventId,
      actorId: session.user.id,
      requestId: uuidSchema.safeParse(requestId).success
        ? requestId
        : generateId(),
      previewId,
      snapshot: {
        source: snapshot.source,
        snapshotDigest: snapshot.snapshotDigest,
      },
      rows: built.rows,
      summary: built.response.summary,
      createdAt,
    });
    return withRateLimitHeaders(
      new Response(JSON.stringify(built.response), {
        headers: privateHeaders(requestId, 'application/json'),
      }),
      rateLimitDecision,
    );
  } catch (error) {
    return withRateLimitHeaders(
      privateProblemResponse(error, requestId),
      rateLimitDecision,
    );
  }
};
