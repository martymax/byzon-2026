import {
  acquireTransactionLock,
  generateUuidV7,
  invitationCandidateConditions,
  invitationCandidateQuery,
  invitationDelivery,
  schema,
  writeAuditLog,
} from '@byzon/database';
import {
  createInvitationBatchSchema,
  invitationBatchCreatedSchema,
  invitationBatchesSchema,
} from '@byzon/domain/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  authorizeInvitationAccess,
  type InvitationDependencies,
} from './admin-invitations';
import {
  executeIdempotentMutation,
  hashIdempotencyRequest,
  readIdempotencyKey,
} from './api/idempotency';
import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError } from './policy';

const invalid = (detail: string, status = 422) =>
  new ApiProblemError({
    status,
    code: 'VALIDATION_FAILED',
    title: 'Invitation batch rejected',
    detail,
  });

export async function handleInvitationBatches(
  request: Request,
  eventId: string,
  deps: InvitationDependencies & { allowedOrigin: string },
): Promise<Response> {
  const requestId = getRequestId(request.headers);
  const headers = {
    'cache-control': 'private, no-store',
    vary: 'Authorization, Cookie',
    'x-content-type-options': 'nosniff',
    'x-request-id': requestId,
  };
  try {
    const { actorId, event } = await authorizeInvitationAccess(
      request,
      eventId,
      deps,
    );
    if (request.method === 'GET') {
      const jobs = schema.invitationDeliveries;
      const counts = {
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${jobs.status} = 'pending')::int`,
        processing: sql<number>`count(*) filter (where ${jobs.status} = 'processing')::int`,
        delivered: sql<number>`count(*) filter (where ${jobs.status} = 'delivered')::int`,
        failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed')::int`,
        skipped: sql<number>`count(*) filter (where ${jobs.status} = 'skipped')::int`,
        failedUserIds: sql<
          string[]
        >`coalesce(array_agg(${jobs.userId}) filter (where ${jobs.status} = 'failed' and ${jobs.userId} is not null), '{}'::uuid[])`,
      };
      const batches = await deps.db
        .select({
          id: schema.invitationBatches.id,
          createdAt: schema.invitationBatches.createdAt,
          ...counts,
        })
        .from(schema.invitationBatches)
        .innerJoin(jobs, eq(jobs.batchId, schema.invitationBatches.id))
        .where(eq(schema.invitationBatches.eventId, eventId))
        .groupBy(schema.invitationBatches.id)
        .orderBy(
          sql`bool_or(${jobs.status} in ('pending', 'processing')) desc`,
          desc(schema.invitationBatches.createdAt),
        )
        .limit(30);
      const queued = await deps.db
        .select({ userId: jobs.userId })
        .from(jobs)
        .where(
          and(
            eq(jobs.eventId, eventId),
            inArray(jobs.status, ['pending', 'processing']),
          ),
        );
      return Response.json(
        invitationBatchesSchema.parse({
          eventId,
          batches: batches.map((batch) => ({
            ...batch,
            createdAt: batch.createdAt.toISOString(),
          })),
          queuedUserIds: queued.flatMap((job) =>
            job.userId ? [job.userId] : [],
          ),
        }),
        { headers },
      );
    }
    if (request.headers.get('origin') !== deps.allowedOrigin)
      throw invalid('Požadavek musí přijít z této aplikace.', 403);
    if (event.status === 'archived')
      throw invalid('Archivovaná akce už nepřijímá pozvánky.', 409);
    const raw = await request.text();
    if (raw.length > 220_000) throw invalid('Vyberte nejvýše 5 000 příjemců.');
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw invalid('Neplatný výběr příjemců.');
    }
    const parsed = createInvitationBatchSchema.safeParse(body);
    if (!parsed.success) throw invalid('Vyberte 1 až 5 000 různých příjemců.');
    const result = await executeIdempotentMutation(
      deps.db,
      {
        eventId,
        actorId,
        scope: 'invitations.batch.create',
        key: readIdempotencyKey(request.headers),
        requestHash: hashIdempotencyRequest({
          method: 'POST',
          path: new URL(request.url).pathname,
          body: raw,
        }),
        ttlMs: 7 * 24 * 60 * 60_000,
      },
      async (tx) => {
        await acquireTransactionLock(tx, `invitations:${eventId}`);
        const candidates = await invitationCandidateQuery(tx, eventId).where(
          and(
            invitationCandidateConditions(eventId),
            inArray(schema.users.id, parsed.data.userIds),
          ),
        );
        if (
          candidates.length !== parsed.data.userIds.length ||
          candidates.some(
            (row) => !invitationDelivery(row.roles, row.participantReady),
          )
        )
          throw invalid(
            'Některý příjemce už nemá aktivní přístup. Obnovte seznam a výběr zkontrolujte.',
          );
        const active = await tx
          .select({ userId: schema.invitationDeliveries.userId })
          .from(schema.invitationDeliveries)
          .where(
            and(
              eq(schema.invitationDeliveries.eventId, eventId),
              inArray(schema.invitationDeliveries.status, [
                'pending',
                'processing',
              ]),
              inArray(schema.invitationDeliveries.userId, parsed.data.userIds),
            ),
          );
        const activeIds = new Set(active.map((job) => job.userId));
        const recipients = candidates.filter(
          (row) => !activeIds.has(row.userId),
        );
        const batchId = recipients.length ? generateUuidV7() : null;
        if (batchId) {
          await tx
            .insert(schema.invitationBatches)
            .values({ id: batchId, eventId, createdBy: actorId });
          // Chunk inserts to stay below PostgreSQL's parameter limit for large selections.
          for (let offset = 0; offset < recipients.length; offset += 500) {
            await tx
              .insert(schema.invitationDeliveries)
              .values(
                recipients
                  .slice(offset, offset + 500)
                  .map((row) => ({
                    id: generateUuidV7(),
                    batchId,
                    eventId,
                    userId: row.userId,
                    delivery: invitationDelivery(
                      row.roles,
                      row.participantReady,
                    )!,
                  })),
              );
          }
          await writeAuditLog(tx, {
            eventId,
            actorId,
            actorType: 'user',
            action: 'invitations.batch_queued',
            targetType: 'invitation_batch',
            targetId: batchId,
            requestId,
            after: { recipients: recipients.length },
          });
        }
        return {
          status: 202,
          body: invitationBatchCreatedSchema.parse({
            eventId,
            batchId,
            queued: recipients.length,
            alreadyQueued: activeIds.size,
          }),
          resultReference: batchId,
        };
      },
    );
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) {
    const response = problemResponse(
      error instanceof EventAccessDeniedError
        ? invalid('Pro rozesílání nemáte oprávnění.', 403)
        : error,
      requestId,
    );
    Object.entries(headers).forEach(([key, value]) =>
      response.headers.set(key, value),
    );
    return response;
  }
}
