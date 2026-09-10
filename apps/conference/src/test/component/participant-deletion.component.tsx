import {
  adminContextFixtures,
  adminFixtureIds,
  supportFixtureIds,
} from '@byzon/test-support/fixtures';
import { adminParticipantDetailSchema } from '@byzon/domain/contracts/support';
import { expect, it, vi } from 'vitest';
import '../../app/styles.css';
import { AdminParticipantDetailWorkspace } from '../../components/admin-support-workspace';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import {
  adminContextEndpoint,
  adminParticipantDeleteEndpoint,
  adminParticipantDetailEndpoint,
} from '../../lib/admin-api';
import type { ApiPort } from '../../lib/api';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const detail = adminParticipantDetailSchema.parse({
  eventId: adminFixtureIds.event,
  participantId: supportFixtureIds.participant,
  ticketId: supportFixtureIds.ticket,
  firstName: 'Testovací',
  lastName: 'Účastník',
  contactEmail: 'delete@example.test',
  phone: null,
  company: '',
  jobTitle: '',
  introduction: '',
  linkedinUrl: null,
  todayHunting: [],
  networkingEnabled: false,
  moderationStatus: 'visible',
  onboardingCompleted: true,
  membershipStatus: 'active',
  invitation: { status: 'not_sent', lastSentAt: null },
  ticket: {
    source: 'ticket',
    referenceSuffix: 'T001',
    externalId: null,
    orderExternalId: null,
    state: 'active',
    claimedAt: null,
    version: 1,
    availableActions: ['block'],
  },
  checkIn: null,
  reservations: [],
  profileVersion: 1,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
});
const success = (data: unknown) => ({
  ok: true,
  kind: 'success',
  status: 200,
  data,
  metadata: { requestId: 'participant-delete-test' },
});

it('requires explicit confirmation, permits cancellation, and reuses the same key after a lost response', async () => {
  window.history.replaceState(
    {},
    '',
    `/admin/ucastnici/${detail.participantId}`,
  );
  const keys: (string | undefined)[] = [];
  const api: ApiPort = {
    request: vi.fn(async (endpoint, options) => {
      if (endpoint === adminContextEndpoint)
        return success(adminContextFixtures.organizer!);
      if (endpoint === adminParticipantDetailEndpoint) return success(detail);
      if (endpoint === adminParticipantDeleteEndpoint) {
        keys.push(options.idempotencyKey);
        expect(options.body).toEqual({
          participantId: detail.participantId,
          expectedProfileVersion: 1,
          confirm: true,
        });
        return keys.length === 1
          ? { ok: false, kind: 'failure', failure: { kind: 'timeout' } }
          : success({
              eventId: detail.eventId,
              participantId: detail.participantId,
              outcome: 'already_applied',
              accountDeleted: false,
              membershipRetained: true,
              deletedAt: detail.updatedAt,
              audit: { auditId: adminFixtureIds.auditMutation },
            });
      }
      throw new Error('Unexpected endpoint');
    }) as ApiPort['request'],
  };
  const screen = await renderComponent(
    <AdminWorkspaceShell api={api}>
      <AdminParticipantDetailWorkspace participantId={detail.participantId} />
    </AdminWorkspaceShell>,
  );
  const remove = screen.getByRole('button', {
    name: 'Smazat účastníka',
    exact: true,
  });
  await remove.click();
  const confirm = screen.getByRole('button', {
    name: 'Trvale smazat účastníka',
    exact: true,
  });
  await expect.element(confirm).toBeDisabled();
  expect(keys).toHaveLength(0);
  await expectComponentToPassAxe(
    screen.getByRole('dialog').element() as HTMLElement,
  );
  await screen.getByRole('button', { name: 'Zrušit', exact: true }).click();
  expect(keys).toHaveLength(0);
  await remove.click();
  await screen.getByRole('dialog').getByRole('checkbox').click();
  await confirm.click();
  await expect.element(screen.getByRole('alert')).toBeVisible();
  await expect
    .element(screen.getByRole('heading', { name: 'Testovací Účastník' }))
    .toBeVisible();
  await remove.click();
  await screen.getByRole('dialog').getByRole('checkbox').click();
  await confirm.click();
  await expect
    .element(
      screen.getByRole('heading', { name: 'Účastník byl trvale smazán' }),
    )
    .toBeVisible();
  await expect
    .element(screen.getByText(/Uživatelský účet zůstává zachován/))
    .toBeVisible();
  await expect
    .element(screen.getByRole('heading', { name: 'Testovací Účastník' }))
    .not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain(detail.contactEmail);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[0]).toBe(keys[1]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    window.innerWidth,
  );
});

it('offers no deletion to an administrator without participant mutation permission', async () => {
  window.history.replaceState(
    {},
    '',
    `/admin/ucastnici/${detail.participantId}`,
  );
  const context = adminContextFixtures.organizer!;
  const api: ApiPort = {
    request: vi.fn(async (endpoint) => {
      if (endpoint === adminContextEndpoint)
        return success({
          ...context,
          actor: {
            ...context.actor,
            permissions: context.actor.permissions.filter(
              (permission) => permission !== 'ticket:any:manage',
            ),
          },
        });
      if (endpoint === adminParticipantDetailEndpoint) return success(detail);
      throw new Error('Unexpected mutation');
    }) as ApiPort['request'],
  };
  const screen = await renderComponent(
    <AdminWorkspaceShell api={api}>
      <AdminParticipantDetailWorkspace participantId={detail.participantId} />
    </AdminWorkspaceShell>,
  );
  await expect
    .element(screen.getByRole('heading', { name: 'Testovací Účastník' }))
    .toBeVisible();
  await expect
    .element(
      screen.getByRole('button', { name: 'Smazat účastníka', exact: true }),
    )
    .not.toBeInTheDocument();
});
