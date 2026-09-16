import { adminContextFixtures } from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../app/styles.css';
import { AdminEmailWorkspace } from '../../components/admin-email-workspace';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import {
  adminContextEndpoint,
  adminEmailListEndpoint,
  adminEmailDetailEndpoint,
} from '../../lib/admin-api';
import type { ApiPort } from '../../lib/api/endpoint';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';

const context = adminContextFixtures.organizer!;
const first = {
  id: '019fb300-0000-7000-8000-000000000001',
  eventId: context.event.id,
  kind: 'team-invitation' as const,
  recipient: 'martin@example.test',
  subject: 'BYZON 2026: pozvánka do organizačního týmu',
  sentAt: '2026-09-17T09:00:00Z',
  contentAvailable: true,
};
const second = {
  ...first,
  id: '019fb300-0000-7000-8000-000000000002',
  recipient: null,
  subject: null,
  contentAvailable: false,
};
const success = <T,>(data: T) =>
  ({
    ok: true,
    kind: 'success',
    status: 200,
    data,
    metadata: { requestId: 'email-component-test' },
  }) as const;
const renderEmails = async () => {
  const api: ApiPort = {
    request: vi.fn(async (endpoint, options) => {
      if (endpoint === adminContextEndpoint) return success(context);
      if (endpoint === adminEmailListEndpoint) {
        const url = new URL(options.path, 'https://example.test');
        const items = url.searchParams.get('search')
          ? [first]
          : url.searchParams.get('cursor')
            ? [second]
            : [first];
        return success({
          eventId: context.event.id,
          items,
          total: 2,
          nextCursor:
            url.searchParams.get('cursor') || url.searchParams.get('search')
              ? null
              : 'next',
        });
      }
      if (endpoint === adminEmailDetailEndpoint) {
        const item = options.path.endsWith(second.id) ? second : first;
        return success({
          ...item,
          sender: 'Konference BYZON <jsem@byzon.cz>',
          html: item.contentAvailable
            ? '<html><body><h1>Dobrý den, Martine,</h1><p>Zveme Vás do týmu konference.</p></body></html>'
            : null,
          text: item.contentAvailable
            ? 'Dobrý den, Martine,\nZveme Vás do týmu konference.'
            : null,
          authLinkRedacted: item.contentAvailable,
        });
      }
      throw new Error('Unexpected endpoint');
    }) as ApiPort['request'],
  };
  return {
    screen: await renderComponent(
      <AdminWorkspaceShell api={api}>
        <AdminEmailWorkspace />
      </AdminWorkspaceShell>,
    ),
    api,
  };
};
beforeEach(() => window.history.replaceState({}, '', '/admin/emaily'));

describe('admin email history', () => {
  it('loads content on demand, switches preview and text, and exposes legacy content honestly', async () => {
    const { screen, api } = await renderEmails();
    const message = screen.getByRole('button', {
      name: /BYZON 2026: pozvánka/,
    });
    await expect.element(message).toBeVisible();
    expect(
      vi
        .mocked(api.request)
        .mock.calls.some(([endpoint]) => endpoint === adminEmailDetailEndpoint),
    ).toBe(false);
    await message.click();
    await expect
      .element(screen.getByText(/Jednorázový přihlašovací/))
      .toBeVisible();
    expect(document.querySelector('iframe')?.getAttribute('sandbox')).toBe('');
    await screen
      .getByRole('button', { name: 'Prostý text', exact: true })
      .click();
    await expect
      .element(screen.getByText(/Zveme Vás do týmu konference/))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Načíst další e-maily' }).click();
    await screen
      .getByRole('button', { name: /Původní adresa nebyla uložena/ })
      .click();
    await expect
      .element(
        screen.getByText(/Tento e-mail byl odeslán před zavedením archivu/),
      )
      .toBeVisible();
    await expectComponentToPassAxe(document.body);
  });

  it('searches by recipient and renders the email archive at every viewport', async () => {
    const { screen } = await renderEmails();
    await expect
      .element(screen.getByRole('button', { name: /BYZON 2026: pozvánka/ }))
      .toBeVisible();
    await screen
      .getByRole('searchbox', { name: 'Příjemce nebo předmět' })
      .fill('martin');
    await screen.getByRole('button', { name: 'Zobrazit', exact: true }).click();
    await screen.getByRole('button', { name: /BYZON 2026: pozvánka/ }).click();
    await expect
      .element(screen.getByText(/Jednorázový přihlašovací/))
      .toBeVisible();
    screen.getByRole('main').element().scrollTop = 0;
    await expect
      .element(document.body)
      .toMatchScreenshot('admin-email-history');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
  });
});
