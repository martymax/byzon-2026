'use client';

import type {
  AdminContextResponse,
  AdminOperationsOverviewResponse,
} from '@byzon/domain/contracts/admin';
import {
  AdminEmptyState,
  AdminPageHeader,
  AdminStatusBadge,
  AdminTechnicalDetails,
  Button,
} from '@byzon/ui';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { requestAdminOperationsOverview } from '@/lib/admin-api';

import {
  adminDashboardMetricRegistry,
  type AdminDashboardMetricIcon,
} from './admin-dashboard-registry';
import { adminCountForms, formatCzechCount } from './admin-copy';
import { adminMetricStateLabels, adminQueueLabels } from './admin-ui-registry';
import { adminFailureMessage } from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';
import dashboard from './admin-overview.module.css';
import {
  overviewAttention,
  overviewCapacityLabel,
  overviewPercent,
} from './admin-overview-model';

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
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(new Date(value));
  } catch {
    return 'čas není dostupný';
  }
};

const number = (value: number) => new Intl.NumberFormat('cs-CZ').format(value);

const Arrow = () => (
  <svg
    aria-hidden="true"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14m-5-5 5 5-5 5" />
  </svg>
);

const Progress = ({
  value,
  total,
  label,
  warning = false,
}: {
  value: number;
  total: number;
  label: string;
  warning?: boolean;
}) =>
  total > 0 ? (
    <progress
      aria-label={label}
      className={dashboard.progress}
      data-warning={warning}
      max={total}
      value={Math.min(value, total)}
    />
  ) : null;

const phaseDescription: Record<Phase, string> = {
  draft: 'Připravte program a načtěte účastníky. Tady uvidíte, co ještě zbývá.',
  activation_open:
    'Sledujte aktivace přístupů a připravenost programu před akcí.',
  live: 'Účastníci, obsazenost aktivit a vše, co právě potřebuje vaši pozornost.',
  ended: 'Výsledný stav akce. Podrobné souhrny najdete v reportech.',
  archived: 'Souhrn archivované akce. Údaje jsou dostupné pouze ke čtení.',
};

export const AdminOverviewWorkspace = () => {
  const { api, context, eventId, eventTimezone, invalidateSensitive } =
    useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const [overview, setOverview] =
    useState<AdminOperationsOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [reload, setReload] = useState(0);
  const archived = context.event.phase === 'archived';

  useEffect(() => {
    const request = requestFence.begin('admin-overview');
    void requestAdminOperationsOverview(api, eventId, request.signal).then(
      (result) => {
        if (!request.isCurrent()) return;
        request.finish();
        setRefreshing(false);
        if (!result.ok) {
          if (isAdminSecurityFailure(result)) {
            setOverview(null);
            invalidateSensitive(
              adminFailureMessage(result.failure, result.metadata?.requestId),
            );
            return;
          }
          setError(
            ['timeout', 'transport', 'invalid_response'].includes(
              result.failure.kind,
            )
              ? 'Aktuální údaje nejsou dostupné. Zkuste přehled načíst znovu.'
              : adminFailureMessage(result.failure, result.metadata?.requestId),
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

  // Never render another event's response while a new request is in flight.
  const data = overview?.eventId === eventId ? overview : null;
  const metrics = useMemo(
    () => new Map(data?.metrics.map((metric) => [metric.id, metric])),
    [data],
  );
  const attention = useMemo(
    () => (data ? overviewAttention(data, context) : []),
    [context, data],
  );
  const activation = data?.summary?.activation;
  const reservations = data?.summary?.reservations;
  const activationPercent = activation
    ? overviewPercent(activation.activated, activation.total)
    : null;
  const reservationPercent = reservations
    ? overviewPercent(reservations.confirmed, reservations.capacity)
    : null;
  const tasks = phaseTasks[context.event.phase].filter(
    (task) =>
      (!task.permission ||
        context.actor.permissions.includes(task.permission)) &&
      (task.permission !== 'announcement:send' ||
        context.features.announcementsEnabled),
  );
  const primaryTask = tasks[0];
  const issueCount = attention.length;
  const hasMissingMetrics =
    !data?.summary ||
    !['activation', 'import', 'content', 'reservation'].every((id) =>
      metrics.has(id as Metric['id']),
    );
  const statusMetrics = (['content', 'import', 'notification'] as const).map(
    (id) => ({ id, metric: metrics.get(id) }),
  );

  const reloadOverview = () => {
    setRefreshing(true);
    setError(null);
    setReload((value) => value + 1);
  };

  return (
    <div className={dashboard.overview}>
      <AdminPageHeader
        title="Přehled akce"
        description={phaseDescription[context.event.phase]}
        meta={
          <span className={dashboard.meta}>
            {data
              ? `Aktuální k ${formatCurrentTime(data.generatedAt, eventTimezone)}`
              : 'Čekám na aktuální data'}
            {error && data ? ' · aktualizace se nezdařila' : ''}
            {issueCount > 0 ? (
              <a className={dashboard.metaAlert} href="#attention-title">
                Vyžaduje pozornost: {issueCount}
                <Arrow />
              </a>
            ) : null}
          </span>
        }
        action={
          <div className={dashboard.headerActions}>
            <Button
              disabled={refreshing}
              onClick={reloadOverview}
              variant="secondary"
            >
              {refreshing ? 'Obnovuji…' : 'Obnovit přehled'}
            </Button>
            {primaryTask?.href ? (
              <Link
                className="ui-action ui-action--primary ui-action--medium"
                href={primaryTask.href}
                prefetch={false}
              >
                {primaryTask.label}
                <Arrow />
              </Link>
            ) : null}
          </div>
        }
      />

      {error ? (
        <section className={styles.errorSummary} role="alert">
          <h2>
            {data
              ? 'Zobrazuji poslední načtené údaje'
              : 'Přehled se nepodařilo načíst'}
          </h2>
          <p>{error}</p>
          <Button
            disabled={refreshing}
            onClick={reloadOverview}
            variant="secondary"
          >
            Zkusit znovu
          </Button>
        </section>
      ) : null}
      {!data && !error ? (
        <section className={dashboard.loading} aria-busy="true">
          <p role="status">Načítám aktuální stav akce…</p>
          <div className={dashboard.skeletonGrid} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      ) : null}
      {data?.metrics.length === 0 ? (
        <AdminEmptyState
          title="Přehled zatím nemá data"
          action={
            !archived &&
            context.actor.permissions.includes('ticket:any:manage') ? (
              <Link
                className="ui-action ui-action--secondary ui-action--medium"
                href="/admin/vstupenky"
                prefetch={false}
              >
                Načíst změny vstupenek
              </Link>
            ) : undefined
          }
        >
          Začněte načtením změn vstupenek nebo přípravou programu.
        </AdminEmptyState>
      ) : data ? (
        <>
          <section
            className={dashboard.stats}
            aria-label="Účastníci a rezervace"
          >
            <article className={dashboard.stat}>
              <div className={dashboard.statHeading}>
                <h2>Importovaní účastníci</h2>
                <span className={dashboard.icon}>
                  <DashboardIcon name="tickets" />
                </span>
              </div>
              <strong className={dashboard.statValue}>
                {activation ? number(activation.total) : '—'}
              </strong>
              <p>Lidé s přístupem vytvořeným z importu vstupenek.</p>
              <div className={dashboard.statFooter}>
                {!archived &&
                context.actor.permissions.includes(
                  'participant:operational:read',
                ) ? (
                  <Link href="/admin/ucastnici" prefetch={false}>
                    Vyhledat účastníka
                    <Arrow />
                  </Link>
                ) : (
                  <span>Celkový počet účastníků v importu</span>
                )}
              </div>
            </article>
            <article className={dashboard.stat}>
              <div className={dashboard.statHeading}>
                <h2>Aktivované přístupy</h2>
                <span className={dashboard.icon}>
                  <DashboardIcon name="activation" />
                </span>
              </div>
              <div className={dashboard.statNumber}>
                <strong className={dashboard.statValue}>
                  {activation
                    ? number(activation.activated)
                    : (metrics.get('activation')?.value ?? '—')}
                </strong>
                {activationPercent !== null ? (
                  <span className={dashboard.percent}>
                    {activationPercent} %
                  </span>
                ) : null}
              </div>
              <p>
                {activation ? (
                  activation.total === 0 ? (
                    'Aktivace začne po načtení účastníků.'
                  ) : activation.total === activation.activated ? (
                    'Všichni účastníci už ověřili svůj e-mail.'
                  ) : (
                    <>
                      Čeká na ověření e-mailu:{' '}
                      <strong>
                        {formatCzechCount(
                          activation.total - activation.activated,
                          {
                            one: 'přístup',
                            few: 'přístupy',
                            other: 'přístupů',
                          },
                        )}
                      </strong>
                      .
                    </>
                  )
                ) : (
                  (metrics.get('activation')?.detail ??
                  'Data zatím nejsou dostupná.')
                )}
              </p>
              <div className={dashboard.statFooter}>
                {activation ? (
                  <Progress
                    value={activation.activated}
                    total={activation.total}
                    label="Podíl aktivovaných přístupů"
                  />
                ) : null}
              </div>
            </article>
            <article className={dashboard.stat}>
              <div className={dashboard.statHeading}>
                <h2>Rezervovaná místa</h2>
                <span className={dashboard.icon}>
                  <DashboardIcon name="reservations" />
                </span>
              </div>
              <div className={dashboard.statNumber}>
                <strong className={dashboard.statValue}>
                  {reservations
                    ? number(reservations.confirmed)
                    : (metrics.get('reservation')?.value ?? '—')}
                </strong>
                {reservations ? (
                  <span className={dashboard.denominator}>
                    / {number(reservations.capacity)}
                  </span>
                ) : null}
              </div>
              <p>
                {reservations ? (
                  reservations.sessionCount === 0 ? (
                    'Zatím nejsou připravené aktivity s rezervací.'
                  ) : (
                    <>
                      Celkem{' '}
                      {formatCzechCount(
                        reservations.sessionCount,
                        adminCountForms.activity,
                      )}{' '}
                      s rezervací
                      {reservationPercent !== null
                        ? ` · obsazeno ${reservationPercent} %`
                        : ''}
                      .
                    </>
                  )
                ) : (
                  (metrics.get('reservation')?.detail ??
                  'Data zatím nejsou dostupná.')
                )}
              </p>
              <div className={dashboard.statFooter}>
                {reservations ? (
                  <Progress
                    value={reservations.confirmed}
                    total={reservations.capacity}
                    label="Obsazenost rezervačních míst"
                    warning={reservations.overbookedSessions > 0}
                  />
                ) : null}
              </div>
            </article>
          </section>

          <div className={dashboard.mainGrid}>
            <section
              className={dashboard.panel}
              aria-labelledby="attention-title"
            >
              <div className={dashboard.sectionHeader}>
                <div>
                  <span className={dashboard.eyebrow}>Priority</span>
                  <h2 id="attention-title" tabIndex={-1}>
                    {archived ? 'Zaznamenané stavy' : 'Co vyžaduje pozornost'}
                  </h2>
                </div>
                <span className={dashboard.count} data-alert={issueCount > 0}>
                  {issueCount}
                </span>
              </div>
              {attention.length > 0 ? (
                <ol className={dashboard.attentionList}>
                  {attention.map((item, index) => (
                    <li
                      key={item.id}
                      className={dashboard.attentionItem}
                      data-severity={item.severity}
                    >
                      <span className={dashboard.issueIcon} aria-hidden="true">
                        !
                      </span>
                      <div>
                        <div className={dashboard.issueHeading}>
                          <h3>{item.title}</h3>
                          <span className={dashboard.severity}>
                            {item.severity === 'degraded'
                              ? 'Chyba'
                              : 'Ke kontrole'}
                          </span>
                        </div>
                        <p>{item.detail}</p>
                        {item.action ? (
                          <Link
                            className={
                              index === 0
                                ? dashboard.priorityLink
                                : dashboard.textLink
                            }
                            href={item.action.href}
                            prefetch={false}
                          >
                            {item.action.label}
                            <Arrow />
                          </Link>
                        ) : item.fallback ? (
                          <p className={dashboard.fallback}>{item.fallback}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className={dashboard.healthy} role="status">
                  <span className={dashboard.healthyIcon} aria-hidden="true">
                    ✓
                  </span>
                  <h3>
                    {hasMissingMetrics
                      ? 'Některé údaje zatím chybí'
                      : 'Teď není potřeba žádný zásah'}
                  </h3>
                  <p>
                    {hasMissingMetrics
                      ? 'Úplný stav akce bude dostupný po načtení všech oblastí.'
                      : 'Sledované oblasti nehlásí provozní problém. Průběh aktivací a rezervací vidíte v přehledu.'}
                  </p>
                </div>
              )}
              {tasks.slice(1).length > 0 ? (
                <div className={dashboard.nextAction}>
                  {tasks.slice(1).map((task) => (
                    <div key={task.title}>
                      <span>{task.title}</span>
                      {task.href ? (
                        <Link
                          className={dashboard.textLink}
                          href={task.href}
                          prefetch={false}
                        >
                          {task.label}
                          <Arrow />
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>

            <section
              className={dashboard.panel}
              aria-labelledby="capacity-title"
            >
              <div className={dashboard.sectionHeader}>
                <div>
                  <span className={dashboard.eyebrow}>Rezervace</span>
                  <h2 id="capacity-title">Obsazenost aktivit</h2>
                </div>
                <span className={dashboard.icon}>
                  <DashboardIcon name="reservations" />
                </span>
              </div>
              <p className={dashboard.sectionDescription}>
                Nejvíce obsazené aktivity jsou nahoře. Počítají se potvrzené
                rezervace.
              </p>
              {reservations?.sessions.length ? (
                <ul className={dashboard.capacityList}>
                  {reservations.sessions.map((session) => {
                    const full =
                      session.capacity !== null &&
                      session.confirmed >= session.capacity &&
                      session.capacity > 0;
                    const over =
                      session.capacity !== null &&
                      session.confirmed > session.capacity;
                    return (
                      <li key={session.sessionId}>
                        <div className={dashboard.capacityHeading}>
                          <h3>{session.title}</h3>
                          <strong>
                            {number(session.confirmed)}
                            <span>
                              {' '}
                              /{' '}
                              {session.capacity === null
                                ? '—'
                                : number(session.capacity)}
                            </span>
                          </strong>
                        </div>
                        <div className={dashboard.capacityMeta}>
                          <time dateTime={session.startsAt}>
                            {new Intl.DateTimeFormat('cs-CZ', {
                              day: 'numeric',
                              month: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: eventTimezone,
                            }).format(new Date(session.startsAt))}
                            {session.status === 'draft' ? ' · Koncept' : ''}
                          </time>
                          <span
                            data-state={
                              over ? 'danger' : full ? 'warning' : 'neutral'
                            }
                          >
                            {overviewCapacityLabel(
                              session.confirmed,
                              session.capacity,
                            )}
                          </span>
                        </div>
                        <Progress
                          label={`Obsazenost: ${session.title}`}
                          value={session.confirmed}
                          total={session.capacity ?? 0}
                          warning={full || over}
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className={dashboard.empty}>
                  <h3>
                    {reservations
                      ? 'Zatím žádné aktivity s rezervací'
                      : 'Detail kapacit zatím není dostupný'}
                  </h3>
                  <p>
                    {reservations
                      ? 'Aktivity se zde objeví, jakmile v programu nastavíte rezervace.'
                      : 'Souhrnný stav rezervací najdete v horní části přehledu.'}
                  </p>
                </div>
              )}
              {!archived &&
              context.actor.permissions.includes('reservation:any:read') ? (
                <div className={dashboard.panelFooter}>
                  <Link
                    className={dashboard.textLink}
                    href="/admin/rezervace"
                    prefetch={false}
                  >
                    Všechny aktivity a rezervace
                    <Arrow />
                  </Link>
                  {reservations && reservations.sessionCount > 5 ? (
                    <span>
                      {reservations.sessions.length} z{' '}
                      {reservations.sessionCount}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>

          <section
            className={dashboard.operations}
            aria-labelledby="operations-title"
          >
            <div className={dashboard.operationsHeading}>
              <h2 id="operations-title">Program a provoz</h2>
              <p>Poslední známý stav jednotlivých oblastí.</p>
            </div>
            <div className={dashboard.statusGrid}>
              {statusMetrics.map(({ id, metric }) => {
                const definition = adminDashboardMetricRegistry[id];
                const disabled =
                  id === 'notification' &&
                  !context.features.announcementsEnabled;
                return (
                  <article key={id} className={dashboard.statusCard}>
                    <div className={dashboard.statusHeading}>
                      <DashboardIcon name={definition.icon} />
                      <h3>{definition.label}</h3>
                    </div>
                    <div className={dashboard.statusValue}>
                      <strong>
                        {disabled ? 'Vypnuto' : (metric?.value ?? '—')}
                      </strong>
                      {metric && !disabled ? (
                        <AdminStatusBadge
                          icon={metricStateIcon[metric.state]}
                          tone={metricStateTone[metric.state]}
                        >
                          {adminMetricStateLabels[metric.state]}
                        </AdminStatusBadge>
                      ) : null}
                    </div>
                    <p>
                      {disabled
                        ? 'Oznámení jsou pro tuto akci vypnutá.'
                        : (metric?.detail ?? 'Data zatím nejsou dostupná.')}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>
          {data.queues.some(
            (queue) => queue.ready + queue.processing + queue.failed > 0,
          ) ? (
            <AdminTechnicalDetails className={dashboard.technical}>
              <dl className={styles.dashboardQueueList}>
                {data.queues.map((queue) => (
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
          ) : null}
        </>
      ) : null}
    </div>
  );
};
