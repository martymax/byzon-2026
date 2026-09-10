import {
  adminContextFixtures,
  adminOperationsOverviewFixtures,
} from '@byzon/test-support/fixtures';
import type {
  AdminContextResponse,
  AdminOperationsOverviewResponse,
} from '@byzon/domain/contracts/admin';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import { AdminOverviewWorkspace } from '../../components/admin-overview-workspace';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import {
  adminContextEndpoint,
  adminOperationsOverviewEndpoint,
  requestAdminOperationsOverview,
} from '../../lib/admin-api';
import type { ApiPort } from '../../lib/api/endpoint';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const metadata = { requestId: 'admin-overview-component-0001' } as const;

const success = <Value,>(data: Value) =>
  ({ ok: true, kind: 'success', status: 200, data, metadata }) as const;

const renderOverview = async ({
  context = adminContextFixtures.organizer!,
  operations = adminOperationsOverviewFixtures.healthy!,
  operationsFailure = false,
  loadOperations,
}: {
  readonly context?: AdminContextResponse;
  readonly operations?: AdminOperationsOverviewResponse;
  readonly operationsFailure?: boolean;
  readonly loadOperations?: () => ReturnType<
    typeof requestAdminOperationsOverview
  >;
} = {}) => {
  const api: ApiPort = {
    request: vi.fn(async (endpoint) => {
      if (endpoint === adminContextEndpoint) return success(context);
      if (endpoint === adminOperationsOverviewEndpoint) {
        if (loadOperations) return loadOperations();
        return operationsFailure
          ? ({
              ok: false,
              kind: 'failure',
              status: 0,
              failure: { kind: 'offline' },
            } as const)
          : success(operations);
      }
      throw new Error('Dashboard requested an unexpected endpoint.');
    }) as unknown as ApiPort['request'],
  };
  return renderComponent(
    <AdminWorkspaceShell api={api} environment="production">
      <AdminOverviewWorkspace />
    </AdminWorkspaceShell>,
  );
};

beforeEach(() => window.history.replaceState({}, '', '/admin'));

describe('admin overview dashboard', () => {
  it('renders participant progress, real capacities and severity-ordered actions', async () => {
    const operations = {
      ...adminOperationsOverviewFixtures.degraded!,
      metrics: adminOperationsOverviewFixtures.degraded!.metrics.map(
        (metric) => ({ ...metric, label: `SERVER ${metric.id}` }),
      ),
    };
    const screen = await renderOverview({
      operations,
    });

    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Přehled akce' }))
      .toBeVisible();
    for (const label of [
      'Importovaní účastníci',
      'Aktivované přístupy',
      'Aktualizace vstupenek',
      'Program a obsah',
      'Obsazenost aktivit',
      'Oznámení',
    ]) {
      expect(screen.getByText(label).elements().length).toBeGreaterThan(0);
    }
    await expect
      .element(screen.getByRole('link', { name: 'Zkontrolovat obsah' }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Přejít do odbavení' }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Zkontrolovat kapacitu' }))
      .toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Zkontrolovat neaktivované' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zkontrolovat změny vstupenek' }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('notifications');
    expect(document.body.textContent).not.toContain('DLQ');
    expect(document.body.textContent).not.toContain('SERVER ');
    await expect
      .element(screen.getByRole('heading', { name: 'Růst bez zkratek' }))
      .toBeVisible();
    await expect.element(screen.getByText('Plně obsazeno')).toBeVisible();
    await expect.element(screen.getByText('1 volné místo')).toBeVisible();
    await expect
      .element(screen.getByText('93 %', { exact: true }))
      .toBeVisible();
    expect(document.querySelector('ol h3')?.textContent).toBe(
      'Zkontrolujte doručení oznámení',
    );
    await expect
      .element(
        screen.getByText('Aktuální k 25. 7. 2026 12:05', { exact: false }),
      )
      .toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(
      document.querySelector<HTMLElement>('[data-admin-root]')!,
    );
  });

  it('shows calm healthy and explicit empty states', async () => {
    const healthy = await renderOverview();
    await expect
      .element(healthy.getByText('Teď není potřeba žádný zásah'))
      .toBeVisible();

    await healthy.unmount();
    const empty = await renderOverview({
      operations: adminOperationsOverviewFixtures.empty!,
    });
    await expect
      .element(empty.getByText('Přehled zatím nemá data'))
      .toBeVisible();
    await expect
      .element(empty.getByRole('link', { name: 'Načíst změny vstupenek' }))
      .toBeVisible();
  });

  it('keeps the previous response visible during refresh, then replaces it', async () => {
    let refreshing = false;
    let finish!: (
      value: Awaited<ReturnType<typeof requestAdminOperationsOverview>>,
    ) => void;
    const screen = await renderOverview({
      loadOperations: () =>
        refreshing
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Promise.resolve(success(adminOperationsOverviewFixtures.healthy!)),
    });
    await expect
      .element(screen.getByText('412', { exact: true }))
      .toBeVisible();
    refreshing = true;
    await screen.getByRole('button', { name: 'Obnovit přehled' }).click();
    await expect
      .element(screen.getByRole('button', { name: 'Obnovuji…' }))
      .toBeDisabled();
    await expect
      .element(screen.getByText('412', { exact: true }))
      .toBeVisible();
    finish(success(adminOperationsOverviewFixtures.degraded!));
    await expect
      .element(screen.getByText('410', { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Obnovit přehled' }))
      .toBeEnabled();
    expect(screen.getByText('412', { exact: true })).not.toBeInTheDocument();
    await screen.getByRole('button', { name: 'Obnovit přehled' }).click();
    finish({
      ok: false,
      kind: 'failure',
      status: 0,
      failure: { kind: 'timeout' },
    });
    await expect
      .element(screen.getByText('Zobrazuji poslední načtené údaje'))
      .toBeVisible();
    await expect
      .element(screen.getByText('410', { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Zkusit znovu' }))
      .toBeVisible();
  });

  it('does not claim complete health when detailed data are unavailable', async () => {
    const legacy = { ...adminOperationsOverviewFixtures.healthy! };
    delete legacy.summary;
    const screen = await renderOverview({ operations: legacy });
    await expect
      .element(screen.getByText('Některé údaje zatím chybí'))
      .toBeVisible();
    expect(
      screen.getByText('Teď není potřeba žádný zásah'),
    ).not.toBeInTheDocument();
  });

  it('does not ask for a content review when a publication is available in the app', async () => {
    const operations: AdminOperationsOverviewResponse = {
      ...adminOperationsOverviewFixtures.healthy!,
      metrics: adminOperationsOverviewFixtures.healthy!.metrics.map((metric) =>
        metric.id === 'content'
          ? {
              ...metric,
              value: 'Verze 2',
              state: 'healthy',
              detail: 'Publikovaná verze je dostupná v aplikaci.',
            }
          : metric,
      ),
    };
    const screen = await renderOverview({ operations });

    await expect.element(screen.getByText('Verze 2')).toBeVisible();
    await expect
      .element(screen.getByText('Publikovaná verze je dostupná v aplikaci.'))
      .toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Zkontrolovat obsah' }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      'Publikovaná verze čeká na dokončení synchronizace.',
    );
  });

  it('keeps permission and feature fallbacks non-actionable', async () => {
    const context: AdminContextResponse = {
      ...adminContextFixtures.organizer!,
      features: { announcementsEnabled: false },
      capabilities: { canEnterCheckin: false },
      actor: {
        ...adminContextFixtures.organizer!.actor,
        permissions: ['operations:read'],
      },
    };
    const screen = await renderOverview({
      context,
      operations: adminOperationsOverviewFixtures.degraded!,
    });

    expect(
      screen.getByText('Odbavení vyžaduje pozornost'),
    ).not.toBeInTheDocument();
    await expect
      .element(screen.getByText('Oznámení jsou pro tuto akci vypnutá.'))
      .toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Zkontrolovat obsah' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Přejít do odbavení' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zkontrolovat kapacitu' }),
    ).not.toBeInTheDocument();
  });

  it('removes mutation actions from an archived event', async () => {
    const context = {
      ...adminContextFixtures.organizer!,
      event: {
        ...adminContextFixtures.organizer!.event,
        phase: 'archived' as const,
      },
    };
    const screen = await renderOverview({
      context,
      operations: adminOperationsOverviewFixtures.degraded!,
    });

    await expect
      .element(screen.getByText('Archivováno · pouze čtení', { exact: true }))
      .toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Zkontrolovat obsah' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Přejít do odbavení' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Zkontrolovat kapacitu' }),
    ).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole('link', { name: 'Otevřít historii' }))
      .toBeVisible();

    await screen.unmount();
    const empty = await renderOverview({
      context,
      operations: adminOperationsOverviewFixtures.empty!,
    });
    expect(
      empty.getByRole('link', { name: 'Načíst změny vstupenek' }),
    ).not.toBeInTheDocument();
    expect(
      empty.getByRole('link', { name: 'Připravit program' }),
    ).not.toBeInTheDocument();
  });

  it('shows a recoverable offline state without retaining metrics', async () => {
    const screen = await renderOverview({ operationsFailure: true });

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Administraci nelze bezpečně zobrazit',
        }),
      )
      .toBeVisible();
    expect(screen.getByText('Aktivace účastníků')).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: 'Ověřit přístup znovu' }))
      .toBeVisible();
  });

  it.each([
    ['draft', 'Připravit program'],
    ['activation_open', 'Otevřít účastníky'],
    ['live', 'Otevřít kapacity'],
    ['ended', 'Otevřít reporty'],
    ['archived', 'Otevřít historii'],
  ] as const)('changes next tasks for the %s phase', async (phase, action) => {
    const context = {
      ...adminContextFixtures.organizer!,
      event: { ...adminContextFixtures.organizer!.event, phase },
    };
    const screen = await renderOverview({ context });

    await expect
      .element(screen.getByRole('link', { name: action }))
      .toBeVisible();
  });
});
