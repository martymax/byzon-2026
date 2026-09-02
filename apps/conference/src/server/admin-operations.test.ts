import type { Database } from '@byzon/database';
import { describe, expect, it, vi } from 'vitest';

import {
  buildAdminOperationsOverview,
  handleAdminOperations,
  type AdminOperationsSnapshot,
} from './admin-operations';

const eventId = '019fb200-0000-7000-8000-000000000001';
const generatedAt = new Date('2026-09-02T10:00:00.000Z');

const healthySnapshot = (): AdminOperationsSnapshot => ({
  activation: { activated: 24, total: 24 },
  announcements: { enabled: true, total: 2 },
  latestImport: { rowCount: 24, status: 'applied' },
  publication: { syncStatus: 'synced', version: 3 },
  queue: { failed: 0, pending: 0, processing: 0 },
  reservations: {
    capacity: 40,
    confirmed: 25,
    fullSessions: 0,
    overbookedSessions: 0,
  },
});

describe('admin operations overview', () => {
  it('projects all approved metrics from production-safe aggregates', () => {
    const overview = buildAdminOperationsOverview(
      eventId,
      7,
      generatedAt,
      healthySnapshot(),
    );

    expect(overview.metrics.map(({ id }) => id)).toEqual([
      'activation',
      'import',
      'content',
      'checkin',
      'reservation',
      'notification',
    ]);
    expect(overview.metrics.every(({ state }) => state === 'healthy')).toBe(
      true,
    );
    expect(overview.queues).toEqual([
      { queue: 'default', ready: 0, processing: 0, failed: 0 },
    ]);
  });

  it('reports failed sync, over-capacity sessions and worker failures without raw errors', () => {
    const snapshot = healthySnapshot();
    snapshot.publication = { syncStatus: 'sync_failed', version: 4 };
    snapshot.queue = { failed: 3, pending: 1, processing: 2 };
    snapshot.reservations = {
      capacity: 40,
      confirmed: 41,
      fullSessions: 0,
      overbookedSessions: 1,
    };

    const overview = buildAdminOperationsOverview(
      eventId,
      8,
      generatedAt,
      snapshot,
    );

    expect(overview.metrics.find(({ id }) => id === 'content')).toMatchObject({
      state: 'degraded',
      detail: 'Synchronizace publikované verze se nepodařila.',
    });
    expect(
      overview.metrics.find(({ id }) => id === 'reservation'),
    ).toMatchObject({ state: 'degraded' });
    expect(overview.queues[0]).toEqual({
      queue: 'default',
      ready: 1,
      processing: 2,
      failed: 3,
    });
    expect(JSON.stringify(overview)).not.toContain('lastError');
  });

  it('localizes intermediate import and empty activation states', () => {
    const snapshot = healthySnapshot();
    snapshot.activation = { activated: 0, total: 0 };
    snapshot.latestImport = { rowCount: 12, status: 'awaiting_confirmation' };

    const overview = buildAdminOperationsOverview(
      eventId,
      9,
      generatedAt,
      snapshot,
    );

    expect(
      overview.metrics.find(({ id }) => id === 'activation'),
    ).toMatchObject({
      state: 'attention',
      value: '0/0',
    });
    expect(overview.metrics.find(({ id }) => id === 'import')).toMatchObject({
      state: 'attention',
      value: 'Čeká na potvrzení',
    });
  });

  it('rejects query filters before authentication or database access', async () => {
    const getSession = vi.fn();
    const response = await handleAdminOperations(
      new Request(
        `https://example.test/api/v1/admin/events/${eventId}/operations?email=private@example.test`,
      ),
      eventId,
      { db: {} as Database, getSession },
    );

    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(getSession).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
