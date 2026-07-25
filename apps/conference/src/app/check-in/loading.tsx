import styles from '../../components/checkin.module.css';

export default function CheckinLoading() {
  return (
    <div
      aria-busy="true"
      aria-labelledby="checkin-loading-title"
      className={styles.bootstrapPage}
    >
      <section className={styles.bootstrapCard} role="status">
        <p className={styles.overline}>BYZON · CHECK-IN</p>
        <h1 id="checkin-loading-title">Připravuji bezpečné odbavení</h1>
        <div aria-live="polite" className={styles.bootstrapLoading}>
          <span aria-hidden="true" className={styles.spinner} />
          <p>Načítám operátorský kontext bez ukládání citlivých dat…</p>
        </div>
      </section>
    </div>
  );
}
