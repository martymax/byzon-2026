'use client';

import type { AdminOperationsOverviewResponse } from '@byzon/domain/contracts/admin';
import { useEffect, useState } from 'react';

import { requestAdminOperationsOverview } from '@/lib/admin-api';

import { adminFailureMessage } from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

const metricClass = {
  healthy: styles.metricHealthy,
  attention: styles.metricAttention,
  degraded: styles.metricDegraded,
} as const;

const metricStateLabel = {
  healthy: 'V pořádku',
  attention: 'Vyžaduje pozornost',
  degraded: 'Omezený provoz',
} as const;

export const AdminOverviewWorkspace = () => {
  const { api, eventId, invalidateSensitive } = useAdminWorkspace();
  const [overview, setOverview] =
    useState<AdminOperationsOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void requestAdminOperationsOverview(api, eventId, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        if (!result.ok) {
          setOverview(null);
          if (isAdminSecurityFailure(result.failure)) {
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
        if (result.kind === 'success') setOverview(result.data);
      },
    );
    return () => controller.abort();
  }, [api, eventId, invalidateSensitive, reload]);

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>F4 · organizační přehled</p>
        <h1>Provoz akce</h1>
        <p>
          Aktuální bezpečný snapshot aktivací, importů, obsahu, check-inu,
          rezervací a oznámení. Data se neukládají do prohlížeče.
        </p>
      </header>

      <section
        aria-busy={!overview && !error}
        aria-labelledby="overview-status-title"
        className={styles.panel}
      >
        <div className={styles.panelHeader}>
          <h2 id="overview-status-title">Stav klíčových oblastí</h2>
          {overview ? (
            <span className={styles.badge}>
              Snapshot v{overview.version} ·{' '}
              {new Intl.DateTimeFormat('cs-CZ', {
                hour: '2-digit',
                minute: '2-digit',
              }).format(new Date(overview.generatedAt))}
            </span>
          ) : null}
        </div>
        {error ? (
          <div className={styles.errorSummary} role="alert">
            <p>{error}</p>
            <button
              className={styles.secondaryButton}
              onClick={() => {
                setError(null);
                setOverview(null);
                setReload((value) => value + 1);
              }}
              type="button"
            >
              Načíst přehled znovu
            </button>
          </div>
        ) : !overview ? (
          <p role="status">Načítám provozní snapshot…</p>
        ) : overview.metrics.length === 0 ? (
          <div className={styles.empty}>
            <p>Pro tento event zatím nejsou dostupné provozní metriky.</p>
            <a className={styles.secondaryButton} href="/admin/vstupenky">
              Začít bezpečným importem
            </a>
          </div>
        ) : (
          <div className={styles.threeColumn}>
            {overview.metrics.map((metric) => (
              <article
                className={`${styles.metric} ${metricClass[metric.state]}`}
                key={metric.id}
              >
                <div className={styles.panelHeader}>
                  <h3>{metric.label}</h3>
                  <span
                    className={`${styles.statusBadge} ${
                      metric.state === 'healthy'
                        ? styles.statusHealthy
                        : metric.state === 'attention'
                          ? styles.statusAttention
                          : styles.statusDegraded
                    }`}
                  >
                    {metricStateLabel[metric.state]}
                  </span>
                </div>
                <strong>{metric.value}</strong>
                <p>{metric.detail}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="overview-actions-title">
        <h2 id="overview-actions-title">Doporučené provozní kroky</h2>
        <div className={styles.threeColumn}>
          <article className={styles.dataCard}>
            <h3>Zkontrolovat import</h3>
            <p>Nejprve ověřte immutable preview a teprve poté potvrďte dopad.</p>
            <a className={styles.secondaryButton} href="/admin/vstupenky">
              Otevřít import
            </a>
          </article>
          <article className={styles.dataCard}>
            <h3>Prověřit provoz</h3>
            <p>Queue přehled zobrazuje pouze agregované počty bez payloadů.</p>
            <a className={styles.secondaryButton} href="/admin/provoz">
              Otevřít provoz
            </a>
          </article>
          <article className={styles.dataCard}>
            <h3>Kapacita a účast</h3>
            <p>Každý override vyžaduje důvod, verzi a výslovné potvrzení.</p>
            <a className={styles.secondaryButton} href="/admin/rezervace">
              Otevřít rezervace
            </a>
          </article>
        </div>
      </section>
    </div>
  );
};
