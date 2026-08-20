import {
  adminAnnouncementPreviewResponseSchema,
  adminAnnouncementSendResponseSchema,
} from '@byzon/domain/contracts';
import { adminOperationsOverviewResponseSchema } from '@byzon/domain/contracts/admin';
import {
  ticketImportApplyResponseSchema,
  ticketImportPreviewResponseSchema,
} from '@byzon/domain/contracts/ticket-import';
import {
  adminAnnouncementPreviewFixtures,
  adminAnnouncementSendFixtures,
  adminAuditFixtures,
  adminContextFixtures,
  adminEventSettingsFixtures,
  adminEventSettingsUpdateFixtures,
  adminFixtureIds,
  adminOperationsOverviewFixtures,
  adminReservationFixtures,
  supportSearchFixtures,
  ticketImportApplyFixtures,
  ticketImportPreviewFixtures,
} from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAnnouncementWorkspace } from '../../components/admin-announcement-workspace';
import { AdminImportWorkspace } from '../../components/admin-import-workspace';
import { AdminOperationsWorkspace } from '../../components/admin-operations-workspace';
import { AdminReservationWorkspace } from '../../components/admin-reservation-workspace';
import { AdminSupportWorkspace } from '../../components/admin-support-workspace';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import {
  adminAnnouncementPreviewEndpoint,
  adminAnnouncementSendEndpoint,
  adminAuditEndpoint,
  adminContextEndpoint,
  adminEventSettingsEndpoint,
  adminEventSettingsUpdateEndpoint,
  adminExportEndpoint,
  adminOperationsOverviewEndpoint,
  adminReservationsEndpoint,
  adminSupportMutationEndpoint,
  adminSupportSearchEndpoint,
  adminTicketImportApplyEndpoint,
  type AdminTicketImportUploadPort,
} from '../../lib/admin-api';
import type { ApiPort } from '../../lib/api/endpoint';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent, userEvent } from './render';

const metadata = { requestId: 'component-admin-0001' } as const;

const success = <Value,>(data: Value) =>
  ({
    ok: true,
    kind: 'success',
    status: 200,
    data,
    metadata,
  }) as const;

const failure = (
  kind: 'offline' | 'timeout' | 'transport' | 'invalid_response',
  status = 0,
) =>
  ({
    ok: false,
    kind: 'failure',
    status,
    failure: { kind },
  }) as const;

type RequestHandler = (
  endpoint: unknown,
  options: unknown,
) => Promise<unknown> | unknown;

const createApi = (handler: RequestHandler): ApiPort => ({
  request: vi.fn(async (endpoint: unknown, options: unknown) =>
    handler(endpoint, options),
  ) as unknown as ApiPort['request'],
});

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
  await screen.getByRole('checkbox').click();
};

const organizerApi = (handler: RequestHandler): ApiPort =>
  createApi((endpoint, options) =>
    endpoint === adminContextEndpoint
      ? success(adminContextFixtures.organizer!)
      : handler(endpoint, options),
  );

beforeEach(() => {
  window.history.replaceState({}, '', '/admin');
});

describe('F4 contract-first admin journeys', () => {
  it('loads canonical context and fails closed before a forbidden resource is mounted', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) {
        return success(adminContextFixtures.room_operator!);
      }
      throw new Error('A forbidden child attempted an API request.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'K této části nemáte oprávnění',
        }),
      )
      .toBeVisible();
    await userEvent.keyboard('{Tab}');
    await expect
      .element(screen.getByRole('link', { name: 'Přeskočit na hlavní obsah' }))
      .toHaveFocus();
    expect(api.request).toHaveBeenCalled();
    await expectComponentToPassAxe(adminRoot());
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });

  it('uploads multipart metadata and retries an ambiguous import with the exact body and key', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const applyCalls: unknown[] = [];
    const applySignals: AbortSignal[] = [];
    let applyCount = 0;
    const file = new File(['reference,state\nT001,active'], 'tickets.csv', {
      type: 'text/csv',
    });
    const preview = ticketImportPreviewResponseSchema.parse({
      ...ticketImportPreviewFixtures.clean!,
      eventId: adminFixtureIds.event,
      source: {
        fileName: file.name,
        mediaType: file.type,
        byteSize: file.size,
      },
    });
    const applied = ticketImportApplyResponseSchema.parse({
      ...ticketImportApplyFixtures.applied!,
      eventId: adminFixtureIds.event,
      previewId: preview.previewId,
      previewVersion: preview.previewVersion,
    });
    const api = organizerApi((endpoint, options) => {
      if (endpoint === adminTicketImportApplyEndpoint) {
        const { signal, ...serializableOptions } = options as Record<
          string,
          unknown
        > & { readonly signal: AbortSignal };
        applyCalls.push(structuredClone(serializableOptions));
        applySignals.push(signal);
        applyCount += 1;
        return applyCount === 1 ? failure('timeout') : success(applied);
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const uploadPort: AdminTicketImportUploadPort = {
      preview: async () => success(preview),
    };
    const screen = await renderComponent(
      <AdminWorkspaceShell
        api={api}
        environment="mocked"
        uploadPort={uploadPort}
      >
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen.getByLabelText('Zdrojový soubor').upload(file);
    await screen
      .getByRole('button', { name: 'Vytvořit validované preview' })
      .click();
    await expect
      .element(screen.getByRole('heading', { name: '2. Staging diff preview' }))
      .toBeVisible();
    await screen
      .getByRole('textbox', { name: 'Auditní důvod' })
      .fill('Bezpečné ověření syntetického importu.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat a potvrdit apply' })
      .click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Aplikovat import' }).click();
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Zopakovat přesně stejný pokus',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('textbox', { name: 'Auditní důvod' }))
      .toBeDisabled();
    await screen
      .getByRole('button', { name: 'Zopakovat přesně stejný pokus' })
      .click();
    await expect
      .element(screen.getByRole('heading', { name: 'Import byl aplikován' }))
      .toBeVisible();
    expect(applyCalls).toHaveLength(2);
    expect(applyCalls[1]).toEqual(applyCalls[0]);
    expect(applySignals).toHaveLength(2);
    expect(applySignals.every((signal) => signal instanceof AbortSignal)).toBe(
      true,
    );
    await expectComponentToPassAxe(adminRoot());
  });

  it('aborts and fences an older upload when the selected file changes', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const firstFile = new File(
      ['reference,state\nT001,active'],
      'first-conflict.csv',
      { type: 'text/csv' },
    );
    const secondFile = new File(
      ['reference,state\nT002,active'],
      'second-clean.csv',
      { type: 'text/csv' },
    );
    const firstPreview = ticketImportPreviewResponseSchema.parse({
      ...ticketImportPreviewFixtures.conflict!,
      eventId: adminFixtureIds.event,
      source: {
        fileName: firstFile.name,
        mediaType: firstFile.type,
        byteSize: firstFile.size,
      },
    });
    const secondPreview = ticketImportPreviewResponseSchema.parse({
      ...ticketImportPreviewFixtures.clean!,
      eventId: adminFixtureIds.event,
      source: {
        fileName: secondFile.name,
        mediaType: secondFile.type,
        byteSize: secondFile.size,
      },
    });
    let resolveFirst: (result: unknown) => void = () => undefined;
    const firstRequest = new Promise<unknown>((resolve) => {
      resolveFirst = resolve;
    });
    let firstSignal: AbortSignal | undefined;
    const previewRequest = vi.fn(
      (_eventId: string, selected: File, signal?: AbortSignal) => {
        if (selected.name === firstFile.name) {
          firstSignal = signal;
          return firstRequest;
        }
        return Promise.resolve(success(secondPreview));
      },
    );
    const uploadPort: AdminTicketImportUploadPort = {
      preview:
        previewRequest as unknown as AdminTicketImportUploadPort['preview'],
    };
    const api = organizerApi(() => {
      throw new Error('No mutation is expected during the upload race.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell
        api={api}
        environment="mocked"
        uploadPort={uploadPort}
      >
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );
    const input = screen.getByLabelText('Zdrojový soubor');

    await input.upload(firstFile);
    await screen
      .getByRole('button', { name: 'Vytvořit validované preview' })
      .click();
    await input.upload(secondFile);
    expect(firstSignal?.aborted).toBe(true);
    await screen
      .getByRole('button', { name: 'Vytvořit validované preview' })
      .click();
    await expect
      .element(screen.getByText(new RegExp(secondPreview.previewId)))
      .toBeVisible();

    resolveFirst(success(firstPreview));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toContain(secondPreview.previewId);
    expect(document.body.textContent).not.toContain(firstPreview.previewId);
  });

  it('wipes support P3 state and closes the workspace when an online-only read reports offline', async () => {
    window.history.replaceState({}, '', '/admin/ucastnici');
    const api = organizerApi((endpoint) => {
      if (endpoint === adminSupportSearchEndpoint) return failure('offline');
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminSupportWorkspace />
      </AdminWorkspaceShell>,
    );

    const search = screen.getByRole('searchbox', {
      name: 'Reference nebo jméno',
    });
    await search.fill('single');
    await screen.getByRole('button', { name: 'Vyhledat' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Administraci nelze bezpečně zobrazit',
        }),
      )
      .toBeVisible();
    await expect.element(search).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('single');
  });

  it('wipes support P3 and never offers retry for a malformed top-level 403 mutation', async () => {
    window.history.replaceState({}, '', '/admin/ucastnici');
    const searchResponse = {
      ...supportSearchFixtures.single_match!,
      eventId: adminFixtureIds.event,
      matches: supportSearchFixtures.single_match!.matches.map((record) => ({
        ...record,
        eventId: adminFixtureIds.event,
      })),
    };
    const api = organizerApi((endpoint) => {
      if (endpoint === adminSupportSearchEndpoint) {
        return success(searchResponse);
      }
      if (endpoint === adminSupportMutationEndpoint) {
        return failure('invalid_response', 403);
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminSupportWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('searchbox', { name: 'Reference nebo jméno' })
      .fill('single');
    await screen.getByRole('button', { name: 'Vyhledat' }).click();
    await screen.getByRole('button', { name: 'Připravit podporu' }).click();
    await screen
      .getByRole('textbox', { name: 'Auditní důvod' })
      .fill('Bezpečný test odebraného oprávnění.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat a potvrdit' })
      .click();
    await acknowledgeDialog(screen);
    await screen
      .getByRole('button', { name: 'Znovu odeslat aktivační výzvu' })
      .click();

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Administraci nelze bezpečně zobrazit',
        }),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain(
      searchResponse.matches[0]!.displayName,
    );
    expect(
      screen.getByRole('button', {
        name: 'Zopakovat přesně stejný pokus',
      }),
    ).not.toBeInTheDocument();
  });

  it('shows support records to a read-only actor without mounting mutation controls', async () => {
    window.history.replaceState({}, '', '/admin/ucastnici');
    const readOnlyContext = {
      ...adminContextFixtures.organizer!,
      actor: {
        ...adminContextFixtures.organizer!.actor,
        permissions: ['participant:operational:read'] as const,
      },
    };
    const searchResponse = {
      ...supportSearchFixtures.single_match!,
      eventId: adminFixtureIds.event,
      matches: supportSearchFixtures.single_match!.matches.map((record) => ({
        ...record,
        eventId: adminFixtureIds.event,
      })),
    };
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) return success(readOnlyContext);
      if (endpoint === adminSupportSearchEndpoint) {
        return success(searchResponse);
      }
      throw new Error('A read-only support actor attempted a mutation.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminSupportWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('searchbox', { name: 'Reference nebo jméno' })
      .fill('single');
    await screen.getByRole('button', { name: 'Vyhledat' }).click();
    await expect
      .element(screen.getByText(searchResponse.matches[0]!.displayName))
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Připravit podporu' }),
    ).not.toBeInTheDocument();
  });

  it('shows reservation records to a reader without capacity or attendance mutation controls', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const readOnlyContext = {
      ...adminContextFixtures.organizer!,
      actor: {
        ...adminContextFixtures.organizer!.actor,
        permissions: ['reservation:any:read'] as const,
      },
    };
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) return success(readOnlyContext);
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      throw new Error('A reservation reader attempted an unauthorized call.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminReservationWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByText('Růst bez zkratek', { exact: true }).last())
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Připravit změnu' }),
    ).not.toBeInTheDocument();
  });

  it('uses only integrated reservation endpoints in the production workspace', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const api = organizerApi((endpoint) => {
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      throw new Error('The live reservation page requested a mocked endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationWorkspace mode="reservations" />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          level: 1,
          name: 'Rezervace a kapacitní výjimky',
        }),
      )
      .toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Auditní stopa' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Nastavení akce' }),
    ).not.toBeInTheDocument();
  });

  it('invalidates edited announcement preview and sends only a reconfirmed canonical version', async () => {
    window.history.replaceState({}, '', '/admin/oznameni');
    let previewVersion = 1;
    const api = organizerApi((endpoint, rawOptions) => {
      const options = rawOptions as { readonly body: unknown };
      if (endpoint === adminAnnouncementPreviewEndpoint) {
        previewVersion += 1;
        const body = options.body as {
          readonly draft: Record<string, unknown>;
        };
        return success(
          adminAnnouncementPreviewResponseSchema.parse({
            ...adminAnnouncementPreviewFixtures.session_audience!,
            eventId: adminFixtureIds.event,
            previewVersion,
            draft: body.draft,
          }),
        );
      }
      if (endpoint === adminAnnouncementSendEndpoint) {
        const body = options.body as {
          readonly previewId: string;
          readonly previewVersion: number;
        };
        return success(
          adminAnnouncementSendResponseSchema.parse({
            ...adminAnnouncementSendFixtures.sent!,
            eventId: adminFixtureIds.event,
            previewId: body.previewId,
            previewVersion: body.previewVersion,
          }),
        );
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminAnnouncementWorkspace />
      </AdminWorkspaceShell>,
    );

    const title = screen.getByRole('textbox', { name: 'Název' });
    await title.fill('Změna sálu workshopu');
    await screen
      .getByRole('textbox', { name: 'Text oznámení' })
      .fill('Workshop se přesouvá do sálu Vltava.');
    await screen.getByRole('button', { name: 'Vytvořit preview' }).click();
    await expect
      .element(screen.getByRole('heading', { name: '2. Immutable preview' }))
      .toBeVisible();
    await title.fill('Změna sálu workshopu – aktualizace');
    await expect
      .element(screen.getByRole('heading', { name: '2. Immutable preview' }))
      .not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'Vytvořit preview' }).click();
    await screen
      .getByRole('textbox', { name: 'Auditní důvod odeslání' })
      .fill('Informování přímo dotčené skupiny.');
    await screen.getByRole('button', { name: 'Zkontrolovat odeslání' }).click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Odeslat oznámení' }).click();
    await expect
      .element(screen.getByRole('heading', { name: 'Oznámení bylo odesláno' }))
      .toBeVisible();
    await expectComponentToPassAxe(adminRoot());
  });

  it('freezes every visible settings field while an ambiguous exact retry is pending', async () => {
    window.history.replaceState({}, '', '/admin/nastaveni');
    const updateCalls: unknown[] = [];
    let updateCount = 0;
    const api = organizerApi((endpoint, options) => {
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      if (endpoint === adminAuditEndpoint) {
        return success(adminAuditFixtures.page!);
      }
      if (endpoint === adminEventSettingsEndpoint) {
        return success(adminEventSettingsFixtures.open!);
      }
      if (endpoint === adminEventSettingsUpdateEndpoint) {
        const { signal, ...request } = options as Record<string, unknown>;
        expect(signal).toBeInstanceOf(AbortSignal);
        updateCalls.push(structuredClone(request));
        updateCount += 1;
        return updateCount === 1
          ? failure('timeout')
          : success(adminEventSettingsUpdateFixtures.updated!);
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminReservationWorkspace />
      </AdminWorkspaceShell>,
    );

    const mode = screen.getByRole('combobox', { name: 'Režim registrace' });
    await mode.selectOptions('invite_only');
    await screen
      .getByRole('textbox', { name: 'Auditní důvod změny' })
      .fill('Bezpečné ověření neměnného nastavení.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat změnu nastavení' })
      .click();
    await screen
      .getByRole('checkbox', {
        name: /Ověřil\/a jsem aktuální snapshot/,
      })
      .click();
    await screen.getByRole('button', { name: 'Uložit nastavení' }).click();
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Zopakovat přesně stejný pokus',
        }),
      )
      .toBeVisible();
    await expect.element(mode).toBeDisabled();
    await screen
      .getByRole('button', { name: 'Zopakovat přesně stejný pokus' })
      .click();
    await expect
      .element(screen.getByText(/Nastavení bylo změněno/))
      .toBeVisible();
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[1]).toEqual(updateCalls[0]);
  });

  it('renders the aggregate operations snapshot without exposing queue payloads', async () => {
    window.history.replaceState({}, '', '/admin/reporty');
    const overview = adminOperationsOverviewResponseSchema.parse({
      ...adminOperationsOverviewFixtures.degraded!,
      eventId: adminFixtureIds.event,
    });
    const api = organizerApi((endpoint) => {
      if (endpoint === adminOperationsOverviewEndpoint) {
        return success(overview);
      }
      if (endpoint === adminExportEndpoint) {
        throw new Error('Export must not run without confirmation.');
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminOperationsWorkspace />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', { name: 'Bezpečný queue a DLQ souhrn' }),
      )
      .toBeVisible();
    await expect.element(screen.getByText('1 v DLQ')).toBeVisible();
    expect(document.body.textContent).not.toContain('recipient@example.test');
    expect(document.body.textContent).not.toContain('raw-secret-token');
    await expectComponentToPassAxe(adminRoot());
  });
});
