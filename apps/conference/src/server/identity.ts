import { createHash } from 'node:crypto';

import {
  acquireTransactionLock,
  generateUuidV7,
  schema,
  writeAuditLog,
  withTransaction,
  type Database,
} from '@byzon/database';
import {
  idempotencyKeySchema,
  identityBootstrapResponseSchema,
  identityOnboardingRequestSchema,
  identityOnboardingResponseSchema,
  identityPrivacyRequestRequestSchema,
  identityPrivacyRequestResponseSchema,
  identityProfileUpdateRequestSchema,
  identityProfileUpdateResponseSchema,
  identityRoleSchema,
  identitySessionActionRequestSchema,
  identitySessionActionResponseSchema,
  type IdentityBootstrapResponse,
  type IdentityLegalAcknowledgement,
  type IdentityLegalDocument,
  type IdentityOnboardingResponse,
  type IdentityPrivacyRequestResponse,
  type IdentityProfileUpdateResponse,
  type IdentitySessionActionResponse,
} from '@byzon/domain/contracts';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import type { z } from 'zod';

import {
  executeIdempotentMutation,
  hashIdempotencyKey,
  hashIdempotencyRequest,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import { completeOnboardingInTransaction, OnboardingError } from './onboarding';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const MAX_IDENTITY_BODY_BYTES = 16_384;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
export const IDENTITY_SUPPORT_EMAIL = 'jsem@byzon.cz';

interface SessionIdentity {
  user: { id: string; email: string };
  session?: { id: string };
}

export interface IdentityDependencies {
  db: Database;
  allowedOrigin: string;
  getSession(headers: Headers): Promise<SessionIdentity | null>;
  currentEventSlug?: string;
  supportEmail?: string;
  now?: () => Date;
  generateId?: () => string;
}

interface AuthRequestHandler {
  handler(request: Request): Promise<Response>;
}

export interface IdentitySessionActionDependencies extends IdentityDependencies {
  auth: AuthRequestHandler;
}

type IdentityEvent = typeof schema.events.$inferSelect;
type IdentityMembership = typeof schema.eventMemberships.$inferSelect;

interface IdentityContext {
  event: IdentityEvent;
  membership: IdentityMembership;
}

const problem = (
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

class StaleProfileVersionError extends ApiProblemError {
  constructor(override readonly currentVersion: number) {
    super({
      status: 409,
      code: 'STALE_VERSION',
      title: 'Profile version changed',
      detail: 'Reload the profile before saving changes.',
    });
  }
}

const identityProblemResponse = (
  error: unknown,
  requestId: string,
): Response => {
  const response = problemResponse(error, requestId);
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('vary', 'Authorization, Cookie');
  return response;
};

const staleProfileResponse = (
  error: StaleProfileVersionError,
  requestId: string,
): Response => {
  const response = identityProblemResponse(error, requestId);
  return new Response(
    JSON.stringify({
      type: 'urn:byzon:problem:stale-version',
      title: error.title,
      status: error.status,
      code: error.code,
      detail: error.detail,
      requestId,
      currentVersion: error.currentVersion,
    }),
    { status: response.status, headers: response.headers },
  );
};

const authenticationRequired = (): ApiProblemError =>
  problem(
    401,
    'AUTHENTICATION_REQUIRED',
    'Authentication required',
    'A valid session is required.',
  );

const eventAccessDenied = (): ApiProblemError =>
  problem(
    403,
    'EVENT_ACCESS_DENIED',
    'Event access denied',
    'The event resource is not available for this account.',
  );

const validationFailed = (
  fieldErrors: Record<string, string[]> = {
    body: ['The request is invalid.'],
  },
): ApiProblemError =>
  problem(
    422,
    'VALIDATION_FAILED',
    'Validation failed',
    'The request does not satisfy the identity contract.',
    fieldErrors,
  );

const zodFieldErrors = (error: z.ZodError): Record<string, string[]> => {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues.slice(0, 50)) {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'body';
    const messages = result[path] ?? [];
    if (messages.length < 10) messages.push(issue.message.slice(0, 512));
    result[path] = messages;
  }
  return Object.keys(result).length > 0
    ? result
    : { body: ['The request is invalid.'] };
};

const requireSession = async (
  request: Request,
  dependencies: IdentityDependencies,
): Promise<SessionIdentity> => {
  const session = await dependencies.getSession(request.headers);
  if (!session) throw authenticationRequired();
  return session;
};

const loadIdentityContext = async (
  db: Database,
  userId: string,
  eventSlug: string,
): Promise<IdentityContext> => {
  const event = await db.query.events.findFirst({
    where: eq(schema.events.slug, eventSlug),
  });
  if (!event) throw eventAccessDenied();
  const membership = await db.query.eventMemberships.findFirst({
    where: and(
      eq(schema.eventMemberships.eventId, event.id),
      eq(schema.eventMemberships.userId, userId),
    ),
  });
  if (!membership) throw eventAccessDenied();
  return { event, membership };
};

const requireOwnPermission = async (
  dependencies: IdentityDependencies,
  context: IdentityContext,
  userId: string,
  permission: 'profile:own:write' | 'privacy:own:write',
): Promise<void> => {
  if (context.membership.status !== 'active') throw eventAccessDenied();
  try {
    await requireEventPermission(
      dependencies.db,
      { userId },
      context.event.id,
      permission,
      { ownsResource: true },
    );
  } catch (error) {
    if (!(error instanceof EventAccessDeniedError)) throw error;
    throw eventAccessDenied();
  }
};

const requireMutationOrigin = (
  request: Request,
  dependencies: IdentityDependencies,
): void => {
  if (request.headers.get('origin') !== dependencies.allowedOrigin) {
    throw eventAccessDenied();
  }
};

const requireCleanMutationTransport = (
  request: Request,
  idempotency: 'required' | 'forbidden',
): string | null => {
  const url = new URL(request.url);
  const contentType = request.headers.get('content-type')?.split(';', 1)[0];
  const key = request.headers.get('idempotency-key');
  if (
    url.search.length > 0 ||
    request.headers.has('if-match') ||
    contentType?.trim().toLowerCase() !== 'application/json' ||
    (idempotency === 'forbidden' && key !== null)
  ) {
    throw validationFailed();
  }
  if (idempotency === 'required') {
    const parsed = idempotencyKeySchema.safeParse(key);
    if (!parsed.success) {
      throw validationFailed({
        idempotencyKey: ['A valid Idempotency-Key header is required.'],
      });
    }
    return parsed.data;
  }
  return null;
};

const readBoundedJson = async (
  request: Request,
): Promise<{ raw: string; value: unknown }> => {
  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > MAX_IDENTITY_BODY_BYTES)
  ) {
    throw validationFailed({ body: ['The request body is too large.'] });
  }

  const reader = request.body?.getReader();
  if (!reader) throw validationFailed();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IDENTITY_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw validationFailed({ body: ['The request body is too large.'] });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { raw, value: JSON.parse(raw) as unknown };
  } catch {
    throw validationFailed({ body: ['The request body must be valid JSON.'] });
  }
};

const successResponse = (
  body: Record<string, unknown>,
  requestId: string,
  status = 200,
  additionalHeaders?: HeadersInit,
): Response => {
  const headers = new Headers(additionalHeaders);
  headers.set('cache-control', 'private, no-store');
  headers.set('content-type', 'application/json');
  headers.set('vary', 'Authorization, Cookie');
  headers.set('x-request-id', requestId);
  return new Response(JSON.stringify(body), { status, headers });
};

const legalPreview = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, 2_048);

const projectLegalDocument = (
  document: typeof schema.legalDocuments.$inferSelect,
): IdentityLegalDocument | null => {
  const content = document.content?.trim();
  const candidate = {
    id: document.id,
    type: document.type,
    version: document.version,
    title: document.title,
    publication: 'published' as const,
    publishedAt: document.publishedAt.toISOString(),
    previewText: legalPreview(content || document.title),
    content: content
      ? { kind: 'inline' as const, text: content }
      : { kind: 'external' as const, url: document.contentUrl },
  };
  const parsed =
    identityBootstrapResponseSchema.shape.legalDocuments.element.safeParse(
      candidate,
    );
  return parsed.success ? parsed.data : null;
};

const effectiveAcknowledgements = (
  documents: readonly IdentityLegalDocument[],
  records: readonly (typeof schema.consentRecords.$inferSelect)[],
): IdentityLegalAcknowledgement[] => {
  const currentById = new Map(
    documents.map((document) => [document.id, document]),
  );
  const latest = new Map<string, (typeof records)[number]>();
  for (const record of records) {
    if (!latest.has(record.legalDocumentId)) {
      latest.set(record.legalDocumentId, record);
    }
  }
  return [...latest.values()]
    .flatMap((record) => {
      const document = currentById.get(record.legalDocumentId);
      const expected: IdentityLegalAcknowledgement['decision'] =
        document?.type === 'terms' ? 'accepted' : 'acknowledged';
      if (!document || record.decision !== expected) return [];
      return [
        {
          documentId: document.id,
          type: document.type,
          decision: expected,
          version: document.version,
          acknowledgedAt: record.recordedAt.toISOString(),
        },
      ];
    })
    .sort((left, right) => left.type.localeCompare(right.type));
};

const membershipAccess = (membership: IdentityMembership) => {
  if (membership.status === 'active') return { state: 'active' as const };
  return {
    state: membership.status,
    supportReference: `event-access-${membership.status}`,
  } as const;
};

export const loadIdentityBootstrap = async (
  dependencies: IdentityDependencies,
  session: SessionIdentity,
): Promise<IdentityBootstrapResponse> => {
  const context = await loadIdentityContext(
    dependencies.db,
    session.user.id,
    dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
  );
  const eventId = context.event.id;
  const [feature, profile, legalRows, consentRows, roleRows, privacyRequest] =
    await Promise.all([
      dependencies.db.query.eventFeatures.findFirst({
        where: eq(schema.eventFeatures.eventId, eventId),
      }),
      dependencies.db.query.participantProfiles.findFirst({
        where: and(
          eq(schema.participantProfiles.eventId, eventId),
          eq(schema.participantProfiles.userId, session.user.id),
        ),
      }),
      dependencies.db.query.legalDocuments.findMany({
        where: and(
          eq(schema.legalDocuments.eventId, eventId),
          eq(schema.legalDocuments.isCurrent, true),
        ),
      }),
      dependencies.db.query.consentRecords.findMany({
        where: and(
          eq(schema.consentRecords.eventId, eventId),
          eq(schema.consentRecords.userId, session.user.id),
        ),
        orderBy: [
          desc(schema.consentRecords.recordedAt),
          desc(schema.consentRecords.id),
        ],
      }),
      dependencies.db
        .select({ role: schema.eventRoles.role })
        .from(schema.eventRoles)
        .where(
          and(
            eq(schema.eventRoles.eventId, eventId),
            eq(schema.eventRoles.userId, session.user.id),
            isNull(schema.eventRoles.revokedAt),
          ),
        ),
      dependencies.db.query.privacyRequests.findFirst({
        where: and(
          eq(schema.privacyRequests.eventId, eventId),
          eq(schema.privacyRequests.userId, session.user.id),
          eq(schema.privacyRequests.kind, 'data_deletion'),
        ),
      }),
    ]);

  const legalDocuments = legalRows
    .map(projectLegalDocument)
    .filter((document): document is IdentityLegalDocument => document !== null)
    .sort((left, right) => left.type.localeCompare(right.type));
  const legalAcknowledgements = effectiveAcknowledgements(
    legalDocuments,
    consentRows,
  );
  const currentDocumentByType = new Map(
    legalDocuments.map((document) => [document.type, document]),
  );
  const acknowledgementByType = new Map(
    legalAcknowledgements.map((record) => [record.type, record]),
  );
  const roles =
    context.membership.status === 'active'
      ? roleRows
          .flatMap(({ role }) => {
            const parsed = identityRoleSchema.safeParse(role);
            return parsed.success ? [parsed.data] : [];
          })
          .sort()
      : [];
  if (context.membership.status === 'active' && roles.length === 0) {
    throw eventAccessDenied();
  }

  const missingTypes = (['terms', 'privacy_notice'] as const).filter(
    (type) => !currentDocumentByType.has(type),
  );
  const missingAcknowledgements = (['terms', 'privacy_notice'] as const).filter(
    (type) => !acknowledgementByType.has(type),
  );
  const deletionStatus =
    privacyRequest?.status ??
    (context.membership.status === 'active' &&
    context.event.status !== 'archived'
      ? ('available' as const)
      : ('unavailable' as const));
  const removed = deletionStatus === 'completed' && !profile;
  if (deletionStatus === 'completed' && profile) {
    throw new Error('Completed profile deletion retained a profile');
  }
  if (context.event.status === 'archived' && !profile && !removed) {
    throw eventAccessDenied();
  }

  const onboarding = removed
    ? privacyRequest?.resolvedAt
      ? ({
          status: 'complete',
          completedAt: privacyRequest.resolvedAt.toISOString(),
        } as const)
      : (() => {
          throw new Error(
            'Completed profile deletion is missing its timestamp',
          );
        })()
    : !profile
      ? ({ status: 'profile_required' } as const)
      : missingTypes.length > 0
        ? ({ status: 'blocked_missing_legal_documents', missingTypes } as const)
        : missingAcknowledgements.length > 0
          ? ({
              status: 'legal_acknowledgement_required',
              documentTypes: missingAcknowledgements,
            } as const)
          : profile.onboardingCompletedAt
            ? ({
                status: 'complete',
                completedAt: profile.onboardingCompletedAt.toISOString(),
              } as const)
            : (() => {
                throw new Error(
                  'Completed onboarding is missing its timestamp',
                );
              })();

  const profileManagement = removed
    ? ({ state: 'removed' } as const)
    : !profile
      ? ({ state: 'missing' } as const)
      : context.event.status === 'archived'
        ? ({ state: 'read_only' } as const)
        : ({ state: 'editable', version: profile.version } as const);

  return identityBootstrapResponseSchema.parse({
    dataMode: 'live',
    event: {
      id: context.event.id,
      slug: context.event.slug,
      name: context.event.name,
      phase: context.event.status,
      timezone: context.event.timezone,
      startsAt: context.event.startsAt.toISOString(),
      endsAt: context.event.endsAt.toISOString(),
    },
    user: { id: session.user.id, email: session.user.email },
    membership: { access: membershipAccess(context.membership), roles },
    profile: profile
      ? {
          firstName: profile.firstName,
          lastName: profile.lastName,
          contactEmail: profile.contactEmail,
          phone: profile.phone,
        }
      : null,
    profileManagement,
    onboarding,
    legalDocuments,
    legalAcknowledgements,
    features: {
      reservations: false,
      announcements: feature?.announcementsEnabled ?? false,
    },
    unreadCounts: { announcements: 0 },
    privacy: { deletionRequest: deletionStatus },
    supportEmail: dependencies.supportEmail ?? IDENTITY_SUPPORT_EMAIL,
  });
};

export const readIdentityBootstrap = async (
  request: Request,
  dependencies: IdentityDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (new URL(request.url).search.length > 0) throw eventAccessDenied();
    const session = await requireSession(request, dependencies);
    const body = await loadIdentityBootstrap(dependencies, session);
    return successResponse(body, requestId);
  } catch (error) {
    return identityProblemResponse(error, requestId);
  }
};

const requestUuid = (key: string): string => {
  const bytes = Buffer.from(
    createHash('sha256').update(key).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const onboardingProblem = (error: OnboardingError): ApiProblemError => {
  switch (error.code) {
    case 'EVENT_ACCESS_DENIED':
      return eventAccessDenied();
    case 'LEGAL_CONFIGURATION_MISSING':
      return problem(
        503,
        error.code,
        'Legal configuration missing',
        'Current legal documents are not available.',
      );
    case 'STALE_LEGAL_DOCUMENT':
      return problem(
        409,
        error.code,
        'Legal documents changed',
        'Reload the current legal documents before continuing.',
      );
    case 'REQUEST_ID_REUSED':
      return problem(
        409,
        error.code,
        'Onboarding request conflict',
        'The onboarding request was already used for different data.',
      );
    case 'ONBOARDING_NOT_REQUIRED':
      return validationFailed({
        body: [
          'Onboarding is already complete for the current legal versions.',
        ],
      });
    case 'PROFILE_CHANGE_NOT_ALLOWED':
      return validationFailed({
        profile: ['Use the versioned profile endpoint to change the profile.'],
      });
  }
};

export const completeIdentityOnboarding = async (
  request: Request,
  dependencies: IdentityDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    requireMutationOrigin(request, dependencies);
    const session = await requireSession(request, dependencies);
    const context = await loadIdentityContext(
      dependencies.db,
      session.user.id,
      dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
    );
    await requireOwnPermission(
      dependencies,
      context,
      session.user.id,
      'profile:own:write',
    );
    if (context.event.status === 'archived') throw eventAccessDenied();
    const key = requireCleanMutationTransport(request, 'required')!;
    const json = await readBoundedJson(request);
    const parsed = identityOnboardingRequestSchema.safeParse(json.value);
    if (!parsed.success) throw validationFailed(zodFieldErrors(parsed.error));

    const now = dependencies.now?.() ?? new Date();
    const generateId = dependencies.generateId ?? generateUuidV7;
    const transportRequestId = requestUuid(key);
    const input = {
      eventId: context.event.id,
      userId: session.user.id,
      requestId: transportRequestId,
      ...parsed.data.profile,
      phone: parsed.data.profile.phone ?? null,
      termsDocumentId: parsed.data.legal.termsDocumentId,
      privacyNoticeDocumentId: parsed.data.legal.privacyNoticeDocumentId,
    };
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId: context.event.id,
        actorId: session.user.id,
        scope: 'identity.onboarding',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: json.raw,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now,
        generateId,
      },
      async (transaction) => {
        const legalDocuments = await transaction.query.legalDocuments.findMany({
          where: and(
            eq(schema.legalDocuments.eventId, context.event.id),
            eq(schema.legalDocuments.isCurrent, true),
          ),
        });
        const usableTypes = new Set(
          legalDocuments
            .filter((document) => projectLegalDocument(document) !== null)
            .map(({ type }) => type),
        );
        if (!usableTypes.has('terms') || !usableTypes.has('privacy_notice')) {
          throw new OnboardingError('LEGAL_CONFIGURATION_MISSING');
        }

        await completeOnboardingInTransaction(transaction, input, {
          now: () => now,
          generateId,
        });
        const [profile, records] = await Promise.all([
          transaction.query.participantProfiles.findFirst({
            where: and(
              eq(schema.participantProfiles.eventId, context.event.id),
              eq(schema.participantProfiles.userId, session.user.id),
            ),
          }),
          transaction.query.consentRecords.findMany({
            where: and(
              eq(schema.consentRecords.eventId, context.event.id),
              eq(schema.consentRecords.userId, session.user.id),
              eq(schema.consentRecords.requestId, transportRequestId),
            ),
          }),
        ]);
        if (!profile?.onboardingCompletedAt) {
          throw new Error('Onboarding completion was not persisted');
        }
        const documentById = new Map(
          legalDocuments.map((document) => [document.id, document]),
        );
        const body: IdentityOnboardingResponse =
          identityOnboardingResponseSchema.parse({
            state: 'complete',
            continueTo: '/app',
            completedAt: profile.onboardingCompletedAt.toISOString(),
            profile: {
              firstName: profile.firstName,
              lastName: profile.lastName,
              contactEmail: profile.contactEmail,
              phone: profile.phone,
            },
            acknowledgements: records
              .map((record) => {
                const document = documentById.get(record.legalDocumentId);
                if (!document) {
                  throw new Error('Onboarding legal document is missing');
                }
                return {
                  documentId: document.id,
                  type: document.type,
                  decision: record.decision,
                  version: document.version,
                };
              })
              .sort((left, right) => left.type.localeCompare(right.type)),
          });
        return {
          status: 200,
          body,
          resultReference: transportRequestId,
        };
      },
    );
    const body = identityOnboardingResponseSchema.parse(result.body);
    return successResponse(body, requestId, result.status, {
      'idempotency-replayed': result.replayed ? 'true' : 'false',
    });
  } catch (error) {
    return identityProblemResponse(
      error instanceof OnboardingError ? onboardingProblem(error) : error,
      requestId,
    );
  }
};

export const updateIdentityProfile = async (
  request: Request,
  dependencies: IdentityDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    requireMutationOrigin(request, dependencies);
    const session = await requireSession(request, dependencies);
    const context = await loadIdentityContext(
      dependencies.db,
      session.user.id,
      dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
    );
    await requireOwnPermission(
      dependencies,
      context,
      session.user.id,
      'profile:own:write',
    );
    if (context.event.status === 'archived') {
      throw problem(
        409,
        'PROFILE_NOT_EDITABLE',
        'Profile is read-only',
        'The profile cannot be edited for this event.',
      );
    }
    requireCleanMutationTransport(request, 'forbidden');
    const json = await readBoundedJson(request);
    const parsed = identityProfileUpdateRequestSchema.safeParse(json.value);
    if (!parsed.success) throw validationFailed(zodFieldErrors(parsed.error));
    const now = dependencies.now?.() ?? new Date();
    const generateId = dependencies.generateId ?? generateUuidV7;

    const body = await withTransaction(dependencies.db, async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `identity-profile:${context.event.id}:${session.user.id}`,
      );
      const current = await transaction.query.participantProfiles.findFirst({
        where: and(
          eq(schema.participantProfiles.eventId, context.event.id),
          eq(schema.participantProfiles.userId, session.user.id),
        ),
      });
      if (!current) {
        throw problem(
          404,
          'PROFILE_NOT_FOUND',
          'Profile not found',
          'Complete onboarding before editing the profile.',
        );
      }
      if (current.version !== parsed.data.expectedVersion) {
        throw new StaleProfileVersionError(current.version);
      }
      const nextVersion = current.version + 1;
      await transaction
        .update(schema.participantProfiles)
        .set({ ...parsed.data.profile, version: nextVersion, updatedAt: now })
        .where(
          and(
            eq(schema.participantProfiles.eventId, context.event.id),
            eq(schema.participantProfiles.userId, session.user.id),
          ),
        );
      await writeAuditLog(
        transaction,
        {
          eventId: context.event.id,
          actorId: session.user.id,
          actorType: 'user',
          action: 'profile.updated',
          targetType: 'participant_profile',
          targetId: session.user.id,
          requestId: generateId(),
          before: { version: current.version },
          after: { version: nextVersion },
        },
        { generateId },
      );
      return identityProfileUpdateResponseSchema.parse({
        eventId: context.event.id,
        userId: session.user.id,
        profile: parsed.data.profile,
        profileManagement: { state: 'editable', version: nextVersion },
        updatedAt: now.toISOString(),
      });
    });
    return successResponse(body, requestId);
  } catch (error) {
    if (error instanceof StaleProfileVersionError) {
      return staleProfileResponse(error, requestId);
    }
    return identityProblemResponse(error, requestId);
  }
};

export const createIdentityPrivacyRequest = async (
  request: Request,
  dependencies: IdentityDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    requireMutationOrigin(request, dependencies);
    const session = await requireSession(request, dependencies);
    const context = await loadIdentityContext(
      dependencies.db,
      session.user.id,
      dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
    );
    await requireOwnPermission(
      dependencies,
      context,
      session.user.id,
      'privacy:own:write',
    );
    if (context.event.status === 'archived') {
      throw problem(
        409,
        'PRIVACY_REQUEST_UNAVAILABLE',
        'Privacy request unavailable',
        'A new privacy request is not available for this event.',
      );
    }
    const key = requireCleanMutationTransport(request, 'required')!;
    const json = await readBoundedJson(request);
    const parsed = identityPrivacyRequestRequestSchema.safeParse(json.value);
    if (!parsed.success) throw validationFailed(zodFieldErrors(parsed.error));
    const now = dependencies.now?.() ?? new Date();
    const generateId = dependencies.generateId ?? generateUuidV7;
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId: context.event.id,
        actorId: session.user.id,
        scope: 'identity.privacy-request',
        key,
        requestHash: hashIdempotencyRequest({
          method: request.method,
          path: new URL(request.url).pathname,
          body: json.raw,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
        now,
        generateId,
      },
      async (transaction) => {
        await acquireTransactionLock(
          transaction,
          `identity-privacy:${context.event.id}:${session.user.id}:${parsed.data.kind}`,
        );
        const existing = await transaction.query.privacyRequests.findFirst({
          columns: { id: true },
          where: and(
            eq(schema.privacyRequests.eventId, context.event.id),
            eq(schema.privacyRequests.userId, session.user.id),
            eq(schema.privacyRequests.kind, parsed.data.kind),
          ),
        });
        if (existing) {
          throw problem(
            409,
            'PRIVACY_REQUEST_UNAVAILABLE',
            'Privacy request unavailable',
            'A deletion request already exists for this event.',
          );
        }
        const privacyRequestId = generateId();
        await transaction.insert(schema.privacyRequests).values({
          id: privacyRequestId,
          eventId: context.event.id,
          userId: session.user.id,
          kind: parsed.data.kind,
          status: 'pending',
          requestedAt: now,
        });
        await writeAuditLog(
          transaction,
          {
            eventId: context.event.id,
            actorId: session.user.id,
            actorType: 'user',
            action: 'privacy.deletion_requested',
            targetType: 'privacy_request',
            targetId: privacyRequestId,
            requestId: generateId(),
            after: { kind: parsed.data.kind, state: 'pending' },
          },
          { generateId },
        );
        const body: IdentityPrivacyRequestResponse =
          identityPrivacyRequestResponseSchema.parse({
            eventId: context.event.id,
            userId: session.user.id,
            request: {
              id: privacyRequestId,
              kind: parsed.data.kind,
              state: 'pending',
              requestedAt: now.toISOString(),
            },
          });
        return {
          status: 202,
          body,
          resultReference: privacyRequestId,
        };
      },
    );
    const body = identityPrivacyRequestResponseSchema.parse(result.body);
    return successResponse(body, requestId, result.status, {
      'idempotency-replayed': result.replayed ? 'true' : 'false',
    });
  } catch (error) {
    return identityProblemResponse(error, requestId);
  }
};

const sessionActionRejected = (): ApiProblemError =>
  problem(
    409,
    'SESSION_ACTION_REJECTED',
    'Session action rejected',
    'The session action could not be completed safely.',
  );

const cookieClearanceRequest = (request: Request): Request => {
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.delete('content-length');
  headers.delete('content-type');
  headers.delete('idempotency-key');
  return new Request(new URL('/api/auth/sign-out', request.url), {
    method: 'POST',
    headers,
  });
};

const loadSessionActionReplay = async (
  dependencies: IdentitySessionActionDependencies,
  input: {
    eventId: string;
    key: string;
    requestHash: string;
    now: Date;
  },
): Promise<IdentitySessionActionResponse | null> => {
  const rows = await dependencies.db
    .select({
      requestHash: schema.idempotencyKeys.requestHash,
      responseStatus: schema.idempotencyKeys.responseStatus,
      responseBody: schema.idempotencyKeys.responseBody,
    })
    .from(schema.idempotencyKeys)
    .where(
      and(
        eq(schema.idempotencyKeys.eventId, input.eventId),
        eq(schema.idempotencyKeys.scope, 'identity.session-action'),
        eq(schema.idempotencyKeys.key, hashIdempotencyKey(input.key)),
        gt(schema.idempotencyKeys.expiresAt, input.now),
      ),
    )
    .limit(2);
  if (
    rows.length !== 1 ||
    rows[0]!.requestHash !== input.requestHash ||
    rows[0]!.responseStatus === null ||
    rows[0]!.responseStatus < 200 ||
    rows[0]!.responseStatus > 299
  ) {
    return null;
  }
  const parsed = identitySessionActionResponseSchema.safeParse(
    rows[0]!.responseBody,
  );
  return parsed.success ? parsed.data : null;
};

export const performIdentitySessionAction = async (
  request: Request,
  dependencies: IdentitySessionActionDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.headers.get('origin') !== dependencies.allowedOrigin) {
      throw sessionActionRejected();
    }
    const key = requireCleanMutationTransport(request, 'required');
    if (!key) throw sessionActionRejected();
    const json = await readBoundedJson(request);
    const parsed = identitySessionActionRequestSchema.safeParse(json.value);
    if (!parsed.success) throw sessionActionRejected();
    const event = await dependencies.db.query.events.findFirst({
      columns: { id: true },
      where: eq(
        schema.events.slug,
        dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
      ),
    });
    if (!event) throw sessionActionRejected();

    const now = dependencies.now?.() ?? new Date();
    const requestHash = hashIdempotencyRequest({
      method: request.method,
      path: new URL(request.url).pathname,
      body: json.raw,
    });
    const session = await dependencies.getSession(request.headers);
    if (!session) {
      const replay = await loadSessionActionReplay(dependencies, {
        eventId: event.id,
        key,
        requestHash,
        now,
      });
      if (!replay) throw authenticationRequired();
      const cookieClearance = await dependencies.auth.handler(
        cookieClearanceRequest(request),
      );
      if (!cookieClearance.ok) throw sessionActionRejected();
      const response = successResponse(replay, requestId, 200, {
        'idempotency-replayed': 'true',
      });
      for (const cookie of cookieClearance.headers.getSetCookie()) {
        response.headers.append('set-cookie', cookie);
      }
      return response;
    }
    if (!session.session?.id) throw sessionActionRejected();

    const cookieClearance = await dependencies.auth.handler(
      cookieClearanceRequest(request),
    );
    if (!cookieClearance.ok) throw sessionActionRejected();

    const generateId = dependencies.generateId ?? generateUuidV7;
    const result = await executeIdempotentMutation(
      dependencies.db,
      {
        eventId: event.id,
        actorId: session.user.id,
        scope: 'identity.session-action',
        key,
        requestHash,
        ttlMs: IDEMPOTENCY_TTL_MS,
        now,
        generateId,
      },
      async (transaction) => {
        const deleted = await transaction
          .delete(schema.sessions)
          .where(
            parsed.data.action === 'logout_all'
              ? eq(schema.sessions.userId, session.user.id)
              : and(
                  eq(schema.sessions.id, session.session!.id),
                  eq(schema.sessions.userId, session.user.id),
                ),
          )
          .returning({ id: schema.sessions.id });
        if (deleted.length === 0) throw sessionActionRejected();

        await writeAuditLog(
          transaction,
          {
            eventId: event.id,
            actorId: session.user.id,
            actorType: 'user',
            action: `session.${parsed.data.action}`,
            targetType: 'auth_session',
            targetId: session.session!.id,
            requestId: generateId(),
            after: {
              state: 'revoked',
              scope: parsed.data.action === 'logout_all' ? 'all' : 'current',
            },
          },
          { generateId },
        );

        const common = {
          effect: 'completed' as const,
          personalData: { disposition: 'none_present' as const },
        };
        const body: IdentitySessionActionResponse =
          identitySessionActionResponseSchema.parse(
            parsed.data.action === 'logout_current'
              ? {
                  ...common,
                  action: 'logout_current',
                  state: 'signed_out',
                  continueTo: '/',
                }
              : parsed.data.action === 'logout_all'
                ? {
                    ...common,
                    action: 'logout_all',
                    state: 'all_sessions_revoked',
                    continueTo: '/',
                  }
                : {
                    ...common,
                    action: 'switch_account',
                    state: 'account_switch_ready',
                    continueTo: '/prihlaseni?mode=switch&returnTo=%2Fapp',
                  },
          );
        return { status: 200, body, resultReference: parsed.data.action };
      },
    );
    const body = identitySessionActionResponseSchema.parse(result.body);
    const response = successResponse(body, requestId, result.status, {
      'idempotency-replayed': result.replayed ? 'true' : 'false',
    });
    for (const cookie of cookieClearance.headers.getSetCookie()) {
      response.headers.append('set-cookie', cookie);
    }
    return response;
  } catch (error) {
    if (
      error instanceof ApiProblemError &&
      ['IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_IN_PROGRESS'].includes(error.code)
    ) {
      return identityProblemResponse(error, requestId);
    }
    return identityProblemResponse(
      error instanceof ApiProblemError &&
        error.code === 'AUTHENTICATION_REQUIRED'
        ? error
        : error instanceof ApiProblemError &&
            error.code === 'SESSION_ACTION_REJECTED'
          ? error
          : sessionActionRejected(),
      requestId,
    );
  }
};

export type IdentityHandlerResponse =
  | IdentityBootstrapResponse
  | IdentityOnboardingResponse
  | IdentityProfileUpdateResponse
  | IdentityPrivacyRequestResponse
  | IdentitySessionActionResponse;
