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
