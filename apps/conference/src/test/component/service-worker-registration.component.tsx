import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INSTALL_PROMPT_DISMISSAL_STORAGE_KEY,
  ServiceWorkerRegistration,
} from '../../components/service-worker-registration';
import { expectComponentToPassAxe } from './accessibility';
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

beforeEach(() => {
  window.localStorage.clear();
});

const installPromptEvent = (): Event => {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.defineProperties(event, {
    prompt: { value: vi.fn(async () => undefined) },
    userChoice: {
      value: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
    },
  });
  return event;
};

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

  it('lets the user close the install prompt and remembers that choice', async () => {
    const screen = await renderComponent(<ServiceWorkerRegistration />);
    window.dispatchEvent(installPromptEvent());

    await expect
      .element(screen.getByText('Mějte program po ruce'))
      .toBeVisible();
    await expectComponentToPassAxe(screen.container);
    await screen.getByRole('button', { name: 'Zavřít' }).click();

    await expect
      .element(screen.getByText('Mějte program po ruce'))
      .not.toBeInTheDocument();
    expect(
      Number(window.localStorage.getItem(INSTALL_PROMPT_DISMISSAL_STORAGE_KEY)),
    ).toBeGreaterThan(Date.now());

    window.dispatchEvent(installPromptEvent());
    await expect
      .element(screen.getByText('Mějte program po ruce'))
      .not.toBeInTheDocument();
    await screen.unmount();
  });
});
