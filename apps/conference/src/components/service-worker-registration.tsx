'use client';

import { useEffect } from 'react';

const APP_SERVICE_WORKER_PATH = '/sw.js';

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

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      const register = async () => {
        const existing = await navigator.serviceWorker.getRegistration('/');
        const scriptUrls = existing
          ? [existing.active, existing.installing, existing.waiting].flatMap(
              (workerState) => (workerState ? [workerState.scriptURL] : []),
            )
          : [];
        if (
          shouldRegisterAppServiceWorker(scriptUrls, window.location.origin)
        ) {
          await navigator.serviceWorker.register(APP_SERVICE_WORKER_PATH, {
            scope: '/',
            updateViaCache: 'none',
          });
        }
      };
      void register().catch(() => undefined);
    }
  }, []);
  return null;
}
