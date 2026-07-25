import type { ApiRequestCommonOptions, ApiPort } from '../../lib/api';
import type { CSSProperties } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';

import '../../app/styles.css';
import { CheckinOperator } from '../../components/checkin-operator';
import type {
  CheckinCameraPort,
  CheckinCameraSession,
} from '../../components/checkin-scanner';
import { createCheckinDemoApi } from '../../lib/checkin-demo-api';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

type RecordedRequest = ApiRequestCommonOptions & { readonly body?: unknown };

const unsupportedCamera: CheckinCameraPort = {
  isSupported: () => false,
  request: async () => ({ kind: 'unsupported' }),
  readSyntheticCredential: async () => {
    throw new Error('Unsupported camera cannot read a credential.');
  },
};

const grantedCamera = ({
  onAttach,
  onRead,
  onStop,
}: {
  readonly onAttach?: () => void;
  readonly onRead?: () => void;
  readonly onStop?: () => void;
} = {}): CheckinCameraPort => {
  const session: CheckinCameraSession = {
    attach: () => onAttach?.(),
    stop: () => onStop?.(),
  };
  return {
    isSupported: () => true,
    request: async () => ({ kind: 'granted', session }),
    readSyntheticCredential: async () => {
      onRead?.();
      return 'DEMO-VALID';
    },
  };
};

const recordingApi = (
  base = createCheckinDemoApi(),
  calls: RecordedRequest[] = [],
): { readonly api: ApiPort; readonly calls: RecordedRequest[] } => ({
  calls,
  api: {
    request: async (endpoint, options) => {
      calls.push(options);
      return base.request(endpoint, options);
    },
  },
});

const renderOperator = (props: Parameters<typeof CheckinOperator>[0] = {}) =>
  renderComponent(
    <div
      style={
        {
          '--byzon-font-body': 'Arial, sans-serif',
          '--byzon-font-display': 'Arial, sans-serif',
        } as CSSProperties
      }
    >
      <CheckinOperator camera={unsupportedCamera} debounceMs={10} {...props} />
    </div>,
  );

const submitCode = async (
  screen: Awaited<ReturnType<typeof renderOperator>>,
  code: string,
) => {
  await screen.getByLabelText('Opaque kód vstupenky').fill(code);
  await screen
    .getByRole('button', { name: 'Ověřit kód bez check-inu' })
    .click();
};

beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/check-in');
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('F5-01..F5-06 check-in operator', () => {
  it('renders a verified, privacy-safe online shell with an axe-clean lookup boundary', async () => {
    const screen = await renderOperator();

    await expect
      .element(
        screen.getByRole('heading', {
          level: 1,
          name: 'Načíst nebo najít vstupenku',
        }),
      )
      .toHaveFocus();
    await expect
      .element(screen.getByText('BYZON 2026 — syntetická ukázka').first())
      .toBeVisible();
    await expect.element(screen.getByText('Hlavní vstup')).toBeVisible();
    await expect.element(screen.getByText('Demo zařízení A')).toBeVisible();
    await expect.element(screen.getByText('Operátor check-inu')).toBeVisible();
    await expect
      .element(screen.getByText('Bez mutace', { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByLabelText('Opaque kód vstupenky'))
      .toBeVisible();
    await expect
      .element(screen.getByLabelText('Jméno nebo e-mail'))
      .toBeVisible();
    expect(document.body.textContent).toContain(
      'Offline check-in není podporovaný',
    );
    expect(document.body.textContent).toContain('Scan pouze vyhledá záznam');
    expect(document.body.textContent).toContain(
      'syntetický credential adapter',
    );
    expect(document.body.textContent).not.toContain('@example.');
    expect(
      Number.parseFloat(
        window.getComputedStyle(
          screen
            .getByRole('heading', {
              level: 1,
              name: 'Načíst nebo najít vstupenku',
            })
            .element(),
        ).fontSize,
      ),
    ).toBeGreaterThanOrEqual(32);

    for (const target of screen.container.querySelectorAll<
      HTMLButtonElement | HTMLInputElement
    >('button, input')) {
      if (target.getClientRects().length === 0) continue;
      expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(screen.container);
  });

  it('shows visible targeting and stops the camera on lookup and unmount', async () => {
    let attached = 0;
    let read = 0;
    let stopped = 0;
    const screen = await renderOperator({
      camera: grantedCamera({
        onAttach: () => {
          attached += 1;
        },
        onRead: () => {
          read += 1;
        },
        onStop: () => {
          stopped += 1;
        },
      }),
    });

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();
    await expect
      .element(screen.getByLabelText('Živý náhled kamery'))
      .toBeVisible();
    expect(
      screen.container.querySelector('[data-camera-target]'),
    ).not.toBeNull();
    expect(attached).toBeGreaterThan(0);
    await screen
      .getByRole('button', { name: 'Načíst syntetický testovací kód' })
      .click();
    await expect
      .element(screen.getByText('Platný lookup', { exact: true }))
      .toBeVisible();
    expect(read).toBe(1);
    expect(stopped).toBe(1);
    expect(document.body.textContent).toContain('Dosavadní scan nic nezměnil');

    await screen.unmount();
    expect(stopped).toBe(1);
  });

  it('keeps manual lookup available after camera denial and unsupported detection', async () => {
    const deniedCamera: CheckinCameraPort = {
      isSupported: () => true,
      request: async () => ({ kind: 'denied' }),
      readSyntheticCredential: async () => 'DEMO-VALID',
    };
    const denied = await renderOperator({ camera: deniedCamera });
    await denied.getByRole('button', { name: 'Povolit kameru' }).click();
    await expect
      .element(denied.getByText('Přístup ke kameře byl odmítnut'))
      .toBeVisible();
    await expect
      .element(denied.getByLabelText('Opaque kód vstupenky'))
      .toBeVisible();
    await denied.unmount();

    const unsupported = await renderOperator({ camera: unsupportedCamera });
    await unsupported.getByRole('button', { name: 'Povolit kameru' }).click();
    await expect
      .element(
        unsupported.getByText('Kamera v tomto prohlížeči není podporovaná'),
      )
      .toBeVisible();
    await expect
      .element(unsupported.getByLabelText('Opaque kód vstupenky'))
      .toBeVisible();
  });

  it('cancels an active camera session without performing lookup', async () => {
    let stopped = 0;
    const { api, calls } = recordingApi();
    const screen = await renderOperator({
      api,
      camera: grantedCamera({
        onStop: () => {
          stopped += 1;
        },
      }),
    });

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();
    await screen.getByRole('button', { name: 'Zrušit' }).click();
    await expect
      .element(screen.getByText('Skenování bylo zrušeno'))
      .toBeVisible();
    expect(stopped).toBe(1);
    expect(
      calls.filter((call) => call.path === '/api/v1/check-in/lookup'),
    ).toHaveLength(0);
  });

  it('stops a late camera grant after route unmount and always leaves the manual path available', async () => {
    let resolveRequest:
      | ((result: {
          readonly kind: 'granted';
          readonly session: CheckinCameraSession;
        }) => void)
      | undefined;
    let stopped = 0;
    const session: CheckinCameraSession = {
      attach: () => undefined,
      stop: () => {
        stopped += 1;
      },
    };
    const camera: CheckinCameraPort = {
      isSupported: () => true,
      request: () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
      readSyntheticCredential: async () => 'DEMO-VALID',
    };
    const screen = await renderOperator({ camera });

    await screen.getByRole('button', { name: 'Povolit kameru' }).click();
    await expect.element(screen.getByText('Čekám na oprávnění…')).toBeVisible();
    await expect
      .element(screen.getByLabelText('Opaque kód vstupenky'))
      .toBeVisible();
    await screen.unmount();
    resolveRequest?.({ kind: 'granted', session });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stopped).toBe(1);
  });

  it('does not expose a scanner or queue mutations when context loading is offline', async () => {
    const api: ApiPort = {
      request: async () => ({
        ok: false,
        kind: 'failure',
        failure: { kind: 'offline' },
      }),
    };
    const screen = await renderOperator({ api });

    await expect
      .element(screen.getByText('Kontext check-inu nelze načíst offline'))
      .toBeVisible();
    expect(screen.container.querySelector('input')).toBeNull();
    expect(document.body.textContent).toContain(
      'Bez ověřeného kontextu nelze provádět lookup ani check-in',
    );
  });

  it('debounces bounded person search and requires identity confirmation before mutation', async () => {
    const { api, calls } = recordingApi();
    const screen = await renderOperator({ api, debounceMs: 15 });
    const search = screen.getByLabelText('Jméno nebo e-mail');

    await search.fill('T');
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(
      calls.filter((call) => call.path.startsWith('/api/v1/check-in/search')),
    ).toHaveLength(0);

    await search.fill('Test');
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Vybrat a ověřit osobu Testovací Účastník',
        }),
      )
      .toBeVisible();
    expect(
      calls.filter((call) => call.path.startsWith('/api/v1/check-in/search')),
    ).toHaveLength(1);
    await expect.element(screen.getByText('t***@b***.test')).toBeVisible();
    expect(document.body.textContent).not.toContain('testovaci@byzon.test');

    await screen
      .getByRole('button', {
        name: 'Vybrat a ověřit osobu Testovací Účastník',
      })
      .click();
    await expect
      .element(screen.getByText('Platný lookup', { exact: true }))
      .toBeVisible();
    expect(
      calls.filter((call) => call.path === '/api/v1/check-in/confirm'),
    ).toHaveLength(0);
  });

  it.each([
    ['DEMO-VALID', 'Platný lookup', 'check'],
    ['DEMO-DUPLICATE', 'Duplicitní scan', 'duplicate'],
    ['DEMO-CANCELLED', 'Zrušená vstupenka', 'x'],
    ['DEMO-REFUNDED', 'Vrácená vstupenka', 'refund'],
    ['DEMO-BLOCKED', 'Blokovaná vstupenka', 'lock'],
    ['DEMO-UNKNOWN', 'Neznámý kód', 'question'],
    ['DEMO-ERROR', 'Lookup selhal · bez mutace', 'error'],
  ] as const)(
    'renders explicit text and an icon for %s without relying on color',
    async (code, label, icon) => {
      const screen = await renderOperator();
      await submitCode(screen, code);

      await expect
        .element(screen.getByText(label, { exact: true }))
        .toBeVisible();
      expect(
        screen.container.querySelector(`[data-result-icon="${icon}"]`),
      ).not.toBeNull();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
    },
  );

  it('reuses the exact confirm payload and key after a committed response is lost', async () => {
    const base = createCheckinDemoApi();
    const confirmCalls: RecordedRequest[] = [];
    let loseFirstConfirm = true;
    const api: ApiPort = {
      request: async (endpoint, options) => {
        if (options.path === '/api/v1/check-in/confirm') {
          confirmCalls.push(options);
          if (loseFirstConfirm) {
            loseFirstConfirm = false;
            await base.request(endpoint, options);
            return {
              ok: false,
              kind: 'failure',
              failure: {
                kind: 'transport',
                requestId: 'checkin-lost-response-0001',
              },
            };
          }
        }
        return base.request(endpoint, options);
      },
    };
    let keyCreations = 0;
    const screen = await renderOperator({
      api,
      createKey: (prefix) => {
        keyCreations += 1;
        return `checkin-${prefix}-component-${keyCreations}`;
      },
    });

    await submitCode(screen, 'DEMO-VALID');
    expect(confirmCalls).toHaveLength(0);
    await screen
      .getByRole('button', { name: 'Potvrdit check-in této osoby' })
      .click();
    await expect
      .element(screen.getByText('Výsledek mutace je nejistý'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Nový scan' }))
      .toBeDisabled();
    expect(document.body.textContent).not.toContain('Nový lookup');
    await screen
      .getByRole('button', {
        name: 'Bezpečně zopakovat stejný požadavek',
      })
      .click();
    await expect
      .element(screen.getByText('Vstup je zaznamenaný'))
      .toBeVisible();

    expect(confirmCalls).toHaveLength(2);
    expect(confirmCalls[0]?.body).toEqual(confirmCalls[1]?.body);
    expect(confirmCalls[0]?.idempotencyKey).toBe(
      confirmCalls[1]?.idempotencyKey,
    );
    expect(keyCreations).toBe(1);
  });

  it('requires a reason for role/time-limited undo and records a separate reversal', async () => {
    const { api, calls } = recordingApi();
    const screen = await renderOperator({
      api,
      createKey: (prefix) => `checkin-${prefix}-component-0001`,
    });

    await submitCode(screen, 'DEMO-VALID');
    await screen
      .getByRole('button', { name: 'Potvrdit check-in této osoby' })
      .click();
    await expect
      .element(screen.getByText('Vstup je zaznamenaný'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Vrátit check-in' }).click();
    await screen.getByLabelText('Důvod vrácení').fill('Omyl');
    await screen
      .getByRole('button', { name: 'Potvrdit auditované vrácení' })
      .click();
    await expect
      .element(screen.getByText(/Uveďte konkrétní důvod/))
      .toBeVisible();
    expect(calls.filter((call) => call.path.endsWith('/undo'))).toHaveLength(0);

    const reason = 'Syntetický návštěvník byl označen omylem.';
    await screen.getByLabelText('Důvod vrácení').fill(reason);
    await screen
      .getByRole('button', { name: 'Potvrdit auditované vrácení' })
      .click();
    await expect.element(screen.getByText('Check-in byl vrácen')).toBeVisible();
    const undoCalls = calls.filter((call) => call.path.endsWith('/undo'));
    expect(undoCalls).toHaveLength(1);
    expect(undoCalls[0]?.body).toEqual({ reason });
    expect(document.body.textContent).toContain('Původní záznam nebyl smazán');
  });

  it('supports keyboard submit, landscape geometry, axe and scan-to-result measurement', async () => {
    const browser = await cdp();
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 812,
      height: 375,
      deviceScaleFactor: 1,
      mobile: true,
      screenOrientation: { type: 'landscapePrimary', angle: 90 },
    });
    const times = [1_000, 1_183];
    try {
      const screen = await renderOperator({
        now: () => times.shift() ?? 1_183,
      });
      const code = screen.getByLabelText('Opaque kód vstupenky');
      await code.fill('DEMO-VALID');
      await userEvent.keyboard('{Enter}');

      await expect
        .element(screen.getByText('Platný lookup', { exact: true }))
        .toBeVisible();
      const metric = screen.container.querySelector<HTMLElement>(
        '[data-lookup-duration-ms]',
      );
      expect(metric?.dataset.lookupDurationMs).toBe('183');
      expect(Number(metric?.dataset.lookupDurationMs)).toBeLessThan(500);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
      await expectComponentToPassAxe(screen.container);
    } finally {
      await browser.send('Emulation.clearDeviceMetricsOverride');
    }
  });
});
