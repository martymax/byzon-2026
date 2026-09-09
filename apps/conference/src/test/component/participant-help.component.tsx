import { describe, expect, it } from 'vitest';
import '../../app/styles.css';
import { ParticipantGuide } from '../../components/participant-guide';
import { ParticipantHelpContent } from '../../components/participant-help';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';

describe('participant welcome and help', () => {
  it('offers a real application tour with an optional skip', async () => {
    const screen = await renderComponent(
      <main>
        <ParticipantGuide showSkip />
      </main>,
    );
    await expect
      .element(
        screen.getByRole('link', { name: 'Spustit průvodce v aplikaci' }),
      )
      .toHaveAttribute('href', '/app/program?pruvodce=program');
    await expect
      .element(screen.getByRole('link', { name: 'Vstoupit bez průvodce' }))
      .toHaveAttribute('href', '/po-prihlaseni');
    await expectComponentToPassAxe(screen.container);
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
    await expect
      .element(
        screen.getByRole('link', { name: 'Spustit průvodce v aplikaci' }),
      )
      .toHaveAttribute('href', '/app/program?pruvodce=program');
    await expect
      .element(screen.getByRole('link', { name: 'Napsat podpoře' }))
      .toHaveAttribute('href', 'mailto:help@example.test');
  });
});
