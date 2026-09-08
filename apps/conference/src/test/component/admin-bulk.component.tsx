import { describe, expect, it, vi } from 'vitest';
import {
  adminContextFixtures,
  adminFixtureIds,
  adminReservationSessionFixtures,
} from '@byzon/test-support/fixtures';
import type { AdminTeamMember } from '@byzon/domain/contracts/admin';
import { useState } from 'react';
import '../../app/styles.css';
import { AdminBulkPanel } from '../../components/admin-bulk-panel';
import { AdminTeamBulk } from '../../components/admin-team-bulk';
import { AdminReservationsBulk } from '../../components/admin-reservations-bulk';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import {
  adminContextEndpoint,
  adminRoleScopeOptionsEndpoint,
  adminTeamMemberMutationEndpoint,
} from '../../lib/admin-api';
import type { ApiPort } from '../../lib/api/endpoint';
import styles from '../../components/admin-workspace.module.css';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';

const items = [
  { id: 'a', label: 'První aktivita' },
  { id: 'b', label: 'Druhá aktivita' },
  { id: 'c', label: 'Archivovaná aktivita' },
];

describe('admin bulk action panel', () => {
  it('confirms the exact eligible selection and reports per-item failures', async () => {
    const execute = vi.fn(async (item: (typeof items)[number]) =>
      item.id === 'b'
        ? { ok: false, message: 'Obsazená kapacita.' }
        : { ok: true },
    );
    const onCompleted = vi.fn();
    const screen = await renderComponent(
      <main className={styles.workspace}>
        <AdminBulkPanel
          items={items}
          identify={(item) => item}
          actions={[
            {
              id: 'capacity',
              label: 'Změnit kapacity',
              description: 'Upraví kapacity vybraných aktivit.',
              reasonRequired: true,
              fields: [
                {
                  name: 'value',
                  label: 'Nová kapacita',
                  type: 'number',
                  min: 1,
                },
              ],
              eligible: (item) => item.id !== 'c',
              execute,
            },
          ]}
          onCompleted={onCompleted}
        />
      </main>,
    );
    await screen.getByText('Hromadné úpravy', { exact: true }).click();
    await screen
      .getByRole('checkbox', { name: 'Vybrat všechny zobrazené (3)' })
      .click();
    await screen
      .getByRole('combobox', { name: 'Hromadná akce' })
      .selectOptions('capacity');
    await screen.getByRole('spinbutton', { name: 'Nová kapacita' }).fill('40');
    await screen
      .getByRole('textbox', { name: 'Důvod změny (8–500 znaků)' })
      .fill('Změna organizace akce');
    await expect
      .element(screen.getByText(/Změna se provede u 2 položek/))
      .toBeVisible();
    await expectComponentToPassAxe(document.querySelector('main')!);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
    await screen
      .getByRole('button', { name: 'Zkontrolovat změnu (2)' })
      .click();
    const dialog = screen.getByRole('dialog');
    await expect
      .element(dialog.getByText('První aktivita', { exact: true }))
      .toBeVisible();
    await expect
      .element(dialog.getByText('Archivovaná aktivita', { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole('button', { name: 'Provést změnu (2)' }))
      .toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
    await dialog.getByRole('checkbox').click();
    await screen.getByRole('button', { name: 'Provést změnu (2)' }).click();
    await expect
      .element(screen.getByText('Dokončeno: 1 z 2. Chyby: 1. Neprovedeno: 0.'))
      .toBeVisible();
    await expect
      .element(screen.getByText('Druhá aktivita: Obsazená kapacita.'))
      .toBeVisible();
    expect(execute.mock.calls.map(([item]) => item.id)).toEqual(['a', 'b']);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('clears selection on search and dismisses without writing', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const screen = await renderComponent(
      <AdminBulkPanel
        items={items}
        identify={(item) => item}
        actions={[
          { id: 'edit', label: 'Upravit', description: 'Úprava.', execute },
        ]}
        onCompleted={vi.fn()}
      />,
    );
    await screen.getByText('Hromadné úpravy', { exact: true }).click();
    await screen
      .getByRole('checkbox', { name: 'Vybrat všechny zobrazené (3)' })
      .click();
    await screen.getByRole('searchbox').fill('První');
    await screen.getByRole('combobox').selectOptions('edit');
    await expect
      .element(screen.getByRole('button', { name: 'Zkontrolovat změnu (0)' }))
      .toBeDisabled();
    await screen.getByRole('checkbox', { name: 'První aktivita' }).click();
    await screen
      .getByRole('button', { name: 'Zkontrolovat změnu (1)' })
      .click();
    await screen.getByRole('button', { name: 'Zrušit', exact: true }).click();
    expect(execute).not.toHaveBeenCalled();
  });

  it('disables all selection and mutation controls for a read-only snapshot', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const screen = await renderComponent(
      <AdminBulkPanel
        items={items}
        identify={(item) => item}
        actions={[
          { id: 'edit', label: 'Upravit', description: 'Úprava.', execute },
        ]}
        disabled
        onCompleted={vi.fn()}
      />,
    );
    await screen.getByText('Hromadné úpravy', { exact: true }).click();
    await expect
      .element(screen.getByRole('checkbox', { name: 'První aktivita' }))
      .toBeDisabled();
    await expect.element(screen.getByRole('combobox')).toBeDisabled();
    expect(execute).not.toHaveBeenCalled();
  });
});

const success = (data: unknown) => ({
  ok: true,
  kind: 'success',
  status: 200,
  data,
  metadata: { requestId: 'bulk-test' },
});
const apiFor = (
  handler: (
    endpoint: unknown,
    options: { body?: Record<string, unknown>; idempotencyKey?: string },
  ) => unknown,
): ApiPort => ({
  request: vi.fn(async (endpoint, options) =>
    endpoint === adminContextEndpoint
      ? success(adminContextFixtures.organizer!)
      : handler(
          endpoint,
          options as {
            body?: Record<string, unknown>;
            idempotencyKey?: string;
          },
        ),
  ) as ApiPort['request'],
});

describe('bulk operations through admin contracts', () => {
  it('advances the confirmed team version across a parent rerender and excludes the current actor', async () => {
    const members: AdminTeamMember[] = [
      adminFixtureIds.operator,
      adminFixtureIds.moderator,
      adminFixtureIds.assignment,
    ].map((memberId, index) => ({
      memberId,
      displayName: `Člen ${index + 1}`,
      email: `clen${index}@example.test`,
      emailVerified: true,
      isCurrentActor: index === 2,
      roles: ['checkin_operator'],
      invitation: { status: 'accepted', lastSentAt: null },
    }));
    const writes: { version: unknown; key: string | undefined }[] = [];
    const api = apiFor((endpoint, options) => {
      if (endpoint === adminRoleScopeOptionsEndpoint)
        return success({
          eventId: adminFixtureIds.event,
          role: options.body?.role,
          options: [],
        });
      if (endpoint === adminTeamMemberMutationEndpoint) {
        writes.push({
          version: options.body?.expectedVersion,
          key: options.idempotencyKey,
        });
        return success({
          eventId: adminFixtureIds.event,
          outcome: 'updated',
          teamVersion: 4 + writes.length,
          member: {
            ...members.find(
              (member) => member.memberId === options.body?.memberId,
            )!,
            roles: ['checkin_operator', 'organizer_admin'],
          },
          changedAt: '2026-09-08T12:00:00Z',
          audit: { auditId: adminFixtureIds.auditMutation },
        });
      }
      throw new Error('Unexpected endpoint');
    });
    const TestTeam = () => {
      const [busy, setBusy] = useState(false);
      return (
        <AdminTeamBulk
          members={members}
          teamVersion={4}
          disabled={busy}
          onBusyChange={setBusy}
          onCompleted={() => undefined}
        />
      );
    };
    const screen = await renderComponent(
      <AdminWorkspaceShell api={api} environment="mocked">
        <TestTeam />
      </AdminWorkspaceShell>,
    );
    await screen.getByText('Hromadné úpravy týmu', { exact: true }).click();
    await screen
      .getByRole('checkbox', { name: 'Vybrat všechny zobrazené (3)' })
      .click();
    await screen
      .getByRole('combobox', { name: 'Hromadná akce' })
      .selectOptions('grant_admin');
    await screen
      .getByRole('textbox', { name: 'Důvod změny (8–500 znaků)' })
      .fill('Rozšíření organizačního týmu');
    await screen
      .getByRole('button', { name: 'Zkontrolovat změnu (2)' })
      .click();
    await screen.getByRole('dialog').getByRole('checkbox').click();
    await screen.getByRole('button', { name: 'Provést změnu (2)' }).click();
    await expect
      .element(screen.getByText('Dokončeno: 2 z 2. Chyby: 0. Neprovedeno: 0.'))
      .toBeVisible();
    expect(writes.map(({ version }) => version)).toEqual([4, 5]);
    expect(new Set(writes.map(({ key }) => key)).size).toBe(2);
  });

  it('rejects a capacity below existing reservations before sending any mutation', async () => {
    const handler = vi.fn(() => {
      throw new Error('No mutation expected');
    });
    const screen = await renderComponent(
      <AdminWorkspaceShell api={apiFor(handler)} environment="mocked">
        <AdminReservationsBulk
          sessions={adminReservationSessionFixtures.complete!.items}
          disabled={false}
          onBusyChange={() => undefined}
          onCompleted={() => undefined}
        />
      </AdminWorkspaceShell>,
    );
    await screen.getByText('Hromadné úpravy kapacit', { exact: true }).click();
    await screen
      .getByRole('checkbox', { name: /Vybrat všechny zobrazené/ })
      .click();
    await screen
      .getByRole('combobox', { name: 'Hromadná akce' })
      .selectOptions('set');
    await screen.getByRole('spinbutton', { name: 'Nová kapacita' }).fill('1');
    await screen
      .getByRole('textbox', { name: 'Důvod změny (8–500 znaků)' })
      .fill('Kontrola nedostatečné kapacity');
    await screen.getByRole('button', { name: /Zkontrolovat změnu/ }).click();
    await expect
      .element(screen.getByText(/kapacita musí být alespoň/))
      .toBeVisible();
    expect(handler).not.toHaveBeenCalled();
  });
});
