import { schema, type Database } from '@byzon/database';
import {
  adminOperationsOverviewResponseSchema,
  type AdminOperationsOverviewResponse,
} from '@byzon/domain/contracts';
import { and, count, countDistinct, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { CURRENT_EVENT_SLUG } from './current-event';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuidSchema = z.string().uuid();

export interface AdminOperationsDependencies {
  db: Database;
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  currentEventSlug?: string;
  now?: () => Date;
}

type ImportStatus =
  | 'uploaded'
  | 'validated'
  | 'awaiting_confirmation'
  | 'applying'
  | 'applied'
  | 'failed';
type SyncStatus = 'sync_pending' | 'syncing' | 'synced' | 'sync_failed';

export interface AdminOperationsSnapshot {
  activation: { activated: number; total: number };
  announcements: { enabled: boolean; total: number };
  latestImport: { rowCount: number; status: ImportStatus } | null;
  publication: { syncStatus: SyncStatus; version: number } | null;
  queue: { failed: number; pending: number; processing: number };
  reservations: {
    capacity: number;
    confirmed: number;
    fullSessions: number;
    overbookedSessions: number;
  };
}

const importStatusCopy: Record<
  ImportStatus,
  { state: 'attention' | 'degraded' | 'healthy'; value: string }
> = {
  uploaded: { state: 'attention', value: 'Nahráno' },
  validated: { state: 'attention', value: 'Zkontrolováno' },
  awaiting_confirmation: { state: 'attention', value: 'Čeká na potvrzení' },
  applying: { state: 'attention', value: 'Používá se' },
  applied: { state: 'healthy', value: 'Použito' },
  failed: { state: 'degraded', value: 'Nepodařilo se' },
};

export const buildAdminOperationsOverview = (
  eventId: string,
  version: number,
  generatedAt: Date,
  snapshot: AdminOperationsSnapshot,
): AdminOperationsOverviewResponse => {
  const importCopy = snapshot.latestImport
    ? importStatusCopy[snapshot.latestImport.status]
    : { state: 'attention' as const, value: 'Bez importu' };
  const contentState = !snapshot.publication
    ? 'degraded'
    : snapshot.publication.syncStatus === 'sync_failed'
      ? 'degraded'
      : snapshot.publication.syncStatus === 'synced'
        ? 'healthy'
        : 'attention';
  const contentDetail = !snapshot.publication
    ? 'Chybí publikovaný obsah aplikace.'
    : snapshot.publication.syncStatus === 'synced'
      ? 'Publikovaná verze je synchronizovaná.'
      : snapshot.publication.syncStatus === 'sync_failed'
        ? 'Synchronizace publikované verze se nepodařila.'
        : 'Publikovaná verze čeká na dokončení synchronizace.';
  const reservationState =
    snapshot.reservations.overbookedSessions > 0
      ? 'degraded'
      : snapshot.reservations.fullSessions > 0
        ? 'attention'
        : 'healthy';

  return adminOperationsOverviewResponseSchema.parse({
    eventId,
    version,
    generatedAt: generatedAt.toISOString(),
    metrics: [
      {
        id: 'activation',
        label: 'Aktivace účastníků',
        value: `${snapshot.activation.activated}/${snapshot.activation.total}`,
        state:
          snapshot.activation.total > 0 &&
          snapshot.activation.activated === snapshot.activation.total
            ? 'healthy'
            : 'attention',
        detail:
          snapshot.activation.total === 0
            ? 'Z importu zatím nevznikl žádný účastnický přístup.'
            : `${snapshot.activation.total - snapshot.activation.activated} účastníků ještě nepotvrdilo svůj e-mailový přístup.`,
      },
      {
        id: 'import',
        label: 'Poslední import',
        value: importCopy.value,
        state: importCopy.state,
        detail: snapshot.latestImport
          ? `${snapshot.latestImport.rowCount} bezpečně zpracovaných řádků.`
          : 'Zatím nebyla vytvořena žádná importní dávka.',
      },
      {
        id: 'content',
        label: 'Publikace obsahu',
        value: snapshot.publication
          ? `Verze ${snapshot.publication.version}`
          : 'Bez publikace',
        state: contentState,
        detail: contentDetail,
      },
      {
        id: 'checkin',
        label: 'Odbavení',
        value: 'Mimo rozsah 2026',
        state: 'healthy',
        detail: 'Odbavení se v provozním režimu 2026 nepoužívá.',
      },
      {
        id: 'reservation',
        label: 'Rezervace',
        value: `${snapshot.reservations.confirmed}/${snapshot.reservations.capacity}`,
        state: reservationState,
        detail:
          snapshot.reservations.overbookedSessions > 0
            ? `${snapshot.reservations.overbookedSessions} aktivit překračuje nastavenou kapacitu.`
            : snapshot.reservations.fullSessions > 0
              ? `${snapshot.reservations.fullSessions} aktivit má naplněnou kapacitu.`
              : 'Potvrzené rezervace jsou pod nastavenými kapacitami.',
      },
      {
        id: 'notification',
        label: 'Oznámení',
        value: snapshot.announcements.enabled
          ? `${snapshot.announcements.total} odesláno`
          : 'Vypnuto',
        state: 'healthy',
        detail: snapshot.announcements.enabled
          ? 'Kritická oznámení jsou pro akci dostupná.'
          : 'Oznámení jsou pro tuto akci vypnutá.',
      },
    ],
    queues: [
      {
        queue: 'default',
        ready: snapshot.queue.pending,
        processing: snapshot.queue.processing,
        failed: snapshot.queue.failed,
      },
    ],
  });
};

const privateHeaders = (requestId: string) => ({
  'cache-control': 'private, no-store',
  vary: 'Authorization, Cookie',
  'x-content-type-options': 'nosniff',
  'x-request-id': requestId,
});

const denied = () =>
  new ApiProblemError({
    status: 403,
    code: 'EVENT_ACCESS_DENIED',
    title: 'Event access denied',
    detail: 'The operations overview is unavailable.',
  });

export const handleAdminOperations = async (
  request: Request,
  eventId: string,
  dependencies: AdminOperationsDependencies,
): Promise<Response> => {
  const requestId = getRequestId(request.headers);
  try {
    if (request.method !== 'GET') {
      throw new ApiProblemError({
        status: 405,
        code: 'METHOD_NOT_ALLOWED',
        title: 'Method not allowed',
        detail: 'The method is not supported.',
      });
    }
    if (new URL(request.url).search.length > 0) {
      throw new ApiProblemError({
        status: 422,
        code: 'VALIDATION_FAILED',
        title: 'Invalid request',
        detail: 'The operations overview does not accept query parameters.',
      });
    }
    if (!uuidSchema.safeParse(eventId).success) throw denied();
    const session = await dependencies.getSession(request.headers);
    if (!session) {
      throw new ApiProblemError({
        status: 401,
        code: 'AUTHENTICATION_REQUIRED',
        title: 'Authentication required',
        detail: 'A valid session is required.',
      });
    }
    const event = await dependencies.db.query.events.findFirst({
      columns: { id: true },
      where: and(
        eq(schema.events.id, eventId),
        eq(
          schema.events.slug,
          dependencies.currentEventSlug ?? CURRENT_EVENT_SLUG,
        ),
      ),
    });
    if (!event) throw denied();
    try {
      await requireEventPermission(
        dependencies.db,
        { userId: session.user.id },
        eventId,
        'operations:read',
      );
    } catch (error) {
      if (!(error instanceof EventAccessDeniedError)) throw error;
      throw denied();
    }
    const [
      version,
      activationCounts,
      latestImport,
      publication,
      reservationRows,
      announcementCount,
      features,
      outbox,
    ] = await Promise.all([
      dependencies.db.query.eventAdminVersions.findFirst({
        columns: { assignmentsVersion: true },
        where: eq(schema.eventAdminVersions.eventId, eventId),
      }),
      dependencies.db
        .select({
          total: countDistinct(schema.ticketSourceParticipants.userId),
          activated: sql<number>`count(distinct ${schema.ticketSourceParticipants.userId}) filter (where ${schema.users.emailVerified} = true)`,
        })
        .from(schema.ticketSourceParticipants)
        .innerJoin(
          schema.users,
          eq(schema.users.id, schema.ticketSourceParticipants.userId),
        )
        .where(eq(schema.ticketSourceParticipants.eventId, eventId)),
      dependencies.db.query.ticketImportBatches.findFirst({
        columns: { status: true, rowCount: true },
        where: eq(schema.ticketImportBatches.eventId, eventId),
        orderBy: (table, { desc }) => [desc(table.createdAt)],
      }),
      dependencies.db.query.contentPublications.findFirst({
        columns: { version: true, syncStatus: true },
        where: eq(schema.contentPublications.eventId, eventId),
        orderBy: (table, { desc }) => [desc(table.version)],
      }),
      dependencies.db
        .select({
          capacity: sql<number>`coalesce(${schema.programSessions.capacity}, 0)`,
          confirmed: count(schema.reservations.id),
        })
        .from(schema.programSessions)
        .leftJoin(
          schema.reservations,
          and(
            eq(schema.reservations.eventId, schema.programSessions.eventId),
            eq(schema.reservations.sessionId, schema.programSessions.id),
            eq(schema.reservations.status, 'confirmed'),
          ),
        )
        .where(
          and(
            eq(schema.programSessions.eventId, eventId),
            eq(schema.programSessions.capacityMode, 'reservation'),
            inArray(schema.programSessions.status, ['draft', 'published']),
          ),
        )
        .groupBy(schema.programSessions.id, schema.programSessions.capacity),
      dependencies.db
        .select({ count: count() })
        .from(schema.announcements)
        .where(eq(schema.announcements.eventId, eventId)),
      dependencies.db.query.eventFeatures.findFirst({
        columns: { announcementsEnabled: true },
        where: eq(schema.eventFeatures.eventId, eventId),
      }),
      dependencies.db
        .select({ status: schema.outboxEvents.status, count: count() })
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.eventId, eventId))
        .groupBy(schema.outboxEvents.status),
    ]);
    const pending =
      outbox.find(({ status }) => status === 'pending')?.count ?? 0;
    const processing =
      outbox.find(({ status }) => status === 'processing')?.count ?? 0;
    const failed = outbox.find(({ status }) => status === 'failed')?.count ?? 0;
    const reservationSnapshot = reservationRows.reduce<
      AdminOperationsSnapshot['reservations']
    >(
      (summary, row) => ({
        capacity: summary.capacity + row.capacity,
        confirmed: summary.confirmed + row.confirmed,
        fullSessions:
          summary.fullSessions +
          (row.capacity > 0 && row.confirmed === row.capacity ? 1 : 0),
        overbookedSessions:
          summary.overbookedSessions + (row.confirmed > row.capacity ? 1 : 0),
      }),
      { capacity: 0, confirmed: 0, fullSessions: 0, overbookedSessions: 0 },
    );
    const generatedAt = dependencies.now?.() ?? new Date();
    const body = buildAdminOperationsOverview(
      eventId,
      version?.assignmentsVersion ?? 1,
      generatedAt,
      {
        activation: {
          activated: Number(activationCounts[0]?.activated ?? 0),
          total: activationCounts[0]?.total ?? 0,
        },
        announcements: {
          enabled: features?.announcementsEnabled ?? false,
          total: announcementCount[0]?.count ?? 0,
        },
        latestImport: latestImport ?? null,
        publication: publication ?? null,
        queue: { failed, pending, processing },
        reservations: reservationSnapshot,
      },
    );
    return Response.json(body, { headers: privateHeaders(requestId) });
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};
