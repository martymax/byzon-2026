import { describe, expect, it } from 'vitest';
import '../../app/styles.css';
import { ParticipantGuide } from '../../components/participant-guide';
import { ParticipantHelpContent } from '../../components/participant-help';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';

describe('participant welcome and help', () => {
  it('offers a skippable keyboard accessible guide', async () => {
    const screen = await renderComponent(
      <main>
        <ParticipantGuide initiallyOpen />
      </main>,
    );
    await expect
      .element(screen.getByRole('link', { name: 'Přeskočit průvodce' }))
      .toHaveAttribute('href', '/po-prihlaseni');
    await screen.getByRole('button', { name: 'Další', exact: true }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Uloženo ještě neznamená rezervováno',
        }),
      )
      .toHaveFocus();
    await expectComponentToPassAxe(screen.container);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
    await screen.getByRole('button', { name: 'Pomoc na dosah' }).click();
    await expect
      .element(screen.getByRole('link', { name: 'Otevřít aplikaci' }))
      .toHaveAttribute('href', '/po-prihlaseni');
    await screen.getByRole('button', { name: 'Zpět', exact: true }).click();
    await expect
      .element(
        screen.getByRole('heading', { name: 'Buďte v obraze a zapojte se' }),
      )
      .toBeVisible();
  });
  it('searches without diacritics, opens answers, recovers empty results and restarts guide', async () => {
    const screen = await renderComponent(
      <main>
        <h1>Nápověda</h1>
        <ParticipantHelpContent supportEmail="help@example.test" />
      </main>,
    );
    const search = screen.getByRole('searchbox');
    await search.fill('pripojeni');
    await expect
      .element(screen.getByText('Funguje aplikace bez internetu?'))
      .toBeVisible();
    await screen.getByText('Funguje aplikace bez internetu?').click();
    await expect
      .element(screen.getByText(/Některé dříve načtené informace/))
      .toBeVisible();
    await search.fill('nenalezitelnyvyraz');
    await expect
      .element(screen.getByText('Tuhle odpověď zatím nemáme'))
      .toBeVisible();
    await screen
      .getByRole('button', { name: 'Zobrazit všechny otázky' })
      .click();
    await expect.element(search).toHaveValue('');
    await expectComponentToPassAxe(screen.container);
    await screen.getByRole('button', { name: 'Spustit průvodce' }).click();
    await expect
      .element(
        screen.getByRole('heading', { name: 'Vyberte si, co vás zajímá' }),
      )
      .toHaveFocus();
    await expect
      .element(screen.getByRole('link', { name: 'Napsat podpoře' }))
      .toHaveAttribute('href', 'mailto:help@example.test');
  });
});
