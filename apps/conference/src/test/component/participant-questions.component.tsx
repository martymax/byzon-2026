import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParticipantQuestionPanel } from '../../components/participant-questions';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';
import '../../app/styles.css';
const eventId = '019fa200-0000-7000-8000-000000000001';
const sessionId = '019fa200-0000-7000-8000-000000000002';
const questionId = '019fa200-0000-7000-8000-000000000003';
const now = '2026-09-18T09:30:00.000Z';
afterEach(() => vi.unstubAllGlobals());
describe('private participant questions', () => {
  it('preserves the draft and idempotency key through a lost response', async () => {
    const keys: string[] = [];
    let accepted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        const path = String(input);
        if (path.includes('question-context'))
          return Response.json({
            eventId,
            serverTime: now,
            session: {
              id: sessionId,
              title: 'Vedení týmu',
              startsAt: '2026-09-18T09:00:00.000Z',
              endsAt: '2026-09-18T10:00:00.000Z',
              roomName: 'Leadership Stage',
            },
            state: 'open',
            canSubmit: true,
            canReadOwn: true,
          });
        if (path.includes('/me/questions'))
          return Response.json({
            eventId,
            serverTime: now,
            items: accepted
              ? [
                  {
                    questionId,
                    sessionId,
                    sessionTitle: 'Vedení týmu',
                    text: 'Jak začít?',
                    submittedAt: now,
                    answer: null,
                  },
                ]
              : [],
            nextCursor: null,
          });
        keys.push(new Headers(options?.headers).get('idempotency-key')!);
        accepted = true;
        if (keys.length === 1) throw new TypeError('lost response');
        return Response.json({ questionId, sessionId, submittedAt: now });
      }),
    );
    const screen = await renderComponent(
      <main>
        <ParticipantQuestionPanel eventId={eventId} sessionId={sessionId} />
      </main>,
    );
    await screen.getByRole('textbox', { name: 'Váš dotaz' }).fill('Jak začít?');
    await Promise.all(
      screen.container.getAnimations({ subtree: true }).map((a) => a.finished),
    );
    await expectComponentToPassAxe(screen.container);
    await screen.getByRole('button', { name: 'Odeslat dotaz' }).click();
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('Spojení bylo přerušeno');
    await expect
      .element(screen.getByRole('textbox', { name: 'Váš dotaz' }))
      .toHaveValue('Jak začít?');
    await screen.getByRole('button', { name: 'Odeslat dotaz' }).click();
    await expect
      .element(screen.getByText('Dotaz byl odeslán moderátorovi.'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('textbox', { name: 'Váš dotaz' }))
      .toHaveValue('');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
  it('clears loaded private history when the next request loses authorization', async () => {
    let denied = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        denied
          ? Response.json(
              { code: 'EVENT_ACCESS_DENIED', detail: 'Přístup odebrán' },
              { status: 403 },
            )
          : Response.json({
              eventId,
              serverTime: now,
              items: [
                {
                  questionId,
                  sessionId,
                  sessionTitle: 'Vedení týmu',
                  text: 'Soukromý dotaz',
                  submittedAt: now,
                  answer: {
                    id: questionId,
                    text: 'Soukromá odpověď',
                    speakerName: 'Dana',
                    publishedAt: now,
                    updatedAt: now,
                    version: 1,
                  },
                },
              ],
              nextCursor: null,
            }),
      ),
    );
    const screen = await renderComponent(
      <main>
        <ParticipantQuestionPanel eventId={eventId} />
      </main>,
    );
    await expect.element(screen.getByText('Soukromá odpověď')).toBeVisible();
    denied = true;
    window.dispatchEvent(new Event('online'));
    await expect
      .element(screen.getByText('Soukromý obsah byl odstraněn ze stránky.'))
      .toBeVisible();
    expect(screen.getByText('Soukromý dotaz').elements()).toHaveLength(0);
    expect(screen.getByText('Soukromá odpověď').elements()).toHaveLength(0);
  });
});
