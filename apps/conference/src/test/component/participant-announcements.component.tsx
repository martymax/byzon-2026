import type { ApiProblem } from '@byzon/domain/contracts';
import {
  announcementFixtureIds,
  participantAnnouncementDetailFixtures,
  participantAnnouncementInboxFixtures,
  participantAnnouncementInboxProblemFixtures,
  participantAnnouncementReadProblemFixtures,
  participantAnnouncementReadFixtures,
} from '@byzon/test-support/fixtures';
import type { CSSProperties, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import { ParticipantLayoutShell as ParticipantLayout } from '../../components/participant-layout-shell';
import { ParticipantAnnouncement } from '../../components/participant-announcement';
import { ParticipantInbox } from '../../components/participant-inbox';
import type { ApiPort } from '../../lib/api';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const visualTestStyle = {
  '--byzon-font-body': 'Arial, sans-serif',
  '--byzon-font-display': 'Arial, sans-serif',
  fontFamily: 'Arial, sans-serif',
} as CSSProperties;

const jsonResponse = (fixture: unknown, requestId: string) =>
  Response.json(fixture, {
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId,
    },
  });

const problemResponse = (problem: ApiProblem) =>
  Response.json(problem, {
    status: problem.status,
    headers: {
      'content-type': 'application/problem+json',
      'x-request-id': problem.requestId,
    },
  });

const requestUrl = (input: RequestInfo | URL): URL => {
  const value =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.toString()
        : input;
  return new URL(value, window.location.origin);
};

const requestMethod = (input: RequestInfo | URL, init?: RequestInit): string =>
  init?.method ?? (input instanceof Request ? input.method : 'GET');

const AnnouncementProbe = ({ children }: { readonly children: ReactNode }) => (
  <main
    id="main"
    data-testid="announcement-shell"
    style={visualTestStyle}
    tabIndex={-1}
  >
    <ParticipantLayout
      accountScope={{
        kind: 'active',
        eventId: announcementFixtureIds.event,
      }}
      navigationMode="active-preview"
    >
      {children}
    </ParticipantLayout>
  </main>
);

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/app/oznameni');
});

describe('F2-05 participant announcement inbox', () => {
  it('filters authoritatively, exposes non-color unread cues and passes the responsive axe baseline', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const fixture =
        url.searchParams.get('filter') === 'unread'
          ? participantAnnouncementInboxFixtures.unread
          : participantAnnouncementInboxFixtures.happy;
      return jsonResponse(fixture, 'component-announcement-inbox-0001');
    });
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <AnnouncementProbe>
        <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />
      </AnnouncementProbe>,
    );

    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Oznámení' }))
      .toHaveFocus();
    await expect
      .element(screen.getByText('3 zobrazená oznámení'))
      .toBeVisible();
    expect(
      screen.container.querySelectorAll('.announcement-read-label--unread'),
    ).toHaveLength(2);
    const firstAnnouncement =
      screen.container.querySelector<HTMLElement>('.announcement-card');
    expect(firstAnnouncement?.textContent).toContain('Změna sálu workshopu');
    expect(firstAnnouncement?.textContent).toContain('Nepřečtené');

    const filter = screen.getByRole('button', {
      name: 'Nepřečtená (2)',
    });
    const filterElement = filter.element();
    const filterBounds = filterElement.getBoundingClientRect();
    expect(filterBounds.width).toBeGreaterThanOrEqual(44);
    expect(filterBounds.height).toBeGreaterThanOrEqual(44);
    await filter.click();
    expect(document.activeElement).toBe(filterElement);

    await expect
      .element(screen.getByText('2 zobrazená oznámení'))
      .toBeVisible();
    expect(new URL(window.location.href).searchParams.get('view')).toBe(
      'unread',
    );
    expect(
      fetch.mock.calls.some(([input]) => {
        const url = requestUrl(input);
        return (
          url.pathname === '/api/v1/me/announcements' &&
          url.searchParams.get('filter') === 'unread' &&
          url.searchParams.get('limit') === '50'
        );
      }),
    ).toBe(true);

    const firstCard =
      screen.container.querySelector<HTMLElement>('.announcement-card');
    expect(firstCard).not.toBeNull();
    expect(firstCard!.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      44,
    );
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(screen.container);
  });

  it('stores only bounded numeric return context when a card is opened', async () => {
    const api = createFetchApiClient({
      fetch: async () =>
        jsonResponse(
          participantAnnouncementInboxFixtures.happy,
          'component-announcement-return-write-0001',
        ),
      maxRetries: 0,
    });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );
    const link = screen
      .getByRole('link', { name: /Změna sálu workshopu/ })
      .element();
    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    });
    click.preventDefault();
    link.dispatchEvent(click);

    const stored = JSON.parse(
      window.sessionStorage.getItem('byzon:announcement-return:v1') ?? 'null',
    ) as unknown;
    expect(stored).toEqual({
      eventId: announcementFixtureIds.event,
      filter: 'all',
      pageCount: 1,
      scrollY: 0,
    });
    expect(Object.keys(stored as object).sort()).toEqual([
      'eventId',
      'filter',
      'pageCount',
      'scrollY',
    ]);
  });

  it('loads every cursor page without hiding the already rendered inbox', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const cursor = url.searchParams.get('cursor');
      return jsonResponse(
        cursor
          ? participantAnnouncementInboxFixtures.second_page
          : participantAnnouncementInboxFixtures.first_page,
        'component-announcement-pagination-0001',
      );
    });
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );

    await expect
      .element(screen.getByText('2 zobrazená oznámení'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Načíst další oznámení' }).click();

    await expect
      .element(screen.getByText('3 zobrazená oznámení'))
      .toBeVisible();
    await expect
      .element(screen.getByText('Bezpečnostní omezení příjezdu'))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole('link', {
          name: /Bezpečnostní omezení příjezdu/,
        }),
      )
      .toHaveFocus();
    await expect
      .element(
        screen.getByRole('link', {
          name: /Bezpečnostní omezení příjezdu/,
        }),
      )
      .toHaveAttribute(
        'href',
        `/app/oznameni/${announcementFixtureIds.information}?returnPages=2`,
      );
    expect(
      fetch.mock.calls.some(([input]) => {
        const url = requestUrl(input);
        return (
          url.searchParams.get('cursor') === announcementFixtureIds.nextCursor
        );
      }),
    ).toBe(true);
    expect(
      [...screen.container.querySelectorAll('button')].some(
        (button) => button.textContent === 'Načíst další oznámení',
      ),
    ).toBe(false);
  });

  it('reloads the prior cursor depth and restores only numeric scroll context', async () => {
    window.history.replaceState({}, '', '/app/oznameni?restorePages=2');
    window.sessionStorage.setItem(
      'byzon:announcement-return:v1',
      JSON.stringify({
        eventId: announcementFixtureIds.event,
        filter: 'all',
        pageCount: 2,
        scrollY: 320,
      }),
    );
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(
        requestUrl(input).searchParams.has('cursor')
          ? participantAnnouncementInboxFixtures.second_page
          : participantAnnouncementInboxFixtures.first_page,
        'component-announcement-return-context-0001',
      ),
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });

    try {
      const screen = await renderComponent(
        <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
      );

      await expect
        .element(screen.getByText('3 zobrazená oznámení'))
        .toBeVisible();
      await vi.waitFor(() => {
        expect(window.location.search).toBe('');
        expect(scrollTo).toHaveBeenCalledWith({
          behavior: 'auto',
          left: 0,
          top: 320,
        });
      });
      expect(
        window.sessionStorage.getItem('byzon:announcement-return:v1'),
      ).toBeNull();
    } finally {
      scrollTo.mockRestore();
    }
  });

  it.each([
    ['missing storage', null],
    [
      'mismatched event',
      {
        eventId: announcementFixtureIds.critical,
        filter: 'all',
        pageCount: 20,
        scrollY: 100,
      },
    ],
    [
      'unknown field',
      {
        eventId: announcementFixtureIds.event,
        filter: 'all',
        pageCount: 20,
        scrollY: 100,
        announcementId: announcementFixtureIds.important,
      },
    ],
  ])(
    'rejects %s before a restore URL can amplify private cursor reads',
    async (_label, stored) => {
      window.history.replaceState({}, '', '/app/oznameni?restorePages=20');
      if (stored) {
        window.sessionStorage.setItem(
          'byzon:announcement-return:v1',
          JSON.stringify(stored),
        );
      }
      const fetch = vi.fn(async () =>
        jsonResponse(
          participantAnnouncementInboxFixtures.first_page,
          'component-announcement-invalid-restore-0001',
        ),
      );
      const api = createFetchApiClient({ fetch, maxRetries: 0 });

      await renderComponent(
        <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
      );
      await vi.waitFor(() => expect(window.location.search).toBe(''));
      expect(fetch).toHaveBeenCalledOnce();
      expect(
        window.sessionStorage.getItem('byzon:announcement-return:v1'),
      ).toBeNull();
    },
  );

  it('uses the URL as filter source of truth across browser back and forward', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(
        requestUrl(input).searchParams.get('filter') === 'unread'
          ? participantAnnouncementInboxFixtures.unread
          : participantAnnouncementInboxFixtures.happy,
        'component-announcement-history-0001',
      ),
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );
    await expect
      .element(screen.getByText('3 zobrazená oznámení'))
      .toBeVisible();

    window.history.pushState({}, '', '/app/oznameni?view=unread');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await expect
      .element(screen.getByText('2 zobrazená oznámení'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Nepřečtená (2)' }))
      .toHaveAttribute('aria-pressed', 'true');

    const back = new Promise<void>((resolve) =>
      window.addEventListener('popstate', () => resolve(), { once: true }),
    );
    window.history.back();
    await back;
    await expect
      .element(screen.getByText('3 zobrazená oznámení'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Všechna' }))
      .toHaveAttribute('aria-pressed', 'true');

    const forward = new Promise<void>((resolve) =>
      window.addEventListener('popstate', () => resolve(), { once: true }),
    );
    window.history.forward();
    await forward;
    await expect
      .element(screen.getByText('2 zobrazená oznámení'))
      .toBeVisible();
  });

  it('aborts an older cursor request when browser navigation changes the filter', async () => {
    let staleSignal: AbortSignal | undefined;
    let releaseStale: (() => void) | undefined;
    const staleResponse = new Promise<Response>((resolve) => {
      releaseStale = () =>
        resolve(
          problemResponse(
            participantAnnouncementInboxProblemFixtures.authentication!,
          ),
        );
    });
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        const filter = url.searchParams.get('filter');
        const cursor = url.searchParams.get('cursor');
        if (filter === 'all' && cursor) {
          staleSignal = init?.signal ?? undefined;
          return staleResponse;
        }
        if (filter === 'unread' && cursor) {
          return jsonResponse(
            {
              ...participantAnnouncementInboxFixtures.empty_unread!,
              unreadCount: 2,
            },
            'component-announcement-filter-race-page-0001',
          );
        }
        return jsonResponse(
          participantAnnouncementInboxFixtures.first_page,
          'component-announcement-filter-race-base-0001',
        );
      },
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );

    await screen.getByRole('button', { name: 'Načíst další oznámení' }).click();
    window.history.pushState({}, '', '/app/oznameni?view=unread');
    window.dispatchEvent(new PopStateEvent('popstate'));

    await expect
      .element(screen.getByRole('button', { name: 'Nepřečtená (2)' }))
      .toHaveAttribute('aria-pressed', 'true');
    await vi.waitFor(() => expect(staleSignal?.aborted).toBe(true));
    releaseStale?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect
      .element(screen.getByRole('button', { name: 'Nepřečtená (2)' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Přihlášení vypršelo').elements()).toHaveLength(0);
    await screen.getByRole('button', { name: 'Načíst další oznámení' }).click();
    await vi.waitFor(() =>
      expect(
        fetch.mock.calls.some(([input]) => {
          const url = requestUrl(input);
          return (
            url.searchParams.get('filter') === 'unread' &&
            url.searchParams.has('cursor')
          );
        }),
      ).toBe(true),
    );
  });

  it('rejects a read item returned by the authoritative unread filter', async () => {
    window.history.replaceState({}, '', '/app/oznameni?view=unread');
    const api = createFetchApiClient({
      fetch: async () =>
        jsonResponse(
          participantAnnouncementInboxFixtures.happy,
          'component-announcement-unread-scope-0001',
        ),
      maxRetries: 0,
    });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );

    await expect
      .element(screen.getByText('Seznam oznámení se nepodařilo načíst'))
      .toBeVisible();
    expect(document.body.textContent).not.toContain(
      'Bezpečnostní omezení příjezdu',
    );
  });

  it('rejects a read item on a later unread page without appending it', async () => {
    window.history.replaceState({}, '', '/app/oznameni?view=unread');
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(
        requestUrl(input).searchParams.has('cursor')
          ? participantAnnouncementInboxFixtures.second_page
          : participantAnnouncementInboxFixtures.first_page,
        'component-announcement-unread-page-scope-0001',
      ),
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );

    await screen.getByRole('button', { name: 'Načíst další oznámení' }).click();
    await expect
      .element(screen.getByText('Další oznámení se nepodařilo načíst'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Zkusit znovu' }))
      .toBeVisible();
    expect(
      [...screen.container.querySelectorAll('button')].some(
        (button) => button.textContent === 'Načíst další oznámení',
      ),
    ).toBe(false);
    await expect
      .element(screen.getByText('Změna sálu workshopu'))
      .toBeVisible();
    expect(document.body.textContent).not.toContain(
      'Bezpečnostní omezení příjezdu',
    );
  });

  it('orders offset timestamps by instant across page boundaries', async () => {
    const outOfOrderPage = {
      ...participantAnnouncementInboxFixtures.second_page!,
      items: [
        {
          ...participantAnnouncementInboxFixtures.second_page!.items[0]!,
          publishedAt: '2026-09-18T05:45:00.000-01:00',
          readAt: null,
        },
      ],
      unreadCount: 3,
    };
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      jsonResponse(
        requestUrl(input).searchParams.has('cursor')
          ? outOfOrderPage
          : participantAnnouncementInboxFixtures.first_page,
        'component-announcement-page-order-0001',
      ),
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );

    await screen.getByRole('button', { name: 'Načíst další oznámení' }).click();
    await expect
      .element(screen.getByText('Další oznámení se nepodařilo načíst'))
      .toBeVisible();
    expect(document.body.textContent).not.toContain(
      'Bezpečnostní omezení příjezdu',
    );
  });

  it('wipes the inbox when cursor loading reveals an access revocation', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      requestUrl(input).searchParams.has('cursor')
        ? problemResponse(
            participantAnnouncementInboxProblemFixtures.authentication!,
          )
        : jsonResponse(
            participantAnnouncementInboxFixtures.first_page,
            'component-announcement-page-revocation-0001',
          ),
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );

    await screen.getByRole('button', { name: 'Načíst další oznámení' }).click();
    await expect
      .element(screen.getByText('Je potřeba se přihlásit'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Oznámení' }))
      .toHaveFocus();
    expect(document.body.textContent).not.toContain('Změna sálu workshopu');
    expect(document.body.textContent).not.toContain(
      'Hlavní vstup dočasně uzavřen',
    );
    expect(document.body.textContent).not.toContain('Nepřečtená (2)');
  });

  it('purges loaded cursor pages after a malformed 401 and cannot revive them through route context', async () => {
    const appendedPage = {
      ...participantAnnouncementInboxFixtures.second_page!,
      pageInfo: {
        hasMore: true,
        nextCursor: 'fixture-announcements-page-3',
      },
    };
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const cursor = url.searchParams.get('cursor');
      if (cursor === 'fixture-announcements-page-3') {
        return new Response('malformed unauthorized response', {
          status: 401,
          headers: { 'content-type': 'text/plain' },
        });
      }
      if (cursor) {
        return jsonResponse(
          appendedPage,
          'component-announcement-malformed-page-0001',
        );
      }
      return jsonResponse(
        url.searchParams.get('filter') === 'unread'
          ? participantAnnouncementInboxFixtures.empty_unread
          : participantAnnouncementInboxFixtures.first_page,
        'component-announcement-malformed-base-0001',
      );
    });
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );

    await screen.getByRole('button', { name: 'Načíst další oznámení' }).click();
    await expect
      .element(screen.getByText('Bezpečnostní omezení příjezdu'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Načíst další oznámení' }).click();

    await expect.element(screen.getByText('Přihlášení vypršelo')).toBeVisible();
    expect(document.body.textContent).not.toContain(
      'Bezpečnostní omezení příjezdu',
    );

    window.history.pushState({}, '', '/app/oznameni?view=unread');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await expect
      .element(screen.getByText('Všechna oznámení máte přečtená'))
      .toBeVisible();

    window.history.pushState({}, '', '/app/oznameni');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await expect
      .element(screen.getByText('2 zobrazená oznámení'))
      .toBeVisible();
    expect(document.body.textContent).not.toContain(
      'Bezpečnostní omezení příjezdu',
    );
  });

  it('cleans validated return context after an authoritative base failure', async () => {
    window.history.replaceState({}, '', '/app/oznameni?restorePages=2');
    window.sessionStorage.setItem(
      'byzon:announcement-return:v1',
      JSON.stringify({
        eventId: announcementFixtureIds.event,
        filter: 'all',
        pageCount: 2,
        scrollY: 100,
      }),
    );
    const fetch = vi.fn(async () =>
      problemResponse(
        participantAnnouncementInboxProblemFixtures.authentication!,
      ),
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );

    await expect
      .element(screen.getByText('Je potřeba se přihlásit'))
      .toBeVisible();
    await vi.waitFor(() => expect(window.location.search).toBe(''));
    expect(
      window.sessionStorage.getItem('byzon:announcement-return:v1'),
    ).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('distinguishes an empty inbox from an empty unread filter', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const unread = requestUrl(input).searchParams.get('filter') === 'unread';
      return jsonResponse(
        unread
          ? participantAnnouncementInboxFixtures.empty_unread
          : participantAnnouncementInboxFixtures.empty,
        'component-announcement-empty-0001',
      );
    });
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );

    await expect
      .element(screen.getByText('Zatím tu nejsou žádná oznámení'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Nepřečtená (0)' }).click();
    await expect
      .element(screen.getByText('Všechna oznámení máte přečtená'))
      .toBeVisible();
  });

  it('reserves a bounded loading state', async () => {
    const api = createFetchApiClient({
      fetch: () => new Promise<Response>(() => undefined),
      maxRetries: 0,
    });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );

    await expect
      .element(screen.getByLabelText('Načítám seznam oznámení'))
      .toBeVisible();
  });

  it('keeps private inbox data unavailable offline', async () => {
    const fetch = vi.fn();
    const api = createFetchApiClient({
      fetch,
      isOnline: () => false,
      maxRetries: 0,
    });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
    );

    await expect.element(screen.getByText('Jste offline')).toBeVisible();
    expect(fetch).toHaveBeenCalled();
    expect(
      fetch.mock.calls.every(([, init]) => init?.cache === 'no-store'),
    ).toBe(true);
    expect(document.body.textContent).not.toContain('Změna sálu workshopu');
  });

  it('fails closed when a valid inbox response belongs to another event', async () => {
    const api = createFetchApiClient({
      fetch: async () =>
        jsonResponse(
          participantAnnouncementInboxFixtures.happy,
          'component-announcement-inbox-scope-0001',
        ),
      maxRetries: 0,
    });
    const screen = await renderComponent(
      <ParticipantInbox api={api} eventId={announcementFixtureIds.critical} />,
    );

    await expect
      .element(screen.getByText('Seznam oznámení se nepodařilo načíst'))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Změna sálu workshopu');
  });

  it.each([
    [
      participantAnnouncementInboxProblemFixtures.disabled!,
      'Oznámení nejsou pro tuto akci zapnutá',
    ],
    [
      participantAnnouncementInboxProblemFixtures.permission!,
      'Oznámení není dostupné',
    ],
    [
      participantAnnouncementInboxProblemFixtures.session_expired!,
      'Přihlášení vypršelo',
    ],
    [
      participantAnnouncementInboxProblemFixtures.internal_error!,
      'Seznam oznámení se nepodařilo načíst',
    ],
  ])(
    'maps a private inbox failure without raw detail %#',
    async (problem, title) => {
      const api = createFetchApiClient({
        fetch: async () => problemResponse(problem),
        maxRetries: 0,
      });
      const screen = await renderComponent(
        <ParticipantInbox api={api} eventId={announcementFixtureIds.event} />,
      );

      await expect.element(screen.getByText(title)).toBeVisible();
      expect(document.body.textContent).not.toContain(problem.detail);
    },
  );
});

describe('F2-05 participant announcement detail and read receipt', () => {
  it('marks a valid rendered detail as read and updates both visible states', async () => {
    const idempotencyKeys: string[] = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (requestMethod(input, init) === 'POST') {
          expect(document.body.textContent).toContain(
            'Hlavní vstup dočasně uzavřen',
          );
          idempotencyKeys.push(
            new Headers(init?.headers).get('idempotency-key') ?? '',
          );
          return jsonResponse(
            participantAnnouncementReadFixtures.success,
            'component-announcement-read-0001',
          );
        }
        return jsonResponse(
          participantAnnouncementDetailFixtures.unread,
          'component-announcement-detail-0001',
        );
      },
    );
    const createIdempotencyKey = vi
      .fn()
      .mockReturnValueOnce('announcement-read:component-key-one')
      .mockReturnValue('announcement-read:component-key-two');
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <AnnouncementProbe>
        <ParticipantAnnouncement
          announcementId={announcementFixtureIds.important}
          api={api}
          createIdempotencyKey={createIdempotencyKey}
          eventId={announcementFixtureIds.event}
        />
      </AnnouncementProbe>,
    );

    await expect
      .element(
        screen.getByText(
          'Oznámení bylo označené jako přečtené až po bezpečném zobrazení.',
        ),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Nepřečtené');
    expect(createIdempotencyKey).toHaveBeenCalledOnce();
    expect(new Set(idempotencyKeys)).toEqual(
      new Set(['announcement-read:component-key-one']),
    );
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(screen.container);
  });

  it('retains one key for an ambiguous canonical mismatch and correlates the retry', async () => {
    let correlated = false;
    const idempotencyKeys: string[] = [];
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (requestMethod(input, init) === 'POST') {
          idempotencyKeys.push(
            new Headers(init?.headers).get('idempotency-key') ?? '',
          );
          return jsonResponse(
            correlated
              ? participantAnnouncementReadFixtures.success
              : participantAnnouncementReadFixtures.already_read,
            'component-announcement-correlation-0001',
          );
        }
        return jsonResponse(
          participantAnnouncementDetailFixtures.unread,
          'component-announcement-detail-0002',
        );
      },
    );
    const createIdempotencyKey = vi
      .fn()
      .mockReturnValueOnce('announcement-read:ambiguous-one')
      .mockReturnValue('announcement-read:unsafe-two');
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantAnnouncement
        announcementId={announcementFixtureIds.important}
        api={api}
        createIdempotencyKey={createIdempotencyKey}
        eventId={announcementFixtureIds.event}
      />,
    );

    await expect
      .element(screen.getByText('Přečtení se nepodařilo potvrdit'))
      .toBeVisible();
    expect(document.body.textContent).toContain('Nepřečtené');

    correlated = true;
    await screen.getByRole('button', { name: 'Zkusit znovu' }).click();
    await expect
      .element(
        screen.getByText(
          'Oznámení bylo označené jako přečtené až po bezpečném zobrazení.',
        ),
      )
      .toBeVisible();

    expect(createIdempotencyKey).toHaveBeenCalledOnce();
    expect(new Set(idempotencyKeys)).toEqual(
      new Set(['announcement-read:ambiguous-one']),
    );
  });

  it('keeps offline read state in memory and retries the same request key after reconnecting', async () => {
    let readOnline = false;
    const idempotencyKeys: string[] = [];
    const request = vi.fn(
      async (
        endpoint: { readonly method: string },
        options: { readonly idempotencyKey?: string },
      ) => {
        if (endpoint.method === 'GET') {
          return {
            ok: true as const,
            kind: 'success' as const,
            status: 200,
            data: participantAnnouncementDetailFixtures.unread,
            metadata: { requestId: 'component-announcement-offline-get-0001' },
          };
        }
        idempotencyKeys.push(options.idempotencyKey ?? '');
        if (!readOnline) {
          return {
            ok: false as const,
            kind: 'failure' as const,
            failure: { kind: 'offline' as const },
          };
        }
        return {
          ok: true as const,
          kind: 'success' as const,
          status: 200,
          data: participantAnnouncementReadFixtures.success,
          metadata: { requestId: 'component-announcement-offline-post-0001' },
        };
      },
    );
    const api: ApiPort = {
      request: request as unknown as ApiPort['request'],
    };
    const createIdempotencyKey = vi
      .fn()
      .mockReturnValueOnce('announcement-read:offline-one')
      .mockReturnValue('announcement-read:offline-two');
    const screen = await renderComponent(
      <ParticipantAnnouncement
        announcementId={announcementFixtureIds.important}
        api={api}
        createIdempotencyKey={createIdempotencyKey}
        eventId={announcementFixtureIds.event}
      />,
    );

    await expect
      .element(screen.getByText('Přečtení zatím není uložené'))
      .toBeVisible();
    await expect.element(screen.getByRole('alert')).toHaveFocus();
    await expect
      .element(
        screen.getByRole('heading', { name: 'Hlavní vstup dočasně uzavřen' }),
      )
      .toBeVisible();
    expect(document.body.textContent).toContain('Nepřečtené');
    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);

    readOnline = true;
    await screen.getByRole('button', { name: 'Zkusit znovu' }).click();
    await expect
      .element(
        screen.getByText(
          'Oznámení bylo označené jako přečtené až po bezpečném zobrazení.',
        ),
      )
      .toBeVisible();
    expect(createIdempotencyKey).toHaveBeenCalledOnce();
    expect(new Set(idempotencyKeys)).toEqual(
      new Set(['announcement-read:offline-one']),
    );
  });

  it('does not send a read mutation for an invalid detail response', async () => {
    const invalidDetail = {
      ...participantAnnouncementDetailFixtures.unread,
      announcement: {
        ...participantAnnouncementDetailFixtures.unread!.announcement,
        id: 'not-an-opaque-uuid',
      },
    };
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (requestMethod(input, init) === 'POST') {
          throw new Error('Read mutation must not run');
        }
        return jsonResponse(
          invalidDetail,
          'component-announcement-invalid-0001',
        );
      },
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantAnnouncement
        announcementId={announcementFixtureIds.important}
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );

    await expect
      .element(screen.getByText('Oznámení se nepodařilo načíst'))
      .toBeVisible();
    expect(
      fetch.mock.calls.some(
        ([input, init]) => requestMethod(input, init) === 'POST',
      ),
    ).toBe(false);
  });

  it.each([
    [
      participantAnnouncementReadProblemFixtures.authentication!,
      'Je potřeba se přihlásit',
    ],
    [
      participantAnnouncementReadProblemFixtures.session_expired!,
      'Přihlášení vypršelo',
    ],
    [
      participantAnnouncementReadProblemFixtures.audience_denied!,
      'Oznámení není dostupné',
    ],
    [
      participantAnnouncementReadProblemFixtures.disabled!,
      'Oznámení nejsou pro tuto akci zapnutá',
    ],
  ])(
    'wipes private detail after an authoritative read revocation %#',
    async (problem, safeTitle) => {
      window.sessionStorage.setItem(
        'byzon:announcement-return:v1',
        JSON.stringify({
          eventId: announcementFixtureIds.event,
          filter: 'all',
          pageCount: 1,
          scrollY: 100,
        }),
      );
      const fetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) =>
          requestMethod(input, init) === 'POST'
            ? problemResponse(problem)
            : jsonResponse(
                participantAnnouncementDetailFixtures.unread,
                'component-announcement-revocation-get-0001',
              ),
      );
      const api = createFetchApiClient({ fetch, maxRetries: 0 });
      const screen = await renderComponent(
        <ParticipantAnnouncement
          announcementId={announcementFixtureIds.important}
          api={api}
          eventId={announcementFixtureIds.event}
        />,
      );

      await expect.element(screen.getByText(safeTitle)).toBeVisible();
      expect(document.body.textContent).not.toContain(
        'Hlavní vstup dočasně uzavřen',
      );
      expect(document.body.textContent).not.toContain(
        'Registrační pult je otevřený',
      );
      expect(
        window.sessionStorage.getItem('byzon:announcement-return:v1'),
      ).toBeNull();
    },
  );

  it('ignores an aborted read revocation from the previous detail route', async () => {
    let staleReadSignal: AbortSignal | undefined;
    let releaseStaleRead: (() => void) | undefined;
    const staleReadResponse = new Promise<Response>((resolve) => {
      releaseStaleRead = () =>
        resolve(
          problemResponse(
            participantAnnouncementReadProblemFixtures.session_expired!,
          ),
        );
    });
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (requestMethod(input, init) === 'POST') {
          staleReadSignal = init?.signal ?? undefined;
          return staleReadResponse;
        }
        const url = requestUrl(input);
        return jsonResponse(
          url.pathname.endsWith(`/${announcementFixtureIds.information}`)
            ? participantAnnouncementDetailFixtures.read
            : participantAnnouncementDetailFixtures.unread,
          'component-announcement-stale-read-0001',
        );
      },
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantAnnouncement
        announcementId={announcementFixtureIds.important}
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );
    await expect.element(screen.getByText('Ukládám přečtení…')).toBeVisible();

    await screen.rerender(
      <ParticipantAnnouncement
        announcementId={announcementFixtureIds.information}
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Bezpečnostní omezení příjezdu',
        }),
      )
      .toBeVisible();
    await vi.waitFor(() => expect(staleReadSignal?.aborted).toBe(true));

    releaseStaleRead?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Bezpečnostní omezení příjezdu',
        }),
      )
      .toBeVisible();
    expect(screen.getByText('Přihlášení vypršelo').elements()).toHaveLength(0);
  });

  it.each([
    [
      {
        ...participantAnnouncementDetailFixtures.unread!,
        eventId: announcementFixtureIds.critical,
      },
      'other event',
    ],
    [participantAnnouncementDetailFixtures.critical!, 'other announcement'],
  ])(
    'rejects a structurally valid detail for %s before rendering or marking read',
    async (detail) => {
      const fetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          if (requestMethod(input, init) === 'POST') {
            throw new Error('Mismatched detail must not mutate');
          }
          return jsonResponse(
            detail,
            'component-announcement-detail-scope-0001',
          );
        },
      );
      const api = createFetchApiClient({ fetch, maxRetries: 0 });
      const screen = await renderComponent(
        <ParticipantAnnouncement
          announcementId={announcementFixtureIds.important}
          api={api}
          eventId={announcementFixtureIds.event}
        />,
      );

      await expect
        .element(screen.getByText('Oznámení se nepodařilo načíst'))
        .toBeVisible();
      expect(document.body.textContent).not.toContain(
        detail.announcement.title,
      );
      expect(
        fetch.mock.calls.some(
          ([input, init]) => requestMethod(input, init) === 'POST',
        ),
      ).toBe(false);
    },
  );

  it('removes the previous private resource synchronously when the route key changes', async () => {
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (requestMethod(input, init) === 'POST') {
          throw new Error('Already-read fixture must not mutate');
        }
        const url = requestUrl(input);
        if (url.pathname.endsWith(`/${announcementFixtureIds.critical}`)) {
          return new Promise<Response>(() => undefined);
        }
        return jsonResponse(
          participantAnnouncementDetailFixtures.read,
          'component-announcement-resource-a-0001',
        );
      },
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantAnnouncement
        announcementId={announcementFixtureIds.information}
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Bezpečnostní omezení příjezdu',
        }),
      )
      .toBeVisible();

    await screen.rerender(
      <ParticipantAnnouncement
        announcementId={announcementFixtureIds.critical}
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );

    expect(document.body.textContent).not.toContain(
      'Bezpečnostní omezení příjezdu',
    );
    await expect
      .element(screen.getByLabelText('Načítám oznámení'))
      .toBeVisible();
  });

  it('collapses a malformed deep-link identifier before any private request', async () => {
    const fetch = vi.fn();
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantAnnouncement
        announcementId="../cizi-zaznam"
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );

    await expect
      .element(screen.getByText('Oznámení není dostupné'))
      .toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('../cizi-zaznam');
  });

  it('returns to the exact detail after authentication recovery', async () => {
    window.sessionStorage.setItem(
      'byzon:announcement-return:v1',
      JSON.stringify({
        eventId: announcementFixtureIds.event,
        filter: 'all',
        pageCount: 1,
        scrollY: 100,
      }),
    );
    const api = createFetchApiClient({
      fetch: async () =>
        problemResponse(
          participantAnnouncementReadProblemFixtures.authentication!,
        ),
      maxRetries: 0,
    });
    const screen = await renderComponent(
      <ParticipantAnnouncement
        announcementId={announcementFixtureIds.important}
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );

    await expect
      .element(screen.getByRole('link', { name: 'Přihlásit se znovu' }))
      .toHaveAttribute(
        'href',
        `/prihlaseni?mode=recovery&returnTo=${encodeURIComponent(
          `/app/oznameni/${announcementFixtureIds.important}`,
        )}`,
      );
    expect(
      window.sessionStorage.getItem('byzon:announcement-return:v1'),
    ).toBeNull();
  });

  it('carries validated filter and page depth back from a detail', async () => {
    window.history.replaceState(
      {},
      '',
      `/app/oznameni/${announcementFixtureIds.information}?returnView=unread&returnPages=2`,
    );
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (requestMethod(input, init) === 'POST') {
          throw new Error('Already-read detail must not mutate');
        }
        return jsonResponse(
          participantAnnouncementDetailFixtures.read,
          'component-announcement-return-link-0001',
        );
      },
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantAnnouncement
        announcementId={announcementFixtureIds.information}
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );

    await expect
      .element(screen.getByRole('link', { name: 'Zpět na oznámení' }))
      .toHaveAttribute('href', '/app/oznameni?view=unread&restorePages=2');
  });

  it('builds the session context and direct-deep-link fallback locally', async () => {
    const readResponse = {
      ...participantAnnouncementReadFixtures.success!,
      announcementId: announcementFixtureIds.critical,
    };
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      requestMethod(input, init) === 'POST'
        ? jsonResponse(readResponse, 'component-announcement-read-0003')
        : jsonResponse(
            participantAnnouncementDetailFixtures.critical,
            'component-announcement-detail-0003',
          ),
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantAnnouncement
        announcementId={announcementFixtureIds.critical}
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );

    await expect
      .element(screen.getByText('Týká se bodu programu'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Otevřít bod v programu' }))
      .toHaveAttribute(
        'href',
        `/app/program/${announcementFixtureIds.session}`,
      );
    await expect
      .element(screen.getByRole('link', { name: 'Zpět na oznámení' }))
      .toHaveAttribute('href', '/app/oznameni');
  });

  it('does not repeat a read mutation for an already-read detail', async () => {
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (requestMethod(input, init) === 'POST') {
          throw new Error('Already-read detail must not mutate');
        }
        return jsonResponse(
          participantAnnouncementDetailFixtures.read,
          'component-announcement-detail-0004',
        );
      },
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantAnnouncement
        announcementId={announcementFixtureIds.information}
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );

    await expect
      .element(
        screen.getByText('Toto oznámení už bylo označené jako přečtené.'),
      )
      .toBeVisible();
    expect(
      fetch.mock.calls.some(
        ([input, init]) => requestMethod(input, init) === 'POST',
      ),
    ).toBe(false);
  });

  it('wraps long Czech content without horizontal overflow', async () => {
    const readResponse = {
      ...participantAnnouncementReadFixtures.success!,
      announcementId:
        participantAnnouncementDetailFixtures.long_content!.announcement.id,
    };
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      requestMethod(input, init) === 'POST'
        ? jsonResponse(readResponse, 'component-announcement-read-0005')
        : jsonResponse(
            participantAnnouncementDetailFixtures.long_content,
            'component-announcement-detail-0005',
          ),
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <ParticipantAnnouncement
        announcementId={
          participantAnnouncementDetailFixtures.long_content!.announcement.id
        }
        api={api}
        eventId={announcementFixtureIds.event}
      />,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: participantAnnouncementDetailFixtures.long_content!.announcement
            .title,
        }),
      )
      .toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });
});
