import { describe, expect, it, vi } from 'vitest';

import {
  APP_SERVICE_WORKER_VERSION,
  requestServiceWorkerVersion,
  serviceWorkerNotice,
  shouldEnableAppServiceWorker,
  shouldRegisterAppServiceWorker,
  shouldUnregisterAppServiceWorker,
  unregisterOwnedAppServiceWorkers,
} from './service-worker-registration';

const ORIGIN = 'https://app.byzon.test';

const transferredPorts = (
  transfer: readonly Transferable[] | StructuredSerializeOptions,
): readonly Transferable[] | undefined =>
  Array.isArray(transfer)
    ? transfer
    : (transfer as StructuredSerializeOptions).transfer;

describe('application service worker ownership', () => {
  it('enables the generated app worker only for a production build', () => {
    expect(shouldEnableAppServiceWorker('production')).toBe(true);
    expect(shouldEnableAppServiceWorker('development')).toBe(false);
    expect(shouldEnableAppServiceWorker('test')).toBe(false);
    expect(shouldEnableAppServiceWorker(undefined)).toBe(false);
  });

  it('reads the waiting worker version through a dedicated message port', async () => {
    const postMessage = vi.fn(
      (
        message: unknown,
        transfer: readonly Transferable[] | StructuredSerializeOptions,
      ) => {
        expect(message).toEqual({ type: 'BYZON_GET_VERSION' });
        const ports = transferredPorts(transfer);
        const port = ports?.[0];
        expect(port).toBeInstanceOf(MessagePort);
        (port as MessagePort).postMessage({
          type: 'BYZON_WORKER_VERSION',
          version: APP_SERVICE_WORKER_VERSION,
        });
      },
    );

    await expect(
      requestServiceWorkerVersion({ postMessage } as Pick<
        ServiceWorker,
        'postMessage'
      >),
    ).resolves.toBe(APP_SERVICE_WORKER_VERSION);
    expect(postMessage).toHaveBeenCalledOnce();
  });

  it('rejects an unverified waiting worker version', async () => {
    const postMessage = vi.fn(
      (
        _message: unknown,
        transfer: readonly Transferable[] | StructuredSerializeOptions,
      ) => {
        const ports = transferredPorts(transfer);
        (ports?.[0] as MessagePort | undefined)?.postMessage({
          type: 'BYZON_WORKER_VERSION',
          version: 'invalid version with spaces',
        });
      },
    );

    await expect(
      requestServiceWorkerVersion(
        { postMessage } as Pick<ServiceWorker, 'postMessage'>,
        10,
      ),
    ).rejects.toThrow('did not report its version');
  });

  it('registers when the scope is empty or already owned by the app worker', () => {
    expect(shouldRegisterAppServiceWorker([], ORIGIN)).toBe(true);
    expect(shouldRegisterAppServiceWorker([`${ORIGIN}/sw.js`], ORIGIN)).toBe(
      true,
    );
  });

  it('does not replace a different, cross-origin or malformed worker', () => {
    expect(
      shouldRegisterAppServiceWorker(
        [`${ORIGIN}/another-service-worker.js`],
        ORIGIN,
      ),
    ).toBe(false);
    expect(
      shouldRegisterAppServiceWorker(['https://other.test/sw.js'], ORIGIN),
    ).toBe(false);
    expect(shouldRegisterAppServiceWorker(['not a URL'], ORIGIN)).toBe(false);
  });

  it('unregisters only an existing same-origin app worker outside production', async () => {
    const registration = (
      scriptURL: string | null,
    ): ServiceWorkerRegistration => {
      const worker = scriptURL
        ? ({ scriptURL } as Pick<ServiceWorker, 'scriptURL'> as ServiceWorker)
        : null;
      return {
        active: worker,
        installing: null,
        unregister: vi.fn(async () => true),
        waiting: null,
      } as Pick<
        ServiceWorkerRegistration,
        'active' | 'installing' | 'unregister' | 'waiting'
      > as ServiceWorkerRegistration;
    };
    const owned = registration(`${ORIGIN}/sw.js`);
    const mockWorker = registration(`${ORIGIN}/mockServiceWorker.js`);
    const unknown = registration(null);
    const serviceWorkers = {
      getRegistrations: vi.fn(async () => [owned, mockWorker, unknown]),
    };

    expect(
      shouldUnregisterAppServiceWorker([`${ORIGIN}/sw.js`], ORIGIN),
    ).toBe(true);
    expect(shouldUnregisterAppServiceWorker([], ORIGIN)).toBe(false);
    expect(
      shouldUnregisterAppServiceWorker(
        [`${ORIGIN}/mockServiceWorker.js`],
        ORIGIN,
      ),
    ).toBe(false);
    await expect(
      unregisterOwnedAppServiceWorkers(
        serviceWorkers as Pick<ServiceWorkerContainer, 'getRegistrations'>,
        ORIGIN,
      ),
    ).resolves.toBe(1);
    expect(owned.unregister).toHaveBeenCalledOnce();
    expect(mockWorker.unregister).not.toHaveBeenCalled();
    expect(unknown.unregister).not.toHaveBeenCalled();
  });
});

describe('service worker notice priority', () => {
  it('keeps loss of connectivity visible above update and install prompts', () => {
    expect(
      serviceWorkerNotice({
        failed: true,
        installAvailable: true,
        online: false,
        updateAvailable: true,
      }),
    ).toBe('offline');
  });

  it('offers a verified update before a secondary installation prompt', () => {
    expect(
      serviceWorkerNotice({
        failed: false,
        installAvailable: true,
        online: true,
        updateAvailable: true,
      }),
    ).toBe('update');
    expect(
      serviceWorkerNotice({
        failed: false,
        installAvailable: true,
        online: true,
        updateAvailable: false,
      }),
    ).toBe('install');
  });

  it('stays silent during the healthy installed online state', () => {
    expect(
      serviceWorkerNotice({
        failed: false,
        installAvailable: false,
        online: true,
        updateAvailable: false,
      }),
    ).toBe('none');
  });
});
