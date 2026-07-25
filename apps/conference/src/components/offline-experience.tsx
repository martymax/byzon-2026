'use client';

import type { PublicContentResponse } from '@byzon/domain/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  loadPublicOfflineContent,
  type PublicOfflineContentResult,
} from '@/lib/offline/public-offline-content';

import styles from './offline-experience.module.css';

interface OfflineCapabilityState {
  readonly database: boolean;
  readonly dataMode: 'preview' | 'preview_failed' | 'production';
  readonly persistentStorage: boolean | null;
  readonly serviceWorker: boolean;
}

const initialCapabilities: OfflineCapabilityState = {
  database: false,
  dataMode: 'production',
  persistentStorage: null,
  serviceWorker: false,
};

const browserCapabilities = (): OfflineCapabilityState => {
  const mode = document.documentElement.dataset.byzonMockMode;
  return {
    database: 'indexedDB' in window,
    dataMode:
      mode === 'active'
        ? 'preview'
        : mode === 'failed'
          ? 'preview_failed'
          : 'production',
    persistentStorage: null,
    serviceWorker: 'serviceWorker' in navigator,
  };
};

const formatTimestamp = (value: string): string => {
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return 'čas není dostupný';
  }
};

const sessionTime = (startsAt: string, timezone: string): string => {
  try {
    return new Intl.DateTimeFormat('cs-CZ', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(new Date(startsAt));
  } catch {
    return 'Termín bude upřesněn';
  }
};

const contentStatusCopy = (
  result: Extract<PublicOfflineContentResult, { status: 'ready' }>,
) => {
  if (result.source === 'network') {
    return {
      label: 'Aktuální veřejná data',
      detail: 'Právě ověřeno přes připojení.',
      tone: 'fresh',
    } as const;
  }
  if (result.freshness === 'stale') {
    return {
      label: 'Uložená data mohou být zastaralá',
      detail:
        'Zobrazuje se poslední bezpečně uložená veřejná publikace. Po připojení ji ověříme.',
      tone: 'stale',
    } as const;
  }
  return {
    label: 'Uložená veřejná data',
    detail:
      'Tato publikace je dostupná bez připojení; po návratu online ji znovu ověříme.',
    tone: 'cached',
  } as const;
};

const ProgramPreview = ({ data }: { readonly data: PublicContentResponse }) => {
  const sessions = useMemo(
    () =>
      [...data.program.sessions]
        .filter(({ status }) => status !== 'cancelled')
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
        .slice(0, 4),
    [data.program.sessions],
  );
  const roomNames = useMemo(
    () =>
      new Map(data.program.rooms.map((room) => [room.id, room.name] as const)),
    [data.program.rooms],
  );

  return (
    <section aria-labelledby="offline-program-title" className={styles.card}>
      <div className={styles.cardHeading}>
        <p className={styles.kicker}>Veřejný obsah</p>
        <h2 id="offline-program-title">Nejbližší program</h2>
      </div>
      {sessions.length === 0 ? (
        <p>V této publikaci zatím nejsou žádné body programu.</p>
      ) : (
        <ol className={styles.sessionList}>
          {sessions.map((session) => (
            <li key={session.id}>
              <time dateTime={session.startsAt}>
                {sessionTime(session.startsAt, data.event.timezone)}
              </time>
              <strong>{session.title}</strong>
              {session.roomId && roomNames.get(session.roomId) ? (
                <span>{roomNames.get(session.roomId)}</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

const PracticalPreview = ({
  data,
}: {
  readonly data: PublicContentResponse;
}) => (
  <section aria-labelledby="offline-practical-title" className={styles.card}>
    <div className={styles.cardHeading}>
      <p className={styles.kicker}>Na místě</p>
      <h2 id="offline-practical-title">Praktické informace</h2>
    </div>
    {data.practical.pages.length === 0 && data.practical.faqs.length === 0 ? (
      <p>V této publikaci zatím nejsou praktické informace.</p>
    ) : (
      <ul className={styles.practicalList}>
        {data.practical.pages.slice(0, 4).map((page) => (
          <li key={page.id}>
            <strong>{page.title}</strong>
            {page.summary ? <span>{page.summary}</span> : null}
          </li>
        ))}
        {data.practical.faqs.slice(0, 4).map((faq) => (
          <li key={faq.id}>
            <strong>{faq.question}</strong>
            {faq.category ? <span>{faq.category}</span> : null}
          </li>
        ))}
      </ul>
    )}
  </section>
);

export function OfflineExperience({
  eventSlug = 'byzon-2026',
  loader = loadPublicOfflineContent,
}: {
  readonly eventSlug?: string;
  readonly loader?: (
    eventSlug: string,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<PublicOfflineContentResult>;
}) {
  const [attempt, setAttempt] = useState(0);
  const [capabilities, setCapabilities] =
    useState<OfflineCapabilityState>(initialCapabilities);
  const [result, setResult] = useState<PublicOfflineContentResult | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- Browser capabilities do
     not exist during SSR and are deliberately revealed only after hydration. */
  useEffect(() => {
    const current = browserCapabilities();
    setCapabilities(current);
    if ('storage' in navigator && navigator.storage.persisted) {
      void navigator.storage
        .persisted()
        .then((persistentStorage) =>
          setCapabilities((value) => ({ ...value, persistentStorage })),
        )
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    void loader(eventSlug, { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setResult(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setResult({ status: 'unavailable', reason: 'offline' });
        }
      });
    return () => controller.abort();
  }, [attempt, eventSlug, loader]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const ready = result?.status === 'ready' ? result : null;
  const statusCopy = ready ? contentStatusCopy(ready) : null;

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.kicker}>Offline centrum</p>
        <h1 data-route-heading tabIndex={-1}>
          Důležité informace zůstávají po ruce
        </h1>
        <p>
          Do zařízení ukládáme jen verzovaný veřejný program, praktické
          informace a agendu přihlášeného účtu. Rezervace ani odbavení nikdy
          nepotvrzujeme bez serveru.
        </p>
      </header>

      {result === null ? (
        <section aria-busy="true" aria-live="polite" className={styles.loading}>
          <span aria-hidden="true" />
          <p>Ověřuji bezpečně uložený veřejný obsah…</p>
        </section>
      ) : ready && statusCopy ? (
        <>
          <section
            aria-label="Stav offline obsahu"
            className={styles.contentStatus}
            data-tone={statusCopy.tone}
          >
            <div>
              <strong>{statusCopy.label}</strong>
              <p>{statusCopy.detail}</p>
            </div>
            <dl>
              <div>
                <dt>Publikace</dt>
                <dd>verze {ready.data.version}</dd>
              </div>
              <div>
                <dt>Uloženo / ověřeno</dt>
                <dd>{formatTimestamp(ready.storedAt)}</dd>
              </div>
            </dl>
          </section>
          <section className={styles.eventName} aria-label="Aktuální akce">
            <span>Načtená akce</span>
            <strong>{ready.data.event.name}</strong>
          </section>
          <div className={styles.grid}>
            <ProgramPreview data={ready.data} />
            <PracticalPreview data={ready.data} />
          </div>
        </>
      ) : (
        <section className={styles.unavailable} role="status">
          <p className={styles.kicker}>Obsah není v zařízení</p>
          <h2>Veřejný program se zatím nepodařilo otevřít</h2>
          <p>
            Připojte se alespoň jednou, otevřete program a potom bude jeho
            poslední veřejná publikace dostupná i bez sítě.
          </p>
          <div className={styles.buttonRow}>
            <button onClick={retry} type="button">
              Zkusit znovu
            </button>
            <a href="/">Zpět na úvod</a>
          </div>
        </section>
      )}

      <section
        aria-labelledby="offline-capabilities-title"
        className={styles.capabilities}
      >
        <div className={styles.cardHeading}>
          <p className={styles.kicker}>Stav zařízení</p>
          <h2 id="offline-capabilities-title">Co je právě dostupné</h2>
        </div>
        <dl className={styles.capabilityList}>
          <div>
            <dt>Datový režim</dt>
            <dd data-state={capabilities.dataMode}>
              {capabilities.dataMode === 'preview'
                ? 'Ukázková data · vývoj'
                : capabilities.dataMode === 'preview_failed'
                  ? 'Ukázkový režim selhal'
                  : 'Produkční API'}
            </dd>
          </div>
          <div>
            <dt>Veřejný obsah</dt>
            <dd data-state={ready ? 'available' : 'unavailable'}>
              {ready ? 'Načtený' : 'Zatím nenačtený'}
            </dd>
          </div>
          <div>
            <dt>Osobní offline agenda</dt>
            <dd
              data-state={capabilities.database ? 'available' : 'unavailable'}
            >
              {capabilities.database ? 'Podporovaná' : 'Nepodporovaná'}
            </dd>
          </div>
          <div>
            <dt>Aktualizace aplikace</dt>
            <dd
              data-state={
                capabilities.serviceWorker ? 'available' : 'unavailable'
              }
            >
              {capabilities.serviceWorker ? 'Podporované' : 'Nepodporované'}
            </dd>
          </div>
          <div>
            <dt>Trvalé úložiště</dt>
            <dd
              data-state={
                capabilities.persistentStorage === true
                  ? 'available'
                  : 'neutral'
              }
            >
              {capabilities.persistentStorage === null
                ? 'Ověřuje se'
                : capabilities.persistentStorage
                  ? 'Potvrzené'
                  : 'Spravuje prohlížeč'}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="offline-rules-title" className={styles.rules}>
        <div className={styles.cardHeading}>
          <p className={styles.kicker}>Bez falešných příslibů</p>
          <h2 id="offline-rules-title">Pravidla změn bez připojení</h2>
        </div>
        <ul>
          <li>
            <strong>Lze odložit:</strong> přidání nebo odebrání bodu z osobní
            agendy. Uvidíte stav čekání, konflikt i možnost opakování.
          </li>
          <li>
            <strong>Vyžaduje server:</strong> rezervace, čekací listina, nabídka
            místa, vstupenka a check-in. Bez připojení nikdy nezobrazíme úspěch.
          </li>
          <li>
            <strong>Soukromí:</strong> data agendy jsou oddělená podle akce a
            účtu a po odhlášení, změně účtu nebo odebrání přístupu se smažou.
          </li>
        </ul>
      </section>
    </main>
  );
}
