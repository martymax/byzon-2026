import {
  activationLandingFixtures,
  activationRecoveryFixtures,
  identitySessionActionFixtures,
} from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import LoginLayout from '../../app/prihlaseni/layout';
import { AccessProblem } from '../../components/access-problem';
import { LoginFlow } from '../../components/login-flow';
import { RecoveryForm } from '../../components/recovery-form';
import { SessionExitControls } from '../../components/session-exit-controls';
import type { ApiPort, ApiRequestCommonOptions } from '../../lib/api';
import type { ActivationReturnTo } from '../../lib/activation-return';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const metadata = { requestId: 'component-recovery-session-0001' } as const;
type RecordedRequest = ApiRequestCommonOptions & { body?: unknown };

const successApi = (
  fixture: unknown,
  onRequest?: (request: RecordedRequest) => void,
): ApiPort => ({
  request: async (endpoint, options) => {
    onRequest?.(options);
    return {
      ok: true,
      kind: 'success',
      status: 200,
      data: endpoint.successSchema.parse(fixture),
      metadata,
    };
  },
});

const RecoveryProbe = ({
  api,
  presentation = 'recovery',
  returnTo = '/app',
}: {
  readonly api: ApiPort;
  readonly presentation?: 'login' | 'recovery';
  readonly returnTo?: ActivationReturnTo;
}) => (
  <main id="main" tabIndex={-1}>
    <LoginLayout>
      <RecoveryForm
        api={api}
        createIdempotencyKey={() => 'recovery-component-0001'}
        presentation={presentation}
        returnTo={returnTo}
      />
    </LoginLayout>
  </main>
);

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/prihlaseni?mode=recovery');
});

describe('F1-06 recovery and safe session exit', () => {
  it('presents the root recovery mechanism as direct passwordless login', async () => {
    const screen = await renderComponent(
      <RecoveryProbe
        api={successApi(activationRecoveryFixtures.accepted)}
        presentation="login"
      />,
    );

    await expect
      .element(screen.getByRole('heading', { name: 'Přihlaste se do BYZON' }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole('button', { name: 'Poslat přihlašovací odkaz' }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Aktivovat vstupenku' }))
      .toBeVisible();

    await screen.getByLabelText('E-mail').fill('alex@example.test');
    await screen
      .getByRole('button', { name: 'Poslat přihlašovací odkaz' })
      .click();

    await expect
      .element(
        screen.getByRole('link', {
          name: 'Otevřít syntetický odkaz pro přihlášení',
        }),
      )
      .toBeVisible();
  });

  it('recovers the initial safe read once when the mock worker wins a cold-start race', async () => {
    let requests = 0;
    const api: ApiPort = {
      request: async (endpoint) => {
        requests += 1;
        if (requests === 1) {
          return {
            ok: false,
            kind: 'failure',
            failure: { kind: 'invalid_response' },
          };
        }
        return {
          ok: true,
          kind: 'success',
          status: 200,
          data: endpoint.successSchema.parse(
            activationLandingFixtures.anonymous,
          ),
          metadata,
        };
      },
    };
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <LoginLayout>
          <LoginFlow
            api={api}
            mode="recovery"
            presentation="login"
            returnTo="/app"
          />
        </LoginLayout>
      </main>,
    );

    await expect
      .element(screen.getByRole('heading', { name: 'Přihlaste se do BYZON' }))
      .toBeVisible();
    expect(requests).toBe(2);
  });

  it('does not stack another retry on a transport failure already handled by the API client', async () => {
    let requests = 0;
    const api: ApiPort = {
      request: async () => {
        requests += 1;
        return {
          ok: false,
          kind: 'failure',
          failure: { kind: 'transport' },
        };
      },
    };
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <LoginLayout>
          <LoginFlow
            api={api}
            mode="recovery"
            presentation="login"
            returnTo="/app"
          />
        </LoginLayout>
      </main>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Přihlášení teď nelze otevřít',
        }),
      )
      .toBeVisible();
    // The browser component harness mounts effects twice in development mode.
    // A second retry layer would increase this count beyond those two mounts.
    expect(requests).toBe(2);
  });

  it('submits recovery once and does not retain or reveal the email', async () => {
    const calls: RecordedRequest[] = [];
    const screen = await renderComponent(
      <RecoveryProbe
        api={successApi(activationRecoveryFixtures.accepted, (request) =>
          calls.push(request),
        )}
      />,
    );

    await screen.getByLabelText('E-mail').fill('alex@example.test');
    const submit = screen
      .getByRole('button', { name: 'Poslat jednorázový odkaz' })
      .element();
    if (!(submit instanceof HTMLButtonElement)) {
      throw new TypeError('Recovery submit must be a button.');
    }
    submit.click();
    submit.click();

    await expect.element(screen.getByText('Zkontrolujte e-mail')).toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      email: 'alex@example.test',
      returnTo: '/app',
    });
    expect(document.body.textContent).not.toContain('alex@example.test');
    expect(window.location.search).toBe('?mode=recovery');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(
      screen
        .getByRole('link', { name: 'Otevřít syntetický odkaz pro obnovu' })
        .element()
        .getAttribute('href'),
    ).toMatch(/^\/aktivace\/odkaz#token=recovery-app%3A/u);
  });

  it('preserves a safe onboarding return in the recovery request', async () => {
    const calls: RecordedRequest[] = [];
    const screen = await renderComponent(
      <RecoveryProbe
        api={successApi(activationRecoveryFixtures.accepted, (request) =>
          calls.push(request),
        )}
        returnTo="/onboarding"
      />,
    );

    await screen.getByLabelText('E-mail').fill('unknown@example.test');
    await screen
      .getByRole('button', { name: 'Poslat jednorázový odkaz' })
      .click();

    expect(calls[0]?.body).toEqual({
      email: 'unknown@example.test',
      returnTo: '/onboarding',
    });
    const recoveryLink = screen.getByRole('link', {
      name: 'Otevřít syntetický odkaz pro obnovu',
    });
    await expect.element(recoveryLink).toBeVisible();
    expect(recoveryLink.element().getAttribute('href')).toMatch(
      /^\/aktivace\/odkaz#token=recovery-onboarding%3A/u,
    );
  });

  it('preserves an exact participant detail route in the recovery request', async () => {
    const returnTo =
      '/app/program/550e8400-e29b-41d4-a716-446655440000' as const;
    const calls: RecordedRequest[] = [];
    const screen = await renderComponent(
      <RecoveryProbe
        api={successApi(activationRecoveryFixtures.accepted, (request) =>
          calls.push(request),
        )}
        returnTo={returnTo}
      />,
    );

    await screen.getByLabelText('E-mail').fill('alex@example.test');
    await screen
      .getByRole('button', { name: 'Poslat jednorázový odkaz' })
      .click();

    expect(calls[0]?.body).toEqual({
      email: 'alex@example.test',
      returnTo,
    });
    const recoveryLink = screen.getByRole('link', {
      name: 'Otevřít syntetický odkaz pro obnovu',
    });
    await expect.element(recoveryLink).toBeVisible();
    expect(recoveryLink.element().getAttribute('href')).toMatch(
      /^\/aktivace\/odkaz#token=recovery-route%3A/u,
    );
  });

  it('does not let a recovery query bypass a server-confirmed claim', async () => {
    const api: ApiPort = {
      request: async (endpoint, options) => ({
        ok: true,
        kind: 'success',
        status: 200,
        data: endpoint.successSchema.parse(
          options.path === '/api/v1/activation'
            ? activationLandingFixtures.in_progress
            : activationRecoveryFixtures.accepted,
        ),
        metadata,
      }),
    };
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <LoginLayout>
          <LoginFlow api={api} mode="recovery" returnTo="/onboarding" />
        </LoginLayout>
      </main>,
    );

    await expect
      .element(screen.getByRole('heading', { name: 'Ověřte svůj e-mail' }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Obnova přihlášení');
  });

  it('routes a server-confirmed onboarding step without recovery or identity input', async () => {
    const api: ApiPort = {
      request: async (endpoint) => ({
        ok: true,
        kind: 'success',
        status: 200,
        data: endpoint.successSchema.parse(
          activationLandingFixtures.in_progress_onboarding,
        ),
        metadata,
      }),
    };
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <LoginLayout>
          <LoginFlow api={api} mode="recovery" returnTo="/onboarding" />
        </LoginLayout>
      </main>,
    );

    await expect
      .element(screen.getByRole('link', { name: 'Otevřít onboarding' }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Zadejte svůj e-mail');
    expect(document.body.textContent).not.toContain('Obnovte bezpečný přístup');
  });

  it('reuses the recovery key after an ambiguous offline result', async () => {
    const keys: string[] = [];
    let requests = 0;
    let keyCreations = 0;
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
            activationRecoveryFixtures.accepted,
          ),
          metadata,
        };
      },
    };
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <RecoveryForm
          api={api}
          createIdempotencyKey={() => {
            keyCreations += 1;
            return `recovery-retry-${keyCreations}`;
          }}
        />
      </main>,
    );

    await screen.getByLabelText('E-mail').fill('unknown@example.test');
    await screen
      .getByRole('button', { name: 'Poslat jednorázový odkaz' })
      .click();
    await expect.element(screen.getByText('Jste offline')).toBeVisible();
    expect(document.querySelector('[data-form-failure]')).toHaveFocus();
    expect(screen.getByLabelText('E-mail').element()).not.toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await screen
      .getByRole('button', { name: 'Poslat jednorázový odkaz' })
      .click();

    await expect.element(screen.getByText('Zkontrolujte e-mail')).toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Zkontrolujte e-mail' }))
      .toHaveFocus();
    expect(keyCreations).toBe(1);
    expect(keys).toEqual(['recovery-retry-1', 'recovery-retry-1']);
  });

  it('confirms session exit and runs local wipe after the canonical response', async () => {
    const order: string[] = [];
    const api = successApi(
      identitySessionActionFixtures.switch_account,
      (request) => {
        order.push(`request:${String(request.idempotencyKey)}`);
      },
    );
    const clearPrivateData = vi.fn(async () => {
      order.push('wipe');
      return 'none_present' as const;
    });
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <SessionExitControls
          api={api}
          clearPrivateData={clearPrivateData}
          createIdempotencyKey={() => 'session-component-0001'}
        />
      </main>,
    );

    await screen.getByRole('button', { name: 'Použít jiný účet' }).click();
    await expect
      .element(screen.getByRole('heading', { name: 'Přepnout na jiný účet?' }))
      .toBeVisible();
    await screen
      .getByRole('button', { name: 'Pokračovat k jinému účtu' })
      .click();

    await expect
      .element(screen.getByText('Náhled je připravený pro jiný účet'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Správa přihlášení' }))
      .toHaveFocus();
    expect(clearPrivateData).toHaveBeenCalledOnce();
    expect(order).toEqual(['request:session-component-0001', 'wipe']);
    await expect
      .element(screen.getByRole('link', { name: 'Přejít k jinému účtu' }))
      .toBeVisible();
  });

  it('rejects a mismatched session response after wiping private data', async () => {
    const clearPrivateData = vi.fn(async () => 'none_present' as const);
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <SessionExitControls
          api={successApi(identitySessionActionFixtures.switch_account)}
          clearPrivateData={clearPrivateData}
        />
      </main>,
    );

    await screen.getByRole('button', { name: 'Odhlásit tento účet' }).click();
    await screen.getByRole('button', { name: 'Odhlásit', exact: true }).click();

    await expect
      .element(screen.getByText('Změna přihlášení se nepodařila'))
      .toBeVisible();
    expect(clearPrivateData).toHaveBeenCalledOnce();
    expect(document.querySelector('dialog[open]')).toBeNull();
  });

  it('keeps access states non-enumerating, accessible and overflow-safe', async () => {
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <AccessProblem
          sessionApi={successApi(identitySessionActionFixtures.logout_current)}
        />
      </main>,
    );
    const main = document.querySelector('main');
    if (!(main instanceof HTMLElement)) {
      throw new TypeError('Access problem probe must render main.');
    }

    expect(document.body.textContent).not.toContain('@');
    expect(document.body.textContent).not.toContain('TST-');
    expect(document.body.textContent).not.toContain('example.test');
    expect(
      screen
        .getByRole('button', { name: 'Odhlásit tento účet' })
        .element()
        .getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(main);
  });

  it.each([
    ['revoked', 'Přístup byl zrušený'],
    ['forbidden', 'Tudy nelze pokračovat'],
    ['session_expired', 'Přihlášení vypršelo'],
  ] as const)(
    'exposes the %s access variant without PII',
    async (kind, heading) => {
      const screen = await renderComponent(
        <main id="main" tabIndex={-1}>
          <AccessProblem
            kind={kind}
            sessionApi={successApi(
              identitySessionActionFixtures.logout_current,
            )}
          />
        </main>,
      );

      await expect
        .element(screen.getByRole('heading', { name: heading }))
        .toBeVisible();
      expect(document.body.textContent).not.toContain('@');
      expect(document.body.textContent).not.toContain('example.test');
      if (kind === 'revoked') {
        expect(document.body.textContent).toContain('MOCK-REVOKED-2026');
        expect(document.body.textContent).not.toContain('MOCK-SUSPENDED-2026');
      }
    },
  );
});
