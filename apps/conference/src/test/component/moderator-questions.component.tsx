import type { CSSProperties } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  HostQuestionSessions,
  ModeratorFeed,
} from '../../components/host-questions';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';
import '../../app/styles.css';
const eventId = '019fa200-0000-7000-8000-000000000001',
  sessionId = '019fa200-0000-7000-8000-000000000002',
  now = '2026-09-18T09:30:00.000Z';
afterEach(() => vi.unstubAllGlobals());
it('drains multiple pages, keeps chronological questions and wipes on revoked access', async () => {
  let denied = false;
  const questions = Array.from({ length: 125 }, (_, i) => ({
    questionId: `019fa200-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
    authorName: `Účastník ${i + 1}`,
    text: `Dotaz číslo ${i + 1}`,
    submittedAt: now,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      if (denied)
        return Response.json(
          { code: 'EVENT_ACCESS_DENIED', detail: 'Odebráno' },
          { status: 403 },
        );
      const url = new URL(String(input), 'https://app.byzon.test');
      if (url.pathname.endsWith('question-context'))
        return Response.json({
          eventId,
          serverTime: now,
          session: {
            id: sessionId,
            title: 'Leadership',
            startsAt: now,
            endsAt: '2026-09-18T10:00:00.000Z',
            roomName: 'Stage',
          },
          state: 'open',
          canSubmit: true,
          canReadOwn: true,
        });
      const cursor = url.searchParams.get('cursor');
      const items = questions
        .filter((q) => !cursor || q.questionId > cursor)
        .slice(0, 100);
      return Response.json({
        eventId,
        sessionId,
        serverTime: now,
        items,
        nextCursor: items.at(-1)?.questionId ?? null,
        pollAfterMs: 5000,
      });
    }),
  );
  const screen = await renderComponent(
    <main>
      <ModeratorFeed eventId={eventId} sessionId={sessionId} />
    </main>,
  );
  await expect
    .element(screen.getByText('Dotaz číslo 125', { exact: true }))
    .toBeVisible();
  expect(screen.getByRole('listitem').elements()).toHaveLength(125);
  await expectComponentToPassAxe(screen.container);
  denied = true;
  await screen.getByRole('button', { name: 'Obnovit dotazy' }).click();
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Soukromé dotazy byly odstraněny');
  expect(screen.getByRole('listitem').elements()).toHaveLength(0);
});

it('keeps assigned talks readable and fully linked at every viewport', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        eventId,
        serverTime: now,
        sessions: [
          {
            id: sessionId,
            title:
              'Jak vést tým a přitom neztratit motivaci ani v náročných situacích',
            startsAt: now,
            endsAt: '2026-09-18T10:00:00.000Z',
            roomName: 'Leadership Stage',
            state: 'open',
            questionCount: 12,
            unansweredCount: 0,
          },
        ],
      }),
    ),
  );
  const screen = await renderComponent(
    <main
      style={
        {
          '--byzon-font-body': 'Arial, sans-serif',
          '--byzon-font-display': 'Arial, sans-serif',
          fontFamily: 'Arial, sans-serif',
        } as CSSProperties
      }
    >
      <HostQuestionSessions eventId={eventId} kind="moderator" />
    </main>,
  );
  const sessionLink = screen.getByRole('link', { name: /Jak vést tým/ });
  await expect
    .element(sessionLink)
    .toHaveAttribute('href', `/host/moderace/${sessionId}`);
  await expect.element(screen.getByText('Dotazy: 12')).toBeVisible();
  const heading = screen
    .getByRole('heading', { name: 'Moderování', exact: true })
    .element();
  expect(
    Number.parseFloat(getComputedStyle(heading).fontSize),
  ).toBeLessThanOrEqual(40);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    window.innerWidth,
  );
  const cardBounds = sessionLink.element().getBoundingClientRect();
  expect(cardBounds.width).toBeGreaterThanOrEqual(44);
  expect(cardBounds.height).toBeGreaterThanOrEqual(44);
  await expectComponentToPassAxe(screen.container);
  await screen
    .getByRole('heading', { name: 'Moderování', exact: true })
    .hover();
  await expect
    .element(screen.getByRole('main'))
    .toMatchScreenshot('moderation-sessions');
});

it('updates answered questions, merges original wording and confirms deletion', async () => {
  const first = '019fa200-0000-7000-8000-000000000010';
  const second = '019fa200-0000-7000-8000-000000000011';
  type Item = {
    questionId: string;
    authorName: string;
    text: string;
    submittedAt: string;
    answeredAt: string | null;
    moderationVersion: number;
    originals: Array<{
      questionId: string;
      authorName: string;
      text: string;
      submittedAt: string;
    }>;
  };
  let items: Item[] = [
    {
      questionId: first,
      authorName: 'Jana',
      text: 'Jak začít s vedením týmu?',
      submittedAt: now,
      answeredAt: null,
      moderationVersion: 1,
      originals: [],
    },
    {
      questionId: second,
      authorName: 'Petr',
      text: 'Jak získat důvěru nového týmu?',
      submittedAt: now,
      answeredAt: null,
      moderationVersion: 1,
      originals: [],
    },
  ];
  const mutations: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://app.byzon.test');
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(new Headers(init.headers).get('idempotency-key')).toBeTruthy();
        mutations.push(body.action);
        const target = items.find(
          (item) => item.questionId === body.questionId,
        )!;
        if (body.action === 'answer')
          target.answeredAt = body.answered ? now : null;
        if (body.action === 'merge') {
          const source = items.find(
            (item) => item.questionId === body.sourceId,
          )!;
          target.originals.push({
            questionId: source.questionId,
            authorName: source.authorName,
            text: source.text,
            submittedAt: source.submittedAt,
          });
          target.answeredAt = null;
          items = items.filter((item) => item !== source);
        }
        if (body.action === 'delete')
          items = items.filter((item) => item !== target);
        target.moderationVersion += 1;
        return Response.json({ questionId: target.questionId });
      }
      if (url.pathname.endsWith('question-context'))
        return Response.json({
          eventId,
          serverTime: now,
          session: {
            id: sessionId,
            title: 'Dotazy k vedení týmu',
            startsAt: now,
            endsAt: '2026-09-18T10:00:00.000Z',
            roomName: 'Stage',
          },
          state: 'open',
          canSubmit: true,
          canReadOwn: true,
        });
      return Response.json({
        eventId,
        sessionId,
        serverTime: now,
        items: url.searchParams.has('cursor') ? [] : items,
        nextCursor: null,
        pollAfterMs: 5000,
      });
    }),
  );
  const screen = await renderComponent(
    <main>
      <ModeratorFeed eventId={eventId} sessionId={sessionId} />
    </main>,
  );
  await expect
    .element(screen.getByText('Jak začít s vedením týmu?', { exact: true }))
    .toBeVisible();
  await screen
    .getByRole('button', { name: 'Označit jako zodpovězenou' })
    .first()
    .click();
  await expect
    .element(screen.getByText('Zodpovězeno na konferenci', { exact: true }))
    .toBeVisible();
  await screen
    .getByRole('checkbox', {
      name: 'Vybrat ke sloučení: Jak začít s vedením týmu?',
    })
    .click();
  await screen
    .getByRole('checkbox', {
      name: 'Vybrat ke sloučení: Jak získat důvěru nového týmu?',
    })
    .click();
  await screen.getByRole('button', { name: 'Sloučit vybrané otázky' }).click();
  await expect
    .poll(() => screen.getByRole('listitem').elements().length)
    .toBe(1);
  await expect
    .element(
      screen.getByText('Jak získat důvěru nového týmu?', { exact: true }),
    )
    .toBeVisible();
  await expectComponentToPassAxe(screen.container);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    window.innerWidth,
  );
  await screen
    .getByRole('button', { name: 'Smazat otázku', exact: true })
    .click();
  expect(mutations).toEqual(['answer', 'merge']);
  await screen.getByRole('button', { name: 'Zrušit', exact: true }).click();
  expect(mutations).toEqual(['answer', 'merge']);
  await screen
    .getByRole('button', { name: 'Smazat otázku', exact: true })
    .click();
  await screen.getByRole('button', { name: 'Potvrdit smazání' }).click();
  await expect
    .element(screen.getByText('Zatím nebyl odeslán žádný dotaz.'))
    .toBeVisible();
  expect(mutations).toEqual(['answer', 'merge', 'delete']);
});
