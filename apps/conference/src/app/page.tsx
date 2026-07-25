import { isFrontendPreviewAvailable } from '@/lib/frontend-preview';

export default function HomePage() {
  const previewAvailable = isFrontendPreviewAvailable();

  return (
    <section className="hero">
      <div className="hero-card">
        <p className="eyebrow">18.–19. září 2026 · České Budějovice</p>
        <h1>
          Byznys bez
          <br />
          <span>náhubku.</span>
        </h1>
        <p className="lead">
          Program, osobní agenda a vše důležité pro účastníky konference BYZON
          na jednom místě.
        </p>
        <div className="status-card" aria-label="Stav aplikace">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>
              {previewAvailable
                ? 'Vývojová ukázka je připravená'
                : 'Aplikaci právě připravujeme'}
            </strong>
            <small>
              {previewAvailable
                ? 'Projděte si bezpečnou aktivaci nad mock daty.'
                : 'Základ je připravený pro další etapu.'}
            </small>
          </div>
        </div>
        {previewAvailable ? (
          <>
            <a className="button" href="/aktivace">
              Začít účastnickou aktivací
            </a>
            <nav
              aria-label="Syntetické uživatelské průchody"
              className="preview-journeys"
            >
              <a href="/app">
                <strong>Účastnická aplikace</strong>
                <span>Program, agenda, oznámení, vstupenka a účet</span>
              </a>
              <a href="/admin">
                <strong>Organizační provoz</strong>
                <span>Import, podpora, oznámení, role a audit</span>
              </a>
              <a href="/check-in">
                <strong>Check-in operátor</strong>
                <span>Scanner, ruční lookup, potvrzení a bezpečné undo</span>
              </a>
              <a href="/offline">
                <strong>PWA a offline stav</strong>
                <span>Cache, synchronizace, aktualizace a dostupnost dat</span>
              </a>
            </nav>
            <p className="preview-disclaimer">
              Všechny průchody používají výhradně syntetická data. Produkční
              účty, vstupenky ani provozní akce se nemění.
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
