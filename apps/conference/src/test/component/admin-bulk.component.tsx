import { describe, expect, it, vi } from 'vitest';
import {
  adminContextFixtures,
  adminFixtureIds,
  adminReservationSessionFixtures,
} from '@byzon/test-support/fixtures';
import type { AdminTeamMember } from '@byzon/domain/contracts/admin';
import { useState } from 'react';
import '../../app/styles.css';
import {
  AdminBulkCheckbox,
  AdminBulkSelectAll,
  useAdminBulkSelection,
} from '../../components/admin-bulk-selection';
import {
  AdminBulkPanel,
  type AdminBulkAction,
} from '../../components/admin-bulk-panel';
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
import { renderComponent, userEvent } from './render';
import { expectComponentToPassAxe } from './accessibility';

const items = [
  { id: 'a', label: 'První aktivita' },
  { id: 'b', label: 'Druhá aktivita' },
  { id: 'c', label: 'Archivovaná aktivita' },
];

const TestList = ({
  actions,
  disabled = false,
  onCompleted = () => undefined,
}: {
  actions: readonly AdminBulkAction<(typeof items)[number]>[];
  disabled?: boolean;
  onCompleted?: () => void;
}) => {
  const [query, setQuery] = useState('');
  const selection = useAdminBulkSelection(query);
  const visible = items.filter((item) => item.label.includes(query));
  return (
    <main className={styles.workspace} style={{ padding: '1.25rem' }}>
      <section className={styles.panel}>
        <h1>Aktivity</h1>
        <label className={styles.field}>
          Hledat aktivity
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <AdminBulkSelectAll
          selection={selection}
          ids={visible.map((item) => item.id)}
          disabled={disabled}
        />
        <AdminBulkPanel
          {...selection}
          items={visible}
          identify={(item) => item}
          actions={actions}
          disabled={disabled}
          onCompleted={onCompleted}
        />
        <ul className={styles.cardList}>
          {visible.map((item) => (
            <li
              className={styles.dataCard}
              data-bulk-selected={selection.selectedIds.has(item.id)}
              key={item.id}
            >
              <div className={styles.bulkCardHeading}>
                <AdminBulkCheckbox
                  selection={selection}
                  id={item.id}
                  label={item.label}
                  disabled={disabled}
                />
                <strong>{item.label}</strong>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
};

describe('admin bulk action panel', () => {
  it('opens one focused form from row selection and reports partial failures', async () => {
    const execute = vi.fn(async (item: (typeof items)[number]) =>
      item.id === 'b'
        ? { ok: false, message: 'Obsazená kapacita.' }
        : { ok: true },
    );
    const onCompleted = vi.fn();
    const screen = await renderComponent(
      <TestList
        onCompleted={onCompleted}
        actions={[
          {
            id: 'capacity',
            label: 'Změnit kapacity',
            description: 'Upraví kapacity vybraných aktivit.',
            reasonRequired: true,
            fields: [
              { name: 'value', label: 'Nová kapacita', type: 'number', min: 1 },
            ],
            eligible: (item) => item.id !== 'c',
            execute,
          },
        ]}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Upravit vybrané' }),
    ).not.toBeInTheDocument();
    await screen
      .getByRole('checkbox', { name: 'Vybrat vše', exact: true })
      .click();
    expect(
      screen.getByText('První aktivita', { exact: true }).elements(),
    ).toHaveLength(1);
    await screen.getByRole('button', { name: 'Upravit vybrané' }).click();
    await expectComponentToPassAxe(document.querySelector('main')!);
    await screen.getByRole('menuitem', { name: 'Změnit kapacity' }).click();
    expect(screen.getByRole('dialog').elements()).toHaveLength(1);
    await screen.getByRole('spinbutton', { name: 'Nová kapacita' }).fill('40');
    await screen
      .getByRole('textbox', { name: 'Důvod změny' })
      .fill('Změna organizace akce');
    await expect
      .element(screen.getByText(/Mimo podmínky akce: 1/))
      .toBeVisible();
    await expectComponentToPassAxe(document.querySelector('main')!);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
    expect(execute).not.toHaveBeenCalled();
    await screen.getByRole('button', { name: 'Provést změnu (2)' }).click();
    await expect
      .element(screen.getByText('Uloženo 1 z 2 položek.'))
      .toBeVisible();
    await screen.getByText('Neprovedené změny (1)').click();
    await expect.element(screen.getByText('Obsazená kapacita.')).toBeVisible();
    expect(execute.mock.calls.map(([item]) => item.id)).toEqual(['a', 'b']);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('supports keyboard actions, cancels without writing and clears selection after changing filters', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const screen = await renderComponent(
      <TestList
        actions={[
          {
            id: 'edit',
            label: 'Změnit název',
            description: 'Úprava názvu.',
            execute,
          },
          {
            id: 'archive',
            label: 'Archivovat',
            description: 'Archivace.',
            danger: true,
            execute,
          },
        ]}
      />,
    );
    await screen
      .getByRole('checkbox', { name: 'Vybrat: První aktivita', exact: true })
      .click();
    expect(
      (
        screen
          .getByRole('checkbox', { name: 'Vybrat vše', exact: true })
          .element() as HTMLInputElement
      ).indeterminate,
    ).toBe(true);
    await screen.getByRole('button', { name: 'Upravit vybrané' }).click();
    await userEvent.keyboard('{End}');
    expect(document.activeElement?.textContent).toBe('Archivovat');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement?.textContent).toContain('Upravit vybrané');
    await screen.getByRole('button', { name: 'Upravit vybrané' }).click();
    await screen.getByRole('menuitem', { name: 'Archivovat' }).click();
    await expect
      .element(screen.getByRole('button', { name: 'Provést změnu (1)' }))
      .toBeDisabled();
    await screen.getByRole('button', { name: 'Zrušit', exact: true }).click();
    await screen.getByRole('searchbox').fill('Druhá');
    expect(
      screen.getByRole('button', { name: 'Upravit vybrané' }),
    ).not.toBeInTheDocument();
    await screen.getByRole('searchbox').fill('');
    await expect
      .element(screen.getByRole('checkbox', { name: 'Vybrat: První aktivita' }))
      .not.toBeChecked();
    expect(execute).not.toHaveBeenCalled();
  });

  it('disables row selection for a read-only snapshot', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const screen = await renderComponent(
      <TestList
        disabled
        actions={[
          { id: 'edit', label: 'Upravit', description: 'Úprava.', execute },
        ]}
      />,
    );
    await expect
      .element(screen.getByRole('checkbox', { name: 'Vybrat: První aktivita' }))
      .toBeDisabled();
    await expect
      .element(
        screen.getByRole('checkbox', { name: 'Vybrat vše', exact: true }),
      )
      .toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Upravit vybrané' }),
    ).not.toBeInTheDocument();
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
      const [selectedIds, onSelectionChange] = useState<ReadonlySet<string>>(
        new Set(members.map((member) => member.memberId)),
      );
      return (
        <AdminTeamBulk
          selectedIds={selectedIds}
          onSelectionChange={onSelectionChange}
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
    await screen.getByRole('button', { name: 'Upravit vybrané' }).click();
    await screen
      .getByRole('menuitem', { name: 'Přidat administrátorský přístup' })
      .click();
    await screen
      .getByRole('textbox', { name: 'Důvod změny' })
      .fill('Rozšíření organizačního týmu');
    await screen.getByRole('dialog').getByRole('checkbox').click();
    await screen.getByRole('button', { name: 'Provést změnu (2)' }).click();
    await expect
      .element(screen.getByText('Hotovo. Změna provedena u 2 položek.'))
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
          selectedIds={
            new Set(
              adminReservationSessionFixtures.complete!.items.map(
                (item) => item.sessionId,
              ),
            )
          }
          onSelectionChange={() => undefined}
          sessions={adminReservationSessionFixtures.complete!.items}
          disabled={false}
          onBusyChange={() => undefined}
          onCompleted={() => undefined}
        />
      </AdminWorkspaceShell>,
    );
    await screen.getByRole('button', { name: 'Upravit vybrané' }).click();
    await screen.getByRole('menuitem', { name: 'Nastavit kapacitu' }).click();
    await screen.getByRole('spinbutton', { name: 'Nová kapacita' }).fill('1');
    await screen
      .getByRole('textbox', { name: 'Důvod změny' })
      .fill('Kontrola nedostatečné kapacity');
    await screen.getByRole('button', { name: /Provést změnu/ }).click();
    await expect
      .element(screen.getByText(/kapacita musí být alespoň/))
      .toBeVisible();
    expect(handler).not.toHaveBeenCalled();
  });
});
