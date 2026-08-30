import { createHash } from 'node:crypto';

import {
  acquireTransactionLock,
  schema,
  type Database,
  type DatabaseTransaction,
} from '@byzon/database';
import { and, asc, count, eq, gte, inArray, lte } from 'drizzle-orm';

const MAX_ATTEMPTS = 8;
const PROCESSING_LEASE_MS = 60_000;

export const protectSpreadsheetCell = (value: unknown): string => {
  const text = String(value ?? '');
  const protectedText = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
};

const csv = (rows: readonly (readonly unknown[])[]): string =>
  `${rows.map((row) => row.map(protectSpreadsheetCell).join(',')).join('\r\n')}\r\n`;

const generateExport = async (
  transaction: DatabaseTransaction,
  request: typeof schema.operationalExportRequests.$inferSelect,
): Promise<{ content: string; contentType: string }> => {
  if (request.report === 'participant_summary') {
    const rows = await transaction
      .select({ status: schema.tickets.status, total: count() })
      .from(schema.tickets)
      .where(eq(schema.tickets.eventId, request.eventId))
      .groupBy(schema.tickets.status)
      .orderBy(asc(schema.tickets.status));
    const data = rows.map((row) => ({ status: row.status, count: row.total }));
    return request.format === 'json'
      ? {
          content: `${JSON.stringify(data, null, 2)}\n`,
          contentType: 'application/json',
        }
      : {
          content: csv([
            ['status', 'count'],
            ...data.map((row) => [row.status, row.count]),
          ]),
          contentType: 'text/csv; charset=utf-8',
        };
  }
  if (request.report === 'checkin_summary') {
    const rows = await transaction
      .select({ station: schema.checkinStations.name, total: count() })
      .from(schema.checkIns)
      .innerJoin(
        schema.checkinStations,
        and(
          eq(schema.checkinStations.eventId, schema.checkIns.eventId),
          eq(schema.checkinStations.id, schema.checkIns.stationId),
        ),
      )
      .where(eq(schema.checkIns.eventId, request.eventId))
      .groupBy(schema.checkinStations.name)
      .orderBy(asc(schema.checkinStations.name));
    const data = rows.map((row) => ({
      station: row.station,
      count: row.total,
    }));
    return request.format === 'json'
      ? {
          content: `${JSON.stringify(data, null, 2)}\n`,
          contentType: 'application/json',
        }
      : {
          content: csv([
            ['station', 'count'],
            ...data.map((row) => [row.station, row.count]),
          ]),
          contentType: 'text/csv; charset=utf-8',
        };
  }
  if (request.report === 'reservation_summary') {
    const rows = await transaction
      .select({
        sessionId: schema.reservations.sessionId,
        title: schema.programSessions.title,
        total: count(),
      })
      .from(schema.reservations)
      .innerJoin(
        schema.programSessions,
        and(
          eq(schema.programSessions.eventId, schema.reservations.eventId),
          eq(schema.programSessions.id, schema.reservations.sessionId),
        ),
      )
      .where(
        and(
          eq(schema.reservations.eventId, request.eventId),
          eq(schema.reservations.status, 'confirmed'),
        ),
      )
      .groupBy(schema.reservations.sessionId, schema.programSessions.title)
      .orderBy(asc(schema.programSessions.title));
    const data = rows.map((row) => ({
      sessionId: row.sessionId,
      title: row.title,
      confirmed: row.total,
    }));
    return request.format === 'json'
      ? {
          content: `${JSON.stringify(data, null, 2)}\n`,
          contentType: 'application/json',
        }
      : {
          content: csv([
            ['session_id', 'title', 'confirmed'],
            ...data.map((row) => [row.sessionId, row.title, row.confirmed]),
          ]),
          contentType: 'text/csv; charset=utf-8',
        };
  }
  if (request.report === 'audit_log') {
    const rows = await transaction
      .select({
        occurredAt: schema.auditLogs.createdAt,
        action: schema.auditLogs.action,
        targetType: schema.auditLogs.targetType,
        targetId: schema.auditLogs.targetId,
        reason: schema.auditLogs.reason,
      })
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.eventId, request.eventId),
          request.rangeFrom
            ? gte(schema.auditLogs.createdAt, request.rangeFrom)
            : undefined,
          request.rangeTo
            ? lte(schema.auditLogs.createdAt, request.rangeTo)
            : undefined,
        ),
      )
      .orderBy(asc(schema.auditLogs.createdAt))
      .limit(10_000);
    const data = rows.map((row) => ({
      occurredAt: row.occurredAt.toISOString(),
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
    }));
    return request.format === 'json'
      ? {
          content: `${JSON.stringify(data, null, 2)}\n`,
          contentType: 'application/json',
        }
      : {
          content: csv([
            ['occurred_at', 'action', 'target_type', 'target_id', 'reason'],
            ...data.map((row) => [
              row.occurredAt,
              row.action,
              row.targetType,
              row.targetId,
              row.reason,
            ]),
          ]),
          contentType: 'text/csv; charset=utf-8',
        };
  }
  throw new Error('UnsupportedExportReport');
};

const supportedEventTypes = ['export.requested', 'program.changed'] as const;

const claimSupportedEvent = async (db: Database, now: Date) =>
  db.transaction(async (transaction) => {
    await acquireTransactionLock(transaction, 'outbox:supported-dispatch');
    await transaction
      .update(schema.outboxEvents)
      .set({ status: 'pending' })
      .where(
        and(
          inArray(schema.outboxEvents.type, supportedEventTypes),
          eq(schema.outboxEvents.status, 'processing'),
          lte(schema.outboxEvents.availableAt, now),
        ),
      );
    const event = await transaction.query.outboxEvents.findFirst({
      where: and(
        inArray(schema.outboxEvents.type, supportedEventTypes),
        eq(schema.outboxEvents.status, 'pending'),
        lte(schema.outboxEvents.availableAt, now),
      ),
      orderBy: (table, { asc }) => [asc(table.availableAt), asc(table.id)],
    });
    if (!event) return null;
    await transaction
      .update(schema.outboxEvents)
      .set({
        status: 'processing',
        attempts: event.attempts + 1,
        availableAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
      })
      .where(eq(schema.outboxEvents.id, event.id));
    return { ...event, attempts: event.attempts + 1 };
  });

export const dispatchSupportedOutboxOnce = async (
  db: Database,
  now = new Date(),
): Promise<'idle' | 'delivered' | 'retried' | 'failed'> => {
  const event = await claimSupportedEvent(db, now);
  if (!event) return 'idle';
  try {
    await db.transaction(async (transaction) => {
      if (event.type === 'program.changed') {
        // Publication diffs are informational by default. They are consumed
        // without creating a draft; only an organizer's explicit critical
        // announcement preview/send action may materialize recipients.
        await transaction
          .update(schema.outboxEvents)
          .set({
            status: 'delivered',
            deliveredAt: now,
            availableAt: now,
            lastError: null,
          })
          .where(eq(schema.outboxEvents.id, event.id));
        return;
      }
      const request =
        await transaction.query.operationalExportRequests.findFirst({
          where: and(
            eq(schema.operationalExportRequests.eventId, event.eventId),
            eq(schema.operationalExportRequests.id, event.aggregateId),
          ),
        });
      if (!request) throw new Error('ExportRequestNotFound');
      if (request.state !== 'ready') {
        const generated = await generateExport(transaction, request);
        const checksumSha256 = createHash('sha256')
          .update(generated.content)
          .digest('hex');
        await transaction
          .update(schema.operationalExportRequests)
          .set({
            state: 'ready',
            content: generated.content,
            contentType: generated.contentType,
            checksumSha256,
            updatedAt: now,
          })
          .where(eq(schema.operationalExportRequests.id, request.id));
      }
      await transaction
        .update(schema.outboxEvents)
        .set({
          status: 'delivered',
          deliveredAt: now,
          availableAt: now,
          lastError: null,
        })
        .where(eq(schema.outboxEvents.id, event.id));
    });
    return 'delivered';
  } catch (error) {
    const terminal = event.attempts >= MAX_ATTEMPTS;
    const retryDelay = Math.min(
      5 * 60_000,
      1_000 * 2 ** Math.min(8, event.attempts - 1),
    );
    await db
      .update(schema.outboxEvents)
      .set({
        status: terminal ? 'failed' : 'pending',
        availableAt: new Date(now.getTime() + retryDelay),
        lastError: error instanceof Error ? error.name : 'UnknownError',
      })
      .where(eq(schema.outboxEvents.id, event.id));
    return terminal ? 'failed' : 'retried';
  }
};
