import { adminContextFixtures } from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import {
  AdminContentAssetField,
  createAdminContentAssetPreviewPort,
} from '../../components/admin-content-asset-field';
import { AdminContentWorkspace } from '../../components/admin-content-workspace';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import { adminContextEndpoint } from '../../lib/admin-api';
import {
  createAdminContentPreviewPort,
  type AdminContentPreviewMode,
} from '../../lib/admin-content-preview-port';
import type { ApiPort } from '../../lib/api/endpoint';
import type {
  AdminContentFailure,
  AdminContentPort,
  AdminPublicationPreview,
} from '../../lib/admin-content-api';
import { mayLeaveAdminContentDraft } from '../../lib/admin-content-dirty-guard';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent, userEvent } from './render';

const eventId = '019fc700-0000-7000-8000-000000000001';

const contentRoot = (): HTMLElement => {
  const root = document.querySelector<HTMLElement>(
    '[aria-labelledby="admin-publication-title"]',
  )?.parentElement;
  if (!root) throw new Error('Admin content workspace is missing.');
  return root;
};

const selectArea = (value: string) => {
  const target = Array.from(document.querySelectorAll('select')).find(
    (candidate) =>
      Array.from(candidate.options).some((option) => option.value === value) &&
      Array.from(candidate.options).some(
        (option) => option.value === 'program',
      ),
  );
  if (!target) throw new Error('Content area selector is missing.');
  target.value = value;
  target.dispatchEvent(new Event('change', { bubbles: true }));
};

const renderContent = (options?: {
  assetPort?: ReturnType<typeof createAdminContentAssetPreviewPort>;
  port?: AdminContentPort;
  readOnly?: boolean;
}) => {
  const port = options?.port ?? createAdminContentPreviewPort({ eventId });
  return renderComponent(
    <AdminContentWorkspace
      {...(options?.assetPort ? { assetPort: options.assetPort } : {})}
      eventId={eventId}
      port={port}
      {...(options?.readOnly === undefined
        ? {}
        : { readOnly: options.readOnly })}
      timezone="Europe/Prague"
    />,
  );
};

const securityPort = (
  kind: Extract<
    AdminContentFailure['kind'],
    'offline' | 'permission' | 'session_expired'
  >,
): AdminContentPort => {
  const base = createAdminContentPreviewPort({ eventId });
  return {
    ...base,
    list: async (candidateEventId, resource, signal) =>
      resource === 'venues'
        ? {
            ok: false,
            failure: {
              kind,
              message: `Syntetický bezpečnostní stav ${kind}.`,
            },
          }
        : base.list(candidateEventId, resource, signal),
  };
};

beforeEach(() => {
  window.history.replaceState({}, '', '/admin/obsah');
});

describe('admin content user journeys', () => {
  it('opens list-first with five areas, exact types and a safe URL state', async () => {
    const screen = await renderContent();

    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Přidat bod programu' }))
      .toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Název' }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Kontrolní součet');
    for (const label of [
      'Program',
      'Řečníci',
      'Místa a místnosti',
      'Partneři',
      'Praktické informace',
    ]) {
      expect(screen.getByText(label).elements().length).toBeGreaterThan(0);
    }

    await screen
      .getByRole('button', { name: 'Upravit: Otevření konference' })
      .click();
    expect(window.location.hash).toBe('#uprava');
    window.history.back();
    await vi.waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Zpět na seznam' }).elements(),
      ).toHaveLength(0),
    );
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();

    selectArea('practical');
    await expect
      .element(screen.getByRole('button', { name: 'Přidat stránku' }))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Časté dotazy' }).click();
    await expect
      .element(screen.getByRole('button', { name: 'Přidat otázku' }))
      .toBeVisible();
    expect(window.location.search).toBe('?oblast=practical&typ=faqs');
    expect(window.location.search).not.toContain('query');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(contentRoot());
  });

  it('uses progressive slug/order and an accessible speaker checkbox picker', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const screen = await renderContent();
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await screen.getByRole('button', { name: 'Přidat bod programu' }).click();

    await screen
      .getByRole('textbox', { name: 'Název' })
      .fill('Český růst bez zkratek');
    await screen.getByText('Pokročilé', { exact: true }).click();
    await expect
      .element(screen.getByRole('textbox', { name: 'Adresa stránky' }))
      .toHaveValue('cesky-rust-bez-zkratek');
    await expect.element(screen.getByText('Pozice 2')).toBeVisible();
    await screen.getByRole('button', { name: 'Posunout dolů' }).click();
    await expect.element(screen.getByText('Pozice 3')).toBeVisible();

    await screen.getByRole('searchbox', { name: 'Najít řečníka' }).fill('Alex');
    const speaker = screen.getByRole('checkbox', { name: 'Alex Novák' });
    await speaker.click();
    await expect
      .element(screen.getByRole('list', { name: 'Vybraní řečníci' }))
      .toHaveTextContent('Alex Novák');
    (await speaker.element()).focus();
    await userEvent.keyboard(' ');
    expect(
      screen.getByRole('list', { name: 'Vybraní řečníci' }),
    ).not.toBeInTheDocument();
    await expect
      .element(screen.getByText('Začátek (Europe/Prague)'))
      .toBeVisible();

    expect(mayLeaveAdminContentDraft()).toBe(false);
    await expect
      .element(screen.getByRole('button', { name: 'Zkontrolovat změny' }))
      .toBeDisabled();
    await expectComponentToPassAxe(contentRoot());
    confirm.mockReturnValue(true);
    await screen.getByRole('button', { name: 'Zpět na seznam' }).click();
    confirm.mockRestore();
  });

  it('uses exact field labels and neutral asset placeholders without a resolver', async () => {
    const screen = await renderContent();
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    selectArea('speakers');
    await expect.element(screen.getByText('Alex Novák')).toBeVisible();
    await screen.getByRole('button', { name: 'Upravit: Alex Novák' }).click();
    await expect
      .element(screen.getByRole('textbox', { name: 'Pozice nebo role' }))
      .toBeVisible();
    await expect
      .element(screen.getByText(/autorizovaného resolveru/))
      .toBeVisible();
    expect(screen.getByLabelText('Obrázek')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('019fc400');

    selectArea('places');
    await screen.getByRole('button', { name: 'Místa', exact: true }).click();
    await expect
      .element(screen.getByRole('button', { name: 'Přidat místo' }))
      .toBeVisible();
    await screen.getByRole('button', { name: /^Upravit:/ }).click();
    await expect
      .element(screen.getByRole('textbox', { name: 'Místo pro mapu' }))
      .toBeVisible();
  });

  it('creates, updates and archives without exposing permanent delete', async () => {
    const screen = await renderContent();
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    selectArea('practical');
    await screen.getByRole('button', { name: 'Časté dotazy' }).click();
    await screen.getByRole('button', { name: 'Přidat otázku' }).click();
    await screen
      .getByRole('textbox', { name: 'Otázka' })
      .fill('Kde je registrace?');
    await screen
      .getByRole('textbox', { name: 'Odpověď' })
      .fill('Registrace je v hlavním foyer.');
    await screen.getByRole('button', { name: 'Uložit novou položku' }).click();
    await expect.element(screen.getByText('Kde je registrace?')).toBeVisible();

    await screen
      .getByRole('button', { name: 'Upravit: Kde je registrace?' })
      .click();
    await screen
      .getByRole('textbox', { name: 'Otázka' })
      .fill('Kde přesně je registrace?');
    await screen.getByRole('button', { name: 'Uložit změny' }).click();
    await expect
      .element(screen.getByText('Kde přesně je registrace?'))
      .toBeVisible();
    await screen
      .getByRole('button', { name: 'Archivovat: Kde přesně je registrace?' })
      .click();
    await expect
      .element(screen.getByRole('heading', { name: 'Archivovat obsah?' }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Trvale smazat');
    await screen.getByRole('checkbox').click();
    await screen.getByRole('button', { name: 'Archivovat položku' }).click();
    await screen.getByRole('button', { name: 'Archiv', exact: true }).click();
    await expect
      .element(screen.getByText('Kde přesně je registrace?'))
      .toBeVisible();
    expect(
      screen.getByRole('button', {
        name: 'Upravit: Kde přesně je registrace?',
      }),
    ).not.toBeInTheDocument();
  });

  it('reviews title-level changes and publishes through a primary confirmation', async () => {
    const screen = await renderContent();
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await screen.getByRole('button', { name: 'Zkontrolovat změny' }).click();
    await expect
      .element(screen.getByText('Obsah má 8 změn ke kontrole.'))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('019fc400');
    await expect
      .element(screen.getByText('Kontrolní součet'))
      .not.toBeVisible();
    await screen.getByText('Technické údaje').click();
    await expect.element(screen.getByText('Kontrolní součet')).toBeVisible();

    await screen
      .getByRole('button', { name: 'Pokračovat ke zveřejnění' })
      .click();
    await expect
      .element(screen.getByRole('heading', { name: 'Zveřejnit 8 změn?' }))
      .toHaveFocus();
    const confirm = screen.getByRole('button', { name: 'Zveřejnit změny' });
    expect((await confirm.element()).className).not.toContain('danger');
    await screen.getByRole('checkbox').click();
    await confirm.click();
    await expect
      .element(screen.getByText(/Změny byly zveřejněné/))
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Zobrazit publikovaný obsah' }))
      .toHaveAttribute('href', '/app/program');
  });

  it('locks an ambiguous publish until the canonical state is checked', async () => {
    const base = createAdminContentPreviewPort({ eventId });
    const publish = vi.fn(async () => ({
      ok: false as const,
      failure: {
        kind: 'transport' as const,
        message: 'Odpověď se po potvrzení ztratila.',
      },
    }));
    const screen = await renderContent({ port: { ...base, publish } });
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await screen.getByRole('button', { name: 'Zkontrolovat změny' }).click();
    await screen
      .getByRole('button', { name: 'Pokračovat ke zveřejnění' })
      .click();
    await screen.getByRole('checkbox').click();
    await screen.getByRole('button', { name: 'Zveřejnit změny' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Výsledek publikace není potvrzen',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Zkontrolovat změny' }))
      .toBeDisabled();
    await screen.getByRole('button', { name: 'Načíst aktuální stav' }).click();
    await expect
      .element(screen.getByText(/Aktuální stav přesně odpovídá/))
      .toBeVisible();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('keeps publishing blocked when reconciliation finds the change already published', async () => {
    const base = createAdminContentPreviewPort({ eventId });
    const publish = vi.fn(
      async (
        candidateEventId: string,
        preview: AdminPublicationPreview,
        signal?: AbortSignal,
      ) => {
        await base.publish(candidateEventId, preview, signal);
        return {
          ok: false as const,
          failure: {
            kind: 'transport' as const,
            message: 'Odpověď se po potvrzení ztratila.',
          },
        };
      },
    );
    const screen = await renderContent({ port: { ...base, publish } });
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await screen.getByRole('button', { name: 'Zkontrolovat změny' }).click();
    await screen
      .getByRole('button', { name: 'Pokračovat ke zveřejnění' })
      .click();
    await screen.getByRole('checkbox').click();
    await screen.getByRole('button', { name: 'Zveřejnit změny' }).click();
    await screen.getByRole('button', { name: 'Načíst aktuální stav' }).click();

    await expect
      .element(screen.getByText(/Server potvrdil aktuální stav bez změny/))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Zkontrolovat změny' }))
      .toBeDisabled();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('surfaces collision and stale recovery without losing a dirty form', async () => {
    const port = createAdminContentPreviewPort({ eventId });
    const screen = await renderContent({ port });
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    selectArea('practical');
    await screen.getByRole('button', { name: 'Časté dotazy' }).click();
    await screen.getByRole('button', { name: 'Přidat otázku' }).click();
    await screen.getByRole('textbox', { name: 'Otázka' }).fill('Kolize?');
    await screen.getByRole('textbox', { name: 'Odpověď' }).fill('Odpověď.');

    port.setMode('conflict');
    await screen.getByRole('button', { name: 'Uložit novou položku' }).click();
    await expect
      .element(
        screen.getByRole('heading', { name: 'Změna koliduje s obsahem' }),
      )
      .toBeVisible();
    port.setMode('stale');
    await screen.getByRole('button', { name: 'Uložit novou položku' }).click();
    await expect
      .element(
        screen.getByRole('heading', { name: 'Obsah na serveru se změnil' }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('textbox', { name: 'Otázka' }))
      .toHaveValue('Kolize?');
    await expect
      .element(screen.getByText(/Další zápisy jsou zamčené/))
      .toBeVisible();
  });

  it('supports an accessible mocked asset preview, progress and removal', async () => {
    const screen = await renderContent({
      assetPort: createAdminContentAssetPreviewPort(),
    });
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    selectArea('speakers');
    await expect.element(screen.getByText('Alex Novák')).toBeVisible();
    await screen.getByRole('button', { name: 'Upravit: Alex Novák' }).click();
    await expect
      .element(screen.getByText('Fotografie řečníka zatím není dostupná'))
      .toBeVisible();
    await userEvent.upload(
      await screen.getByLabelText('Obrázek').element(),
      new File(['synthetic-image'], 'alex.webp', { type: 'image/webp' }),
    );
    await screen.getByRole('button', { name: 'Nahrát obrázek' }).click();
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Doplňte alternativní popis');
    await screen
      .getByRole('textbox', { name: 'Alternativní popis' })
      .fill('Portrét Alexe Nováka');
    await screen.getByRole('button', { name: 'Nahrát obrázek' }).click();
    await expect.element(screen.getByRole('progressbar')).toBeVisible();
    await expect
      .element(screen.getByRole('img', { name: 'Portrét Alexe Nováka' }))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Odstranit obrázek' }).click();
    expect(screen.getByRole('img')).not.toBeInTheDocument();
    await expectComponentToPassAxe(contentRoot());
  });

  it('keeps an existing asset preview visible but immutable in read-only mode', async () => {
    const port = createAdminContentAssetPreviewPort();
    const owner = {
      kind: 'speaker' as const,
      id: '019fc700-0000-7000-8000-000000000021',
    };
    const seeded = await port.replace({
      altText: 'Portrét Alexe Nováka',
      eventId,
      expectedOwnerVersion: 1,
      file: new File(['synthetic-image'], 'alex.webp', {
        type: 'image/webp',
      }),
      onProgress: () => undefined,
      owner,
      purpose: 'speaker_photo',
    });
    expect(seeded.ok).toBe(true);

    const screen = await renderComponent(
      <AdminContentAssetField
        eventId={eventId}
        owner={owner}
        ownerVersion={2}
        port={port}
        purpose="speaker_photo"
        readOnly
      />,
    );

    await expect
      .element(screen.getByRole('img', { name: 'Portrét Alexe Nováka' }))
      .toBeVisible();
    await expect
      .element(screen.getByText('Archivovaný obsah je pouze ke čtení.'))
      .toBeVisible();
    expect(screen.getByLabelText('Obrázek')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Odstranit obrázek' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    'offline',
    'permission',
    'session_expired',
  ] satisfies readonly AdminContentPreviewMode[])(
    'wipes content and blocks the workspace after %s',
    async (mode) => {
      const screen = await renderContent({ port: securityPort(mode) });
      await expect
        .element(
          screen.getByRole('heading', {
            name: 'Obsah nelze bezpečně zobrazit',
          }),
        )
        .toBeVisible();
      expect(document.body.textContent).not.toContain('Otevření konference');
      expect(
        screen.getByRole('button', { name: 'Přidat bod programu' }),
      ).not.toBeInTheDocument();
    },
  );

  it('keeps an archived event and archived items read-only', async () => {
    const screen = await renderContent({ readOnly: true });
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await expect
      .element(screen.getByText('Archiv · pouze čtení'))
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Přidat bod programu' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Upravit:/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Zkontrolovat změny' }),
    ).not.toBeInTheDocument();
    await expectComponentToPassAxe(contentRoot());
  });

  it('does not mount the production content port without program:manage', async () => {
    const list = vi.fn(async () => {
      throw new Error('Forbidden content port was mounted.');
    });
    const blockedPort: AdminContentPort = {
      ...createAdminContentPreviewPort({ eventId }),
      list,
    };
    const api: ApiPort = {
      request: vi.fn(async (endpoint) => {
        if (endpoint !== adminContextEndpoint)
          throw new Error('Unexpected endpoint.');
        return {
          ok: true,
          kind: 'success',
          status: 200,
          data: {
            ...adminContextFixtures.organizer!,
            actor: {
              ...adminContextFixtures.organizer!.actor,
              permissions: ['operations:read'],
            },
          },
          metadata: { requestId: 'admin-content-component-0001' },
        };
      }) as unknown as ApiPort['request'],
    };
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminContentWorkspace
          eventId={eventId}
          port={blockedPort}
          timezone="Europe/Prague"
        />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'K této části nemáte oprávnění',
        }),
      )
      .toBeVisible();
    expect(list).not.toHaveBeenCalled();
  });
});
