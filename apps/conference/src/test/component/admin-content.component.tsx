import { adminContextFixtures } from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import { AdminContentWorkspace } from '../../components/admin-content-workspace';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import {
  createAdminContentPreviewPort,
  type AdminContentPreviewMode,
} from '../../lib/admin-content-preview-port';
import { adminContextEndpoint } from '../../lib/admin-api';
import type { ApiPort } from '../../lib/api/endpoint';
import type {
  AdminContentFailure,
  AdminContentList,
  AdminContentMutation,
  AdminContentPort,
  AdminContentResult,
  AdminPublicationPreview,
  AdminPublicationResult,
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
  it('guards dirty input, focuses invalid fields and stays responsive', async () => {
    window.history.replaceState({}, '', '/admin');
    window.history.pushState({}, '', '/admin/obsah');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const screen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={createAdminContentPreviewPort({ eventId })}
        timezone="Europe/Prague"
      />,
    );
    const resource = screen.getByRole('combobox', { name: 'Oblast obsahu' });

    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    expect(
      Array.from(
        (
          screen
            .getByRole('combobox', { name: 'Typ' })
            .element() as HTMLSelectElement
        ).options,
        ({ value }) => value,
      ),
    ).toEqual([
      'talk',
      'panel',
      'workshop',
      'mastermind',
      'coaching',
      'networking',
      'break',
      'meal',
      'gala',
      'other',
    ]);
    await screen.getByRole('button', { name: 'Sestavit nový náhled' }).click();
    await expect
      .element(screen.getByText(/Immutable náhled verze 1/))
      .toBeVisible();
    await screen.getByRole('textbox', { name: 'Slug' }).fill('rozepsany-bod');
    expect(document.body.textContent).not.toContain('Kontrolní součet');
    await expect
      .element(
        screen.getByText(
          'Formulář obsahuje neuložené změny. Před sestavením náhledu je uložte nebo zahoďte.',
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Sestavit nový náhled' }))
      .toBeDisabled();
    expect(
      screen
        .getByRole('button', { name: /^Archivovat:/ })
        .elements()
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
    expect(mayLeaveAdminContentDraft()).toBe(false);
    window.history.back();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(window.location.pathname).toBe('/admin/obsah');
    await expect
      .element(screen.getByRole('textbox', { name: 'Slug' }))
      .toHaveValue('rozepsany-bod');
    await resource.selectOptions('partners');
    await expect.element(resource).toHaveValue('sessions');
    expect(confirm).toHaveBeenCalledTimes(3);

    confirm.mockReturnValue(true);
    await resource.selectOptions('partners');
    await expect.element(resource).toHaveValue('partners');
    await expect.element(screen.getByText('Partner Example')).toBeVisible();
    expect(
      Array.from(
        (
          screen
            .getByRole('combobox', { name: 'Stav' })
            .element() as HTMLSelectElement
        ).options,
        ({ value }) => value,
      ),
    ).not.toContain('archived');
    await screen.getByRole('button', { name: 'Vytvořit položku' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Obsahovou operaci nelze dokončit',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('textbox', { name: 'Slug' }))
      .toHaveFocus();

    await screen
      .getByRole('textbox', { name: 'Slug' })
      .fill('rozepsany-partner');
    await expect
      .element(screen.getByRole('textbox', { name: 'Slug' }))
      .toHaveFocus();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    const action = screen.getByRole('button', { name: 'Vytvořit položku' });
    expect(
      (await action.element().getBoundingClientRect()).height,
    ).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
    await expectComponentToPassAxe(contentRoot());
    confirm.mockRestore();
  });

  it('never exposes actions for an old resource while a new snapshot loads or fails', async () => {
    const base = createAdminContentPreviewPort({ eventId });
    let resolvePartners:
      ((result: AdminContentResult<AdminContentList>) => void) | undefined;
    const pendingPartners = new Promise<AdminContentResult<AdminContentList>>(
      (resolve) => {
        resolvePartners = resolve;
      },
    );
    const port: AdminContentPort = {
      ...base,
      list: (candidateEventId, resource, signal) =>
        resource === 'partners'
          ? pendingPartners
          : base.list(candidateEventId, resource, signal),
    };
    const screen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={port}
        timezone="Europe/Prague"
      />,
    );

    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await screen
      .getByRole('combobox', { name: 'Oblast obsahu' })
      .selectOptions('faqs');
    await expect
      .element(screen.getByText('Je k dispozici šatna?'))
      .toBeVisible();
    await screen
      .getByRole('textbox', { name: 'Otázka' })
      .fill('Je dostupné parkování?');
    await screen
      .getByRole('textbox', { name: 'Odpověď' })
      .fill('Ano, u hotelu.');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await screen
      .getByRole('combobox', { name: 'Oblast obsahu' })
      .selectOptions('partners');
    await expect.element(screen.getByText('Načítám obsah…')).toBeVisible();
    expect(document.body.textContent).not.toContain('Otevření konference');
    expect(
      screen.getByRole('button', { name: /^Upravit:/ }).elements(),
    ).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Vytvořit položku' }).elements(),
    ).toHaveLength(0);

    resolvePartners?.({
      ok: false,
      failure: {
        kind: 'transport',
        message: 'Syntetický nový snapshot nebyl potvrzen.',
      },
    });
    await expect
      .element(screen.getByText(/Lokální formulář zůstal zachovaný/))
      .toBeVisible();
    await expect
      .element(screen.getByRole('textbox', { name: 'Otázka' }))
      .toHaveValue('Je dostupné parkování?');
    await expect
      .element(screen.getByRole('button', { name: 'Vytvořit položku' }))
      .toBeDisabled();
    expect(document.body.textContent).not.toContain('Otevření konference');
    confirm.mockRestore();
  });

  it('keeps actionable conflict and stale recovery messages visible', async () => {
    const port = createAdminContentPreviewPort({ eventId });
    const screen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={port}
        timezone="Europe/Prague"
      />,
    );
    await screen
      .getByRole('combobox', { name: 'Oblast obsahu' })
      .selectOptions('faqs');
    await expect
      .element(screen.getByText('Je k dispozici šatna?'))
      .toBeVisible();
    await screen
      .getByRole('textbox', { name: 'Otázka' })
      .fill('Je dostupné parkování?');
    await screen
      .getByRole('textbox', { name: 'Odpověď' })
      .fill('Ano, u hotelu.');

    port.setMode('conflict');
    await screen.getByRole('button', { name: 'Vytvořit položku' }).click();
    await expect
      .element(
        screen.getByRole('heading', { name: 'Změna koliduje s obsahem' }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText(/Časy bodu se překrývají/))
      .toBeVisible();

    port.setMode('stale');
    await screen.getByRole('button', { name: 'Vytvořit položku' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Snapshot obsahu se změnil',
        }),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          'Aktuální seznam není dostupný. Zkuste znovu načíst celý snapshot.',
        ),
      )
      .toBeVisible();
  });

  it('creates, updates, archives and explicitly publishes stateful mock content', async () => {
    const base = createAdminContentPreviewPort({ eventId });
    const save = vi.fn(base.save);
    const port: AdminContentPort = { ...base, save };
    const screen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={port}
        timezone="Europe/Prague"
      />,
    );

    await screen
      .getByRole('combobox', { name: 'Oblast obsahu' })
      .selectOptions('faqs');
    await expect
      .element(screen.getByText('Je k dispozici šatna?'))
      .toBeVisible();
    await screen
      .getByRole('textbox', { name: 'Otázka' })
      .fill('Kde je registrace?');
    await screen
      .getByRole('textbox', { name: 'Odpověď' })
      .fill('Registrace je v hlavním foyer.');
    await screen.getByRole('textbox', { name: 'Kategorie' }).fill('Na místě');
    const create = screen.getByRole('button', { name: 'Vytvořit položku' });
    const createElement = (await create.element()) as HTMLButtonElement;
    createElement.click();
    createElement.click();
    await expect.element(screen.getByText('Kde je registrace?')).toBeVisible();
    expect(save).toHaveBeenCalledTimes(1);

    const editButtons = screen
      .getByRole('button', { name: /^Upravit:/ })
      .elements();
    (editButtons.at(-1) as HTMLButtonElement).click();
    await expect
      .element(screen.getByRole('textbox', { name: 'Otázka' }))
      .toHaveValue('Kde je registrace?');
    await screen
      .getByRole('textbox', { name: 'Otázka' })
      .fill('Kde přesně je registrace?');
    await screen.getByRole('button', { name: 'Uložit změny' }).click();
    await expect
      .element(screen.getByText('Kde přesně je registrace?'))
      .toBeVisible();
    expect(save).toHaveBeenCalledTimes(2);

    const archiveButtons = screen
      .getByRole('button', { name: /^Archivovat:/ })
      .elements();
    (archiveButtons.at(-1) as HTMLButtonElement).click();
    const archiveTitle = screen.getByRole('heading', {
      name: 'Archivovat obsah?',
    });
    await expect.element(archiveTitle).toHaveFocus();
    await expect
      .element(screen.getByRole('button', { name: 'Archivovat položku' }))
      .toBeDisabled();
    await screen.getByRole('checkbox').click();
    await screen.getByRole('button', { name: 'Archivovat položku' }).click();
    await expect
      .element(
        screen.getByText('Položka byla archivována a potvrzena serverem.'),
      )
      .toBeVisible();
    const archivedEditButtons = screen
      .getByRole('button', { name: /^Upravit:/ })
      .elements();
    expect((archivedEditButtons.at(-1) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await screen.getByRole('button', { name: 'Sestavit nový náhled' }).click();
    await expect
      .element(screen.getByText(/Immutable náhled verze 1/))
      .toBeVisible();
    const checksumValue = document.querySelector<HTMLElement>(
      '[class*="checksum"] code',
    )?.textContent;
    expect(checksumValue).toMatch(/^[0-9a-f]{64}$/);
    await expect
      .element(screen.getByText('Významně změněné body programu'))
      .toBeVisible();
    const review = screen.getByRole('button', {
      name: 'Zkontrolovat a publikovat',
    });
    await review.click();
    await expect
      .element(screen.getByRole('heading', { name: 'Publikovat obsah akce?' }))
      .toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect.element(review).toHaveFocus();
    await review.click();
    await screen.getByRole('checkbox').click();
    await screen.getByRole('button', { name: 'Publikovat verzi 1' }).click();
    await expect
      .element(screen.getByText(/atomicky publikována/))
      .toBeVisible();
    await expectComponentToPassAxe(contentRoot());
  });

  it('locks an ambiguous publish until canonical verification', async () => {
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
            message: 'Odpověď publikace se po commitu ztratila.',
          },
        };
      },
    );
    const screen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={{ ...base, publish }}
        timezone="Europe/Prague"
      />,
    );

    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await screen.getByRole('button', { name: 'Sestavit nový náhled' }).click();
    const checksum = document.querySelector<HTMLElement>(
      '[class*="checksum"] code',
    )?.textContent;
    await screen
      .getByRole('button', { name: 'Zkontrolovat a publikovat' })
      .click();
    await screen.getByRole('checkbox').click();
    await screen.getByRole('button', { name: 'Publikovat verzi 1' }).click();

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Výsledek publikace není potvrzen',
        }),
      )
      .toBeVisible();
    expect(document.body.textContent).toContain(checksum);
    await expect
      .element(screen.getByRole('button', { name: 'Sestavit nový náhled' }))
      .toBeDisabled();
    await expect
      .element(
        screen.getByRole('button', { name: 'Zkontrolovat a publikovat' }),
      )
      .toBeDisabled();
    expect(publish).toHaveBeenCalledTimes(1);

    await screen.getByRole('button', { name: 'Ověřit kanonický stav' }).click();
    await expect
      .element(screen.getByText(/Server potvrdil kanonický stav/))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Sestavit nový náhled' }))
      .toBeDisabled();
    await expect
      .element(
        screen.getByRole('button', { name: 'Zkontrolovat a publikovat' }),
      )
      .toBeDisabled();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('turns the empty scenario into stateful content after the first create', async () => {
    const port = createAdminContentPreviewPort({ eventId });
    port.setMode('empty');
    const screen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={port}
        timezone="Europe/Prague"
      />,
    );

    await expect
      .element(screen.getByText('V této oblasti zatím není žádná položka.'))
      .toBeVisible();
    await screen
      .getByRole('combobox', { name: 'Oblast obsahu' })
      .selectOptions('faqs');
    await expect
      .element(screen.getByText('V této oblasti zatím není žádná položka.'))
      .toBeVisible();
    await screen.getByRole('textbox', { name: 'Otázka' }).fill('První otázka?');
    await screen
      .getByRole('textbox', { name: 'Odpověď' })
      .fill('První odpověď.');
    await screen.getByRole('button', { name: 'Vytvořit položku' }).click();
    await expect.element(screen.getByText('První otázka?')).toBeVisible();
  });

  it('labels day removal as permanent and requires acknowledgement', async () => {
    const screen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={createAdminContentPreviewPort({ eventId })}
        timezone="Europe/Prague"
      />,
    );
    await screen
      .getByRole('combobox', { name: 'Oblast obsahu' })
      .selectOptions('days');
    await expect.element(screen.getByText('Pátek')).toBeVisible();
    await screen
      .getByRole('button', { name: 'Trvale smazat den: Pátek' })
      .click();
    await expect
      .element(screen.getByRole('heading', { name: 'Trvale smazat den?' }))
      .toBeVisible();
    await expect
      .element(screen.getByText(/Den bude trvale odstraněn/))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Trvale smazat den',
          exact: true,
        }),
      )
      .toBeDisabled();
    await screen.getByRole('checkbox').click();
    await screen
      .getByRole('button', { name: 'Trvale smazat den', exact: true })
      .click();
    await expect
      .element(
        screen.getByRole('heading', { name: 'Změna koliduje s obsahem' }),
      )
      .toBeVisible();
    await expect.element(screen.getByText('Pátek')).toBeVisible();
  });

  it.each([
    'offline',
    'permission',
    'session_expired',
  ] satisfies readonly AdminContentPreviewMode[])(
    'wipes all content and blocks the workspace after %s',
    async (mode) => {
      const screen = await renderComponent(
        <AdminContentWorkspace
          eventId={eventId}
          port={securityPort(mode)}
          timezone="Europe/Prague"
        />,
      );

      await expect
        .element(
          screen.getByRole('heading', {
            name: 'Obsah nelze bezpečně zobrazit',
          }),
        )
        .toBeVisible();
      expect(document.body.textContent).not.toContain('Otevření konference');
      expect(
        screen.getByRole('button', { name: 'Vytvořit položku' }).elements(),
      ).toHaveLength(0);
      if (mode === 'session_expired') {
        await expect
          .element(screen.getByRole('link', { name: 'Přihlásit se znovu' }))
          .toHaveAttribute(
            'href',
            '/prihlaseni?mode=recovery&returnTo=%2Fadmin%2Fobsah',
          );
      } else {
        await expect
          .element(
            screen.getByRole('button', { name: 'Ověřit a načíst znovu' }),
          )
          .toBeVisible();
      }
    },
  );

  it('removes a loaded list and immutable preview when a later read revokes access', async () => {
    const base = createAdminContentPreviewPort({ eventId });
    let revoked = false;
    const port: AdminContentPort = {
      ...base,
      list: (candidateEventId, resource, signal) =>
        revoked && resource === 'venues'
          ? Promise.resolve({
              ok: false,
              failure: {
                kind: 'permission',
                message: 'Syntetické oprávnění bylo odebráno.',
              },
            })
          : base.list(candidateEventId, resource, signal),
    };
    const screen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={port}
        timezone="Europe/Prague"
      />,
    );

    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await screen.getByRole('button', { name: 'Sestavit nový náhled' }).click();
    await expect
      .element(screen.getByText(/Immutable náhled verze 1/))
      .toBeVisible();

    revoked = true;
    await screen.getByRole('button', { name: 'Načíst aktuální stav' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Obsah nelze bezpečně zobrazit',
        }),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Otevření konference');
    expect(document.body.textContent).not.toContain('Kontrolní součet');
    await expect
      .element(screen.getByRole('button', { name: 'Ověřit a načíst znovu' }))
      .toBeVisible();
  });

  it('aborts deferred save and publication requests when their scope unmounts', async () => {
    const saveBase = createAdminContentPreviewPort({ eventId });
    let saveSignal: AbortSignal | undefined;
    let resolveSave:
      ((result: AdminContentResult<AdminContentMutation>) => void) | undefined;
    const pendingSave = new Promise<AdminContentResult<AdminContentMutation>>(
      (resolve) => {
        resolveSave = resolve;
      },
    );
    const savePort: AdminContentPort = {
      ...saveBase,
      save: (input) => {
        saveSignal = input.signal;
        return pendingSave;
      },
    };
    const saveScreen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={savePort}
        timezone="Europe/Prague"
      />,
    );
    await saveScreen
      .getByRole('combobox', { name: 'Oblast obsahu' })
      .selectOptions('faqs');
    await expect
      .element(saveScreen.getByText('Je k dispozici šatna?'))
      .toBeVisible();
    await saveScreen
      .getByRole('textbox', { name: 'Otázka' })
      .fill('Deferred otázka?');
    await saveScreen
      .getByRole('textbox', { name: 'Odpověď' })
      .fill('Deferred odpověď.');
    await saveScreen.getByRole('button', { name: 'Vytvořit položku' }).click();
    expect(saveSignal?.aborted).toBe(false);
    await saveScreen.unmount();
    expect(saveSignal?.aborted).toBe(true);
    resolveSave?.({
      ok: false,
      failure: { kind: 'aborted', message: 'Požadavek byl zrušen.' },
    });

    const previewBase = createAdminContentPreviewPort({ eventId });
    let previewSignal: AbortSignal | undefined;
    let resolvePreview:
      | ((result: AdminContentResult<AdminPublicationPreview>) => void)
      | undefined;
    const pendingPreview = new Promise<
      AdminContentResult<AdminPublicationPreview>
    >((resolve) => {
      resolvePreview = resolve;
    });
    const previewPort: AdminContentPort = {
      ...previewBase,
      previewPublication: (_candidateEventId, signal) => {
        previewSignal = signal;
        return pendingPreview;
      },
    };
    const previewScreen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={previewPort}
        timezone="Europe/Prague"
      />,
    );
    await expect
      .element(previewScreen.getByText('Otevření konference'))
      .toBeVisible();
    await previewScreen
      .getByRole('button', { name: 'Sestavit nový náhled' })
      .click();
    expect(previewSignal?.aborted).toBe(false);
    await previewScreen.unmount();
    expect(previewSignal?.aborted).toBe(true);
    resolvePreview?.({
      ok: false,
      failure: { kind: 'aborted', message: 'Požadavek byl zrušen.' },
    });

    const archiveBase = createAdminContentPreviewPort({ eventId });
    let archiveSignal: AbortSignal | undefined;
    let resolveArchive:
      ((result: AdminContentResult<AdminContentMutation>) => void) | undefined;
    const pendingArchive = new Promise<
      AdminContentResult<AdminContentMutation>
    >((resolve) => {
      resolveArchive = resolve;
    });
    const archiveScreen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={{
          ...archiveBase,
          archive: (input) => {
            archiveSignal = input.signal;
            return pendingArchive;
          },
        }}
        timezone="Europe/Prague"
      />,
    );
    await archiveScreen
      .getByRole('combobox', { name: 'Oblast obsahu' })
      .selectOptions('partners');
    await expect
      .element(archiveScreen.getByText('Partner Example'))
      .toBeVisible();
    await archiveScreen
      .getByRole('button', { name: 'Archivovat: Partner Example' })
      .click();
    await archiveScreen.getByRole('checkbox').click();
    await archiveScreen
      .getByRole('button', { name: 'Archivovat položku' })
      .click();
    expect(archiveSignal?.aborted).toBe(false);
    await archiveScreen.unmount();
    expect(archiveSignal?.aborted).toBe(true);
    resolveArchive?.({
      ok: false,
      failure: { kind: 'aborted', message: 'Požadavek byl zrušen.' },
    });

    const publishBase = createAdminContentPreviewPort({ eventId });
    let publishSignal: AbortSignal | undefined;
    let resolvePublish:
      | ((result: AdminContentResult<AdminPublicationResult>) => void)
      | undefined;
    const pendingPublish = new Promise<
      AdminContentResult<AdminPublicationResult>
    >((resolve) => {
      resolvePublish = resolve;
    });
    const publishScreen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={{
          ...publishBase,
          publish: (_candidateEventId, _preview, signal) => {
            publishSignal = signal;
            return pendingPublish;
          },
        }}
        timezone="Europe/Prague"
      />,
    );
    await expect
      .element(publishScreen.getByText('Otevření konference'))
      .toBeVisible();
    await publishScreen
      .getByRole('button', { name: 'Sestavit nový náhled' })
      .click();
    await publishScreen
      .getByRole('button', { name: 'Zkontrolovat a publikovat' })
      .click();
    await publishScreen.getByRole('checkbox').click();
    await publishScreen
      .getByRole('button', { name: 'Publikovat verzi 1' })
      .click();
    expect(publishSignal?.aborted).toBe(false);
    await publishScreen.unmount();
    expect(publishSignal?.aborted).toBe(true);
    resolvePublish?.({
      ok: false,
      failure: { kind: 'aborted', message: 'Požadavek byl zrušen.' },
    });
  });

  it('keeps an archived event and its items read-only', async () => {
    const screen = await renderComponent(
      <AdminContentWorkspace
        eventId={eventId}
        port={createAdminContentPreviewPort({ eventId })}
        readOnly
        timezone="Europe/Prague"
      />,
    );

    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await expect
      .element(screen.getByText('Archiv · pouze čtení'))
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Vytvořit položku' }).elements(),
    ).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: 'Sestavit nový náhled' }).elements(),
    ).toHaveLength(0);
    expect(
      screen.getByRole('button', { name: /^Upravit:/ }).elements(),
    ).toHaveLength(0);
    await expectComponentToPassAxe(contentRoot());
  });

  it('does not mount the content port without program:manage', async () => {
    const list = vi.fn(async () => {
      throw new Error('Forbidden content port was mounted.');
    });
    const blockedPort: AdminContentPort = {
      ...createAdminContentPreviewPort({ eventId }),
      list,
    };
    const api: ApiPort = {
      request: vi.fn(async (endpoint) => {
        if (endpoint !== adminContextEndpoint) {
          throw new Error('Unexpected admin endpoint.');
        }
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
    await expectComponentToPassAxe(
      document.querySelector<HTMLElement>('[data-admin-environment]')!,
    );
  });
});
