import '../../app/styles.css';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import {
  adminContextFixtures,
  adminFixtureIds,
} from '@byzon/test-support/fixtures';
import type { FeedbackAdminOverview } from '@byzon/domain/contracts';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import { AdminFeedbackWorkspace } from '../../components/admin-feedback-workspace';
import { adminContextEndpoint } from '../../lib/admin-api';
import {
  feedbackOverviewEndpoint,
  feedbackSendEndpoint,
} from '../../lib/admin-feedback-api';
import type { ApiPort } from '../../lib/api/endpoint';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';

const overview: FeedbackAdminOverview = {
  eventId: adminFixtureIds.event,
  eventName: 'BYZON 2026',
  updatedAt: '2026-09-21T12:00:00.000Z',
  summary: {
    total: 3,
    invited: 2,
    started: 2,
    completed: 1,
    inProgress: 1,
    notStarted: 1,
    optedOut: 0,
  },
  recipients: [
    {
      id: '019fb200-0000-7000-8000-000000000091',
      name: 'Petra Nová',
      email: 'petra@example.test',
      role: 'attendee',
      suggestedRole: 'attendee',
      status: 'not_started',
      invitedAt: null,
      remindedAt: null,
      mailStatus: 'not_sent',
      emailEnabled: true,
    },
    {
      id: '019fb200-0000-7000-8000-000000000092',
      name: 'Jan Klidný',
      email: 'jan@example.test',
      role: 'speaker',
      suggestedRole: 'speaker',
      status: 'in_progress',
      invitedAt: '2026-09-21T10:00:00.000Z',
      remindedAt: null,
      mailStatus: 'delivered',
      emailEnabled: true,
    },
    {
      id: '019fb200-0000-7000-8000-000000000093',
      name: 'Eva Malá',
      email: 'eva@example.test',
      role: 'partner',
      suggestedRole: 'partner',
      status: 'completed',
      invitedAt: '2026-09-21T10:00:00.000Z',
      remindedAt: null,
      mailStatus: 'delivered',
      emailEnabled: true,
    },
  ],
  questions: [
    {
      id: 'score',
      label: 'Jak hodnotíte konferenci celkově?',
      type: 'choice',
      eligible: 3,
      answered: 2,
      notApplicable: 0,
      average: 4.5,
      options: [
        { value: '5', label: 'Výborná', count: 1 },
        { value: '4', label: 'Velmi dobrá', count: 1 },
      ],
      comments: [],
    },
    {
      id: 'musicScore',
      label: 'Jak jste byli spokojeni s hudebním doprovodem?',
      type: 'choice',
      eligible: 3,
      answered: 2,
      notApplicable: 1,
      average: 4,
      options: [
        { value: '4', label: 'Velmi spokojen/a', count: 1 },
        { value: 'skip', label: 'Nevnímal/a jsem', count: 1 },
      ],
      comments: [],
    },
  ],
  roles: [],
};
const success = (data: unknown) => ({
  ok: true,
  kind: 'success',
  status: 200,
  data,
  metadata: { requestId: 'feedback-admin-test' },
});

const setup = async (sendResult?: () => unknown) => {
  const sends = vi.fn((options: unknown) => {
    void options;
    return (
      sendResult?.() ??
      success({
        data: {
          queued: 1,
          skipped: 0,
          batchId: '019fb200-0000-7000-8000-000000000094',
        },
      })
    );
  });
  const api: ApiPort = {
    request: vi.fn(async (endpoint: unknown, options: unknown) => {
      if (endpoint === adminContextEndpoint)
        return success(adminContextFixtures.organizer!);
      if (endpoint === feedbackOverviewEndpoint)
        return success({ data: overview });
      if (endpoint === feedbackSendEndpoint) {
        sends(options);
        return sends.mock.results.at(-1)?.value;
      }
      throw new Error('Unexpected endpoint');
    }) as unknown as ApiPort['request'],
  };
  const screen = await renderComponent(
    <AdminWorkspaceShell api={api}>
      <AdminFeedbackWorkspace />
    </AdminWorkspaceShell>,
  );
  await expect
    .element(screen.getByRole('heading', { name: 'Co nám účastníci říkají' }))
    .toBeVisible();
  return { screen, sends };
};

beforeEach(() => window.history.replaceState({}, '', '/admin/hodnoceni'));

describe('conference feedback administration', () => {
  it('reports partial answers, excludes skipped ratings and offers a filtered export', async () => {
    const { screen } = await setup();
    await expect
      .element(
        screen.getByText('Číselných hodnocení pro výpočet průměru: 2.', {
          exact: false,
        }),
      )
      .toBeVisible();
    await screen
      .getByText('Jak jste byli spokojeni s hudebním doprovodem?', {
        exact: true,
      })
      .click();
    await expect
      .element(
        screen.getByText('Číselných hodnocení pro výpočet průměru: 1.', {
          exact: false,
        }),
      )
      .toBeVisible();
    expect(
      screen
        .getByRole('link', { name: 'Stáhnout odpovědi CSV' })
        .element()
        .getAttribute('href'),
    ).toContain('role=all&status=all');
    await expectComponentToPassAxe(
      document.querySelector<HTMLElement>('[data-admin-root]')!,
    );
    window.scrollTo(0, 0);
    await page.screenshot({
      path: `.vitest-attachments/admin-feedback-results-${window.innerWidth}.png`,
      fullPage: true,
    });
  });

  it('requires a reviewed exact-recipient selection before a batch is queued', async () => {
    const { screen, sends } = await setup();
    await screen
      .getByRole('button', { name: 'Rozesílání e-mailů', exact: true })
      .click();
    await expect
      .element(
        screen.getByRole('button', { name: 'Zkontrolovat a odeslat (0)' }),
      )
      .toBeDisabled();
    await expect
      .element(
        screen.getByRole('checkbox', {
          name: 'Vybrat Eva Malá (eva@example.test)',
        }),
      )
      .toBeDisabled();
    await screen
      .getByRole('button', { name: 'Vybrat vhodné (1)', exact: true })
      .click();
    expect(sends).not.toHaveBeenCalled();
    await screen
      .getByRole('button', { name: 'Zkontrolovat a odeslat (1)' })
      .click();
    await expect.element(screen.getByRole('dialog')).toBeVisible();
    expect(sends).not.toHaveBeenCalled();
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Odeslat 1 e-mail' })
      .click();
    await expect.poll(() => sends.mock.calls.length).toBe(1);
    expect(sends.mock.calls[0]?.[0]).toMatchObject({
      body: {
        kind: 'invitation',
        participantIds: [overview.recipients[0]!.id],
      },
      idempotencyKey: expect.any(String),
    });
    await expect
      .element(
        screen.getByText('Do fronty jsme zařadili 1 e-mail.', {
          exact: false,
        }),
      )
      .toBeVisible();
    await expectComponentToPassAxe(
      document.querySelector<HTMLElement>('[data-admin-root]')!,
    );
    window.scrollTo(0, 0);
    await page.screenshot({
      path: `.vitest-attachments/admin-feedback-mail-${window.innerWidth}.png`,
      fullPage: true,
    });
  });

  it('reuses the exact batch and key after an uncertain transport result', async () => {
    const { screen, sends } = await setup(() => ({
      ok: false,
      kind: 'failure',
      failure: { kind: 'timeout' },
    }));
    await screen
      .getByRole('button', { name: 'Rozesílání e-mailů', exact: true })
      .click();
    await screen
      .getByRole('button', { name: 'Vybrat vhodné (1)', exact: true })
      .click();
    await screen
      .getByRole('button', { name: 'Zkontrolovat a odeslat (1)' })
      .click();
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Odeslat 1 e-mail' })
      .click();
    await screen.getByRole('button', { name: 'Ověřit původní dávku' }).click();
    await expect.poll(() => sends.mock.calls.length).toBe(2);
    const first = sends.mock.calls[0]?.[0] as {
      body: unknown;
      idempotencyKey: string;
    };
    const retry = sends.mock.calls[1]?.[0] as {
      body: unknown;
      idempotencyKey: string;
    };
    expect(retry.body).toEqual(first.body);
    expect(retry.idempotencyKey).toEqual(first.idempotencyKey);
  });
});
