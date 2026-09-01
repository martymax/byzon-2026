import {
  adminAnnouncementPreviewResponseSchema,
  adminAnnouncementSendResponseSchema,
} from '@byzon/domain/contracts';
import {
  adminOperationsOverviewResponseSchema,
  adminSessionCapacityMutationResponseSchema,
} from '@byzon/domain/contracts/admin';
import {
  adminAnnouncementPreviewFixtures,
  adminAnnouncementSendFixtures,
  adminAuditFixtures,
  adminContextFixtures,
  adminEngagementMutationFixtures,
  adminEngagementOverviewFixtures,
  adminEventSettingsFixtures,
  adminEventSettingsUpdateFixtures,
  adminFixtureIds,
  adminMutationProblemFixtures,
  adminOperationsOverviewFixtures,
  adminReservationFixtures,
  adminSessionCapacityFixtures,
  adminSessionCapacityMutationFixtures,
  supportSearchFixtures,
  ticketImportPreviewFixtures,
} from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAnnouncementWorkspace } from '../../components/admin-announcement-workspace';
import { AdminImportWorkspace } from '../../components/admin-import-workspace';
import { AdminEngagementWorkspace } from '../../components/admin-engagement-workspace';
import { AdminOperationsWorkspace } from '../../components/admin-operations-workspace';
import { AdminReservationWorkspace } from '../../components/admin-reservation-workspace';
import { AdminSupportWorkspace } from '../../components/admin-support-workspace';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import {
  adminAnnouncementPreviewEndpoint,
  adminAnnouncementSendEndpoint,
  adminAuditEndpoint,
  adminContextEndpoint,
  adminEngagementMutationEndpoint,
  adminEngagementOverviewEndpoint,
  adminEventSettingsEndpoint,
  adminEventSettingsUpdateEndpoint,
  adminExportEndpoint,
  adminOperationsOverviewEndpoint,
  adminReservationsEndpoint,
  adminSessionCapacitiesEndpoint,
  adminSessionCapacityMutationEndpoint,
  adminSupportMutationEndpoint,
  adminSupportSearchEndpoint,
  adminTicketImportPreviewEndpoint,
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
  kind:
    | 'offline'
    | 'timeout'
    | 'transport'
    | 'invalid_response'
    | 'session_expired',
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
    '[data-admin-environment]',
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
  it('offers the production login route and preserves the exact admin return', async () => {
    window.history.replaceState({}, '', '/admin/interakce');
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) {
        return failure('session_expired', 401);
      }
      throw new Error('An unauthenticated shell requested a private resource.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminEngagementWorkspace />
      </AdminWorkspaceShell>,
    );

    const login = screen.getByRole('link', { name: 'Přihlásit se' });
    await expect.element(login).toBeVisible();
    expect(login.element().getAttribute('href')).toBe(
      '/prihlaseni?returnTo=%2Fadmin%2Finterakce',
    );
  });

  it('rejects a non-organizer context before a private resource is mounted', async () => {
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
          name: 'Administraci nelze bezpečně zobrazit',
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

  it('fails closed per route before a forbidden organizer resource is mounted', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const limitedOrganizer = {
      ...adminContextFixtures.organizer!,
      actor: {
        ...adminContextFixtures.organizer!.actor,
        permissions: ['operations:read'] as const,
      },
    };
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) return success(limitedOrganizer);
      throw new Error('A forbidden child attempted an API request.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
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
    expect(api.request).toHaveBeenCalled();
  });

  it('renders the permission-aware grouped navigation without technical shell identifiers', async () => {
    const screen = await renderComponent(
      <AdminWorkspaceShell
        api={organizerApi(() => null)}
        environment="production"
      >
        <h1>Přehled akce</h1>
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByRole('heading', { name: 'Přehled akce' }))
      .toBeVisible();
    expect(
      document.querySelector('aside a[href="/admin/obsah"]')?.textContent,
    ).toContain('Program a obsah');
    expect(
      document.querySelector('aside a[href="/admin/vstupenky"]')?.textContent,
    ).toContain('Aktualizace vstupenek');
    expect(
      document.querySelector('aside a[href="/check-in"]')?.textContent,
    ).toContain('Odbavení');
    expect(document.body.textContent).not.toContain(adminFixtureIds.event);
    expect(document.body.textContent).not.toContain('Europe/Prague');
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(document.querySelectorAll('a[href="#admin-main"]')).toHaveLength(1);
  });

  it('keeps a permitted feature-off destination visible and blocks its private workspace', async () => {
    window.history.replaceState({}, '', '/admin/oznameni');
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) {
        return success(adminContextFixtures.organizer_features_off!);
      }
      throw new Error('A feature-off workspace attempted a private request.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <p>Soukromý editor oznámení</p>
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Oznámení nejsou pro tuto akci dostupná',
        }),
      )
      .toBeVisible();
    expect(
      document.querySelector('aside a[href="/admin/oznameni"]')?.textContent,
    ).toContain('OznámeníVypnuto');
    expect(document.body.textContent).not.toContain('Soukromý editor oznámení');
  });

  it('hides missing permissions and the explicit check-in capability independently', async () => {
    const limitedContext = {
      ...adminContextFixtures.organizer!,
      capabilities: { canEnterCheckin: false },
      actor: {
        ...adminContextFixtures.organizer!.actor,
        permissions: ['operations:read'] as const,
      },
    };
    const api = createApi((endpoint) => {
      if (endpoint === adminContextEndpoint) return success(limitedContext);
      throw new Error('Unexpected private request.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <h1>Přehled akce</h1>
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByRole('heading', { name: 'Přehled akce' }))
      .toBeVisible();
    expect(document.querySelector('aside a[href="/admin"]')).not.toBeNull();
    expect(
      document.querySelector('aside a[href="/admin/reporty"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('aside a[href="/admin/ucastnici"]'),
    ).toBeNull();
    expect(document.querySelector('aside a[href="/check-in"]')).toBeNull();
  });

  it('exposes a native modal drawer contract on compact viewports', async () => {
    const screen = await renderComponent(
      <AdminWorkspaceShell
        api={organizerApi(() => null)}
        environment="production"
      >
        <h1>Přehled akce</h1>
      </AdminWorkspaceShell>,
    );
    await expect
      .element(screen.getByRole('heading', { name: 'Přehled akce' }))
      .toBeVisible();
    const triggerElement = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Otevřít navigaci administrace"]',
    );
    const dialog = document.querySelector<HTMLDialogElement>('dialog');
    expect(triggerElement?.getAttribute('aria-haspopup')).toBe('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-labelledby')).toBe(
      dialog?.querySelector('h2')?.id,
    );
  });

  it('offers human account actions and keeps the role inside the account menu', async () => {
    const screen = await renderComponent(
      <AdminWorkspaceShell
        api={organizerApi(() => null)}
        environment="production"
      >
        <h1>Přehled akce</h1>
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: /Demo administrátor/ }).click();
    await expect
      .element(screen.getByText('Administrátor', { exact: true }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole('menuitem', {
          name: 'Přejít do aplikace účastníka',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('menuitem', { name: 'Nastavení akce' }))
      .toBeVisible();
  });

  it('loads a sanitized SimpleShop preview and never offers apply', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    const preview = {
      ...ticketImportPreviewFixtures.simpleshop_readonly!,
      eventId: adminFixtureIds.event,
    };
    const api = organizerApi((endpoint) => {
      if (endpoint === adminTicketImportPreviewEndpoint) {
        return success(preview);
      }
      throw new Error('Unexpected admin endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen.getByRole('button', { name: 'Načíst ze SimpleShopu' }).click();
    await expect
      .element(screen.getByRole('heading', { name: '2. Staging diff preview' }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          'Toto je výhradně read-only SimpleShop preview. Apply není součástí P4-02 a server jej nenabízí.',
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('textbox', { name: 'Auditní důvod' }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: /apply/i }))
      .not.toBeInTheDocument();
    expect(document.body.textContent).toContain('Alice Participant');
    expect(document.body.textContent).toContain('alice@example.test');
    expect(document.body.textContent).toContain('Vstupenka 7100001');
    expect(document.body.textContent).toContain('18. 8. 2026');
    expect(document.body.textContent).toContain('Kupón EARLYBIRD');
    expect(document.body.textContent).toContain('Bez slevového kupónu');
    expect(document.body.textContent).toContain(
      'Účastník z „prodeje na jméno“',
    );
    expect(document.body.textContent).not.toContain('kontakt •••');
    await expectComponentToPassAxe(adminRoot());
  });

  it('configures per-session questions and assigns a moderator from canonical selects', async () => {
    window.history.replaceState({}, '', '/admin/interakce');
    let overview = structuredClone(adminEngagementOverviewFixtures.default!);
    const mutationBodies: Record<string, unknown>[] = [];
    const api = organizerApi((endpoint, rawOptions) => {
      const options = rawOptions as { readonly body?: Record<string, unknown> };
      if (endpoint === adminEngagementOverviewEndpoint) {
        return success(overview);
      }
      if (endpoint === adminEngagementMutationEndpoint) {
        const body = options.body ?? {};
        mutationBodies.push(structuredClone(body));
        if (body.action === 'set_session_questions') {
          overview = {
            ...overview,
            sessions: overview.sessions.map((session) =>
              session.sessionId === adminFixtureIds.secondSession
                ? { ...session, questionsEnabled: true, version: 5 }
                : session,
            ),
          };
          return success(adminEngagementMutationFixtures.session_updated!);
        }
        if (body.action === 'assign_moderator') {
          overview = {
            ...overview,
            assignmentsVersion: 4,
            sessions: overview.sessions.map((session) =>
              session.sessionId === adminFixtureIds.secondSession
                ? {
                    ...session,
                    moderators: [
                      {
                        assignmentId: adminFixtureIds.assignment,
                        userId: adminFixtureIds.operator,
                        displayName: 'Operátor #27',
                        maskedContact: 'o***@example.test',
                      },
                    ],
                  }
                : session,
            ),
          };
          return success(adminEngagementMutationFixtures.moderator_assigned!);
        }
      }
      throw new Error('Unexpected engagement endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminEngagementWorkspace />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('textbox', { name: 'Důvod pro další operaci' })
      .fill('Povolení dotazů pro vybranou přednášku.');
    await screen
      .getByRole('button', {
        name: 'Povolit otázky pro Panel: firmy v pohybu',
      })
      .click();
    await screen
      .getByRole('checkbox', { name: /Potvrzuji správnou přednášku/ })
      .click();
    await screen
      .getByRole('button', { name: 'Povolit otázky', exact: true })
      .click();
    await expect.element(screen.getByText(/zapsána do auditu/i)).toBeVisible();

    await screen
      .getByRole('combobox', { name: 'Přednáška' })
      .selectOptions(adminFixtureIds.secondSession);
    await screen
      .getByRole('combobox', { name: 'Účastník' })
      .selectOptions(adminFixtureIds.operator);
    await screen
      .getByRole('textbox', { name: 'Důvod pro další operaci' })
      .fill('Přiřazení moderátora ke konkrétní přednášce.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat přiřazení moderátora' })
      .click();
    await screen
      .getByRole('checkbox', { name: /Ověřil\/a jsem osobu i přednášku/ })
      .click();
    await screen.getByRole('button', { name: 'Přiřadit moderátora' }).click();

    expect(mutationBodies).toEqual([
      expect.objectContaining({
        action: 'set_session_questions',
        sessionId: adminFixtureIds.secondSession,
        enabled: true,
      }),
      expect.objectContaining({
        action: 'assign_moderator',
        sessionId: adminFixtureIds.secondSession,
        userId: adminFixtureIds.operator,
      }),
    ]);
    expect(document.body.textContent).not.toContain('operator@example.test');
    await expectComponentToPassAxe(adminRoot());
  });

  it('prevents duplicate preview submission and aborts the request on unmount', async () => {
    window.history.replaceState({}, '', '/admin/vstupenky');
    let previewSignal: AbortSignal | undefined;
    const previewRequest = vi.fn((_endpoint: unknown, options: unknown) => {
      previewSignal = (options as { signal?: AbortSignal }).signal;
      return new Promise<unknown>(() => undefined);
    });
    const api = organizerApi((endpoint, options) => {
      if (endpoint === adminTicketImportPreviewEndpoint) {
        return previewRequest(endpoint, options);
      }
      throw new Error('No other request is expected during preview.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <AdminImportWorkspace />
      </AdminWorkspaceShell>,
    );
    const button = screen.getByRole('button', {
      name: 'Načíst ze SimpleShopu',
    });

    await button.click();
    await expect
      .element(screen.getByRole('button', { name: 'SimpleShop se načítá…' }))
      .toBeDisabled();
    expect(previewRequest).toHaveBeenCalledTimes(1);
    expect(previewSignal?.aborted).toBe(false);

    await screen.unmount();
    expect(previewSignal?.aborted).toBe(true);
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
      if (endpoint === adminSessionCapacitiesEndpoint) {
        return success(adminSessionCapacityFixtures.list!);
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
      if (endpoint === adminSessionCapacitiesEndpoint) {
        return success(adminSessionCapacityFixtures.list!);
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

  it('keeps reservation management available when only the capacity read fails', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    const api = organizerApi((endpoint) => {
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      if (endpoint === adminSessionCapacitiesEndpoint) {
        return failure('transport');
      }
      throw new Error('The degraded reservation page requested a mutation.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationWorkspace mode="reservations" />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Bezpečný snapshot se nepodařilo načíst',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText('Růst bez zkratek', { exact: true }).last())
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Upravit kapacitu' }),
    ).not.toBeInTheDocument();

    await screen
      .getByRole('button', { name: 'Připravit změnu' })
      .first()
      .click();
    await expect
      .element(screen.getByRole('heading', { name: /Změna nad snapshotem/ }))
      .toBeVisible();
  });

  it('edits a session capacity independently of a reservation record', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    let capacities = structuredClone(adminSessionCapacityFixtures.list!);
    let mutationBody: Record<string, unknown> | null = null;
    const api = organizerApi((endpoint, rawOptions) => {
      const options = rawOptions as { readonly body?: Record<string, unknown> };
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      if (endpoint === adminSessionCapacitiesEndpoint) {
        return success(capacities);
      }
      if (endpoint === adminSessionCapacityMutationEndpoint) {
        mutationBody = options.body ?? null;
        const response = adminSessionCapacityMutationResponseSchema.parse({
          ...adminSessionCapacityMutationFixtures.updated!,
          record: {
            ...adminSessionCapacityMutationFixtures.updated!.record,
            capacity: options.body?.capacity,
          },
        });
        capacities = {
          ...capacities,
          items: capacities.items.map((record) =>
            record.sessionId === response.record.sessionId
              ? response.record
              : record,
          ),
        };
        return success(response);
      }
      throw new Error('The capacity editor requested an unexpected endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationWorkspace mode="reservations" />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('button', { name: 'Upravit kapacitu' })
      .first()
      .click();
    await screen.getByRole('spinbutton', { name: 'Nová kapacita' }).fill('42');
    await screen
      .getByRole('textbox', { name: 'Auditní důvod' })
      .fill('Potvrzená provozní změna kapacity workshopu.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat změnu kapacity' })
      .click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Uložit kapacitu' }).click();

    await expect
      .element(screen.getByText(/Kapacita aktivity byla změněna/))
      .toBeVisible();
    expect(mutationBody).toMatchObject({
      sessionId: adminFixtureIds.session,
      expectedVersion: 4,
      capacity: 42,
      reason: 'Potvrzená provozní změna kapacity workshopu.',
    });
    expect(mutationBody).not.toHaveProperty('reservationId');
  });

  it('configures networking capacity from an explicit unconfigured state', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    let mutationBody: Record<string, unknown> | null = null;
    const api = organizerApi((endpoint, rawOptions) => {
      const options = rawOptions as { readonly body?: Record<string, unknown> };
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      if (endpoint === adminSessionCapacitiesEndpoint) {
        return success(adminSessionCapacityFixtures.list!);
      }
      if (endpoint === adminSessionCapacityMutationEndpoint) {
        mutationBody = options.body ?? null;
        return success({
          ...adminSessionCapacityMutationFixtures.networking_configured!,
          record: {
            ...adminSessionCapacityMutationFixtures.networking_configured!
              .record,
            capacity: options.body?.capacity,
          },
        });
      }
      throw new Error(
        'The networking editor requested an unexpected endpoint.',
      );
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationWorkspace mode="reservations" />
      </AdminWorkspaceShell>,
    );

    await expect
      .element(screen.getByText('Kapacita není nastavená'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Nastavit kapacitu' }).click();
    await screen.getByRole('spinbutton', { name: 'Nová kapacita' }).fill('14');
    await screen
      .getByRole('textbox', { name: 'Auditní důvod' })
      .fill('Potvrzená provozní kapacita řízeného networkingu.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat změnu kapacity' })
      .click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Uložit kapacitu' }).click();

    expect(mutationBody).toMatchObject({
      sessionId: adminFixtureIds.networkingSession,
      expectedVersion: 1,
      capacity: 14,
      reason: 'Potvrzená provozní kapacita řízeného networkingu.',
    });
  });

  it('refreshes and clamps the capacity editor after the confirmed count changes', async () => {
    window.history.replaceState({}, '', '/admin/rezervace');
    let capacities = structuredClone(adminSessionCapacityFixtures.list!);
    let capacityListCalls = 0;
    const api = organizerApi((endpoint) => {
      if (endpoint === adminReservationsEndpoint) {
        return success(adminReservationFixtures.list!);
      }
      if (endpoint === adminSessionCapacitiesEndpoint) {
        capacityListCalls += 1;
        return success(capacities);
      }
      if (endpoint === adminSessionCapacityMutationEndpoint) {
        capacities = {
          ...capacities,
          items: capacities.items.map((record) =>
            record.sessionId === adminFixtureIds.session
              ? { ...record, confirmedCount: 39 }
              : record,
          ),
        };
        return {
          ok: false,
          kind: 'failure',
          status: 409,
          failure: {
            kind: 'problem',
            problem: adminMutationProblemFixtures.invalid_transition!,
          },
          metadata,
        } as const;
      }
      throw new Error('The capacity editor requested an unexpected endpoint.');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="production">
        <AdminReservationWorkspace mode="reservations" />
      </AdminWorkspaceShell>,
    );

    await screen
      .getByRole('button', { name: 'Upravit kapacitu' })
      .first()
      .click();
    const initialListCalls = capacityListCalls;
    const capacity = screen.getByRole('spinbutton', { name: 'Nová kapacita' });
    await capacity.fill('38');
    await screen
      .getByRole('textbox', { name: 'Auditní důvod' })
      .fill('Ověření souběžně obsazeného místa workshopu.');
    await screen
      .getByRole('button', { name: 'Zkontrolovat změnu kapacity' })
      .click();
    await acknowledgeDialog(screen);
    await screen.getByRole('button', { name: 'Uložit kapacitu' }).click();

    await expect.element(screen.getByText('39 / 40')).toBeVisible();
    await expect.element(capacity).toHaveValue(39);
    expect(capacityListCalls).toBe(initialListCalls + 1);
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
      if (endpoint === adminSessionCapacitiesEndpoint) {
        return success(adminSessionCapacityFixtures.list!);
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
