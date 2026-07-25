import type { ActivationClaimResponse } from '@byzon/domain/contracts';
import {
  activationClaimFixtures,
  activationLandingFixtures,
} from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it } from 'vitest';

import '../../app/styles.css';
import ActivationLayout from '../../app/aktivace/layout';
import {
  ActivationScanner,
  ActivationScannerGate,
  type ActivationCameraPort,
  type ActivationCameraSession,
} from '../../components/activation-scanner';
import type { ApiPort, ApiRequestCommonOptions } from '../../lib/api';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const metadata = { requestId: 'component-camera-0001' } as const;

const apiForOutcome = (
  outcome: ActivationClaimResponse,
  onRequest?: (options: ApiRequestCommonOptions & { body?: unknown }) => void,
): ApiPort => ({
  request: async (endpoint, options) => {
    onRequest?.(options);
    return {
      ok: true,
      kind: 'success',
      status: 200,
      data: endpoint.successSchema.parse(outcome),
      metadata,
    };
  },
});

const apiForLanding = (fixture: unknown) =>
  createFetchApiClient({
    maxRetries: 0,
    fetch: async () =>
      Response.json(fixture, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'component-camera-gate-0001',
        },
      }),
  });

const ScannerProbe = ({
  camera,
  api = apiForOutcome(activationClaimFixtures.identity_required),
  createKey = () => 'camera-claim-component-0001',
}: {
  readonly camera: ActivationCameraPort;
  readonly api?: ApiPort;
  readonly createKey?: () => string;
}) => (
  <main id="main" tabIndex={-1}>
    <ActivationLayout>
      <ActivationScanner api={api} camera={camera} createClaimKey={createKey} />
    </ActivationLayout>
  </main>
);

const grantedCamera = ({
  onAttach,
  onRead,
  onRequest,
  onStop,
}: {
  readonly onAttach?: () => void;
  readonly onRead?: () => void;
  readonly onRequest?: () => void;
  readonly onStop?: () => void;
} = {}): ActivationCameraPort => {
  const session: ActivationCameraSession = {
    attach: () => onAttach?.(),
    stop: () => onStop?.(),
  };
  return {
    isSupported: () => true,
    request: async () => {
      onRequest?.();
      return { kind: 'granted', session };
    },
    readSyntheticCode: async () => {
      onRead?.();
      return 'camera:00000000-0000-4000-8000-000000000001';
    },
  };
};

beforeEach(() => {
  window.history.replaceState({}, '', '/aktivace/skenovat');
});

describe('F1-03 progressive activation scanner', () => {
  it('explains camera access before asking and keeps the manual path visible', async () => {
    let requested = 0;
    const screen = await renderComponent(
      <ScannerProbe
        camera={grantedCamera({
          onRequest: () => {
            requested += 1;
          },
        })}
      />,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          level: 1,
          name: 'Načtěte QR ze vstupenky',
        }),
      )
      .toHaveFocus();
    expect(requested).toBe(0);
    await expect.element(screen.getByText('Než kameru zapnete')).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Zadat kód ručně' }))
      .toBeVisible();
    expect(
      screen
        .getByRole('button', { name: 'Povolit kameru' })
        .element()
        .getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );

    const main = document.querySelector('main');
    if (!(main instanceof HTMLElement)) {
      throw new TypeError('Scanner probe must render a main element.');
    }
    await expectComponentToPassAxe(main);
  });

  it('stops the camera and submits only an in-memory synthetic scan', async () => {
    let attached = 0;
    let read = 0;
    let stopped = 0;
    const requests: Array<ApiRequestCommonOptions & { body?: unknown }> = [];
    const camera = grantedCamera({
      onAttach: () => {
        attached += 1;
      },
      onRead: () => {
        read += 1;
      },
      onStop: () => {
        stopped += 1;
      },
    });
    const screen = await renderComponent(
      <ScannerProbe
        api={apiForOutcome(
          activationClaimFixtures.identity_required,
          (options) => requests.push(options),
        )}
        camera={camera}
      />,
    );

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();
    await expect
      .element(screen.getByText(/Namiřte kameru na QR/))
      .toBeVisible();
    expect(attached).toBeGreaterThan(0);
    const scanButton = screen
      .getByRole('button', { name: 'Načíst syntetický QR' })
      .element();
    if (!(scanButton instanceof HTMLButtonElement)) {
      throw new TypeError('Synthetic scan action must be a button.');
    }
    scanButton.click();
    scanButton.click();

    await expect
      .element(screen.getByText('Syntetický QR byl přijat'))
      .toBeVisible();
    expect(read).toBe(1);
    expect(stopped).toBe(1);
    expect(requests[0]?.body).toEqual({
      code: 'camera:00000000-0000-4000-8000-000000000001',
      method: 'camera_scan',
    });
    expect(document.body.textContent).not.toContain(
      'camera:00000000-0000-4000-8000-000000000001',
    );
    expect(document.body.textContent).toContain(
      'nevytvořila skutečný účet, účast na akci ani přihlášení',
    );
  });

  it('stops camera access that resolves only after the route unmounts', async () => {
    let resolveRequest:
      | ((result: {
          readonly kind: 'granted';
          readonly session: ActivationCameraSession;
        }) => void)
      | undefined;
    let stopped = 0;
    const session: ActivationCameraSession = {
      attach: () => undefined,
      stop: () => {
        stopped += 1;
      },
    };
    const camera: ActivationCameraPort = {
      isSupported: () => true,
      request: () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
      readSyntheticCode: async () => {
        throw new Error('Unmounted scanner must not read.');
      },
    };
    const screen = await renderComponent(<ScannerProbe camera={camera} />);

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();
    await expect.element(screen.getByText('Čekám na oprávnění…')).toBeVisible();
    await screen.unmount();
    resolveRequest?.({ kind: 'granted', session });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stopped).toBe(1);
  });

  it('locks two same-tick permission clicks to one browser request', async () => {
    let requested = 0;
    let resolveRequest:
      ((result: { readonly kind: 'denied' }) => void) | undefined;
    const camera: ActivationCameraPort = {
      isSupported: () => true,
      request: () => {
        requested += 1;
        return new Promise((resolve) => {
          resolveRequest = resolve;
        });
      },
      readSyntheticCode: async () => {
        throw new Error('Permission request has not granted a camera.');
      },
    };
    const screen = await renderComponent(<ScannerProbe camera={camera} />);
    const button = screen
      .getByRole('button', { name: 'Povolit kameru' })
      .element();
    if (!(button instanceof HTMLButtonElement)) {
      throw new TypeError('Camera permission action must be a button.');
    }

    button.click();
    button.click();
    expect(requested).toBe(1);
    resolveRequest?.({ kind: 'denied' });
    await expect
      .element(screen.getByText('Přístup ke kameře byl odmítnut'))
      .toBeVisible();
  });

  it('keeps a cancelled permission request explicit until its late result is stopped', async () => {
    let requested = 0;
    let stopped = 0;
    let resolveRequest:
      | ((result: {
          readonly kind: 'granted';
          readonly session: ActivationCameraSession;
        }) => void)
      | undefined;
    const session: ActivationCameraSession = {
      attach: () => undefined,
      stop: () => {
        stopped += 1;
      },
    };
    const camera: ActivationCameraPort = {
      isSupported: () => true,
      request: () => {
        requested += 1;
        return new Promise((resolve) => {
          resolveRequest = resolve;
        });
      },
      readSyntheticCode: async () => {
        throw new Error('A cancelled permission request must not scan.');
      },
    };
    const screen = await renderComponent(<ScannerProbe camera={camera} />);

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();
    await expect.element(screen.getByText('Čekám na oprávnění…')).toBeVisible();
    await screen.getByRole('button', { name: 'Zrušit skenování' }).click();

    await expect
      .element(
        screen.getByText(
          /Žádost prohlížeče o oprávnění ještě dobíhá.*pozdní přístup ke kameře okamžitě zastavíme/,
        ),
      )
      .toBeVisible();
    const settling = screen
      .getByRole('button', { name: 'Dokončuji žádost prohlížeče…' })
      .element();
    if (!(settling instanceof HTMLButtonElement)) {
      throw new TypeError('Settling camera action must be a button.');
    }
    expect(settling).toBeDisabled();
    settling.click();
    expect(requested).toBe(1);

    resolveRequest?.({ kind: 'granted', session });
    await expect
      .element(screen.getByRole('button', { name: 'Zkusit kameru znovu' }))
      .toBeEnabled();
    expect(stopped).toBe(1);
  });

  it('stops a granted camera when the user cancels', async () => {
    let stopped = 0;
    const screen = await renderComponent(
      <ScannerProbe
        camera={grantedCamera({
          onStop: () => {
            stopped += 1;
          },
        })}
      />,
    );

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();
    await screen.getByRole('button', { name: 'Zrušit skenování' }).click();

    await expect
      .element(screen.getByText('Skenování bylo bezpečně ukončeno'))
      .toBeVisible();
    expect(stopped).toBe(1);
    await expect
      .element(screen.getByRole('link', { name: 'Zadat kód ručně' }))
      .toBeVisible();
  });

  it('ignores a late claim response after cancellation', async () => {
    let finishClaim: (() => void) | undefined;
    let requestSignal: AbortSignal | undefined;
    const api: ApiPort = {
      request: async (endpoint, options) => {
        requestSignal = options.signal;
        await new Promise<void>((resolve) => {
          finishClaim = resolve;
        });
        return {
          ok: true,
          kind: 'success',
          status: 200,
          data: endpoint.successSchema.parse(
            activationClaimFixtures.identity_required,
          ),
          metadata,
        };
      },
    };
    const screen = await renderComponent(
      <ScannerProbe api={api} camera={grantedCamera()} />,
    );

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();
    await screen.getByRole('button', { name: 'Načíst syntetický QR' }).click();
    await expect
      .element(screen.getByText('Ověřuji syntetický QR…'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Zrušit skenování' }).click();
    expect(requestSignal?.aborted).toBe(true);
    finishClaim?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect
      .element(screen.getByText('Skenování bylo bezpečně ukončeno'))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Syntetický QR byl přijat');
  });

  it('does not overwrite a completed claim on a later pagehide', async () => {
    const screen = await renderComponent(
      <ScannerProbe camera={grantedCamera()} />,
    );

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();
    await screen.getByRole('button', { name: 'Načíst syntetický QR' }).click();
    await expect
      .element(screen.getByText('Syntetický QR byl přijat'))
      .toBeVisible();
    window.dispatchEvent(new Event('pagehide'));

    await expect
      .element(screen.getByText('Syntetický QR byl přijat'))
      .toBeVisible();
    expect(document.body.textContent).not.toContain(
      'Skenování bylo bezpečně ukončeno',
    );
  });

  it('reuses the same claim key after an ambiguous scanner retry', async () => {
    let requests = 0;
    let keyCreations = 0;
    const keys: string[] = [];
    const api: ApiPort = {
      request: async (endpoint, options) => {
        requests += 1;
        if (options.idempotencyKey) keys.push(options.idempotencyKey);
        if (requests === 1) {
          return {
            ok: false,
            kind: 'failure',
            failure: { kind: 'offline' },
          };
        }
        return {
          ok: true,
          kind: 'success',
          status: 200,
          data: endpoint.successSchema.parse(
            activationClaimFixtures.identity_required,
          ),
          metadata,
        };
      },
    };
    const screen = await renderComponent(
      <ScannerProbe
        api={api}
        camera={grantedCamera()}
        createKey={() => {
          keyCreations += 1;
          return `scanner-retry-${keyCreations}`;
        }}
      />,
    );

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();
    await screen.getByRole('button', { name: 'Načíst syntetický QR' }).click();
    await expect
      .element(screen.getByText('Aktivace vyžaduje připojení'))
      .toBeVisible();
    await screen
      .getByRole('button', { name: 'Zopakovat předchozí odeslání' })
      .click();

    await expect
      .element(screen.getByText('Syntetický QR byl přijat'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Ověřte svou identitu' }))
      .toHaveFocus();
    expect(keys).toEqual(['scanner-retry-1', 'scanner-retry-1']);
    expect(keyCreations).toBe(1);
  });

  it('maps denied permission without hiding the manual fallback', async () => {
    const camera: ActivationCameraPort = {
      isSupported: () => true,
      request: async () => ({ kind: 'denied' }),
      readSyntheticCode: async () => {
        throw new Error('Scanner must not read after denied permission.');
      },
    };
    const screen = await renderComponent(<ScannerProbe camera={camera} />);

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();

    await expect
      .element(screen.getByText('Přístup ke kameře byl odmítnut'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Zadat kód ručně' }))
      .toBeVisible();
  });

  it('does not request camera access on an unsupported device', async () => {
    let requested = 0;
    const camera: ActivationCameraPort = {
      isSupported: () => false,
      request: async () => {
        requested += 1;
        return { kind: 'unsupported' };
      },
      readSyntheticCode: async () => {
        throw new Error('Unsupported camera must not scan.');
      },
    };
    const screen = await renderComponent(<ScannerProbe camera={camera} />);

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();

    await expect
      .element(screen.getByText('Kamera na tomto zařízení není dostupná'))
      .toBeVisible();
    expect(requested).toBe(0);
    await expect
      .element(screen.getByRole('link', { name: 'Zadat kód ručně' }))
      .toBeVisible();
  });

  it('checks the server activation gate before exposing camera controls', async () => {
    let cameraRequested = 0;
    const camera = grantedCamera({
      onRequest: () => {
        cameraRequested += 1;
      },
    });
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <ActivationLayout>
          <ActivationScannerGate
            api={apiForLanding(activationLandingFixtures.in_progress)}
            camera={camera}
          />
        </ActivationLayout>
      </main>,
    );

    await expect
      .element(screen.getByText('Kameru není potřeba spouštět'))
      .toBeVisible();
    expect(cameraRequested).toBe(0);
    expect(document.body.textContent).not.toContain('Povolit kameru');
  });
});
