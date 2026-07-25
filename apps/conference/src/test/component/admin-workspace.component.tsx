import { beforeEach, describe, expect, it } from 'vitest';

import { AdminAnnouncementWorkspace } from '../../components/admin-announcement-workspace';
import { AdminImportWorkspace } from '../../components/admin-import-workspace';
import { AdminOperationsWorkspace } from '../../components/admin-operations-workspace';
import { AdminReservationWorkspace } from '../../components/admin-reservation-workspace';
import { AdminSupportWorkspace } from '../../components/admin-support-workspace';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import { demoReservations } from '../../components/admin-workspace-demo-data';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent, userEvent } from './render';

const adminRoot = (): HTMLElement => {
  const element = document.querySelector<HTMLElement>(
    '[data-admin-environment="mocked"]',
  );
  if (!element) throw new Error('Admin workspace root is missing.');
  return element;
};

const acknowledgeDialog = async (
  screen: Awaited<ReturnType<typeof renderComponent>>,
) => {
  await screen.getByRole('checkbox', { name: /potvrzuji/i }).click();
};

beforeEach(() => {
  window.history.replaceState({}, '', '/admin');
});

describe('F4 admin workspace critical mocked journeys', () => {
  it('provides a keyboard-first adaptive shell and fails closed for a forbidden role', async () => {
    window.history.replaceState({}, '', '/admin/import');
    const screen = await renderComponent(
      <AdminWorkspaceShell initialRole="participant">
        <AdminImportWorkspace initialMode="known" />
      </AdminWorkspaceShell>,
    );

    await userEvent.keyboard('{Tab}');
    await expect
      .element(screen.getByRole('link', { name: 'Přeskočit na hlavní obsah' }))
      .toHaveFocus();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'K této části nemáte oprávnění',
        }),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain('SYN-10001');
    await expectComponentToPassAxe(adminRoot());
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });

  it('preserves the selected role across client navigation and clears scoped drafts', async () => {
    window.history.replaceState({}, '', '/admin/ucastnici');
    const screen = await renderComponent(
      <AdminWorkspaceShell initialRole="support_operator">
        <AdminSupportWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('searchbox', {
        name: 'Reference vstupenky nebo zkrácené jméno',
      })
      .fill('SYN-10001');
    await screen
      .getByRole('button', { name: 'Vyhledat v mock datech' })
      .click();
    await screen
      .getByRole('button', { name: 'Otevřít auditovanou akci' })
      .click();
    await screen
      .getByRole('textbox', { name: 'Důvod' })
      .fill('Citlivý rozpracovaný důvod se nesmí přenést.');

    await screen
      .getByRole('combobox', { name: 'Demo role a oprávnění' })
      .selectOptions('organizer_admin');
    await expect.element(screen.getByRole('searchbox')).toHaveValue('');

    await screen
      .getByRole('combobox', { name: 'Demo role a oprávnění' })
      .selectOptions('support_operator');
    window.history.pushState({}, '', '/admin/vstupenky');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'K této části nemáte oprávnění',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('combobox', { name: 'Demo role a oprávnění' }))
      .toHaveValue('support_operator');
    await expect.element(screen.getByRole('main')).toHaveFocus();
  });

  it('validates, confirms and reports an exact immutable import preview', async () => {
    window.history.replaceState({}, '', '/admin/import');
    const screen = await renderComponent(
      <AdminWorkspaceShell>
        <AdminImportWorkspace initialMode="known" />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', { level: 1, name: 'Import vstupenek' }),
      )
      .toBeVisible();
    await screen
      .getByRole('button', { name: 'Zkontrolovat dopad mock apply' })
      .click();
    await expect
      .element(screen.getByText('Doplňte povinné údaje'))
      .toBeVisible();
    await screen
      .getByRole('textbox', { name: 'Důvod změny' })
      .fill('Bezpečný syntetický nácvik importu.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat dopad mock apply' })
      .click();

    const dialogTitle = screen.getByRole('heading', {
      name: 'Potvrdit neměnný dopad importu?',
    });
    await expect.element(dialogTitle).toHaveFocus();
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect
      .element(screen.getByRole('button', { name: 'Zrušit' }))
      .toHaveFocus();
    await userEvent.keyboard('{Tab}');
    await expect
      .element(screen.getByRole('checkbox', { name: /potvrzuji/i }))
      .toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialogTitle).not.toBeInTheDocument();

    await screen
      .getByRole('button', { name: 'Zkontrolovat dopad mock apply' })
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('button', { name: 'Použít pouze v mock režimu' })
      .click();
    await expect
      .element(screen.getByRole('heading', { name: 'Mock report je hotový' }))
      .toBeVisible();
    await expect
      .element(screen.getByText(/Aplikováno 2, beze změny 1/))
      .toBeVisible();
    await expectComponentToPassAxe(adminRoot());
  });

  it('validates the actual upload name, type and size before staging', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const screen = await renderComponent(
      <AdminWorkspaceShell>
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );
    const input = screen.getByLabelText('Zdrojový soubor');

    await input.upload(
      new File(['not-a-sheet'], 'tickets.exe', {
        type: 'application/octet-stream',
      }),
    );
    await expect
      .element(
        screen.getByText('Podporované jsou pouze soubory CSV a XLSX do 10 MB.'),
      )
      .toBeVisible();

    await input.upload(
      new File([new Uint8Array(10_000_001)], 'tickets.csv', {
        type: 'text/csv',
      }),
    );
    await expect
      .element(screen.getByText('Soubor překračuje bezpečný limit 10 MB.'))
      .toBeVisible();

    await input.upload(
      new File(['reference,state'], 'tickets.csv', { type: 'text/csv' }),
    );
    await expect
      .element(screen.getByText('Vybráno: tickets.csv', { exact: false }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Vytvořit validované preview',
        }),
      )
      .toBeEnabled();
  });

  it('never enables apply for an unresolved import conflict', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const screen = await renderComponent(
      <AdminWorkspaceShell>
        <AdminImportWorkspace initialMode="conflict" />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByText(
          'Apply je zakázán: preview obsahuje konflikt nebo neznámý stav.',
          { exact: false },
        ),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Zkontrolovat dopad mock apply',
        }),
      )
      .toBeDisabled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('never enables apply for an unknown imported status', async () => {
    window.history.replaceState({}, '', '/admin/import');
    const screen = await renderComponent(
      <AdminWorkspaceShell>
        <AdminImportWorkspace initialMode="unknown" />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByText(
          'Apply je zakázán: preview obsahuje konflikt nebo neznámý stav.',
          { exact: false },
        ),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Zkontrolovat dopad mock apply',
        }),
      )
      .toBeDisabled();
    expect(
      document.querySelector('[role="dialog"]'),
      'Unknown status must never open an apply confirmation.',
    ).toBeNull();
  });

  it('searches with minimal PII and returns a canonical support audit', async () => {
    window.history.replaceState({}, '', '/admin/support');
    const screen = await renderComponent(
      <AdminWorkspaceShell initialRole="support_operator">
        <AdminSupportWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('searchbox', {
        name: 'Reference vstupenky nebo zkrácené jméno',
      })
      .fill('SYN-10001');
    await screen
      .getByRole('button', { name: 'Vyhledat v mock datech' })
      .click();
    await expect.element(screen.getByText('a•••@example.test')).toBeVisible();
    await screen
      .getByRole('button', { name: 'Otevřít auditovanou akci' })
      .click();
    await screen.getByRole('combobox', { name: 'Akce' }).selectOptions('block');
    await screen
      .getByRole('button', { name: 'Zkontrolovat a potvrdit' })
      .click();
    await expect.element(screen.getByText('Akci nelze potvrdit')).toBeVisible();
    await screen
      .getByRole('textbox', { name: 'Důvod' })
      .fill('Syntetické ověření blokace na žádost podpory.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat a potvrdit' })
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('button', { name: 'Potvrdit: Zablokovat vstupenku' })
      .click();

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Canonical stav byl v mocku aktualizován',
        }),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toMatch(
      /[A-Za-z0-9._%+-]+@(?!example\.test)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    );
    await expectComponentToPassAxe(adminRoot());
  });

  it('invalidates an edited announcement preview and sends only a reconfirmed in-app snapshot', async () => {
    window.history.replaceState({}, '', '/admin/oznameni');
    const screen = await renderComponent(
      <AdminWorkspaceShell>
        <AdminAnnouncementWorkspace />
      </AdminWorkspaceShell>,
    );

    const title = screen.getByRole('textbox', { name: 'Název' });
    await title.fill('Změna sálu workshopu');
    await screen
      .getByRole('textbox', { name: 'Text zprávy' })
      .fill('Workshop se přesouvá do sálu Vltava.');
    await screen
      .getByRole('button', { name: 'Vytvořit audience preview' })
      .click();
    await expect
      .element(
        screen.getByRole('heading', { name: 'Immutable audience preview' }),
      )
      .toBeVisible();

    await title.fill('Změna sálu workshopu – aktualizace');
    await expect
      .element(
        screen.getByRole('heading', { name: 'Immutable audience preview' }),
      )
      .not.toBeInTheDocument();
    await screen
      .getByRole('button', { name: 'Vytvořit audience preview' })
      .click();
    await screen
      .getByRole('textbox', { name: 'Provozní důvod' })
      .fill('Informování přímo dotčené skupiny.');
    await screen.getByRole('button', { name: 'Zkontrolovat odeslání' }).click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('button', { name: 'Odeslat v in-app mocku' })
      .click();
    await expect
      .element(
        screen.getByRole('heading', { name: 'Odesláno pouze v in-app mocku' }),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByRole('button', {
          name: 'E-mailový kanál není dostupný',
        }),
      )
      .toBeDisabled();
    await expectComponentToPassAxe(adminRoot());
  });

  it('queues an aggregate export without exposing a DLQ payload', async () => {
    window.history.replaceState({}, '', '/admin/provoz');
    const screen = await renderComponent(
      <AdminWorkspaceShell>
        <AdminOperationsWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('button', {
        name: 'Spustit bezpečný asynchronní export',
      })
      .click();
    await expect
      .element(screen.getByText('Doplňte auditní důvod.'))
      .toBeVisible();
    await screen
      .getByRole('textbox', {
        name: 'Společný auditní důvod pro další akci',
      })
      .fill('Agregovaný report pro syntetický provozní nácvik.');
    await screen
      .getByRole('button', {
        name: 'Spustit bezpečný asynchronní export',
      })
      .click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Zařadit mock export' }).click();
    await expect
      .element(
        screen.getByRole('heading', { name: 'Export zařazen do fronty' }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText('Bez payloadu, adresátů, tokenů a raw chyb.'))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('recipient@example.test');
    await expectComponentToPassAxe(adminRoot());
  });

  it('limits room attendance to assigned sessions and records a versioned audit', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const screen = await renderComponent(
      <AdminWorkspaceShell initialRole="room_operator">
        <AdminReservationWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByText('Růst bez zkratek', { exact: true }).last())
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Panel: firmy v pohybu');
    expect(document.body.textContent).not.toContain('update_support_message');
    await screen.getByRole('button', { name: 'Otevřít řízenou změnu' }).click();
    await screen
      .getByRole('textbox', { name: 'Důvod změny' })
      .fill('Potvrzení fyzické účasti v přidělené místnosti.');
    await screen
      .getByRole('button', {
        name: 'Zkontrolovat označit účast v místnosti',
      })
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('button', {
        name: 'Označit účast v místnosti',
        exact: true,
      })
      .click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Canonical mock stav aktualizován',
        }),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          'Nastavení akce je pro roli operátora sálu pouze nedostupné',
          { exact: false },
        ),
      )
      .toBeVisible();
    await expectComponentToPassAxe(adminRoot());
  });

  it('fails closed for a cross-event reservation with the same assigned session', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const foreign = {
      ...demoReservations[0]!,
      eventId: 'event-foreign-2026',
      participantReference: 'Cizí účastník •999',
    };
    const screen = await renderComponent(
      <AdminWorkspaceShell initialRole="room_operator">
        <AdminReservationWorkspace initialRecords={[foreign]} />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', { name: 'Provozní data nelze zobrazit' }),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Cizí účastník');
    expect(document.body.textContent).not.toContain(foreign.reservationId);
  });

  it('confirms optimistic event settings against their exact version', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const screen = await renderComponent(
      <AdminWorkspaceShell>
        <AdminReservationWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('combobox', { name: 'Režim registrace' })
      .selectOptions('closed');
    await screen
      .getByRole('textbox', { name: 'Důvod změny nastavení' })
      .fill('Syntetický nácvik uzavření registrace.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat změnu nastavení' })
      .click();
    await expect
      .element(
        screen.getByRole('heading', { name: 'Potvrdit auditovanou změnu?' }),
      )
      .toHaveFocus();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Uložit mock nastavení' }).click();
    await expect
      .element(screen.getByText('Verze 6', { exact: true }))
      .toBeVisible();
  });
});
