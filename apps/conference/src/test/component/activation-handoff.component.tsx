import type {
  ActivationIdentityResponse,
  ActivationLandingResponse,
  ActivationLinkResponse,
} from '@byzon/domain/contracts';
import {
  activationIdentityFixtures,
  activationLandingFixtures,
  activationLinkFixtures,
  activationLinkProblemFixtures,
} from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it } from 'vitest';

import '../../app/styles.css';
import ActivationLayout from '../../app/aktivace/layout';
import LoginLayout from '../../app/prihlaseni/layout';
import { ActivationIdentity } from '../../components/activation-identity';
import { ActivationLinkConsumer } from '../../components/activation-link-consumer';
import type { ApiPort, ApiRequestCommonOptions } from '../../lib/api';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const metadata = { requestId: 'component-handoff-0001' } as const;
type RecordedRequest = ApiRequestCommonOptions & { body?: unknown };

const apiForIdentity = ({
  identity = activationIdentityFixtures.link_sent,
  landing = activationLandingFixtures.in_progress,
  onIdentity,
}: {
  readonly identity?: ActivationIdentityResponse;
  readonly landing?: ActivationLandingResponse;
  readonly onIdentity?: (options: RecordedRequest) => void;
} = {}): ApiPort => ({
  request: async (endpoint, options) => {
    const outcome =
      options.path === '/api/v1/activation'
        ? landing
        : (onIdentity?.(options), identity);
    return {
      ok: true,
      kind: 'success',
      status: 200,
      data: endpoint.successSchema.parse(outcome),
      metadata,
    };
  },
});

const apiForLink = (
  outcome: ActivationLinkResponse,
  onRequest?: (options: RecordedRequest) => void,
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

const IdentityProbe = ({
  api = apiForIdentity(),
  createKey = () => 'identity-component-0001',
  now,
}: {
  readonly api?: ApiPort;
  readonly createKey?: () => string;
  readonly now?: (() => number) | undefined;
}) => (
  <main id="main" tabIndex={-1}>
    <LoginLayout>
      <ActivationIdentity
        api={api}
        createIdempotencyKey={createKey}
        createMockLinkToken={() => 'link:00000000-0000-4000-8000-000000000001'}
        now={now}
      />
    </LoginLayout>
  </main>
);

const LinkProbe = ({
  api,
  createKey = () => 'link-component-0001',
}: {
  readonly api: ApiPort;
  readonly createKey?: () => string;
}) => (
  <main id="main" tabIndex={-1}>
    <ActivationLayout>
      <ActivationLinkConsumer api={api} createIdempotencyKey={createKey} />
    </ActivationLayout>
  </main>
);

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/prihlaseni');
});

describe('F1-04 identity and one-time-link handoff', () => {
  it('resumes only a server-confirmed pending activation flow', async () => {
    const screen = await renderComponent(
      <IdentityProbe
        api={apiForIdentity({ landing: activationLandingFixtures.anonymous! })}
      />,
    );

    await expect
      .element(screen.getByText('Chybí rozpracovaný aktivační průchod'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Přejít k aktivaci' }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('flow.synthetic.2026');
    expect(window.sessionStorage.length).toBe(0);
  });

  it('uses client time only as an injected early expiry hint', async () => {
    const screen = await renderComponent(
      <IdentityProbe now={() => Date.parse('2026-07-25T13:00:00.000Z')} />,
    );

    await expect
      .element(screen.getByText('Rozpracovaný průchod už není platný'))
      .toBeVisible();
    expect(window.sessionStorage.length).toBe(0);
  });

  it('follows a server-owned onboarding next step without asking for email again', async () => {
    const screen = await renderComponent(
      <IdentityProbe
        api={apiForIdentity({
          landing: activationLandingFixtures.in_progress_onboarding!,
        })}
      />,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Pokračujte k nastavení účasti',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Otevřít onboarding' }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Zadejte svůj e-mail');
  });

  it('submits identity exactly once and keeps flow metadata out of URL/storage', async () => {
    const calls: RecordedRequest[] = [];
    const screen = await renderComponent(
      <IdentityProbe
        api={apiForIdentity({
          onIdentity: (options) => calls.push(options),
        })}
      />,
    );

    await screen.getByLabelText('E-mail').fill('alex@example.test');
    const submit = screen
      .getByRole('button', { name: 'Poslat jednorázový odkaz' })
      .element();
    if (!(submit instanceof HTMLButtonElement)) {
      throw new TypeError('Identity submit must be a button.');
    }
    submit.click();
    submit.click();

    await expect
      .element(
        screen.getByText('Pokud lze průchod dokončit, odkaz byl odeslán'),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Zkontrolujte e-mail' }))
      .toHaveFocus();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      flowId: 'flow.synthetic.2026',
      email: 'alex@example.test',
      returnTo: '/onboarding',
    });
    expect(window.location.search).toBe('');
    expect(window.sessionStorage.length).toBe(0);
    expect(document.body.textContent).not.toContain('flow.synthetic.2026');
    expect(document.body.textContent).not.toContain('alex@example.test');
    expect(
      screen
        .getByRole('link', {
          name: 'Otevřít syntetický jednorázový odkaz',
        })
        .element()
        .getAttribute('href'),
    ).toBe('/aktivace/odkaz#token=link%3A00000000-0000-4000-8000-000000000001');
  });

  it('rejects a response flow mismatch without minting a mock link', async () => {
    const screen = await renderComponent(
      <IdentityProbe
        api={apiForIdentity({
          identity: {
            ...activationIdentityFixtures.link_sent,
            flowId: 'flow.mismatch.2026',
          },
        })}
      />,
    );

    await screen.getByLabelText('E-mail').fill('alex@example.test');
    await screen
      .getByRole('button', { name: 'Poslat jednorázový odkaz' })
      .click();

    await expect
      .element(screen.getByText('Odkaz se nepodařilo odeslat', { exact: true }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain(
      'Otevřít syntetický jednorázový odkaz',
    );
  });

  it('reuses one idempotency key after an ambiguous offline result', async () => {
    let identityRequests = 0;
    let keyCreations = 0;
    const keys: string[] = [];
    const api: ApiPort = {
      request: async (endpoint, options) => {
        if (options.path === '/api/v1/activation') {
          return {
            ok: true,
            kind: 'success',
            status: 200,
            data: endpoint.successSchema.parse(
              activationLandingFixtures.in_progress,
            ),
            metadata,
          };
        }
        identityRequests += 1;
        if (options.idempotencyKey) keys.push(options.idempotencyKey);
        if (identityRequests === 1) {
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
            activationIdentityFixtures.link_sent,
          ),
          metadata,
        };
      },
    };
    const screen = await renderComponent(
      <IdentityProbe
        api={api}
        createKey={() => {
          keyCreations += 1;
          return `identity-retry-${keyCreations}`;
        }}
      />,
    );

    await screen.getByLabelText('E-mail').fill('alex@example.test');
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

    await expect
      .element(
        screen.getByText('Pokud lze průchod dokončit, odkaz byl odeslán'),
      )
      .toBeVisible();
    expect(identityRequests).toBe(2);
    expect(keyCreations).toBe(1);
    expect(keys).toEqual(['identity-retry-1', 'identity-retry-1']);
  });

  it('validates identity locally with focusable error summary', async () => {
    const screen = await renderComponent(<IdentityProbe />);

    await screen.getByLabelText('E-mail').fill('not-an-email');
    await screen
      .getByRole('button', { name: 'Poslat jednorázový odkaz' })
      .click();

    await expect
      .element(
        screen.getByText('Zadejte platnou e-mailovou adresu bez úprav navíc.', {
          exact: true,
        }),
      )
      .toBeVisible();
    const summary = screen
      .getByRole('heading', { name: 'Zkontrolujte zadané údaje' })
      .element();
    expect(summary.closest('section')).toHaveFocus();
  });

  it('removes the token from URL before one explicit locked consumption', async () => {
    const calls: RecordedRequest[] = [];
    const previousHistoryLength = window.history.length;
    window.history.replaceState(
      { safe: true },
      '',
      '/aktivace/odkaz#token=link%3A00000000-0000-4000-8000-000000000001',
    );
    const screen = await renderComponent(
      <LinkProbe
        api={apiForLink(activationLinkFixtures.onboarding_required, (options) =>
          calls.push(options),
        )}
      />,
    );

    await expect
      .element(screen.getByText('Token byl odstraněn z adresy'))
      .toBeVisible();
    expect(window.location.pathname).toBe('/aktivace/odkaz');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
    expect(window.history.length).toBe(previousHistoryLength);
    expect(window.history.state).toEqual({ safe: true });
    expect(document.body.textContent).not.toContain(
      'link:00000000-0000-4000-8000-000000000001',
    );

    const consume = screen
      .getByRole('button', { name: 'Pokračovat' })
      .element();
    if (!(consume instanceof HTMLButtonElement)) {
      throw new TypeError('Link consume action must be a button.');
    }
    consume.click();
    consume.click();

    await expect
      .element(screen.getByText('Syntetický odkaz byl bezpečně spotřebován'))
      .toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      token: 'link:00000000-0000-4000-8000-000000000001',
    });
    await expect
      .element(screen.getByRole('link', { name: 'Pokračovat na onboarding' }))
      .toBeVisible();
    expect(window.location.href).not.toContain(
      'link%3A00000000-0000-4000-8000-000000000001',
    );
    expect(window.location.href).not.toContain(
      'link:00000000-0000-4000-8000-000000000001',
    );
    expect(JSON.stringify(window.history.state)).not.toContain(
      'link:00000000-0000-4000-8000-000000000001',
    );
  });

  it('rejects a missing or duplicated URL token without a request', async () => {
    let requests = 0;
    window.history.replaceState({}, '', '/aktivace/odkaz#token=one&token=two');
    const screen = await renderComponent(
      <LinkProbe
        api={apiForLink(activationLinkFixtures.onboarding_required, () => {
          requests += 1;
        })}
      />,
    );

    await expect
      .element(screen.getByText('Odkaz chybí nebo už není platný'))
      .toBeVisible();
    expect(requests).toBe(0);
    expect(window.location.search).toBe('');
  });

  it('ignores and scrubs a legacy query token without consuming it', async () => {
    let requests = 0;
    window.history.replaceState(
      {},
      '',
      '/aktivace/odkaz?token=link%3A00000000-0000-4000-8000-000000000001',
    );
    const screen = await renderComponent(
      <LinkProbe
        api={apiForLink(activationLinkFixtures.onboarding_required, () => {
          requests += 1;
        })}
      />,
    );

    await expect
      .element(screen.getByText('Odkaz chybí nebo už není platný'))
      .toBeVisible();
    expect(requests).toBe(0);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('retries an ambiguous link failure with the same idempotency key', async () => {
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
            activationLinkFixtures.onboarding_required,
          ),
          metadata,
        };
      },
    };
    window.history.replaceState(
      {},
      '',
      '/aktivace/odkaz#token=link%3A00000000-0000-4000-8000-000000000001',
    );
    const screen = await renderComponent(
      <LinkProbe
        api={api}
        createKey={() => {
          keyCreations += 1;
          return `link-retry-${keyCreations}`;
        }}
      />,
    );

    await screen.getByRole('button', { name: 'Pokračovat' }).click();
    await expect
      .element(screen.getByText('Dokončení vyžaduje připojení'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Zkusit znovu' }).click();

    await expect
      .element(screen.getByText('Syntetický odkaz byl bezpečně spotřebován'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Dokončete profil' }))
      .toHaveFocus();
    expect(requests).toBe(2);
    expect(keyCreations).toBe(1);
    expect(keys).toEqual(['link-retry-1', 'link-retry-1']);
  });

  it('mints a new key after the server rejects a reused link key', async () => {
    let requests = 0;
    let keyCreations = 0;
    const keys: string[] = [];
    const api: ApiPort = {
      request: async (endpoint, options) => {
        requests += 1;
        if (options.idempotencyKey) keys.push(options.idempotencyKey);
        if (requests === 1) {
          const problem = activationLinkProblemFixtures.idempotency_key_reused!;
          return {
            ok: false,
            kind: 'failure',
            status: problem.status,
            failure: {
              kind: 'problem',
              problem: endpoint.problemSchema.parse(problem),
            },
            metadata,
          };
        }
        return {
          ok: true,
          kind: 'success',
          status: 200,
          data: endpoint.successSchema.parse(
            activationLinkFixtures.onboarding_required,
          ),
          metadata,
        };
      },
    };
    window.history.replaceState(
      {},
      '',
      '/aktivace/odkaz#token=link%3A00000000-0000-4000-8000-000000000001',
    );
    const screen = await renderComponent(
      <LinkProbe
        api={api}
        createKey={() => {
          keyCreations += 1;
          return `link-collision-${keyCreations}`;
        }}
      />,
    );

    await screen.getByRole('button', { name: 'Pokračovat' }).click();
    await expect
      .element(screen.getByText('Odkaz se nepodařilo dokončit'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Zkusit znovu' }).click();

    await expect
      .element(screen.getByText('Syntetický odkaz byl bezpečně spotřebován'))
      .toBeVisible();
    expect(keys).toEqual(['link-collision-1', 'link-collision-2']);
    expect(keyCreations).toBe(2);
  });

  it('keeps the identity form accessible and responsive', async () => {
    const screen = await renderComponent(<IdentityProbe />);
    await expect
      .element(screen.getByRole('heading', { name: 'Ověřte svůj e-mail' }))
      .toBeVisible();

    expect(
      screen.getByLabelText('E-mail').element().getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    const main = document.querySelector('main');
    if (!(main instanceof HTMLElement)) {
      throw new TypeError('Identity probe must render a main element.');
    }
    await expectComponentToPassAxe(main);
  });
});
