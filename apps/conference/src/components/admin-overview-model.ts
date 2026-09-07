import type {
  AdminContextResponse,
  AdminOperationsOverviewResponse,
} from '@byzon/domain/contracts/admin';
import {
  adminDashboardMetricRegistry,
  type AdminDashboardAction,
} from './admin-dashboard-registry';
import { formatCzechCount } from './admin-copy';

type Metric = AdminOperationsOverviewResponse['metrics'][number];

export interface OverviewAttention {
  id: string;
  title: string;
  detail: string;
  severity: 'degraded' | 'attention';
  action: AdminDashboardAction | null;
  fallback: string | null;
}

const attentionTitles: Record<Metric['id'], string> = {
  activation: 'Zkontrolujte přístupy účastníků',
  import: 'Zkontrolujte aktualizaci vstupenek',
  content: 'Zkontrolujte publikaci programu',
  checkin: 'Odbavení vyžaduje pozornost',
  reservation: 'Zkontrolujte obsazenost aktivit',
  notification: 'Zkontrolujte doručení oznámení',
};

export const overviewAttention = (
  overview: AdminOperationsOverviewResponse,
  context: AdminContextResponse,
): OverviewAttention[] => {
  const archived = context.event.phase === 'archived';
  const items = overview.metrics.flatMap<OverviewAttention>((metric) => {
    const definition = adminDashboardMetricRegistry[metric.id];
    if (metric.state === 'healthy' || !definition.showInAttention(context))
      return [];
    // Waiting for participants to activate is progress, not an incident.
    if (metric.id === 'activation' && metric.state !== 'degraded') return [];
    if (metric.id === 'checkin' && !context.capabilities.canEnterCheckin)
      return [];
    return [
      {
        id: metric.id,
        title: attentionTitles[metric.id],
        detail: metric.detail,
        severity: metric.state,
        action: archived ? null : definition.resolveAction(context),
        fallback: archived ? null : definition.fallback(context),
      },
    ];
  });
  const failed = overview.queues.reduce(
    (total, queue) => total + queue.failed,
    0,
  );
  if (failed > 0 && !items.some((item) => item.id === 'notification')) {
    items.push({
      id: 'background',
      title: 'Zpracování na pozadí potřebuje kontrolu',
      detail: `Počet nedokončených úloh s chybou: ${failed}. Požádejte technickou podporu o kontrolu.`,
      severity: 'degraded',
      action: null,
      fallback: null,
    });
  }
  return items.sort(
    (left, right) =>
      Number(right.severity === 'degraded') -
      Number(left.severity === 'degraded'),
  );
};

export const overviewPercent = (value: number, total: number): number | null =>
  total > 0 ? Math.round((value / total) * 100) : null;

export const overviewCapacityLabel = (
  confirmed: number,
  capacity: number | null,
): string => {
  if (capacity === null) return 'Kapacita nenastavena';
  if (confirmed > capacity) return `Nad kapacitou o ${confirmed - capacity}`;
  if (capacity === 0) return 'Bez dostupných míst';
  if (confirmed === capacity) return 'Plně obsazeno';
  return formatCzechCount(capacity - confirmed, {
    one: 'volné místo',
    few: 'volná místa',
    other: 'volných míst',
  });
};
