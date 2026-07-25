import styles from './admin-workspace.module.css';

const contentMetrics = [
  {
    label: 'Program',
    value: '12 session',
    detail: '2 dny · 3 sály · syntetická data',
  },
  {
    label: 'Řečníci',
    value: '9 profilů',
    detail: 'Všechny veřejné demo profily jsou validní',
  },
  {
    label: 'Praktický obsah',
    value: '6 položek',
    detail: 'Informace, partneři a FAQ',
  },
] as const;

export const AdminContentDemoWorkspace = () => (
  <div className={styles.stack}>
    <header className={styles.pageHeader}>
      <p className={styles.eyebrow}>Obsah akce · bezpečný preview</p>
      <h1>Publikovaný obsah</h1>
      <p>
        Kompaktní syntetický stav pro frontend průchod. Produkční editor a
        publikace se načtou jen mimo preview z integrovaného serverového
        rozhraní.
      </p>
    </header>
    <section className={styles.panel} aria-labelledby="content-state-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="content-state-title">Stav publikace</h2>
          <p className={styles.muted}>
            Immutable mock snapshot content-version-2026-07
          </p>
        </div>
        <span className={`${styles.statusBadge} ${styles.statusHealthy}`}>
          Publikováno · mock
        </span>
      </div>
      <div className={styles.threeColumn}>
        {contentMetrics.map((metric) => (
          <article className={styles.metric} key={metric.label}>
            <small>{metric.label}</small>
            <strong>{metric.value}</strong>
            <p>{metric.detail}</p>
          </article>
        ))}
      </div>
      <p className={styles.callout}>
        Čekající změny: 0. Content sync je v syntetickém snapshotu v pořádku.
        Tento panel neumí publikovat ani měnit produkční obsah.
      </p>
    </section>
  </div>
);
