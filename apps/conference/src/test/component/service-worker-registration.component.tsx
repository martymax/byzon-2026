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

const installPromptEvent = (prompt = vi.fn(async () => undefined)): Event => {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.defineProperties(event, {
    prompt: { value: prompt },
    userChoice: {
      value: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
    },
  });
  return event;
};

describe('service worker registration environment boundary', () => {
  it('shows installation instructions on Safari without a native install event', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.6 Safari/605.1.15',
    );
    vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(0);
    const screen = await renderComponent(<ServiceWorkerRegistration />);
    await screen.getByRole('button', { name: 'Jak nainstalovat' }).click();
    await expect
      .element(screen.getByText(/Soubor → Přidat do Docku/))
      .toBeVisible();
    await expectComponentToPassAxe(screen.container);
    await screen.getByRole('button', { name: 'Zavřít' }).click();
    await screen.unmount();
    const reopened = await renderComponent(<ServiceWorkerRegistration />);
    await expect
      .element(reopened.getByText('Mějte program po ruce'))
      .not.toBeInTheDocument();
    await reopened.unmount();
  });

  it('recognizes iPad desktop mode and hides the offer in an installed app', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/17.0 Safari/605.1.15',
    );
    vi.spyOn(navigator, 'maxTouchPoints', 'get').mockReturnValue(5);
    const screen = await renderComponent(<ServiceWorkerRegistration />);
    await screen.getByRole('button', { name: 'Jak nainstalovat' }).click();
    await expect.element(screen.getByText(/Přidat na plochu/)).toBeVisible();
    window.dispatchEvent(new Event('appinstalled'));
    await expect
      .element(screen.getByText('Mějte program po ruce'))
      .not.toBeInTheDocument();
    await screen.unmount();

    const originalMatchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
      const result = originalMatchMedia(query);
      if (query === '(display-mode: standalone)') {
        Object.defineProperty(result, 'matches', { value: true });
      }
      return result;
    });
    const installed = await renderComponent(<ServiceWorkerRegistration />);
    window.dispatchEvent(installPromptEvent());
    await expect
      .element(installed.getByText('Mějte program po ruce'))
      .not.toBeInTheDocument();
    await installed.unmount();
  });

  it('shows a useful message when the browser rejects the native install prompt', async () => {
    const screen = await renderComponent(<ServiceWorkerRegistration />);
    window.dispatchEvent(
      installPromptEvent(
        vi.fn(async () => {
          throw new Error('Prompt unavailable');
        }),
      ),
    );
    await screen.getByRole('button', { name: 'Nainstalovat' }).click();
    await expect
      .element(screen.getByText(/Instalaci se nepodařilo otevřít/))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Zavřít' }).click();
    await screen.unmount();
  });

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
