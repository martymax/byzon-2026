import {
  adminContextFixtures,
  adminOperationsOverviewFixtures,
} from '@byzon/test-support/fixtures';
import { describe, expect, it } from 'vitest';
import {
  overviewAttention,
  overviewCapacityLabel,
  overviewPercent,
} from './admin-overview-model';

describe('overview decisions', () => {
  it('puts failures first and does not count an unfinished activation as an incident', () => {
    const overview = adminOperationsOverviewFixtures.degraded!;
    const items = overviewAttention(
      {
        ...overview,
        metrics: overview.metrics.map((metric) =>
          metric.id === 'activation'
            ? { ...metric, state: 'attention' }
            : metric,
        ),
      },
      adminContextFixtures.organizer!,
    );
    expect(items[0]?.id).toBe('notification');
    expect(items.map((item) => item.id)).not.toContain('activation');
    expect(items.map((item) => item.id)).not.toContain('background');
  });

  it('surfaces failed background work even when every business metric is healthy', () => {
    const overview = {
      ...adminOperationsOverviewFixtures.healthy!,
      queues: [
        { queue: 'default' as const, ready: 3, processing: 1, failed: 2 },
      ],
    };
    const items = overviewAttention(overview, adminContextFixtures.organizer!);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'background',
      severity: 'degraded',
      action: null,
    });
  });

  it('respects disabled features and the archived phase', () => {
    const context = adminContextFixtures.organizer!;
    const items = overviewAttention(adminOperationsOverviewFixtures.degraded!, {
      ...context,
      capabilities: { canEnterCheckin: false },
      features: { announcementsEnabled: false },
      event: { ...context.event, phase: 'archived' },
    });
    expect(items.map((item) => item.id)).not.toContain('checkin');
    expect(items.map((item) => item.id)).not.toContain('notification');
    expect(items.every((item) => item.action === null)).toBe(true);
  });

  it('distinguishes missing, zero, full and exceeded capacities', () => {
    expect(overviewPercent(0, 0)).toBeNull();
    expect(overviewPercent(410, 440)).toBe(93);
    expect(overviewPercent(21, 20)).toBe(105);
    expect(overviewCapacityLabel(0, null)).toBe('Kapacita nenastavena');
    expect(overviewCapacityLabel(0, 0)).toBe('Bez dostupných míst');
    expect(overviewCapacityLabel(20, 20)).toBe('Plně obsazeno');
    expect(overviewCapacityLabel(21, 20)).toBe('Nad kapacitou o 1');
    expect(overviewCapacityLabel(19, 20)).toBe('1 volné místo');
  });
});
