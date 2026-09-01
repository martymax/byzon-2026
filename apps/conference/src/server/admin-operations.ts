import { schema, type Database } from '@byzon/database';
import { adminOperationsOverviewResponseSchema } from '@byzon/domain/contracts';
import { and, count, eq, inArray, sum } from 'drizzle-orm';
import { z } from 'zod';

import { ApiProblemError, getRequestId, problemResponse } from './api/problem';
import { EventAccessDeniedError, requireEventPermission } from './policy';

const uuidSchema = z.string().uuid();

export interface AdminOperationsDependencies {
  db: Database;
  getSession(headers: Headers): Promise<{ user: { id: string } } | null>;
  now?: () => Date;
}

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
      ticketCounts,
      latestImport,
      publication,
      reservations,
      capacity,
      outbox,
    ] = await Promise.all([
      dependencies.db.query.eventAdminVersions.findFirst({
        columns: { assignmentsVersion: true },
        where: eq(schema.eventAdminVersions.eventId, eventId),
      }),
      dependencies.db
        .select({ status: schema.tickets.status, count: count() })
        .from(schema.tickets)
        .where(eq(schema.tickets.eventId, eventId))
        .groupBy(schema.tickets.status),
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
        .select({ count: count() })
        .from(schema.reservations)
        .where(
          and(
            eq(schema.reservations.eventId, eventId),
            eq(schema.reservations.status, 'confirmed'),
          ),
        ),
      dependencies.db
        .select({ value: sum(schema.programSessions.capacity) })
        .from(schema.programSessions)
        .where(
          and(
            eq(schema.programSessions.eventId, eventId),
            eq(schema.programSessions.capacityMode, 'reservation'),
            inArray(schema.programSessions.status, ['draft', 'published']),
          ),
        ),
      dependencies.db
        .select({ status: schema.outboxEvents.status, count: count() })
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.eventId, eventId))
        .groupBy(schema.outboxEvents.status),
    ]);
    const tickets = new Map(
      ticketCounts.map((row) => [row.status, row.count] as const),
    );
    const totalTickets = ticketCounts.reduce(
      (value, row) => value + row.count,
      0,
    );
    const activated = tickets.get('activated') ?? 0;
    const pending =
      outbox.find(({ status }) => status === 'pending')?.count ?? 0;
    const processing =
      outbox.find(({ status }) => status === 'processing')?.count ?? 0;
    const failed = outbox.find(({ status }) => status === 'failed')?.count ?? 0;
    const reserved = reservations[0]?.count ?? 0;
    const capacityTotal = Number(capacity[0]?.value ?? 0);
    const generatedAt = dependencies.now?.() ?? new Date();
    const body = adminOperationsOverviewResponseSchema.parse({
      eventId,
      version: version?.assignmentsVersion ?? 1,
      generatedAt: generatedAt.toISOString(),
      metrics: [
        {
          id: 'activation',
          label: 'Aktivace vstupenek',
          value: `${activated}/${totalTickets}`,
          state:
            activated === totalTickets && totalTickets > 0
              ? 'healthy'
              : 'attention',
          detail: `${totalTickets - activated} vstupenek ještě není aktivovaných.`,
        },
        {
          id: 'import',
          label: 'Poslední import',
          value: latestImport?.status ?? 'bez importu',
          state: latestImport?.status === 'applied' ? 'healthy' : 'attention',
          detail: latestImport
            ? `${latestImport.rowCount} bezpečně zpracovaných řádků.`
            : 'Zatím nebyl vytvořen žádný importní batch.',
        },
        {
          id: 'content',
          label: 'Publikace obsahu',
          value: publication ? `v${publication.version}` : 'bez publikace',
          state: publication ? 'healthy' : 'degraded',
          detail: publication
            ? `Synchronizační stav: ${publication.syncStatus}.`
            : 'Chybí publikovaný obsah aplikace.',
        },
        {
          id: 'checkin',
          label: 'Odbavení',
          value: 'Mimo launch scope',
          state: 'healthy',
          detail: 'Odbavení se v provozním režimu 2026 nepoužívá.',
        },
        {
          id: 'reservation',
          label: 'Rezervace',
          value: `${reserved}/${capacityTotal}`,
          state: reserved <= capacityTotal ? 'healthy' : 'degraded',
          detail: 'Potvrzené rezervace vůči součtu nastavených kapacit.',
        },
        {
          id: 'notification',
          label: 'Provozní fronta',
          value: `${pending + processing} čeká`,
          state:
            failed > 0 ? 'degraded' : pending > 0 ? 'attention' : 'healthy',
          detail:
            failed > 0
              ? `${failed} událostí se nepodařilo dokončit ani po opakování.`
              : 'Všechny události se zpracovávají bez známé chyby.',
        },
      ],
      queues: [
        {
          queue: 'default',
          ready: pending,
          processing,
          failed,
        },
      ],
    });
    return Response.json(body, { headers: privateHeaders(requestId) });
  } catch (error) {
    const response = problemResponse(error, requestId);
    Object.entries(privateHeaders(requestId)).forEach(([name, value]) =>
      response.headers.set(name, value),
    );
    return response;
  }
};
