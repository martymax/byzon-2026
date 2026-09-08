import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../app/styles.css';
import { AdminContentWorkspace } from '../../components/admin-content-workspace';
import { createFetchAdminContentPort } from '../../lib/admin-content-api';
import { createAdminContentPreviewPort } from '../../lib/admin-content-preview-port';
import { AdminSessionQr } from '../../components/admin-session-qr';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { SessionRating } from '../../components/live-interactions';
import { renderComponent } from './render';

const sessionId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('session QR and rating', () => {
  it('explains that rating opens after the talk ends', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const screen = await renderComponent(
      <SessionRating
        sessionId={sessionId}
        endsAt={new Date(Date.now() + 60_000).toISOString()}
        explicit
      />,
    );
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('Hodnocení se otevře po skončení přednášky');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows confirmation for an already rated talk', async () => {
    const api = createFetchApiClient({
      fetch: async () =>
        new Response(
          JSON.stringify({
            eventId,
            targetType: 'session',
            sessionId,
            completed: true,
          }),
          {
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'qr-test-request',
            },
          },
        ),
    });
    const screen = await renderComponent(
      <SessionRating
        api={api}
        sessionId={sessionId}
        endsAt="2020-01-01T00:00:00Z"
        explicit
      />,
    );
    await expect
      .element(screen.getByRole('status'))
      .toHaveTextContent('Děkujeme, vaše hodnocení už je uložené.');
  });
});

it('submits the selected rating and keeps a visible confirmation', async () => {
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Response(
        JSON.stringify(
          init?.method === 'POST'
            ? {
                ratingId: '33333333-3333-4333-8333-333333333333',
                eventId,
                sessionId,
                targetType: 'session',
                completed: true,
                submittedAt: new Date().toISOString(),
              }
            : { eventId, sessionId, targetType: 'session', completed: false },
        ),
        {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'qr-test-request',
          },
        },
      ),
  );
  const screen = await renderComponent(
    <SessionRating
      api={createFetchApiClient({ fetch: fetcher })}
      sessionId={sessionId}
      endsAt="2020-01-01T00:00:00Z"
      explicit
    />,
  );
  await screen.getByRole('combobox', { name: 'Hodnocení' }).selectOptions('4');
  await screen
    .getByRole('textbox', { name: 'Volitelný komentář' })
    .fill('Díky za přednášku.');
  await screen.getByRole('button', { name: 'Odeslat hodnocení' }).click();
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('Děkujeme, vaše hodnocení už je uložené.');
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
    sessionId,
    score: 4,
    comment: 'Díky za přednášku.',
  });
});

it.each(['program', 'questions', 'rating'] as const)(
  'offers PNG and SVG in the %s QR preview',
  async (target) => {
    const screen = await renderComponent(
      <div data-admin-root="">
        <AdminSessionQr
          eventId={eventId}
          sessionId={sessionId}
          title="Přednáška"
          target={target}
        />
      </div>,
    );
    await screen.getByRole('button').click();
    const dialog = screen.getByRole('dialog', { name: 'Přednáška' });
    for (const format of ['PNG', 'SVG']) {
      await expect
        .element(dialog.getByRole('link', { name: `Stáhnout ${format}` }))
        .toHaveAttribute(
          'href',
          expect.stringContaining(
            `target=${target}&format=${format.toLowerCase()}`,
          ),
        );
    }
  },
);

it('shows Q&A QR only for supported sessions after the real API response parser', async () => {
  const base = createAdminContentPreviewPort({ eventId });
  const live = createFetchAdminContentPort(async () => {
    const result = await base.list(eventId, 'sessions');
    if (!result.ok) throw new Error('Missing session fixture');
    return Response.json(
      {
        resource: 'sessions',
        requestId: 'session-qr-test',
        items: [
          { ...result.data.items[0], questionMode: 'moderated_follow_up' },
          {
            ...result.data.items[0],
            id: sessionId,
            title: 'Registrace',
            questionMode: 'disabled',
          },
        ],
      },
      { headers: { 'x-request-id': 'session-qr-test' } },
    );
  });
  const screen = await renderComponent(
    <AdminContentWorkspace
      eventId={eventId}
      timezone="Europe/Prague"
      port={{
        ...base,
        list: (id, resource, signal) =>
          resource === 'sessions'
            ? live.list(id, resource, signal)
            : base.list(id, resource, signal),
      }}
    />,
  );
  const qa = screen.getByRole('button', {
    name: 'Zobrazit Q&A QR: Otevření konference',
  });
  await expect.element(qa).toBeVisible();
  await expect
    .element(
      screen.getByRole('button', { name: 'Zobrazit QR programu: Registrace' }),
    )
    .toBeVisible();
  await expect
    .element(
      screen.getByRole('button', { name: 'Zobrazit Q&A QR: Registrace' }),
    )
    .not.toBeInTheDocument();
  await qa.click();
  await expect
    .element(
      screen.getByRole('dialog').getByRole('link', { name: 'Stáhnout PNG' }),
    )
    .toHaveAttribute(
      'href',
      expect.stringContaining('target=questions&format=png'),
    );
});
