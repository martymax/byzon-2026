import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../app/styles.css';
import { MagicLinkLogin } from '../../components/magic-link-login';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

afterEach(() => vi.restoreAllMocks());

describe('email code login in the installed application', () => {
  it('uses a code by default in standalone mode and keeps verification in the same app', async () => {
    const matchMedia = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
      query === '(display-mode: standalone)'
        ? {
            ...matchMedia(query),
            matches: true,
            addEventListener: () => {},
            removeEventListener: () => {},
          }
        : matchMedia(query),
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ success: true }),
    );
    const navigate = vi.fn();
    const screen = await renderComponent(
      <main>
        <MagicLinkLogin
          fetch={fetch}
          navigate={navigate}
          returnTo="/app/networking"
        />
      </main>,
    );
    await screen.getByLabelText('E-mail').fill('User@Example.Test');
    await screen
      .getByRole('button', { name: 'Poslat přihlašovací kód' })
      .click();
    await expect.element(screen.getByLabelText('Kód z e-mailu')).toBeVisible();
    await expectComponentToPassAxe(document.body);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/auth/email-otp/send-verification-otp',
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      email: 'user@example.test',
      type: 'sign-in',
    });
    await screen.getByLabelText('Kód z e-mailu').fill('123 456');
    await screen
      .getByRole('button', { name: 'Přihlásit se', exact: true })
      .click();
    expect(fetch.mock.calls[1]?.[0]).toBe('/api/auth/sign-in/email-otp');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      email: 'user@example.test',
      otp: '123456',
    });
    expect(navigate).toHaveBeenCalledWith('/app/networking');
  });

  it('offers code login in browsers, retries expired codes and permits changing email', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    const navigate = vi.fn();
    const screen = await renderComponent(
      <main>
        <MagicLinkLogin fetch={fetch} navigate={navigate} />
      </main>,
    );
    await screen
      .getByRole('button', { name: 'Přihlásit se kódem v této aplikaci' })
      .click();
    await expectComponentToPassAxe(document.body);
    await screen.getByLabelText('E-mail').fill('user@example.test');
    await screen
      .getByRole('button', { name: 'Poslat přihlašovací kód' })
      .click();
    await screen.getByLabelText('Kód z e-mailu').fill('123456');
    await screen
      .getByRole('button', { name: 'Přihlásit se', exact: true })
      .click();
    await expect
      .element(
        screen.getByText(
          'Kód není platný nebo už vypršel. Zkontrolujte ho nebo si pošlete nový.',
        ),
      )
      .toBeVisible();
    expect(navigate).not.toHaveBeenCalled();
    await screen.getByRole('button', { name: 'Poslat nový kód' }).click();
    await expect
      .element(screen.getByLabelText('Kód z e-mailu'))
      .toHaveValue('');
    await screen.getByRole('button', { name: 'Změnit e-mail' }).click();
    await expect
      .element(screen.getByLabelText('E-mail'))
      .toHaveValue('user@example.test');
    await screen.getByRole('button', { name: 'Přihlásit se odkazem' }).click();
    await expect
      .element(
        screen.getByRole('button', { name: 'Poslat přihlašovací odkaz' }),
      )
      .toBeVisible();
  });
});
