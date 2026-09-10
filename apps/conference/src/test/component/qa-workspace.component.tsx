import type { CSSProperties, ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { participantProgramFixtures } from '@byzon/test-support/fixtures';
import { ParticipantQuestionPanel } from '../../components/participant-questions';
import { ModeratorFeed } from '../../components/host-questions';
import { SpeakerQuestionPanel } from '../../components/speaker-questions';
import { SessionView } from '../../components/program-view';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';
import '../../app/styles.css';

const eventId = '019fa200-0000-7000-8000-000000000001';
const sessionId = '019fa200-0000-7000-8000-000000000002';
const first = '019fa200-0000-7000-8000-000000000010';
const second = '019fa200-0000-7000-8000-000000000011';
const now = '2026-09-18T09:30:00.000Z';
const session = {
  id: sessionId,
  title: 'Jak vést tým a neztratit důvěru lidí',
  roomName: 'Leadership Stage',
  startsAt: now,
  endsAt: '2026-09-18T10:00:00.000Z',
};
const context = {
  eventId,
  session,
  serverTime: now,
  state: 'open',
  canSubmit: true,
  canReadOwn: true,
};
const question = {
  questionId: first,
  text: 'Jak získat důvěru týmu, když přicházím jako nový vedoucí?',
  submittedAt: now,
};
const answer = {
  id: second,
  text: 'Začněte rozhovory s každým členem týmu. Ptejte se, co funguje a co potřebují změnit.',
  speakerName: 'Jana Nováková',
  publishedAt: now,
  updatedAt: now,
  version: 1,
};
const Frame = ({ children }: { children: ReactNode }) => (
  <main
    className="app-page"
    style={
      {
        '--byzon-font-body': 'Arial, sans-serif',
        '--byzon-font-display': 'Arial, sans-serif',
        fontFamily: 'Arial, sans-serif',
      } as CSSProperties
    }
  >
    {children}
  </main>
);
const fit = () =>
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    window.innerWidth,
  );
afterEach(() => vi.unstubAllGlobals());

it('places the question entry before the long talk description and changes it when collection closes', async () => {
  const fixture = structuredClone(participantProgramFixtures.happy!);
  const talk = fixture.program.sessions.find((item) => item.type === 'talk')!;
  talk.summary = 'Praktické kroky pro vedení nového týmu.';
  talk.description = 'Podrobný popis přednášky. '.repeat(30);
  let open = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...context,
        eventId: fixture.eventId,
        session: { ...session, id: talk.id },
        canSubmit: open,
        state: open ? 'open' : 'closed',
      }),
    ),
  );
  const api = createFetchApiClient({
    maxRetries: 0,
    fetch: async () =>
      Response.json(fixture, { headers: { 'x-request-id': 'qa-detail-test' } }),
  });
  const screen = await renderComponent(
    <Frame>
      <SessionView api={api} eventId={fixture.eventId} sessionId={talk.id} />
    </Frame>,
  );
  const link = screen.getByRole('link', { name: 'Položit dotaz', exact: true });
  await expect
    .element(link)
    .toHaveAttribute('href', `/app/interakce/${talk.id}`);
  const description = screen
    .getByText('Praktické kroky pro vedení nového týmu.')
    .element();
  expect(
    link.element().compareDocumentPosition(description) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fit();
  await expectComponentToPassAxe(screen.container);
  await expect
    .element(screen.getByRole('region', { name: 'Dotazy k přednášce' }))
    .toMatchScreenshot('qa-entry');
  open = false;
  window.dispatchEvent(new Event('online'));
  await expect
    .element(screen.getByRole('link', { name: 'Moje dotazy a odpovědi' }))
    .toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Položit dotaz', exact: true }).elements(),
  ).toHaveLength(0);
});

it('keeps a closed participant workspace readable with a private answer and no unusable form', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      Response.json(
        String(input).includes('question-context')
          ? { ...context, state: 'closed', canSubmit: false }
          : {
              eventId,
              serverTime: now,
              nextCursor: null,
              items: [
                {
                  ...question,
                  sessionId,
                  sessionTitle: session.title,
                  answeredAt: now,
                  answer,
                },
              ],
            },
      ),
    ),
  );
  const screen = await renderComponent(
    <Frame>
      <ParticipantQuestionPanel eventId={eventId} sessionId={sessionId} />
    </Frame>,
  );
  await expect.element(screen.getByText(answer.text)).toBeVisible();
  expect(screen.getByRole('textbox').elements()).toHaveLength(0);
  await expect
    .element(screen.getByText('Písemně zodpovězeno', { exact: true }))
    .toBeVisible();
  fit();
  await expectComponentToPassAxe(screen.container);
  await expect
    .element(screen.getByRole('main'))
    .toMatchScreenshot('qa-participant');
});

it('keeps speaker editors collapsed and shows a useful empty filter', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        eventId,
        session,
        serverTime: now,
        nextCursor: null,
        items: [{ ...question, answeredAt: now, answer: null, canEdit: false }],
      }),
    ),
  );
  const screen = await renderComponent(
    <Frame>
      <SpeakerQuestionPanel eventId={eventId} sessionId={sessionId} />
    </Frame>,
  );
  await expect.element(screen.getByText(question.text)).toBeVisible();
  await expect
    .element(screen.getByText('Zodpovězeno na konferenci', { exact: true }))
    .toBeVisible();
  expect(
    screen.getByRole('textbox', { name: 'Vaše písemná odpověď' }).elements(),
  ).toHaveLength(0);
  await screen.getByText('Napsat soukromou odpověď', { exact: true }).click();
  await screen
    .getByRole('textbox', { name: 'Vaše písemná odpověď' })
    .fill('Můj rozepsaný návrh odpovědi.');
  await screen
    .getByRole('button', { name: 'S písemnou odpovědí (0)', exact: true })
    .click();
  await expect
    .element(screen.getByText('V tomto filtru nejsou žádné dotazy.'))
    .toBeVisible();
  await screen
    .getByRole('button', { name: 'Bez písemné odpovědi (1)', exact: true })
    .click();
  // Filtering must preserve drafts, including when a filter has no matching rows.
  await expect
    .element(screen.getByRole('textbox', { name: 'Vaše písemná odpověď' }))
    .toHaveValue('Můj rozepsaný návrh odpovědi.');
  fit();
  await expectComponentToPassAxe(screen.container);
  await expect
    .element(screen.getByRole('main'))
    .toMatchScreenshot('qa-speaker');
});

it.each([false, true])(
  'filters questions and confirms the exact deletion (admin=%s)',
  async (embedded) => {
    const items = [
      {
        ...question,
        authorName: 'Petr Novák',
        answeredAt: null,
        moderationVersion: 1,
        originals: [],
      },
      {
        ...question,
        questionId: second,
        text: 'Jak poznám, že moje změny týmu opravdu pomáhají?',
        authorName: 'Jana Malá',
        answeredAt: now,
        moderationVersion: 1,
        originals: [],
      },
    ];
    const mutations = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        if (options?.method === 'POST') {
          mutations();
          return Response.json({ questionId: first });
        }
        return Response.json(
          String(input).includes('question-context')
            ? context
            : {
                eventId,
                sessionId,
                serverTime: now,
                items,
                nextCursor: null,
                pollAfterMs: 5000,
              },
        );
      }),
    );
    const screen = await renderComponent(
      <Frame>
        {embedded ? (
          <>
            <h1>Administrace</h1>
            <h2>Interakce</h2>
          </>
        ) : null}
        <ModeratorFeed
          eventId={eventId}
          sessionId={sessionId}
          embedded={embedded}
        />
      </Frame>,
    );
    await expect.element(screen.getByText(question.text)).toBeVisible();
    await screen
      .getByRole('button', { name: 'Zodpovězené (1)', exact: true })
      .click();
    expect(
      screen.getByText(question.text, { exact: true }).elements(),
    ).toHaveLength(0);
    await screen
      .getByRole('button', { name: 'Všechny (2)', exact: true })
      .click();
    fit();
    await expectComponentToPassAxe(screen.container);
    await expect
      .element(screen.getByRole('main'))
      .toMatchScreenshot(embedded ? 'qa-admin' : 'qa-moderator');
    await screen
      .getByRole('button', { name: 'Smazat otázku', exact: true })
      .first()
      .click();
    const dialog = screen.getByRole('dialog', { name: 'Smazat otázku?' });
    await expect.element(dialog).toBeVisible();
    await expect
      .element(dialog.getByText(question.text, { exact: true }))
      .toBeVisible();
    expect(mutations).not.toHaveBeenCalled();
    await expectComponentToPassAxe(screen.container);
    await expect
      .element(dialog)
      .toMatchScreenshot(embedded ? 'qa-admin-delete' : 'qa-moderator-delete');
    await dialog.getByRole('button', { name: 'Zrušit', exact: true }).click();
    expect(mutations).not.toHaveBeenCalled();
  },
);
