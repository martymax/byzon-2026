import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePathname } from './navigation-stub';
import { useState } from 'react';
import '../../app/styles.css';
import { ParticipantTour } from '../../components/participant-tour';
import { AppMain } from '../../components/app-main';
import { renderComponent, userEvent } from './render';
import { expectComponentToPassAxe } from './accessibility';

const sessionId = 'a02d41a0-c21e-4308-80da-2ff4e1da04bc';
const goto = (path: string) => {
  window.history.replaceState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};
function TourApp({
  onSave = () => {},
  initialTarget = true,
}: {
  readonly onSave?: () => void;
  readonly initialTarget?: boolean;
}) {
  const path = usePathname();
  const [loaded, setLoaded] = useState(initialTarget);
  const [confirm, setConfirm] = useState(false);
  return (
    <main
      id="main"
      style={{ minHeight: '140vh', padding: 24, paddingBottom: '60vh' }}
    >
      <h1 data-route-heading tabIndex={-1}>
        Konferenční aplikace
      </h1>
      {path === '/app/program' ? (
        <div style={{ marginTop: 140 }}>
          <button onClick={() => setLoaded(true)}>Načíst aktivity</button>
          {loaded ? (
            <>
              <a
                data-tour="program-session"
                href={`/app/program/${sessionId}`}
                style={{ display: 'none' }}
              >
                Skrytá varianta aktivity
              </a>
              <a
                data-tour="program-session"
                data-tour-recommended="true"
                href={`/app/program/${sessionId}`}
                style={{ display: 'block', padding: 24, maxWidth: 300 }}
              >
                Workshop leadershipu
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {path === `/app/program/${sessionId}` ? (
        <section
          data-tour="agenda-action"
          style={{ marginTop: 140, padding: 16, maxWidth: 320 }}
        >
          <h2>Osobní agenda</h2>
          <button onClick={onSave}>Přidat do agendy</button>
          <button onClick={() => setConfirm(true)}>Rezervovat místo</button>
        </section>
      ) : null}
      {path === '/app/agenda' ? (
        <header data-tour="agenda-heading">
          <h2>Osobní agenda</h2>
          <p>Zde je váš plán</p>
        </header>
      ) : null}
      {path === '/app/networking' ? (
        <label data-tour="networking-visibility">
          <input type="checkbox" onChange={onSave} />
          Zobrazit můj profil v adresáři
        </label>
      ) : null}
      {path === '/app/oznameni' ? (
        <header data-tour="announcements">
          <h2>Oznámení</h2>
        </header>
      ) : null}
      {path === '/app/napoveda' ? (
        <label data-tour="help-search">
          Najít odpověď
          <input type="search" />
        </label>
      ) : null}
      {confirm ? (
        <div role="dialog" aria-modal="true" aria-label="Potvrdit rezervaci">
          <button onClick={() => setConfirm(false)}>Ponechat beze změny</button>
        </div>
      ) : null}
      <ParticipantTour />
    </main>
  );
}

beforeEach(() => goto('/app/program?pruvodce=program'));
describe('contextual participant tour', () => {
  it.each(['Dokončit průvodce', 'Ukončit průvodce'])(
    'handles the first pointer click on %s when Safari focuses the main landmark',
    async (name) => {
      goto('/app/napoveda?pruvodce=help');
      const screen = await renderComponent(
        <AppMain>
          <section style={{ minHeight: '200vh', padding: 24 }}>
            <h1 data-route-heading tabIndex={-1}>
              Nápověda
            </h1>
            <label
              data-tour="help-search"
              style={{ display: 'block', marginTop: 160 }}
            >
              Najít odpověď
              <input type="search" />
            </label>
          </section>
          <ParticipantTour />
        </AppMain>,
      );
      await screen.getByRole('button', { name, exact: true }).click();
      await expect.poll(() => window.location.search).toBe('');
    },
  );

  it('preserves the active guide when the application shell handles a real link', async () => {
    const screen = await renderComponent(
      <AppMain>
        <a href={`/app/program/${sessionId}`}>Otevřít skutečnou aktivitu</a>
      </AppMain>,
    );
    await screen
      .getByRole('link', { name: 'Otevřít skutečnou aktivitu' })
      .click();
    expect(window.location.pathname).toBe(`/app/program/${sessionId}`);
    expect(new URLSearchParams(window.location.search).get('pruvodce')).toBe(
      'detail',
    );
  });

  it('keeps the guide controls inside the viewport when scrolling past a wide target', async () => {
    goto('/app/networking?pruvodce=networking');
    const screen = await renderComponent(
      <main style={{ minHeight: '300vh', padding: 24 }}>
        <h1>Networking</h1>
        <label
          data-tour="networking-visibility"
          style={{ display: 'block', marginTop: 260, padding: 16 }}
        >
          <input type="checkbox" /> Zobrazit můj profil v adresáři
        </label>
        <ParticipantTour />
      </main>,
    );
    const close = screen.getByRole('button', { name: 'Ukončit průvodce' });
    await expect.element(close).toBeVisible();
    window.scrollTo({ top: 1100, behavior: 'instant' });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const panel = screen.container.querySelector('.participant-tour')!;
    expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(16);
    expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      window.innerHeight - 16,
    );
    await close.click();
    expect(window.location.search).toBe('');
  });

  it('does not scroll the page again when collapsing or expanding the same step', async () => {
    const screen = await renderComponent(<TourApp />);
    await expect
      .element(screen.getByRole('link', { name: 'Workshop leadershipu' }))
      .toHaveAttribute('data-tour-highlight', 'true');
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    try {
      for (const name of ['Sbalit', 'Rozbalit']) {
        scroll.mockClear();
        await screen.getByRole('button', { name, exact: true }).click();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
        expect(scroll).not.toHaveBeenCalled();
      }
    } finally {
      scroll.mockRestore();
    }
  });

  it('gets out of the way when the user starts changing a highlighted setting', async () => {
    goto('/app/networking?pruvodce=networking');
    const save = vi.fn();
    const screen = await renderComponent(<TourApp onSave={save} />);
    await expect.element(screen.getByRole('checkbox')).not.toBeChecked();
    expect(save).not.toHaveBeenCalled();
    await screen.getByRole('checkbox').click();
    await expect.element(screen.getByRole('checkbox')).toBeChecked();
    expect(save).toHaveBeenCalledTimes(1);
    await expect
      .element(screen.getByRole('button', { name: 'Rozbalit', exact: true }))
      .toBeVisible();
    expect(window.location.search).toBe('?pruvodce=networking');
  });

  it('follows a real chosen activity and lets the user perform the action themselves', async () => {
    const save = vi.fn();
    const screen = await renderComponent(<TourApp onSave={save} />);
    await expect
      .element(screen.getByRole('link', { name: 'Workshop leadershipu' }))
      .toHaveAttribute('data-tour-highlight', 'true');
    await screen.getByRole('link', { name: 'Workshop leadershipu' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Vaše účast u aktivity',
        }),
      )
      .toBeVisible();
    expect(window.location.search).toContain('pruvodce=detail');
    expect(save).not.toHaveBeenCalled();
    await screen
      .getByRole('button', { name: 'Přejít na zvýrazněné místo' })
      .click();
    await expect
      .element(screen.getByRole('button', { name: 'Přidat do agendy' }))
      .toHaveFocus();
    await screen.getByRole('button', { name: 'Přidat do agendy' }).click();
    expect(save).toHaveBeenCalledTimes(1);
    await screen.getByRole('button', { name: 'Rozbalit', exact: true }).click();
    await screen.getByRole('button', { name: 'Pokračovat do agendy' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Zkontrolujte svůj osobní program',
        }),
      )
      .toBeVisible();
    expect(window.location.search).toContain(`aktivita=${sessionId}`);
    await screen.getByRole('button', { name: 'Zpět', exact: true }).click();
    expect(window.location.pathname).toBe(`/app/program/${sessionId}`);
    await expectComponentToPassAxe(screen.container);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
  });
  it('finds asynchronously loaded targets and supports skipping unavailable content', async () => {
    const screen = await renderComponent(<TourApp initialTarget={false} />);
    await expect
      .element(screen.getByText(/Aktivity zatím nejsou dostupné/))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Načíst aktivity' }).click();
    await expect
      .element(screen.getByRole('link', { name: 'Workshop leadershipu' }))
      .toHaveAttribute('data-tour-highlight', 'true');
    await screen
      .getByRole('button', { name: 'Přeskočit výběr aktivity' })
      .click();
    expect(window.location.pathname).toBe('/app/agenda');
    await screen.getByRole('button', { name: 'Zpět', exact: true }).click();
    expect(window.location.pathname).toBe('/app/program');
  });
  it('resumes from the URL, yields to confirmation dialogs and exits with Escape', async () => {
    goto(`/app/program/${sessionId}?pruvodce=detail&day=friday`);
    const save = vi.fn();
    const screen = await renderComponent(<TourApp onSave={save} />);
    await screen
      .getByRole('button', { name: 'Přejít na zvýrazněné místo' })
      .click();
    await screen.getByRole('button', { name: 'Rezervovat místo' }).click();
    await expect
      .poll(
        () =>
          getComputedStyle(
            screen.container.querySelector('#participant-tour-heading')!,
          ).visibility,
      )
      .toBe('hidden');
    expect(save).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(window.location.search).toContain('pruvodce=detail');
    await screen.getByRole('button', { name: 'Ponechat beze změny' }).click();
    await expect
      .element(screen.getByRole('button', { name: 'Rozbalit', exact: true }))
      .toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect
      .element(screen.getByRole('heading', { name: 'Konferenční aplikace' }))
      .toHaveFocus();
    expect(window.location.search).toBe('?day=friday');
    expect(document.querySelector('[data-tour-highlight]')).toBeNull();
  });
  it('finishes in the application without changing visibility or other user data', async () => {
    goto('/app/networking?pruvodce=networking');
    const save = vi.fn();
    const screen = await renderComponent(<TourApp onSave={save} />);
    await expect.element(screen.getByRole('checkbox')).not.toBeChecked();
    await screen.getByRole('button', { name: 'Zobrazit oznámení' }).click();
    await screen.getByRole('button', { name: 'Kde najdu pomoc' }).click();
    await screen.getByRole('button', { name: 'Dokončit průvodce' }).click();
    expect(window.location.pathname).toBe('/app/napoveda');
    expect(window.location.search).toBe('');
    expect(save).not.toHaveBeenCalled();
  });
});
