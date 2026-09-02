'use client';

import type {
  AdminContextResponse,
  AdminOperationsOverviewResponse,
} from '@byzon/domain/contracts/admin';
import {
  AdminAttentionList,
  AdminEmptyState,
  AdminMetricCard,
  AdminPageHeader,
  AdminStatusBadge,
  AdminTechnicalDetails,
  Button,
} from '@byzon/ui';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { requestAdminOperationsOverview } from '@/lib/admin-api';

import {
  adminDashboardMetricOrder,
  adminDashboardMetricRegistry,
  type AdminDashboardMetricIcon,
} from './admin-dashboard-registry';
import { adminCountForms, formatCzechCount } from './admin-copy';
import {
  adminMetricStateLabels,
  adminPhaseLabels,
  adminQueueLabels,
} from './admin-ui-registry';
import { adminFailureMessage } from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

type Metric = AdminOperationsOverviewResponse['metrics'][number];
type Phase = AdminContextResponse['event']['phase'];

const metricStateTone = {
  healthy: 'success',
  attention: 'warning',
  degraded: 'danger',
} as const satisfies Record<Metric['state'], 'success' | 'warning' | 'danger'>;

const metricStateIcon = {
  healthy: '✓',
  attention: '!',
  degraded: '×',
} as const satisfies Record<Metric['state'], string>;

const DashboardIcon = ({
  name,
}: {
  readonly name: AdminDashboardMetricIcon;
}) => {
  const paths: Record<AdminDashboardMetricIcon, ReactNode> = {
    activation: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0M19 3v4M17 5h4" />
      </>
    ),
    tickets: (
      <>
        <path d="M20 12a2 2 0 0 0 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 0 0-4V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 0-2 2Z" />
        <path d="M13 5v2M13 17v2M13 11v2" />
      </>
    ),
    content: (
      <>
        <path d="M8 2v4M16 2v4M3 9h18" />
        <rect height="18" rx="2" width="18" x="3" y="4" />
      </>
    ),
    checkin: <path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 12h10" />,
    reservations: (
      <>
        <path d="M5 11V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5" />
        <path d="M3 11h18v8H3zM5 19v2M19 19v2" />
      </>
    ),
    announcements: (
      <>
        <path d="m3 11 18-5v12L3 13v-2Z" />
        <path d="m11.6 15.4.9 4.1a2 2 0 0 1-3.9.9L7.5 14.3" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      width="20"
    >
      {paths[name]}
    </svg>
  );
};

interface PhaseTask {
  readonly href?: string;
  readonly label: string;
  readonly permission?: AdminContextResponse['actor']['permissions'][number];
  readonly title: string;
}

const phaseTasks = {
  draft: [
    {
      href: '/admin/obsah',
      label: 'Připravit program',
      permission: 'program:manage',
      title: 'Dokončete obsah před zveřejněním',
    },
    {
      href: '/admin/vstupenky',
      label: 'Načíst změny vstupenek',
      permission: 'ticket:any:manage',
      title: 'Zkontrolujte zdroj účastníků',
    },
  ],
  activation_open: [
    {
      href: '/admin/ucastnici',
      label: 'Otevřít účastníky',
      permission: 'participant:operational:read',
      title: 'Pomozte lidem dokončit aktivaci',
    },
    {
      href: '/admin/obsah',
      label: 'Zkontrolovat program',
      permission: 'program:manage',
      title: 'Ověřte zveřejněný obsah',
    },
  ],
  live: [
    {
      href: '/admin/rezervace',
      label: 'Otevřít kapacity',
      permission: 'reservation:any:read',
      title: 'Sledujte kapacity aktivit',
    },
    {
      href: '/admin/oznameni',
      label: 'Otevřít oznámení',
      permission: 'announcement:send',
      title: 'Kritickou změnu sdělte účastníkům',
    },
  ],
  ended: [
    {
      href: '/admin/reporty',
      label: 'Otevřít reporty',
      permission: 'personal-data:operational:export',
      title: 'Připravte souhrn akce',
    },
    {
      href: '/admin/audit',
      label: 'Projít historii',
      permission: 'audit:read',
      title: 'Zkontrolujte důležité změny',
    },
  ],
  archived: [
    {
      href: '/admin/audit',
      label: 'Otevřít historii',
      permission: 'audit:read',
      title: 'Archiv je dostupný pouze ke čtení',
    },
  ],
} as const satisfies Record<Phase, readonly PhaseTask[]>;

const formatCurrentTime = (value: string, timeZone: string): string => {
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(new Date(value));
  } catch {
    return 'čas není dostupný';
  }
};

export const AdminOverviewWorkspace = () => {
  const { api, context, eventId, eventTimezone, invalidateSensitive } =
    useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const [overview, setOverview] =
    useState<AdminOperationsOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const archived = context.event.phase === 'archived';

  useEffect(() => {
    const request = requestFence.begin('admin-overview');
    void requestAdminOperationsOverview(api, eventId, request.signal).then(
      (result) => {
        if (!request.isCurrent()) return;
        request.finish();
        if (!result.ok) {
          setOverview(null);
          if (isAdminSecurityFailure(result)) {
            invalidateSensitive(
              adminFailureMessage(result.failure, result.metadata?.requestId),
            );
            return;
          }
          setError(
            adminFailureMessage(result.failure, result.metadata?.requestId),
          );
          return;
        }
        if (result.kind === 'success') {
          setError(null);
          setOverview(result.data);
        }
      },
    );
    return () => requestFence.cancel('admin-overview');
  }, [api, eventId, invalidateSensitive, reload, requestFence]);

  const metricsById = useMemo(
    () => new Map(overview?.metrics.map((metric) => [metric.id, metric])),
    [overview],
  );
  const attentionMetrics = useMemo(
    () =>
      adminDashboardMetricOrder.flatMap((id) => {
        const metric = metricsById.get(id);
        if (
          !metric ||
          metric.state === 'healthy' ||
          !adminDashboardMetricRegistry[id].showInAttention(context)
        ) {
          return [];
        }
        return [metric];
      }),
    [context, metricsById],
  );
  const queueTotals = useMemo(
    () =>
      overview?.queues.reduce(
        (totals, queue) => ({
          failed: totals.failed + queue.failed,
          processing: totals.processing + queue.processing,
          ready: totals.ready + queue.ready,
        }),
        { failed: 0, processing: 0, ready: 0 },
      ) ?? { failed: 0, processing: 0, ready: 0 },
    [overview],
  );
  const hasTechnicalWork =
    queueTotals.ready > 0 ||
    queueTotals.processing > 0 ||
    queueTotals.failed > 0;
  const visiblePhaseTasks = phaseTasks[context.event.phase].filter(
    (task) =>
      !task.permission || context.actor.permissions.includes(task.permission),
  );
  const firstActionableAttentionId = attentionMetrics.find((metric) =>
    archived
      ? false
      : Boolean(adminDashboardMetricRegistry[metric.id].resolveAction(context)),
  )?.id;

  const reloadOverview = () => {
    setError(null);
    setOverview(null);
    setReload((value) => value + 1);
  };

  return (
    <div className={styles.stack}>
      <AdminPageHeader
        action={
          <Button onClick={reloadOverview} variant="secondary">
            Obnovit přehled
          </Button>
        }
        description={`${context.event.name} · ${adminPhaseLabels[context.event.phase]}`}
        meta={
          overview
            ? `Aktuální k ${formatCurrentTime(overview.generatedAt, eventTimezone)}`
            : 'Čekám na aktuální data'
        }
        title="Přehled akce"
      />

      {error ? (
        <section className={styles.errorSummary} role="alert">
          <h2>Přehled se nepodařilo načíst</h2>
          <p>{error}</p>
          <Button onClick={reloadOverview} variant="secondary">
            Zkusit znovu
          </Button>
        </section>
      ) : !overview ? (
        <section className={styles.panel} aria-busy="true">
          <p role="status">Načítám aktuální stav akce…</p>
        </section>
      ) : overview.metrics.length === 0 ? (
        <AdminEmptyState
          action={
            archived ? undefined : context.actor.permissions.includes(
                'ticket:any:manage',
              ) ? (
              <Link
                className="ui-action ui-action--secondary ui-action--medium"
                href="/admin/vstupenky"
                prefetch={false}
              >
                Načíst změny vstupenek
              </Link>
            ) : context.actor.permissions.includes('program:manage') ? (
              <Link
                className="ui-action ui-action--secondary ui-action--medium"
                href="/admin/obsah"
                prefetch={false}
              >
                Připravit program
              </Link>
            ) : undefined
          }
          title="Přehled zatím nemá data"
        >
          Začněte načtením změn vstupenek nebo přípravou programu.
        </AdminEmptyState>
      ) : (
        <>
          {attentionMetrics.length > 0 ? (
            <AdminAttentionList
              items={attentionMetrics.map((metric) => {
                const definition = adminDashboardMetricRegistry[metric.id];
                const action = archived
                  ? null
                  : definition.resolveAction(context);
                const fallback = definition.fallback(context);
                return {
                  action: action ? (
                    <Link
                      className={`ui-action ui-action--${
                        metric.id === firstActionableAttentionId
                          ? 'primary'
                          : 'secondary'
                      } ui-action--medium`}
                      href={action.href}
                      prefetch={false}
                    >
                      {action.label}
                    </Link>
                  ) : undefined,
                  description: (
                    <>
                      <span>{metric.detail}</span>
                      {!action && fallback ? (
                        <small className={styles.dashboardFallback}>
                          {fallback}
                        </small>
                      ) : null}
                    </>
                  ),
                  id: metric.id,
                  severity: metric.state === 'degraded' ? 'danger' : 'warning',
                  title: definition.label,
                };
              })}
              sortBySeverity={false}
            />
          ) : (
            <section className={styles.dashboardHealthy} role="status">
              <h2>Teď není potřeba žádný zásah</h2>
              <p>Všechny dostupné oblasti jsou bez upozornění.</p>
            </section>
          )}

          <section aria-labelledby="dashboard-status-title">
            <h2 id="dashboard-status-title">Stav akce</h2>
            <div className={styles.dashboardMetricGrid}>
              {adminDashboardMetricOrder.map((id) => {
                const metric = metricsById.get(id);
                const definition = adminDashboardMetricRegistry[id];
                return (
                  <div
                    className={styles.dashboardMetricCard}
                    data-state={metric?.state ?? 'missing'}
                    key={id}
                  >
                    <div className={styles.dashboardMetricIcon}>
                      <DashboardIcon name={definition.icon} />
                    </div>
                    <AdminMetricCard
                      detail={
                        metric ? (
                          <>
                            <AdminStatusBadge
                              icon={metricStateIcon[metric.state]}
                              tone={metricStateTone[metric.state]}
                            >
                              {adminMetricStateLabels[metric.state]}
                            </AdminStatusBadge>
                            <p>{metric.detail}</p>
                          </>
                        ) : (
                          'Data zatím nejsou dostupná.'
                        )
                      }
                      label={definition.label}
                      value={metric?.value ?? '—'}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="next-tasks-title">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="next-tasks-title">Další úkoly</h2>
                <p className={styles.muted}>
                  Doporučení odpovídají fázi „
                  {adminPhaseLabels[context.event.phase]}“.
                </p>
              </div>
            </div>
            {visiblePhaseTasks.length > 0 ? (
              <ul className={styles.dashboardTaskList}>
                {visiblePhaseTasks.map((task) => (
                  <li key={task.title}>
                    <strong>{task.title}</strong>
                    {task.href ? (
                      <Link href={task.href} prefetch={false}>
                        {task.label}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>
                Pro tuto fázi a vaše oprávnění není připraven další úkol.
              </p>
            )}
          </section>

          {hasTechnicalWork ? (
            <section className={styles.panel} aria-labelledby="technical-title">
              <h2 id="technical-title">Technický provoz</h2>
              <p className={styles.muted}>
                Zobrazuje jen souhrnné počty bez obsahu úloh a osobních údajů.
              </p>
              <AdminTechnicalDetails>
                <dl className={styles.dashboardQueueList}>
                  {overview.queues.map((queue) => (
                    <div key={queue.queue}>
                      <dt>{adminQueueLabels[queue.queue]}</dt>
                      <dd>
                        {formatCzechCount(
                          queue.ready,
                          adminCountForms.waitingTask,
                        )}{' '}
                        ·{' '}
                        {formatCzechCount(
                          queue.processing,
                          adminCountForms.processingTask,
                        )}{' '}
                        ·{' '}
                        {formatCzechCount(
                          queue.failed,
                          adminCountForms.failedTask,
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </AdminTechnicalDetails>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
};
