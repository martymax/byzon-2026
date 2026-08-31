import {
  acquireTransactionLock,
  schema,
  writeAuditLog,
  type Database,
} from '@byzon/database';
import {
  networkingDirectoryQuerySchema,
  networkingDirectoryResponseSchema,
  networkingDirectoryProfileSchema,
  networkingSettingsSchema,
  networkingSettingsUpdateRequestSchema,
  type NetworkingDirectoryProfile,
} from '@byzon/domain/contracts';
import {
  and,
  arrayContains,
  asc,
  eq,
  gt,
  ilike,
  isNull,
  or,
} from 'drizzle-orm';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const MAX_BODY_BYTES = 16_384;
const uuidSchema = z.string().uuid();

export const networkingVisibilityForOptIn = (
  networkingEnabled: boolean,
): 'directory' | 'hidden' => (networkingEnabled ? 'directory' : 'hidden');

export const projectNetworkingContacts = (
  profile: Pick<
    typeof schema.participantProfiles.$inferSelect,
    'contactEmail' | 'linkedinUrl' | 'phone'
  >,
) => ({
  email: profile.contactEmail,
  phone: profile.phone,
  linkedinUrl: profile.linkedinUrl,
});

interface NetworkingIdentity {
  user: { id: string };
}

export interface NetworkingDependencies {
  db: Database;
  allowedOrigin: string;
  getSession(headers: Headers): Promise<NetworkingIdentity | null>;
  currentEventSlug?: string;
  now?: () => Date;
}

const privateHeaders = (requestId: string): HeadersInit => ({
  'cache-control': 'private, no-store',
  'content-type': 'application/json',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const apiProblem = (
  status: number,
  code: string,
  title: string,
  detail: string,
): ApiProblemError => new ApiProblemError({ status, code, title, detail });

const respondProblem = (error: unknown, requestId: string): Response => {
  const response = problemResponse(error, requestId);
  response.headers.set('cache-control', 'private, no-store');
  response.headers.set('vary', 'Authorization, Cookie');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
};

const readJson = async (request: Request): Promise<unknown> => {
  if (
    request.headers.get('content-type')?.split(';', 1)[0]?.trim() !==
    'application/json'
  ) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Validation failed',
      'JSON is required.',
    );
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Validation failed',
      'The body is too large.',
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw apiProblem(
      422,
      'VALIDATION_FAILED',
      'Validation failed',
      'The body is invalid.',
    );
  }
};

const loadContext = async (
  request: Request,
  dependencies: NetworkingDependencies,
) => {
  const identity = await dependencies.getSession(request.headers);
  if (!identity || !uuidSchema.safeParse(identity.user.id).success) {
    throw apiProblem(
      401,
      'AUTHENTICATION_REQUIRED',
      'Authentication required',
      'A valid session is required.',
    );
  }
  const event = await dependencies.db.query.events.findFirst({
    columns: { id: true, status: true },
    where: eq(
      schema.events.slug,
      dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
    ),
  });
  if (!event || event.status === 'draft' || event.status === 'archived') {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Networking is unavailable.',
    );
  }
  const [feature, membership, profile] = await Promise.all([
    dependencies.db.query.eventFeatures.findFirst({
      columns: { networkingEnabled: true },
      where: eq(schema.eventFeatures.eventId, event.id),
    }),
    dependencies.db.query.eventMemberships.findFirst({
      columns: { status: true },
      where: and(
        eq(schema.eventMemberships.eventId, event.id),
        eq(schema.eventMemberships.userId, identity.user.id),
      ),
    }),
    dependencies.db.query.participantProfiles.findFirst({
      where: and(
        eq(schema.participantProfiles.eventId, event.id),
        eq(schema.participantProfiles.userId, identity.user.id),
      ),
    }),
  ]);
  if (!feature?.networkingEnabled) {
    throw apiProblem(
      409,
      'NETWORKING_DISABLED',
      'Networking disabled',
      'Networking is not enabled for this event.',
    );
  }
  if (membership?.status !== 'active' || !profile) {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Networking is unavailable.',
    );
  }
  return { eventId: event.id, userId: identity.user.id, profile };
};

const projectSettings = (context: Awaited<ReturnType<typeof loadContext>>) =>
  networkingSettingsSchema.parse(
    (() => {
      const networkingEnabled = context.profile.networkingEnabled === true;
      const visibility = networkingVisibilityForOptIn(networkingEnabled);
      return {
        eventId: context.eventId,
        userId: context.userId,
        version: context.profile.version,
        networkingEnabled,
        introduction: context.profile.bio ?? '',
        company: context.profile.company ?? '',
        jobTitle: context.profile.jobTitle ?? '',
        todayHunting: context.profile.todayHunting,
        contactEmail: context.profile.contactEmail,
        phone: context.profile.phone,
        linkedinUrl: context.profile.linkedinUrl,
        emailVisibility: visibility,
        phoneVisibility: visibility,
        linkedinVisibility: visibility,
        updatedAt: context.profile.updatedAt.toISOString(),
      };
    })(),
  );

const requireNetworkingParticipant = async (
  context: Awaited<ReturnType<typeof loadContext>>,
  dependencies: NetworkingDependencies,
): Promise<void> => {
  const participantRole = await dependencies.db.query.eventRoles.findFirst({
    columns: { id: true },
    where: and(
      eq(schema.eventRoles.eventId, context.eventId),
      eq(schema.eventRoles.userId, context.userId),
      eq(schema.eventRoles.role, 'participant'),
      isNull(schema.eventRoles.revokedAt),
    ),
  });
  if (!participantRole) {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Networking is unavailable.',
    );
  }
};

export const handleNetworkingSettings = async (
  request: Request,
  dependencies: NetworkingDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    const context = await loadContext(request, dependencies);
    await requireNetworkingParticipant(context, dependencies);
    await requireEventPermission(
      dependencies.db,
      { userId: context.userId },
      context.eventId,
      'profile:own:write',
      { ownsResource: true },
    );
    if (request.method === 'GET') {
      if (new URL(request.url).search.length > 0) {
        throw apiProblem(
          422,
          'VALIDATION_FAILED',
          'Validation failed',
          'Query parameters are not supported.',
        );
      }
      return Response.json(projectSettings(context), {
        headers: privateHeaders(requestId),
      });
    }
    if (
      request.method !== 'PATCH' ||
      request.headers.get('origin') !== dependencies.allowedOrigin ||
      new URL(request.url).search.length > 0 ||
      request.headers.has('idempotency-key')
    ) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The settings request is invalid.',
      );
    }
    const parsed = networkingSettingsUpdateRequestSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The networking settings are invalid.',
      );
    }
    const now = dependencies.now?.() ?? new Date();
    const body = await dependencies.db.transaction(async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `networking-profile:${context.eventId}:${context.userId}`,
      );
      const current = await transaction.query.participantProfiles.findFirst({
        where: and(
          eq(schema.participantProfiles.eventId, context.eventId),
          eq(schema.participantProfiles.userId, context.userId),
        ),
      });
      if (!current) {
        throw apiProblem(
          404,
          'PROFILE_NOT_FOUND',
          'Profile not found',
          'The profile is unavailable.',
        );
      }
      if (current.version !== parsed.data.expectedVersion) {
        throw apiProblem(
          409,
          'STALE_VERSION',
          'Profile changed',
          'Reload the profile before saving.',
        );
      }
      const version = current.version + 1;
      const visibility = networkingVisibilityForOptIn(
        parsed.data.networkingEnabled,
      );
      await transaction
        .update(schema.participantProfiles)
        .set({
          networkingEnabled: parsed.data.networkingEnabled,
          bio: parsed.data.introduction || null,
          company: parsed.data.company || null,
          jobTitle: parsed.data.jobTitle || null,
          todayHunting: parsed.data.todayHunting,
          contactEmail: parsed.data.contactEmail,
          phone: parsed.data.phone,
          linkedinUrl: parsed.data.linkedinUrl,
          emailVisibility: visibility,
          phoneVisibility: visibility,
          linkedinVisibility: visibility,
          version,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.participantProfiles.eventId, context.eventId),
            eq(schema.participantProfiles.userId, context.userId),
            eq(schema.participantProfiles.version, current.version),
          ),
        );
      await writeAuditLog(transaction, {
        eventId: context.eventId,
        actorId: context.userId,
        actorType: 'user',
        action: parsed.data.networkingEnabled
          ? 'networking.opt_in'
          : 'networking.opt_out',
        targetType: 'participant_profile',
        targetId: context.userId,
        requestId,
        before: {
          enabled: current.networkingEnabled === true,
          version: current.version,
        },
        after: { enabled: parsed.data.networkingEnabled, version },
      });
      return networkingSettingsSchema.parse({
        eventId: context.eventId,
        userId: context.userId,
        version,
        networkingEnabled: parsed.data.networkingEnabled,
        introduction: parsed.data.introduction,
        company: parsed.data.company,
        jobTitle: parsed.data.jobTitle,
        todayHunting: parsed.data.todayHunting,
        contactEmail: parsed.data.contactEmail,
        phone: parsed.data.phone,
        linkedinUrl: parsed.data.linkedinUrl,
        emailVisibility: visibility,
        phoneVisibility: visibility,
        linkedinVisibility: visibility,
        updatedAt: now.toISOString(),
      });
    });
    return Response.json(body, { headers: privateHeaders(requestId) });
  } catch (error) {
    if (error instanceof EventAccessDeniedError) {
      return respondProblem(
        apiProblem(
          403,
          'EVENT_ACCESS_DENIED',
          'Event access denied',
          'Networking is unavailable.',
        ),
        requestId,
      );
    }
    return respondProblem(error, requestId);
  }
};

const projectDirectoryProfile = (
  row: typeof schema.participantProfiles.$inferSelect,
): NetworkingDirectoryProfile =>
  networkingDirectoryProfileSchema.parse({
    profileId: row.userId,
    displayName: `${row.firstName} ${row.lastName}`,
    company: row.company ?? '',
    jobTitle: row.jobTitle ?? '',
    introduction: row.bio ?? '',
    todayHunting: row.todayHunting,
    contacts: projectNetworkingContacts(row),
  });

const requireDirectoryReader = async (
  context: Awaited<ReturnType<typeof loadContext>>,
  dependencies: NetworkingDependencies,
) => {
  if (
    context.profile.networkingEnabled !== true ||
    context.profile.moderationStatus !== 'visible'
  ) {
    throw apiProblem(
      403,
      'EVENT_ACCESS_DENIED',
      'Event access denied',
      'Opt in before using the directory.',
    );
  }
  await requireNetworkingParticipant(context, dependencies);
  await requireEventPermission(
    dependencies.db,
    { userId: context.userId },
    context.eventId,
    'networking:directory:read',
    { networkingOptedIn: true },
  );
};

export const readNetworkingDirectory = async (
  request: Request,
  dependencies: NetworkingDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'GET' || request.headers.has('idempotency-key')) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The directory request is invalid.',
      );
    }
    const context = await loadContext(request, dependencies);
    await requireDirectoryReader(context, dependencies);
    const url = new URL(request.url);
    const known = new Set(['q', 'todayHunting', 'cursor', 'limit']);
    if ([...url.searchParams.keys()].some((key) => !known.has(key))) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'Unknown directory filter.',
      );
    }
    const query = networkingDirectoryQuerySchema.safeParse({
      ...(url.searchParams.get('q') ? { q: url.searchParams.get('q') } : {}),
      ...(url.searchParams.get('todayHunting')
        ? { todayHunting: url.searchParams.get('todayHunting') }
        : {}),
      ...(url.searchParams.get('cursor')
        ? { cursor: url.searchParams.get('cursor') }
        : {}),
      ...(url.searchParams.get('limit')
        ? { limit: Number(url.searchParams.get('limit')) }
        : {}),
    });
    if (!query.success) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The directory filters are invalid.',
      );
    }
    const term = query.data.q
      ? `%${query.data.q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
      : null;
    const limit = query.data.limit ?? 30;
    const rows = await dependencies.db
      .select({ profile: schema.participantProfiles })
      .from(schema.participantProfiles)
      .innerJoin(
        schema.eventMemberships,
        and(
          eq(
            schema.eventMemberships.eventId,
            schema.participantProfiles.eventId,
          ),
          eq(schema.eventMemberships.userId, schema.participantProfiles.userId),
          eq(schema.eventMemberships.status, 'active'),
        ),
      )
      .where(
        and(
          eq(schema.participantProfiles.eventId, context.eventId),
          eq(schema.participantProfiles.networkingEnabled, true),
          eq(schema.participantProfiles.moderationStatus, 'visible'),
          isNull(schema.participantProfiles.networkingAnonymizedAt),
          query.data.cursor
            ? gt(schema.participantProfiles.userId, query.data.cursor)
            : undefined,
          query.data.todayHunting
            ? arrayContains(schema.participantProfiles.todayHunting, [
                query.data.todayHunting,
              ])
            : undefined,
          term
            ? or(
                ilike(schema.participantProfiles.firstName, term),
                ilike(schema.participantProfiles.lastName, term),
                ilike(schema.participantProfiles.company, term),
              )
            : undefined,
        ),
      )
      .orderBy(asc(schema.participantProfiles.userId))
      .limit(limit + 1);
    const page = rows
      .slice(0, limit)
      .map(({ profile }) => projectDirectoryProfile(profile));
    const hasMore = rows.length > limit;
    const body = networkingDirectoryResponseSchema.parse({
      eventId: context.eventId,
      items: page,
      pageInfo: {
        hasMore,
        nextCursor: hasMore ? (page.at(-1)?.profileId ?? null) : null,
      },
    });
    return Response.json(body, { headers: privateHeaders(requestId) });
  } catch (error) {
    if (error instanceof EventAccessDeniedError) {
      return respondProblem(
        apiProblem(
          403,
          'EVENT_ACCESS_DENIED',
          'Event access denied',
          'Networking is unavailable.',
        ),
        requestId,
      );
    }
    return respondProblem(error, requestId);
  }
};

export const readNetworkingProfile = async (
  request: Request,
  profileId: string,
  dependencies: NetworkingDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (
      request.method !== 'GET' ||
      !uuidSchema.safeParse(profileId).success ||
      new URL(request.url).search.length > 0
    ) {
      throw apiProblem(
        404,
        'PROFILE_NOT_FOUND',
        'Profile not found',
        'The directory profile is unavailable.',
      );
    }
    const context = await loadContext(request, dependencies);
    await requireDirectoryReader(context, dependencies);
    const row = await dependencies.db
      .select({ profile: schema.participantProfiles })
      .from(schema.participantProfiles)
      .innerJoin(
        schema.eventMemberships,
        and(
          eq(
            schema.eventMemberships.eventId,
            schema.participantProfiles.eventId,
          ),
          eq(schema.eventMemberships.userId, schema.participantProfiles.userId),
          eq(schema.eventMemberships.status, 'active'),
        ),
      )
      .where(
        and(
          eq(schema.participantProfiles.eventId, context.eventId),
          eq(schema.participantProfiles.userId, profileId),
          eq(schema.participantProfiles.networkingEnabled, true),
          eq(schema.participantProfiles.moderationStatus, 'visible'),
          isNull(schema.participantProfiles.networkingAnonymizedAt),
        ),
      )
      .limit(1);
    const profile = row[0]?.profile;
    if (!profile) {
      throw apiProblem(
        404,
        'PROFILE_NOT_FOUND',
        'Profile not found',
        'The directory profile is unavailable.',
      );
    }
    return Response.json(projectDirectoryProfile(profile), {
      headers: privateHeaders(requestId),
    });
  } catch (error) {
    if (error instanceof EventAccessDeniedError) {
      return respondProblem(
        apiProblem(
          403,
          'EVENT_ACCESS_DENIED',
          'Event access denied',
          'Networking is unavailable.',
        ),
        requestId,
      );
    }
    return respondProblem(error, requestId);
  }
};

const adminHideRequestSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  hidden: z.boolean(),
  reason: z.string().trim().min(8).max(240),
});

export const moderateNetworkingProfile = async (
  request: Request,
  eventId: string,
  profileId: string,
  dependencies: NetworkingDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (
      request.method !== 'PATCH' ||
      request.headers.get('origin') !== dependencies.allowedOrigin ||
      !uuidSchema.safeParse(eventId).success ||
      !uuidSchema.safeParse(profileId).success ||
      new URL(request.url).search.length > 0
    ) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The moderation request is invalid.',
      );
    }
    const identity = await dependencies.getSession(request.headers);
    if (!identity) {
      throw apiProblem(
        401,
        'AUTHENTICATION_REQUIRED',
        'Authentication required',
        'A valid session is required.',
      );
    }
    await requireEventPermission(
      dependencies.db,
      { userId: identity.user.id },
      eventId,
      'networking:reported-content:moderate',
    );
    const parsed = adminHideRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw apiProblem(
        422,
        'VALIDATION_FAILED',
        'Validation failed',
        'The moderation input is invalid.',
      );
    }
    const now = dependencies.now?.() ?? new Date();
    const body = await dependencies.db.transaction(async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `networking-profile:${eventId}:${profileId}`,
      );
      const current = await transaction.query.participantProfiles.findFirst({
        columns: { moderationStatus: true, version: true },
        where: and(
          eq(schema.participantProfiles.eventId, eventId),
          eq(schema.participantProfiles.userId, profileId),
        ),
      });
      if (!current) {
        throw apiProblem(
          404,
          'PROFILE_NOT_FOUND',
          'Profile not found',
          'The directory profile is unavailable.',
        );
      }
      if (current.version !== parsed.data.expectedVersion) {
        throw apiProblem(
          409,
          'STALE_VERSION',
          'Profile changed',
          'Reload the profile before moderation.',
        );
      }
      const status = parsed.data.hidden ? 'hidden' : 'visible';
      const version = current.version + 1;
      await transaction
        .update(schema.participantProfiles)
        .set({ moderationStatus: status, version, updatedAt: now })
        .where(
          and(
            eq(schema.participantProfiles.eventId, eventId),
            eq(schema.participantProfiles.userId, profileId),
            eq(schema.participantProfiles.version, current.version),
          ),
        );
      await writeAuditLog(transaction, {
        eventId,
        actorId: identity.user.id,
        actorType: 'user',
        action: parsed.data.hidden
          ? 'networking.admin_hide'
          : 'networking.admin_restore',
        targetType: 'participant_profile',
        targetId: profileId,
        requestId,
        reason: parsed.data.reason,
        before: {
          moderationStatus: current.moderationStatus,
          version: current.version,
        },
        after: { moderationStatus: status, version },
      });
      return {
        profileId,
        moderationStatus: status,
        version,
        updatedAt: now.toISOString(),
      };
    });
    return Response.json(body, { headers: privateHeaders(requestId) });
  } catch (error) {
    if (error instanceof EventAccessDeniedError) {
      return respondProblem(
        apiProblem(
          403,
          'EVENT_ACCESS_DENIED',
          'Event access denied',
          'Profile moderation is unavailable.',
        ),
        requestId,
      );
    }
    return respondProblem(error, requestId);
  }
};
