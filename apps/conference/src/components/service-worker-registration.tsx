'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { OFFLINE_AGENDA_SYNC_EVENT } from '../lib/offline/offline-policy';
import { activateServiceWorker } from '../lib/offline/service-worker-update';

import styles from './service-worker-registration.module.css';

const APP_SERVICE_WORKER_PATH = '/sw.js';
export const APP_SERVICE_WORKER_VERSION = '2026.07.26.1';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
export const INSTALL_PROMPT_DISMISSAL_MS = 30 * 24 * 60 * 60 * 1_000;
export const INSTALL_PROMPT_DISMISSAL_STORAGE_KEY =
  'byzon:pwa-install-dismissed-until:v1';

export const isInstallPromptDismissed = (
  storage: Pick<Storage, 'getItem'>,
  now = Date.now(),
): boolean => {
  try {
    const dismissedUntil = Number(
      storage.getItem(INSTALL_PROMPT_DISMISSAL_STORAGE_KEY),
    );
    return Number.isFinite(dismissedUntil) && dismissedUntil > now;
  } catch {
    return false;
  }
};

export const rememberInstallPromptDismissal = (
  storage: Pick<Storage, 'setItem'>,
  now = Date.now(),
): void => {
  try {
    storage.setItem(
      INSTALL_PROMPT_DISMISSAL_STORAGE_KEY,
      String(now + INSTALL_PROMPT_DISMISSAL_MS),
    );
  } catch {
    // The prompt still closes when browser storage is unavailable.
  }
};

export const shouldEnableAppServiceWorker = (
  nodeEnvironment: string | undefined,
): boolean => nodeEnvironment === 'production';

const subscribeToConnectivity = (onChange: () => void): (() => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

interface DeferredInstallPromptEvent extends Event {
  readonly userChoice: Promise<{
    readonly outcome: 'accepted' | 'dismissed';
    readonly platform: string;
  }>;
  prompt(): Promise<void>;
}

export const manualInstallInstructions = (
  userAgent: string,
  maxTouchPoints: number,
): string | null => {
  if (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  ) {
    return 'V Safari otevřete nabídku Sdílet (případně nejprve Více), zvolte Přidat na plochu a potvrďte Přidat. Pokud se zobrazí volba Otevřít jako webovou aplikaci, zapněte ji.';
  }
  if (
    /Macintosh/.test(userAgent) &&
    /Version\/.*Safari\//.test(userAgent) &&
    !/Chrome|Chromium|Edg|OPR/.test(userAgent)
  ) {
    return 'V Safari zvolte Soubor → Přidat do Docku a potvrďte Přidat. Tato možnost je dostupná v macOS Sonoma nebo novějším.';
  }
  return null;
};

const subscribeToInstallEnvironment = (onChange: () => void): (() => void) => {
  const displayMode = window.matchMedia('(display-mode: standalone)');
  displayMode.addEventListener('change', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    displayMode.removeEventListener('change', onChange);
    window.removeEventListener('storage', onChange);
  };
};

const getManualInstallSnapshot = (): string | null => {
  if (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
    return null;
  try {
    if (isInstallPromptDismissed(window.localStorage)) return null;
  } catch {
    // Installation instructions also work when storage access is blocked.
  }
  return manualInstallInstructions(
    navigator.userAgent,
    navigator.maxTouchPoints,
  );
};

type WorkerNotice = 'error' | 'install' | 'none' | 'offline' | 'update';

interface WaitingWorker {
  readonly version: string;
  readonly worker: ServiceWorker;
}

export const requestServiceWorkerVersion = (
  worker: Pick<ServiceWorker, 'postMessage'>,
  timeoutMs = 2_000,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = globalThis.setTimeout(() => {
      channel.port1.close();
      reject(
        new TypeError('Waiting service worker did not report its version.'),
      );
    }, timeoutMs);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data as {
        readonly type?: unknown;
        readonly version?: unknown;
      } | null;
      if (
        !data ||
        data.type !== 'BYZON_WORKER_VERSION' ||
        typeof data.version !== 'string' ||
        data.version.length < 1 ||
        data.version.length > 128 ||
        !/^[0-9A-Za-z._-]+$/.test(data.version)
      ) {
        return;
      }
      globalThis.clearTimeout(timeout);
      channel.port1.close();
      resolve(data.version);
    };
    try {
      worker.postMessage({ type: 'BYZON_GET_VERSION' }, [channel.port2]);
    } catch (error) {
      globalThis.clearTimeout(timeout);
      channel.port1.close();
      reject(error);
    }
  });

export const shouldRegisterAppServiceWorker = (
  scriptUrls: readonly string[],
  expectedOrigin: string,
): boolean =>
  scriptUrls.length === 0 ||
  scriptUrls.every((scriptUrl) => {
    try {
      const url = new URL(scriptUrl);
      return (
        url.origin === expectedOrigin &&
        url.pathname === APP_SERVICE_WORKER_PATH
      );
    } catch {
      return false;
    }
  });

export const shouldUnregisterAppServiceWorker = (
  scriptUrls: readonly string[],
  expectedOrigin: string,
): boolean =>
  scriptUrls.length > 0 &&
  shouldRegisterAppServiceWorker(scriptUrls, expectedOrigin);

export const serviceWorkerNotice = ({
  failed,
  installAvailable,
  online,
  updateAvailable,
}: {
  readonly failed: boolean;
  readonly installAvailable: boolean;
  readonly online: boolean;
  readonly updateAvailable: boolean;
}): WorkerNotice => {
  if (!online) return 'offline';
  if (updateAvailable) return 'update';
  if (failed) return 'error';
  if (installAvailable) return 'install';
  return 'none';
};

const registrationWorkers = (
  registration: ServiceWorkerRegistration | undefined,
): readonly ServiceWorker[] =>
  registration
    ? [registration.active, registration.installing, registration.waiting]
        .filter((worker): worker is ServiceWorker => worker !== null)
        .filter((worker, index, workers) => workers.indexOf(worker) === index)
    : [];

export const unregisterOwnedAppServiceWorkers = async (
  serviceWorkers: Pick<ServiceWorkerContainer, 'getRegistrations'>,
  expectedOrigin: string,
): Promise<number> => {
  const registrations = await serviceWorkers.getRegistrations();
  const owned = registrations.filter((registration) =>
    shouldUnregisterAppServiceWorker(
      registrationWorkers(registration).map(({ scriptURL }) => scriptURL),
      expectedOrigin,
    ),
  );
  await Promise.all(owned.map((registration) => registration.unregister()));
  return owned.length;
};

export function ServiceWorkerRegistration() {
  const [failed, setFailed] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<DeferredInstallPromptEvent | null>(null);
  const manualInstallSnapshot = useSyncExternalStore(
    subscribeToInstallEnvironment,
    getManualInstallSnapshot,
    () => null,
  );
  const [manualInstallHidden, setManualInstallHidden] = useState(false);
  const manualInstall = manualInstallHidden ? null : manualInstallSnapshot;
  const [showInstallInstructions, setShowInstallInstructions] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<
    'idle' | 'applying' | 'error'
  >('idle');
  const online = useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    () => true,
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const waitingWorker = useRef<WaitingWorker | null>(null);
  const applyingUpdate = useRef<AbortController | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloading = useRef(false);

  useEffect(() => {
    const displayMode = window.matchMedia('(display-mode: standalone)');
    let installed =
      displayMode.matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const dismissed = () => {
      try {
        return isInstallPromptDismissed(window.localStorage);
      } catch {
        return false;
      }
    };
    const onBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as DeferredInstallPromptEvent;
      promptEvent.preventDefault();
      if (installed || dismissed()) return;
      setInstallPrompt(promptEvent);
    };
    const onAppInstalled = () => {
      installed = true;
      setInstallPrompt(null);
      setManualInstallHidden(true);
    };
    const onDisplayModeChange = () => {
      if (displayMode.matches) onAppInstalled();
    };
    displayMode.addEventListener('change', onDisplayModeChange);

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      displayMode.removeEventListener('change', onDisplayModeChange);
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    if (!shouldEnableAppServiceWorker(process.env.NODE_ENV)) {
      void unregisterOwnedAppServiceWorkers(
        navigator.serviceWorker,
        window.location.origin,
      ).catch(() => undefined);
      return;
    }

    let disposed = false;
    let waitingProbe = 0;
    let registration: ServiceWorkerRegistration | undefined;
    const workerStateListeners = new Map<
      ServiceWorker,
      (event: Event) => void
    >();

    const exposeWaitingWorker = (worker: ServiceWorker | null) => {
      if (disposed || !worker) return;
      const probe = ++waitingProbe;
      void requestServiceWorkerVersion(worker)
        .then((version) => {
          if (
            disposed ||
            probe !== waitingProbe ||
            worker.state !== 'installed'
          )
            return;
          if (waitingWorker.current?.worker === worker) return;
          waitingWorker.current = { version, worker };
          setUpdateDismissed(false);
          setUpdateAvailable(true);
        })
        .catch(() => {
          if (!disposed && probe === waitingProbe) setFailed(true);
        });
    };

    const observeWorker = (worker: ServiceWorker | null) => {
      if (!worker || workerStateListeners.has(worker)) return;
      const onStateChange = () => {
        if (
          worker.state === 'installed' &&
          navigator.serviceWorker.controller
        ) {
          exposeWaitingWorker(
            registration?.waiting ??
              (worker.state === 'installed' ? worker : null),
          );
        }
      };
      worker.addEventListener('statechange', onStateChange);
      workerStateListeners.set(worker, onStateChange);
    };

    const register = async () => {
      const existing = await navigator.serviceWorker.getRegistration('/');
      const scriptUrls = registrationWorkers(existing).map(
        ({ scriptURL }) => scriptURL,
      );
      if (!shouldRegisterAppServiceWorker(scriptUrls, window.location.origin)) {
        return;
      }
      registration = await navigator.serviceWorker.register(
        APP_SERVICE_WORKER_PATH,
        {
          scope: '/',
          updateViaCache: 'none',
        },
      );
      if (disposed) return;
      registrationRef.current = registration;
      setFailed(false);
      exposeWaitingWorker(registration.waiting);
      observeWorker(registration.installing);
      registration.addEventListener('updatefound', onUpdateFound);
    };

    const onUpdateFound = () => observeWorker(registration?.installing ?? null);
    const onWorkerMessage = (event: MessageEvent<unknown>) => {
      const controller = navigator.serviceWorker.controller;
      if (!controller || event.source !== controller) {
        return;
      }
      if (!event.data || typeof event.data !== 'object') return;
      const data = event.data as { readonly type?: unknown };
      if (data.type === 'BYZON_SYNC_REQUESTED') {
        window.dispatchEvent(new CustomEvent(OFFLINE_AGENDA_SYNC_EVENT));
      }
    };
    const checkForUpdate = () => {
      if (document.visibilityState !== 'hidden') {
        void registration?.update().catch(() => undefined);
      }
    };

    navigator.serviceWorker.addEventListener('message', onWorkerMessage);
    document.addEventListener('visibilitychange', checkForUpdate);
    const interval = window.setInterval(
      checkForUpdate,
      UPDATE_CHECK_INTERVAL_MS,
    );
    void register().catch(() => {
      if (!disposed) setFailed(true);
    });

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', checkForUpdate);
      registration?.removeEventListener('updatefound', onUpdateFound);
      registrationRef.current = null;
      applyingUpdate.current?.abort();
      navigator.serviceWorker.removeEventListener('message', onWorkerMessage);
      for (const [worker, listener] of workerStateListeners) {
        worker.removeEventListener('statechange', listener);
      }
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    if (applyingUpdate.current || reloading.current) return;
    const attempt = new AbortController();
    applyingUpdate.current = attempt;
    setUpdateStatus('applying');
    try {
      // Another deployment may have replaced the worker since the notice opened.
      const worker =
        registrationRef.current?.waiting ?? waitingWorker.current?.worker;
      if (!worker) throw new Error('No update worker available.');
      const version =
        waitingWorker.current?.worker === worker
          ? waitingWorker.current.version
          : await requestServiceWorkerVersion(worker);
      await activateServiceWorker(
        navigator.serviceWorker,
        worker,
        version,
        attempt.signal,
      );
      if (attempt.signal.aborted || reloading.current) return;
      reloading.current = true;
      window.location.reload();
    } catch {
      if (!attempt.signal.aborted) setUpdateStatus('error');
    } finally {
      if (applyingUpdate.current === attempt) applyingUpdate.current = null;
    }
  }, []);

  const rememberDismissal = () => {
    try {
      rememberInstallPromptDismissal(window.localStorage);
    } catch {
      // Some browsers block access to the storage property itself.
    }
  };

  const installApplication = useCallback(async () => {
    const prompt = installPrompt;
    if (!prompt) return;
    setInstallPrompt(null);
    setInstallFailed(false);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'dismissed') rememberDismissal();
      setManualInstallHidden(true);
    } catch {
      setInstallFailed(true);
    }
  }, [installPrompt]);

  const dismissInstallPrompt = useCallback(() => {
    rememberDismissal();
    setInstallPrompt(null);
    setManualInstallHidden(true);
    setInstallFailed(false);
    setShowInstallInstructions(false);
  }, []);

  const notice = serviceWorkerNotice({
    failed,
    installAvailable:
      installPrompt !== null || manualInstall !== null || installFailed,
    online,
    updateAvailable: updateAvailable && !updateDismissed,
  });
  if (notice === 'none') return null;

  return (
    <aside
      aria-live="polite"
      className={styles.notice}
      data-kind={notice}
      role="status"
    >
      <div className={styles.copy}>
        <strong>
          {notice === 'offline'
            ? 'Jste offline'
            : notice === 'update'
              ? updateStatus === 'applying'
                ? 'Aktualizuji aplikaci'
                : updateStatus === 'error'
                  ? 'Aktualizace se nezdařila'
                  : 'Je dostupná nová verze'
              : notice === 'install'
                ? 'Mějte program po ruce'
                : 'Offline podpora není dostupná'}
        </strong>
        <span>
          {notice === 'offline'
            ? 'Dostupný zůstává dříve načtený veřejný program a praktické informace.'
            : notice === 'update'
              ? updateStatus === 'applying'
                ? 'Po dokončení se stránka automaticky obnoví.'
                : updateStatus === 'error'
                  ? 'Zkuste aktualizaci znovu. Pokud potíže trvají, zavřete všechny panely aplikace a znovu ji otevřete.'
                  : 'Aktualizaci spustíte vědomě; do té doby zůstává aktivní ověřená verze.'
              : notice === 'install'
                ? installFailed
                  ? 'Instalaci se nepodařilo otevřít. Použijte nabídku instalace v prohlížeči nebo obnovte stránku a zkuste to znovu.'
                  : showInstallInstructions && manualInstall
                    ? manualInstall
                    : 'Přidejte si aplikaci na plochu nebo do Docku tohoto zařízení.'
                : 'Aplikace funguje online, ale obsah se teď do zařízení neuloží.'}
        </span>
      </div>
      <div className={styles.actions}>
        {notice === 'offline' ? (
          <a className={styles.action} href="/offline">
            Co je dostupné
          </a>
        ) : notice === 'update' ? (
          <>
            <button
              className={styles.action}
              disabled={updateStatus === 'applying'}
              onClick={() => void applyUpdate()}
              type="button"
            >
              {updateStatus === 'applying'
                ? 'Aktualizuji…'
                : updateStatus === 'error'
                  ? 'Zkusit znovu'
                  : 'Aktualizovat'}
            </button>
            <button
              className={styles.quietAction}
              disabled={updateStatus === 'applying'}
              onClick={() => setUpdateDismissed(true)}
              type="button"
            >
              Později
            </button>
          </>
        ) : notice === 'install' ? (
          <>
            {installPrompt ? (
              <button
                className={styles.action}
                onClick={() => void installApplication()}
                type="button"
              >
                Nainstalovat
              </button>
            ) : manualInstall && !showInstallInstructions ? (
              <button
                className={styles.action}
                onClick={() => setShowInstallInstructions(true)}
                type="button"
              >
                Jak nainstalovat
              </button>
            ) : null}
            <button
              className={styles.quietAction}
              onClick={dismissInstallPrompt}
              type="button"
            >
              Zavřít
            </button>
          </>
        ) : (
          <button
            className={styles.quietAction}
            onClick={() => setFailed(false)}
            type="button"
          >
            Zavřít
          </button>
        )}
      </div>
    </aside>
  );
}
