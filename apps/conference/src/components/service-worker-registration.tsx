'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { wipeAllParticipantOfflineData } from '../lib/offline/offline-database';
import { OFFLINE_AGENDA_SYNC_EVENT } from '../lib/offline/offline-policy';
import { subscribeToPrivateResourceInvalidation } from '../lib/private-resource-events';

import styles from './service-worker-registration.module.css';

const APP_SERVICE_WORKER_PATH = '/sw.js';
export const APP_SERVICE_WORKER_VERSION = '2026.07.25.2';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000;

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

type WorkerNotice = 'error' | 'install' | 'none' | 'offline' | 'update';

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

export function ServiceWorkerRegistration() {
  const [failed, setFailed] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<DeferredInstallPromptEvent | null>(null);
  const online = useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    () => true,
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const waitingWorker = useRef<ServiceWorker | null>(null);
  const applyingUpdate = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeToPrivateResourceInvalidation((reason) => {
      void wipeAllParticipantOfflineData(
        reason === 'session_expired' ? 'session_expired' : 'permission',
      ).catch(() => undefined);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      const promptEvent = event as DeferredInstallPromptEvent;
      promptEvent.preventDefault();
      setInstallPrompt(promptEvent);
    };
    const onAppInstalled = () => setInstallPrompt(null);

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const workerStateListeners = new Map<
      ServiceWorker,
      (event: Event) => void
    >();

    const exposeWaitingWorker = (worker: ServiceWorker | null) => {
      if (disposed || !worker) return;
      waitingWorker.current = worker;
      setUpdateDismissed(false);
      setUpdateAvailable(true);
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
      setFailed(false);
      exposeWaitingWorker(registration.waiting);
      observeWorker(registration.installing);
      registration.addEventListener('updatefound', () => {
        observeWorker(registration?.installing ?? null);
      });
    };

    const onControllerChange = () => {
      if (!applyingUpdate.current) return;
      const reloadKey = `byzon:worker-reload:${APP_SERVICE_WORKER_VERSION}`;
      if (sessionStorage.getItem(reloadKey) === 'done') return;
      sessionStorage.setItem(reloadKey, 'done');
      window.location.reload();
    };
    const onWorkerMessage = (event: MessageEvent<unknown>) => {
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

    navigator.serviceWorker.addEventListener(
      'controllerchange',
      onControllerChange,
    );
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
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange,
      );
      navigator.serviceWorker.removeEventListener('message', onWorkerMessage);
      for (const [worker, listener] of workerStateListeners) {
        worker.removeEventListener('statechange', listener);
      }
    };
  }, []);

  const applyUpdate = useCallback(() => {
    const worker = waitingWorker.current;
    if (!worker) return;
    applyingUpdate.current = true;
    worker.postMessage({
      type: 'BYZON_SKIP_WAITING',
      version: APP_SERVICE_WORKER_VERSION,
    });
  }, []);

  const installApplication = useCallback(async () => {
    const prompt = installPrompt;
    if (!prompt) return;
    setInstallPrompt(null);
    await prompt.prompt();
    await prompt.userChoice;
  }, [installPrompt]);

  const notice = serviceWorkerNotice({
    failed,
    installAvailable: installPrompt !== null,
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
              ? 'Je dostupná nová verze'
              : notice === 'install'
                ? 'Mějte program po ruce'
                : 'Offline podpora není dostupná'}
        </strong>
        <span>
          {notice === 'offline'
            ? 'Dostupný zůstává dříve načtený veřejný program a praktické informace.'
            : notice === 'update'
              ? 'Aktualizaci spustíte vědomě; do té doby zůstává aktivní ověřená verze.'
              : notice === 'install'
                ? 'Nainstalujte si aplikaci na plochu tohoto zařízení.'
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
              onClick={applyUpdate}
              type="button"
            >
              Aktualizovat
            </button>
            <button
              className={styles.quietAction}
              onClick={() => setUpdateDismissed(true)}
              type="button"
            >
              Později
            </button>
          </>
        ) : notice === 'install' ? (
          <button
            className={styles.action}
            onClick={() => void installApplication()}
            type="button"
          >
            Nainstalovat
          </button>
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
