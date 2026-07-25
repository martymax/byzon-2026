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
          <a className="button" href="/aktivace">
            Otevřít mock průchod
          </a>
        ) : null}
      </div>
    </section>
  );
}
