export const UPDATE_ACTIVATION_TIMEOUT_MS = 15_000;

// Subscribe before skipWaiting: activation can finish before postMessage returns.
// The guard belongs to this attempt, not sessionStorage: multiple builds can
// share the worker protocol version and each still needs its own page reload.
export const activateServiceWorker = (
  container: ServiceWorkerContainer,
  worker: ServiceWorker,
  version: string,
  signal: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      container.removeEventListener('controllerchange', checkState);
      worker.removeEventListener('statechange', checkState);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (error?: Error) => {
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const checkState = () => {
      if (worker.state === 'redundant') {
        finish(new Error('The update worker was replaced.'));
      } else if (
        container.controller === worker &&
        worker.state === 'activated'
      ) {
        finish();
      }
    };
    const onAbort = () => finish(new Error('The update was cancelled.'));
    const timeout = setTimeout(
      () => finish(new Error('The update did not take control in time.')),
      UPDATE_ACTIVATION_TIMEOUT_MS,
    );
    container.addEventListener('controllerchange', checkState);
    worker.addEventListener('statechange', checkState);
    signal.addEventListener('abort', onAbort);
    if (signal.aborted) {
      onAbort();
      return;
    }
    checkState();
    if (worker.state !== 'installed') return;
    try {
      worker.postMessage({ type: 'BYZON_SKIP_WAITING', version });
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Update failed.'));
    }
  });
