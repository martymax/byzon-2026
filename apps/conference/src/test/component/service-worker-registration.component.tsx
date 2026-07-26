import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServiceWorkerRegistration } from '../../components/service-worker-registration';
import { renderComponent } from './render';

const registration = (
  scriptURL: string,
  unregister: ReturnType<typeof vi.fn>,
): ServiceWorkerRegistration =>
  ({
    active: { scriptURL },
    installing: null,
    unregister,
    waiting: null,
  }) as unknown as ServiceWorkerRegistration;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('service worker registration environment boundary', () => {
  it('unregisters only the owned app worker when the component mounts outside production', async () => {
    const unregisterOwned = vi.fn(async () => true);
    const unregisterMock = vi.fn(async () => true);
    const owned = registration(
      `${window.location.origin}/sw.js`,
      unregisterOwned,
    );
    const mock = registration(
      `${window.location.origin}/mockServiceWorker.js`,
      unregisterMock,
    );
    const getRegistrations = vi
      .spyOn(navigator.serviceWorker, 'getRegistrations')
      .mockResolvedValue([owned, mock]);

    const screen = await renderComponent(<ServiceWorkerRegistration />);

    await vi.waitFor(() => {
      expect(getRegistrations).toHaveBeenCalled();
      expect(unregisterOwned).toHaveBeenCalled();
    });
    expect(unregisterMock).not.toHaveBeenCalled();
    await screen.unmount();
  });
});
