import { expect, it, vi } from 'vitest';
import type {
  AdminAnnouncementDraftMutationRequest,
  AdminAnnouncementPreviewRequest,
  AdminAnnouncementSavedDraft,
} from '@byzon/domain/contracts';
import {
  adminContextFixtures,
  adminFixtureIds,
  adminAnnouncementPreviewFixtures,
  adminAnnouncementSendFixtures,
} from '@byzon/test-support/fixtures';
import '../../app/styles.css';
import { AdminAnnouncementWorkspace } from '../../components/admin-announcement-workspace';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import {
  adminAnnouncementDraftEndpoint,
  adminAnnouncementDraftListEndpoint,
  adminAnnouncementDraftMutationEndpoint,
  adminAnnouncementListEndpoint,
  adminAnnouncementPreviewEndpoint,
  adminAnnouncementSendEndpoint,
  adminContextEndpoint,
} from '../../lib/admin-api';
import type { ApiPort } from '../../lib/api';
import { renderComponent, page } from './render';
import { expectComponentToPassAxe } from './accessibility';

const success = (data: unknown) => ({
  ok: true,
  kind: 'success',
  status: 200,
  data,
  metadata: { requestId: 'announcement-draft-component' },
});
const stored = (): AdminAnnouncementSavedDraft => ({
  id: '019fc100-0000-7000-8000-000000000001',
  version: 1,
  draft: {
    title: 'Změna programu',
    bodyText: '',
    severity: 'critical',
    audience: { kind: 'event' },
  },
  createdBy: adminFixtureIds.operator,
  updatedBy: adminFixtureIds.operator,
  createdAt: '2026-09-17T10:00:00Z',
  updatedAt: '2026-09-17T10:00:00Z',
});
const harness = (
  options: {
    initial?: AdminAnnouncementSavedDraft;
    ambiguous?: boolean;
    stale?: boolean;
  } = {},
) => {
  let item = options.initial ?? null;
  let attempts = 0;
  const mutations: {
    body: AdminAnnouncementDraftMutationRequest;
    idempotencyKey?: string;
  }[] = [];
  const previews: AdminAnnouncementPreviewRequest[] = [];
  const sends: unknown[] = [];
  const api: ApiPort = {
    request: vi.fn(async (endpoint, raw) => {
      if (endpoint === adminContextEndpoint)
        return success(adminContextFixtures.organizer!);
      if (endpoint === adminAnnouncementListEndpoint)
        return success({
          eventId: adminFixtureIds.event,
          items: [],
          nextCursor: null,
        });
      if (endpoint === adminAnnouncementDraftListEndpoint)
        return success({
          eventId: adminFixtureIds.event,
          items: item ? [item] : [],
          nextCursor: null,
        });
      if (endpoint === adminAnnouncementDraftEndpoint)
        return success({ eventId: adminFixtureIds.event, item });
      if (endpoint === adminAnnouncementDraftMutationEndpoint) {
        const request = raw as {
          body: AdminAnnouncementDraftMutationRequest;
          idempotencyKey?: string;
        };
        mutations.push(request);
        attempts += 1;
        if (options.ambiguous && attempts === 1)
          return { ok: false, kind: 'failure', failure: { kind: 'timeout' } };
        if (options.stale)
          return {
            ok: false,
            kind: 'failure',
            status: 409,
            failure: {
              kind: 'problem',
              problem: { code: 'ANNOUNCEMENT_DRAFT_STALE' },
            },
          };
        if (request.body.action === 'delete') {
          item = null;
          return success({
            eventId: adminFixtureIds.event,
            outcome: 'deleted',
            draftId: request.body.draftId,
          });
        }
        item = {
          ...stored(),
          id: request.body.draftId,
          version: request.body.expectedVersion + 1,
          draft: request.body.draft,
        };
        return success({
          eventId: adminFixtureIds.event,
          outcome: 'saved',
          item,
        });
      }
      if (endpoint === adminAnnouncementPreviewEndpoint) {
        const body = (raw as { body: AdminAnnouncementPreviewRequest }).body;
        previews.push(body);
        return success({
          ...adminAnnouncementPreviewFixtures.session_audience!,
          eventId: adminFixtureIds.event,
          draft: body.draft,
          ...(body.sourceDraft ? { sourceDraft: body.sourceDraft } : {}),
        });
      }
      if (endpoint === adminAnnouncementSendEndpoint) {
        const body = (
          raw as { body: { previewId: string; previewVersion: number } }
        ).body;
        sends.push(body);
        item = null;
        return success({
          ...adminAnnouncementSendFixtures.sent!,
          eventId: adminFixtureIds.event,
          previewId: body.previewId,
          previewVersion: body.previewVersion,
        });
      }
      throw new Error('Unexpected endpoint');
    }) as ApiPort['request'],
  };
  return { api, mutations, previews, sends };
};
const mount = async (api: ApiPort) => {
  window.history.replaceState({}, '', '/admin/oznameni');
  return renderComponent(
    <AdminWorkspaceShell api={api}>
      <AdminAnnouncementWorkspace targets={[]} />
    </AdminWorkspaceShell>,
  );
};

it('saves incomplete content, reopens the shared draft, and sends only after saving edits and reviewing recipients', async () => {
  const h = harness();
  const screen = await mount(h.api);
  await screen.getByRole('textbox', { name: 'Nadpis' }).fill('Změna programu');
  await screen
    .getByRole('button', { name: 'Uložit koncept', exact: true })
    .click();
  await expect.element(screen.getByText(/Koncept je uložený/)).toBeVisible();
  expect(h.previews).toHaveLength(0);
  expect(h.sends).toHaveLength(0);
  expect(h.mutations[0]!.body).toMatchObject({
    action: 'save',
    expectedVersion: 0,
    draft: { bodyText: '' },
  });
  await screen.getByRole('button', { name: 'Nové oznámení' }).click();
  await expect
    .element(screen.getByRole('textbox', { name: 'Nadpis' }))
    .toHaveValue('');
  await screen
    .getByRole('button', { name: 'Otevřít koncept „Změna programu“' })
    .click();
  await expect
    .element(screen.getByRole('textbox', { name: 'Nadpis' }))
    .toHaveValue('Změna programu');
  await screen
    .getByRole('textbox', { name: 'Zpráva' })
    .fill('Workshop začne o půl hodiny později.');
  await screen.getByRole('button', { name: 'Zkontrolovat oznámení' }).click();
  await expect
    .element(screen.getByText('Před kontrolou uložte změny konceptu.'))
    .toBeVisible();
  expect(h.previews).toHaveLength(0);
  await screen
    .getByRole('button', { name: 'Uložit koncept', exact: true })
    .click();
  await expect.element(screen.getByText(/Koncept je uložený/)).toBeVisible();
  await expectComponentToPassAxe(document.querySelector('#admin-main')!);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    window.innerWidth,
  );
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(
    viewport.width,
    Math.ceil(screen.container.scrollHeight) + 32,
  );
  window.scrollTo(0, 0);
  await page.screenshot({
    element: screen.container,
    path: `../../../../../test-results/announcement-drafts-${viewport.width}.png`,
  });
  await page.viewport(viewport.width, viewport.height);
  await screen.getByRole('button', { name: 'Zkontrolovat oznámení' }).click();
  await expect
    .element(screen.getByRole('heading', { name: 'Kontrola', exact: true }))
    .toBeVisible();
  expect(h.previews[0]!.sourceDraft).toEqual({
    id: h.mutations[0]!.body.draftId,
    version: 2,
  });
  await screen
    .getByRole('textbox', { name: 'Důvod odeslání' })
    .fill('Aktuální informace pro účastníky.');
  await screen.getByRole('button', { name: 'Zkontrolovat odeslání' }).click();
  expect(h.sends).toHaveLength(0);
  await screen.getByRole('dialog').getByRole('checkbox').click();
  await screen
    .getByRole('button', { name: 'Odeslat oznámení', exact: true })
    .click();
  await expect
    .element(screen.getByText(/Oznámení bylo odesláno/))
    .toBeVisible();
  await expect
    .element(
      screen.getByRole('button', { name: 'Otevřít koncept „Změna programu“' }),
    )
    .not.toBeInTheDocument();
  expect(h.sends).toHaveLength(1);
});

it('protects unsaved edits when opening a shared draft and keeps local changes on a version conflict', async () => {
  const h = harness({ initial: stored(), stale: true });
  const screen = await mount(h.api);
  await screen
    .getByRole('textbox', { name: 'Nadpis' })
    .fill('Moje neuložené změny');
  await screen
    .getByRole('button', { name: 'Otevřít koncept „Změna programu“' })
    .click();
  await expect
    .element(screen.getByText(/Ve formuláři máte neuložené změny/))
    .toBeVisible();
  await screen.getByRole('button', { name: 'Pokračovat v úpravách' }).click();
  await expect
    .element(screen.getByRole('textbox', { name: 'Nadpis' }))
    .toHaveValue('Moje neuložené změny');
  await screen
    .getByRole('button', { name: 'Otevřít koncept „Změna programu“' })
    .click();
  await screen
    .getByRole('button', { name: 'Zahodit změny a pokračovat' })
    .click();
  await expect
    .element(screen.getByRole('textbox', { name: 'Nadpis' }))
    .toHaveValue('Změna programu');
  await screen
    .getByRole('textbox', { name: 'Zpráva' })
    .fill('Moje lokální úprava.');
  await screen
    .getByRole('button', { name: 'Uložit koncept', exact: true })
    .click();
  await expect
    .element(screen.getByText(/Koncept mezitím upravil jiný uživatel/))
    .toBeVisible();
  await expect
    .element(screen.getByRole('textbox', { name: 'Zpráva' }))
    .toHaveValue('Moje lokální úprava.');
  expect(h.sends).toHaveLength(0);
});

it('retries an ambiguous save with the same identity and confirms deletion without sending', async () => {
  const h = harness({ ambiguous: true });
  const screen = await mount(h.api);
  await screen.getByRole('textbox', { name: 'Nadpis' }).fill('Změna programu');
  await screen
    .getByRole('button', { name: 'Uložit koncept', exact: true })
    .click();
  await expect
    .element(screen.getByRole('textbox', { name: 'Nadpis' }))
    .toBeDisabled();
  await screen
    .getByRole('button', { name: 'Zopakovat uložení konceptu' })
    .click();
  await expect.element(screen.getByText(/Koncept je uložený/)).toBeVisible();
  expect(h.mutations[0]!.body).toEqual(h.mutations[1]!.body);
  expect(h.mutations[0]!.idempotencyKey).toBe(h.mutations[1]!.idempotencyKey);
  await screen
    .getByRole('button', { name: 'Smazat koncept „Změna programu“' })
    .click();
  await expect
    .element(screen.getByRole('button', { name: 'Potvrdit smazání konceptu' }))
    .toBeDisabled();
  await screen.getByRole('dialog').getByRole('checkbox').click();
  await screen
    .getByRole('button', { name: 'Potvrdit smazání konceptu' })
    .click();
  await expect.element(screen.getByText('Koncept byl smazán.')).toBeVisible();
  await expect
    .element(screen.getByRole('textbox', { name: 'Nadpis' }))
    .toHaveValue('');
  expect(h.sends).toHaveLength(0);
});
