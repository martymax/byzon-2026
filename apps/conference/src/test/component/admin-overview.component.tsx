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
}: {
  readonly context?: AdminContextResponse;
  readonly operations?: AdminOperationsOverviewResponse;
  readonly operationsFailure?: boolean;
} = {}) => {
  const api: ApiPort = {
    request: vi.fn(async (endpoint) => {
      if (endpoint === adminContextEndpoint) return success(context);
      if (endpoint === adminOperationsOverviewEndpoint) {
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
  it('renders six contract metrics, derived attention and safe actions', async () => {
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
      'Aktivace účastníků',
      'Aktualizace vstupenek',
      'Program a obsah',
      'Odbavení',
      'Rezervace',
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
    await expect.element(screen.getByText('Aktuální k 12:05')).toBeVisible();
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

    await expect
      .element(screen.getByText('Odbavení vyžaduje samostatné oprávnění.'))
      .toBeVisible();
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
