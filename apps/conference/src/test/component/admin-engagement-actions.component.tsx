import { describe, expect, it, vi } from 'vitest';
import {
  adminContextFixtures,
  adminEngagementOverviewFixtures,
  adminFixtureIds,
} from '@byzon/test-support/fixtures';
import { adminEngagementMutationRequestSchema } from '@byzon/domain/contracts/admin-engagement';
import '../../app/styles.css';
import { AdminEngagementWorkspace } from '../../components/admin-engagement-workspace';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import {
  adminContextEndpoint,
  adminEngagementMutationEndpoint,
  adminEngagementOverviewEndpoint,
} from '../../lib/admin-api';
import type { ApiPort } from '../../lib/api/endpoint';
import { page, renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';

const success = (data: unknown) => ({
  ok: true,
  kind: 'success',
  status: 200,
  data,
  metadata: { requestId: 'engagement-actions-test' },
});

const setup = async () => {
  window.history.replaceState({}, '', '/admin/interakce');
  const overview = structuredClone(adminEngagementOverviewFixtures.default!);
  overview.features.questionsEnabled = false;
  overview.sessions.forEach((session) => {
    session.questionsEnabled = false;
  });
  overview.sessions[0]!.status = 'draft';
  overview.sessions.push({
    ...overview.sessions[1]!,
    sessionId: '019fb200-0000-7000-8000-000000000099',
    title: 'Archivovaná přednáška',
    status: 'archived',
  });
  const writes: {
    body: ReturnType<typeof adminEngagementMutationRequestSchema.parse>;
    key: string | undefined;
  }[] = [];
  const api: ApiPort = {
    request: vi.fn(async (endpoint, rawOptions) => {
      if (endpoint === adminContextEndpoint)
        return success(adminContextFixtures.organizer!);
      if (endpoint === adminEngagementOverviewEndpoint)
        return success(structuredClone(overview));
      if (endpoint !== adminEngagementMutationEndpoint)
        throw new Error('Unexpected endpoint');
      const options = rawOptions as { body: unknown; idempotencyKey?: string };
      const body = adminEngagementMutationRequestSchema.parse(options.body);
      writes.push({ body, key: options.idempotencyKey });
      const common = {
        action: body.action,
        eventId: overview.eventId,
        outcome: 'updated',
        changedAt: '2026-09-08T20:00:00.000Z',
        audit: { auditId: adminFixtureIds.auditMutation },
      };
      if (body.action === 'set_session_questions') {
        const session = overview.sessions.find(
          (s) => s.sessionId === body.sessionId,
        )!;
        expect(body.expectedSessionVersion).toBe(session.version);
        session.questionsEnabled = body.enabled;
        session.version += 1;
        return success({
          ...common,
          session: {
            sessionId: session.sessionId,
            questionsEnabled: session.questionsEnabled,
            version: session.version,
          },
        });
      }
      if (body.action === 'assign_moderator') {
        expect(body.expectedAssignmentsVersion).toBe(
          overview.assignmentsVersion,
        );
        const session = overview.sessions.find(
          (s) => s.sessionId === body.sessionId,
        )!;
        const candidate = overview.moderatorCandidates.find(
          (c) => c.userId === body.userId,
        )!;
        session.moderators.push({
          ...candidate,
          assignmentId: session.sessionId,
        });
        session.moderatorReady = true;
        overview.assignmentsVersion += 1;
        return success({
          ...common,
          assignmentsVersion: overview.assignmentsVersion,
          assignment: { sessionId: session.sessionId, ...candidate },
        });
      }
      throw new Error('Unexpected action');
    }) as ApiPort['request'],
  };
  const screen = await renderComponent(
    <AdminWorkspaceShell api={api} environment="production">
      <AdminEngagementWorkspace />
    </AdminWorkspaceShell>,
  );
  await expect
    .element(screen.getByRole('heading', { name: 'Otázky podle přednášky' }))
    .toBeVisible();
  return { screen, writes, overview };
};

const confirmBatch = async (
  screen: Awaited<ReturnType<typeof setup>>['screen'],
  count: number,
) => {
  await screen
    .getByRole('button', { name: `Zkontrolovat změnu (${count})` })
    .click();
  await screen.getByRole('dialog').getByRole('checkbox').click();
  await screen
    .getByRole('button', { name: `Provést změnu (${count})` })
    .click();
  await expect
    .element(
      screen.getByText(
        `Dokončeno: ${count} z ${count}. Chyby: 0. Neprovedeno: 0.`,
      ),
    )
    .toBeVisible();
};

describe('Q&A actions in the program overview', () => {
  it('assigns a moderator directly from a row while collection is disabled', async () => {
    const { screen, writes, overview } = await setup();
    const first = overview.sessions[0]!;
    const rowButton = screen.getByRole('button', {
      name: `Přiřadit moderátora pro ${first.title}`,
    });
    const row = rowButton.element().closest('tr, li');
    if (!row) throw new Error('Session row is missing');
    await page.elementLocator(row).screenshot({
      path: `./test-results/byzon-engagement-row-${window.innerWidth}.png`,
    });
    await rowButton.click();
    const dialog = screen.getByRole('dialog');
    await expect
      .element(dialog.getByText(new RegExp(first.title)))
      .toBeVisible();
    await expect
      .element(
        dialog.getByRole('button', {
          name: 'Přiřadit moderátora',
          exact: true,
        }),
      )
      .toBeDisabled();
    await expect
      .element(dialog.getByRole('option', { name: /Demo Moderátor/ }))
      .not.toBeInTheDocument();
    await dialog
      .getByRole('combobox', { name: 'Moderátor', exact: true })
      .selectOptions(adminFixtureIds.operator);
    await dialog
      .getByRole('textbox', { name: 'Důvod přiřazení (8–500 znaků)' })
      .fill('Moderátor pro tuto přednášku.');
    await expectComponentToPassAxe(document.querySelector('[role="dialog"]')!);
    await dialog.screenshot({
      path: `./test-results/byzon-moderator-dialog-${window.innerWidth}.png`,
    });
    expect(writes).toHaveLength(0);
    await dialog.getByRole('checkbox').click();
    await dialog
      .getByRole('button', { name: 'Přiřadit moderátora', exact: true })
      .click();
    await expect
      .element(
        screen.getByText('Změna byla bezpečně uložena do historie změn.'),
      )
      .toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.body).toMatchObject({
      action: 'assign_moderator',
      sessionId: first.sessionId,
      userId: adminFixtureIds.operator,
    });
    expect(first.moderators.map((m) => m.userId)).toEqual([
      adminFixtureIds.moderator,
      adminFixtureIds.operator,
    ]);
    expect(overview.features.questionsEnabled).toBe(false);
    expect(first.questionsEnabled).toBe(false);
  });

  it('enables questions for selected drafts and published sessions, excluding archived sessions', async () => {
    const { screen, writes, overview } = await setup();
    await expect
      .element(
        screen.getByRole('checkbox', {
          name: 'Vybrat přednášku Archivovaná přednáška',
        }),
      )
      .toBeDisabled();
    await screen
      .getByRole('checkbox', { name: 'Vybrat všechny přednášky (2)' })
      .click();
    await screen
      .getByRole('combobox', { name: 'Hromadná akce' })
      .selectOptions('enable');
    await screen
      .getByRole('textbox', { name: 'Důvod změny (8–500 znaků)' })
      .fill('Příprava otázek pro páteční program.');
    expect(writes).toHaveLength(0);
    await expectComponentToPassAxe(document.querySelector('#admin-main')!);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
    await screen
      .getByRole('region', { name: 'Otázky podle přednášky' })
      .screenshot({
        path: `./test-results/byzon-engagement-selection-${window.innerWidth}.png`,
      });
    await confirmBatch(screen, 2);
    expect(writes.map(({ body }) => body)).toEqual([
      expect.objectContaining({
        action: 'set_session_questions',
        sessionId: adminFixtureIds.session,
        enabled: true,
        expectedSessionVersion: 2,
      }),
      expect.objectContaining({
        action: 'set_session_questions',
        sessionId: adminFixtureIds.secondSession,
        enabled: true,
        expectedSessionVersion: 4,
      }),
    ]);
    expect(overview.features.questionsEnabled).toBe(false);
    expect(overview.sessions[2]!.questionsEnabled).toBe(false);
    await expect
      .element(screen.getByText('Vybráno: 0', { exact: true }))
      .toBeVisible();
  });

  it('assigns the same moderator to selected sessions with both Q&A switches off and advances versions', async () => {
    const { screen, writes, overview } = await setup();
    for (const session of overview.sessions.slice(0, 2)) {
      await screen
        .getByRole('checkbox', { name: `Vybrat přednášku ${session.title}` })
        .click();
    }
    await screen
      .getByRole('combobox', { name: 'Hromadná akce' })
      .selectOptions('assign');
    await screen
      .getByRole('combobox', { name: 'Moderátor', exact: true })
      .selectOptions(adminFixtureIds.operator);
    await screen
      .getByRole('textbox', { name: 'Důvod změny (8–500 znaků)' })
      .fill('Společný moderátor pátečních přednášek.');
    await confirmBatch(screen, 2);
    expect(writes.map(({ body }) => body)).toEqual([
      expect.objectContaining({
        action: 'assign_moderator',
        userId: adminFixtureIds.operator,
        expectedAssignmentsVersion: 3,
      }),
      expect.objectContaining({
        action: 'assign_moderator',
        userId: adminFixtureIds.operator,
        expectedAssignmentsVersion: 4,
      }),
    ]);
    expect(new Set(writes.map(({ key }) => key)).size).toBe(2);
    expect(overview.sessions[0]!.moderators.map((m) => m.userId)).toEqual([
      adminFixtureIds.moderator,
      adminFixtureIds.operator,
    ]);
    expect(overview.sessions.every((s) => !s.questionsEnabled)).toBe(true);
    expect(overview.features.questionsEnabled).toBe(false);
  });

  it('cancels row assignment without writes and returns focus to the row', async () => {
    const { screen, writes, overview } = await setup();
    const button = screen.getByRole('button', {
      name: `Přiřadit moderátora pro ${overview.sessions[1]!.title}`,
    });
    await button.click();
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Zrušit', exact: true })
      .click();
    await expect.element(button).toHaveFocus();
    expect(writes).toHaveLength(0);
  });
});
