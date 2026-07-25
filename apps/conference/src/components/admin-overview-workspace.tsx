'use client';

import { demoOperationsOverview } from './admin-workspace-demo-data';
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

export const AdminOverviewWorkspace = () => (
  <div className={styles.stack}>
    <header className={styles.pageHeader}>
      <p className={styles.eyebrow}>F4 · organizační přehled</p>
      <h1>Provoz akce</h1>
      <p>
        Jedno místo pro Priority A stav aktivací, importů, obsahu, check-inu,
        rezervací a oznámení. Hodnoty jsou validovaná syntetická data bez
        osobních údajů.
      </p>
    </header>

    <section className={styles.panel} aria-labelledby="overview-status-title">
      <div className={styles.panelHeader}>
        <h2 id="overview-status-title">Stav klíčových oblastí</h2>
        <span className={styles.badge}>Aktualizováno 12:00 · mock</span>
      </div>
      <div className={styles.threeColumn}>
        {demoOperationsOverview.metrics.map((metric) => (
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
    </section>

    <section className={styles.panel} aria-labelledby="overview-actions-title">
      <h2 id="overview-actions-title">Doporučené provozní kroky</h2>
      <div className={styles.threeColumn}>
        <article className={styles.dataCard}>
          <h3>Zkontrolovat import</h3>
          <p>
            Preview má jeden konflikt. Konfliktní řádek se v mock apply bezpečně
            přeskočí.
          </p>
          <a className={styles.secondaryButton} href="/admin/import">
            Otevřít import
          </a>
        </article>
        <article className={styles.dataCard}>
          <h3>Prověřit frontu</h3>
          <p>
            V DLQ je jedna anonymizovaná notification úloha; payload není v UI
            dostupný.
          </p>
          <a className={styles.secondaryButton} href="/admin/provoz">
            Otevřít provoz
          </a>
        </article>
        <article className={styles.dataCard}>
          <h3>Kapacita workshopu</h3>
          <p>
            Rezervace dosáhly 89 %. Každý override vyžaduje oprávnění, důvod a
            potvrzení.
          </p>
          <a className={styles.secondaryButton} href="/admin/rezervace">
            Otevřít rezervace
          </a>
        </article>
      </div>
    </section>
  </div>
);
