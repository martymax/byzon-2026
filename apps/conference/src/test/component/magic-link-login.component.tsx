import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import { MagicLinkLogin } from '../../components/magic-link-login';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/prihlaseni?returnTo=%2Fadmin');
});

describe('production magic-link login', () => {
  it('uses the role-aware destination when no protected route is explicit', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(Response.json({ status: true }, { status: 200 })),
    );
    const screen = await renderComponent(<MagicLinkLogin fetch={fetch} />);

    await screen.getByLabelText('E-mail').fill('Admin@Example.Test');
    await screen
      .getByRole('button', { name: 'Poslat přihlašovací odkaz' })
      .click();

    const [, request] = fetch.mock.calls[0]!;
    expect(JSON.parse(String(request?.body))).toMatchObject({
      callbackURL: '/po-prihlaseni',
      errorCallbackURL: '/prihlaseni?returnTo=%2Fpo-prihlaseni',
    });
  });

  it('submits directly to Better Auth and keeps the e-mail out of storage and the URL', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(Response.json({ status: true }, { status: 200 })),
    );
    const screen = await renderComponent(
      <MagicLinkLogin fetch={fetch} returnTo="/admin" />,
    );

    await screen.getByLabelText('E-mail').fill('Admin@Example.Test');
    const submit = screen.getByRole('button', {
      name: 'Poslat přihlašovací odkaz',
    });
    await submit.click();

    await expect
      .element(screen.getByRole('heading', { name: 'Zkontrolujte e-mail' }))
      .toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, request] = fetch.mock.calls[0]!;
    expect(path).toBe('/api/auth/sign-in/magic-link');
    expect(JSON.parse(String(request?.body))).toEqual({
      email: 'admin@example.test',
      callbackURL: '/admin',
      errorCallbackURL: '/prihlaseni?returnTo=%2Fadmin',
    });
    expect(window.location.search).toBe('?returnTo=%2Fadmin');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.body.textContent).not.toContain('admin@example.test');
  });

  it('rejects invalid e-mail locally and announces the field error', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const screen = await renderComponent(<MagicLinkLogin fetch={fetch} />);

    await screen.getByLabelText('E-mail').fill('not-an-email');
    await screen
      .getByRole('button', { name: 'Poslat přihlašovací odkaz' })
      .click();

    await expect
      .element(screen.getByLabelText('Zkontrolujte zadané údaje'))
      .toHaveTextContent('Zadejte platnou e-mailovou adresu bez úprav navíc.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a recoverable provider failure without disclosing account existence', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response(null, { status: 503 })),
    );
    const screen = await renderComponent(<MagicLinkLogin fetch={fetch} />);

    await screen.getByLabelText('E-mail').fill('unknown@example.test');
    await screen
      .getByRole('button', { name: 'Poslat přihlašovací odkaz' })
      .click();

    await expect
      .element(screen.getByText('Odkaz se nepodařilo odeslat'))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('unknown@example.test');
    expect(document.body.textContent).not.toContain('neexistuje');
  });

  it('offers a new link after an expired or already used link', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(Response.json({ status: true }, { status: 200 })),
    );
    const screen = await renderComponent(
      <MagicLinkLogin fetch={fetch} invalidLink returnTo="/app" />,
    );

    await expect
      .element(screen.getByText('Odkaz už není platný'))
      .toBeVisible();
    await screen.getByLabelText('E-mail').fill('participant@example.test');
    await screen
      .getByRole('button', { name: 'Poslat přihlašovací odkaz' })
      .click();

    await expect
      .element(screen.getByRole('heading', { name: 'Zkontrolujte e-mail' }))
      .toBeVisible();
    await expect
      .element(screen.getByText(/Aktivační odkaz platí 24 hodin/))
      .toBeVisible();
  });

  it('passes accessibility checks in the form and confirmation states', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(Response.json({ status: true }, { status: 200 })),
    );
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <MagicLinkLogin fetch={fetch} />
      </main>,
    );

    await expectComponentToPassAxe(document.body);
    await screen.getByLabelText('E-mail').fill('admin@example.test');
    await screen
      .getByRole('button', { name: 'Poslat přihlašovací odkaz' })
      .click();
    await expect
      .element(screen.getByRole('heading', { name: 'Zkontrolujte e-mail' }))
      .toBeVisible();
    await expectComponentToPassAxe(document.body);
  });
});

describe('staging e-mail login', () => {
  it('creates the session without requesting an e-mail and continues to the safe destination', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(Response.json({ status: true }, { status: 200 })),
    );
    const navigate = vi.fn();
    const screen = await renderComponent(
      <MagicLinkLogin
        directEmailLogin
        fetch={fetch}
        navigate={navigate}
        returnTo="/app/networking"
      />,
    );

    await expect
      .element(
        screen.getByText(
          'Na stagingu stačí zadat e-mail existujícího účtu. Přihlašovací odkaz neposíláme.',
        ),
      )
      .toBeVisible();
    await screen.getByLabelText('E-mail').fill('Participant@Example.Test');
    await screen.getByRole('button', { name: 'Přihlásit se' }).click();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [path, request] = fetch.mock.calls[0]!;
    expect(path).toBe('/api/auth/sign-in/staging-email');
    expect(JSON.parse(String(request?.body))).toEqual({
      email: 'participant@example.test',
    });
    expect(navigate).toHaveBeenCalledWith('/app/networking');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('keeps the tester on the form when the account is not provisioned', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Promise.resolve(new Response(null, { status: 401 })),
    );
    const navigate = vi.fn();
    const screen = await renderComponent(
      <MagicLinkLogin directEmailLogin fetch={fetch} navigate={navigate} />,
    );

    await screen.getByLabelText('E-mail').fill('unknown@example.test');
    await screen.getByRole('button', { name: 'Přihlásit se' }).click();

    await expect.element(screen.getByText('E-mail nemá přístup')).toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('unknown@example.test');
  });

  it('passes accessibility checks', async () => {
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <MagicLinkLogin directEmailLogin />
      </main>,
    );

    await expectComponentToPassAxe(document.body);
    await expect
      .element(screen.getByRole('button', { name: 'Přihlásit se' }))
      .toBeVisible();
  });
});
