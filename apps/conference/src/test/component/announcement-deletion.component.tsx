import { describe, expect, it, vi } from 'vitest';
import {
  adminContextFixtures,
  adminFixtureIds,
  announcementFixtureIds,
  participantAnnouncementDetailFixtures,
  participantAnnouncementInboxFixtures,
  participantAnnouncementReadProblemFixtures,
} from '@byzon/test-support/fixtures';
import '../../app/styles.css';
import { AdminAnnouncementHistory } from '../../components/admin-announcement-history';
import { AdminWorkspaceShell } from '../../components/admin-workspace-shell';
import { ParticipantAnnouncement } from '../../components/participant-announcement';
import { ParticipantInbox } from '../../components/participant-inbox';
import { ParticipantNotificationCenter } from '../../components/participant-notification-center';
import {
  adminAnnouncementDeleteEndpoint,
  adminAnnouncementListEndpoint,
  adminContextEndpoint,
} from '../../lib/admin-api';
import type { ApiPort } from '../../lib/api';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { publishParticipantAnnouncementRefresh } from '../../lib/participant-announcement-events';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';

const success = (data: unknown) => ({
  ok: true,
  kind: 'success',
  status: 200,
  data,
  metadata: { requestId: 'announcement-delete-component' },
});
const item = {
  ...participantAnnouncementInboxFixtures.unread!.items[0]!,
  recipientCount: 2,
  bodyText: 'Aktuální provozní zpráva.',
};
const json = (data: unknown) =>
  Response.json(data, {
    headers: { 'x-request-id': 'announcement-delete-component' },
  });

it('confirms deletion for all recipients and safely retries a lost response', async () => {
  window.history.replaceState({}, '', '/admin/oznameni');
  let attempts = 0;
  const keys: (string | undefined)[] = [];
  const api: ApiPort = {
    request: vi.fn(async (endpoint, options) => {
      if (endpoint === adminContextEndpoint)
        return success(adminContextFixtures.organizer!);
      if (endpoint === adminAnnouncementListEndpoint)
        return success({
          eventId: adminFixtureIds.event,
          items: [item],
          nextCursor: null,
        });
      if (endpoint === adminAnnouncementDeleteEndpoint) {
        attempts += 1;
        keys.push(options.idempotencyKey);
        return attempts === 1
          ? { ok: false, kind: 'failure', failure: { kind: 'timeout' } }
          : success({
              eventId: adminFixtureIds.event,
              announcementId: item.id,
              outcome: 'deleted',
            });
      }
      throw new Error('Unexpected endpoint');
    }) as ApiPort['request'],
  };
  const screen = await renderComponent(
    <AdminWorkspaceShell api={api}>
      <AdminAnnouncementHistory />
    </AdminWorkspaceShell>,
  );
  const remove = screen.getByRole('button', {
    name: `Smazat oznámení „${item.title}“`,
  });
  await remove.click();
  await expect
    .element(screen.getByRole('button', { name: 'Smazat všem příjemcům' }))
    .toBeDisabled();
  expect(attempts).toBe(0);
  await screen.getByRole('button', { name: 'Zrušit', exact: true }).click();
  expect(attempts).toBe(0);
  await remove.click();
  await expectComponentToPassAxe(
    screen.getByRole('dialog').element() as HTMLElement,
  );
  await screen.getByRole('dialog').getByRole('checkbox').click();
  await screen.getByRole('button', { name: 'Smazat všem příjemcům' }).click();
  await expect.element(screen.getByRole('alert')).toBeVisible();
  await expect.element(remove).toBeVisible();
  await remove.click();
  await screen.getByRole('dialog').getByRole('checkbox').click();
  await screen.getByRole('button', { name: 'Smazat všem příjemcům' }).click();
  await expect
    .element(screen.getByText(/bylo smazáno a už není dostupné příjemcům/))
    .toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  await expect.element(remove).not.toBeInTheDocument();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    window.innerWidth,
  );
});

describe('participant deletion refresh', () => {
  it('removes a deleted toast and updates the unread bell', async () => {
    let messages = participantAnnouncementInboxFixtures.empty_unread!;
    const api = createFetchApiClient({
      fetch: vi.fn(async () => json(messages)),
      maxRetries: 0,
    });
    const screen = await renderComponent(
      <ParticipantNotificationCenter
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );
    await expect
      .element(screen.getByRole('link', { name: 'Oznámení', exact: true }))
      .toBeVisible();
    // Wait for the initial empty poll before publishing the new message.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    messages = {
      ...messages,
      items: [participantAnnouncementInboxFixtures.unread!.items[0]!],
      unreadCount: 1,
    };
    publishParticipantAnnouncementRefresh();
    await expect
      .element(screen.getByRole('heading', { name: item.title }))
      .toBeVisible();
    messages = participantAnnouncementInboxFixtures.empty_unread!;
    publishParticipantAnnouncementRefresh();
    await expect
      .element(screen.getByRole('heading', { name: item.title }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole('link', { name: 'Oznámení', exact: true }))
      .toBeVisible();
  });

  it('refreshes the open inbox when the user returns to the window', async () => {
    window.history.replaceState({}, '', '/app/oznameni');
    let messages = {
      ...participantAnnouncementInboxFixtures.empty_unread!,
      items: [participantAnnouncementInboxFixtures.unread!.items[0]!],
      unreadCount: 1,
    };
    const api = createFetchApiClient({
      fetch: vi.fn(async () => json(messages)),
      maxRetries: 0,
    });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );
    await expect
      .element(screen.getByRole('link', { name: item.title }))
      .toBeVisible();
    messages = { ...messages, items: [], unreadCount: 0 };
    window.dispatchEvent(new Event('focus'));
    await expect
      .element(screen.getByRole('link', { name: item.title }))
      .not.toBeInTheDocument();
  });

  it('hides an already-read detail when the server reports its deletion', async () => {
    const detail = participantAnnouncementDetailFixtures.read!;
    let deleted = false;
    const api = createFetchApiClient({
      fetch: vi.fn(async () =>
        deleted
          ? Response.json(
              participantAnnouncementReadProblemFixtures.not_found,
              {
                status: 404,
                headers: {
                  'content-type': 'application/problem+json',
                  'x-request-id':
                    participantAnnouncementReadProblemFixtures.not_found!
                      .requestId,
                },
              },
            )
          : json(detail),
      ),
      maxRetries: 0,
    });
    const screen = await renderComponent(
      <ParticipantAnnouncement
        api={api}
        eventId={announcementFixtureIds.event}
        announcementId={detail.announcement.id}
      />,
    );
    await expect
      .element(screen.getByRole('heading', { name: detail.announcement.title }))
      .toBeVisible();
    deleted = true;
    window.dispatchEvent(new Event('focus'));
    await expect
      .element(screen.getByRole('heading', { name: 'Oznámení není dostupné' }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: detail.announcement.title }))
      .not.toBeInTheDocument();
  });
});
