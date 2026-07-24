import { setupWorker } from 'msw/browser';

import { mockHandlers } from './handlers';

const PRODUCTION_BOUNDARY_MARKER = 'BYZON_MOCK_RUNTIME_F0_05';
const MOCK_WORKER_PATH = '/mockServiceWorker.js';
const INDICATOR_ID = 'byzon-mock-mode-indicator';
const INDICATOR_STYLE_ID = 'byzon-mock-mode-indicator-styles';
const API_FAILURE_GUARD_STATE = Symbol.for(
  'byzon.mock-runtime.api-failure-guard',
);
const ACTIVE_MOCK_WORKER_STATE = Symbol.for('byzon.mock-runtime.active-worker');
const worker = setupWorker(...mockHandlers);

type IndicatorState = 'active' | 'failed';
let pendingIndicatorState: IndicatorState | null = null;
let indicatorRenderQueued = false;

type MockRuntimeWindow = typeof window & {
  [API_FAILURE_GUARD_STATE]?: {
    originalFetch: typeof window.fetch;
  };
  [ACTIVE_MOCK_WORKER_STATE]?: {
    stop: () => void;
  };
};

const renderIndicator = (state: IndicatorState): void => {
  if (!document.head || !document.body) {
    pendingIndicatorState = state;
    if (!indicatorRenderQueued) {
      indicatorRenderQueued = true;
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          indicatorRenderQueued = false;
          const pendingState = pendingIndicatorState;
          pendingIndicatorState = null;
          if (pendingState) renderIndicator(pendingState);
        },
        { once: true },
      );
    }
    document.documentElement.dataset.byzonMockMode = state;
    return;
  }

  document.getElementById(INDICATOR_ID)?.remove();
  document.getElementById(INDICATOR_STYLE_ID)?.remove();

  const style = document.createElement('style');
  style.id = INDICATOR_STYLE_ID;
  style.textContent = `
    #${INDICATOR_ID} {
      position: fixed;
      z-index: 1000;
      inset-inline-start: 50%;
      bottom: max(0.75rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem));
      translate: -50% 0;
      max-width: calc(100vw - 1.5rem);
      padding: 0.55rem 0.85rem;
      border: 2px solid currentColor;
      border-radius: var(--byzon-radius-pill, 999px);
      color: var(--byzon-warning, #8a4d00);
      background: var(--byzon-warning-soft, #fff2d8);
      box-shadow: var(--byzon-shadow-md, 0 12px 32px rgba(20, 6, 16, 0.1));
      font: 700 0.875rem/1.25 var(--byzon-font-body, system-ui, sans-serif);
      letter-spacing: 0.04em;
      text-align: center;
      text-transform: uppercase;
      white-space: nowrap;
      pointer-events: none;
    }
    #${INDICATOR_ID}[data-state='failed'] {
      color: var(--byzon-danger, #b42318);
      background: var(--byzon-danger-soft, #ffebe9);
    }
  `;
  document.head.append(style);

  const indicator = document.createElement('aside');
  indicator.id = INDICATOR_ID;
  indicator.dataset.state = state;
  indicator.dataset.boundaryMarker = PRODUCTION_BOUNDARY_MARKER;
  indicator.setAttribute('role', 'status');
  indicator.setAttribute('aria-live', 'polite');
  indicator.textContent =
    state === 'active'
      ? 'Mock data · pouze vývoj/test'
      : 'Mock režim selhal · API blokováno';
  document.body.append(indicator);
  document.documentElement.dataset.byzonMockMode = state;
};

const removeIndicator = (): void => {
  pendingIndicatorState = null;
  document.getElementById(INDICATOR_ID)?.remove();
  document.getElementById(INDICATOR_STYLE_ID)?.remove();
  delete document.documentElement.dataset.byzonMockMode;
};

const scriptPath = (workerState: ServiceWorker | null): string | null => {
  if (!workerState) return null;
  try {
    return new URL(workerState.scriptURL).pathname;
  } catch {
    return null;
  }
};

const isMockRegistration = (registration: ServiceWorkerRegistration): boolean =>
  [registration.active, registration.installing, registration.waiting].some(
    (workerState) => scriptPath(workerState) === MOCK_WORKER_PATH,
  );

const installApiFailureGuard = (): void => {
  const runtimeWindow = window as MockRuntimeWindow;
  if (runtimeWindow[API_FAILURE_GUARD_STATE]) return;

  const originalFetch = window.fetch;
  const nativeFetch = originalFetch.bind(window);
  runtimeWindow[API_FAILURE_GUARD_STATE] = { originalFetch };
  window.fetch = async (input, init) => {
    const rawUrl =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;
    const url = new URL(rawUrl, location.href);
    if (
      url.origin === location.origin &&
      /^\/api\/v1(?:\/|$)/.test(url.pathname)
    ) {
      throw new TypeError('Mock API unavailable');
    }
    return nativeFetch(input, init);
  };
};

const restoreApiFailureGuard = (): void => {
  const runtimeWindow = window as MockRuntimeWindow;
  const guardState = runtimeWindow[API_FAILURE_GUARD_STATE];
  if (!guardState) return;

  window.fetch = guardState.originalFetch;
  delete runtimeWindow[API_FAILURE_GUARD_STATE];
};

const stopActiveMocking = (): void => {
  const runtimeWindow = window as MockRuntimeWindow;
  const activeWorker = runtimeWindow[ACTIVE_MOCK_WORKER_STATE];
  if (!activeWorker) return;

  try {
    activeWorker.stop();
  } finally {
    delete runtimeWindow[ACTIVE_MOCK_WORKER_STATE];
  }
};

export const startBrowserMocking = async (): Promise<void> => {
  stopActiveMocking();
  try {
    await worker.start({
      onUnhandledRequest: 'error',
      serviceWorker: {
        url: MOCK_WORKER_PATH,
        options: { scope: '/' },
      },
    });
    (window as MockRuntimeWindow)[ACTIVE_MOCK_WORKER_STATE] = {
      stop: () => worker.stop(),
    };
    restoreApiFailureGuard();
    renderIndicator('active');
  } catch {
    installApiFailureGuard();
    renderIndicator('failed');
    console.error(
      '[BYZON mocks] Mock startup failed; API requests are blocked.',
    );
  }
};

export const restoreAppWorker = async (): Promise<void> => {
  stopActiveMocking();
  restoreApiFailureGuard();
  if (!('serviceWorker' in navigator)) {
    removeIndicator();
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    registrations
      .filter(isMockRegistration)
      .map((registration) => registration.unregister()),
  );
  removeIndicator();
};
