import { expect, it, vi } from 'vitest';
import '../../app/styles.css';
import { EventRating } from '../../components/live-interactions';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

it('submits a conference rating without a session and shows the saved result', async () => {
  const eventId = '22222222-2222-4222-8222-222222222222';
  const fetcher = vi.fn<typeof fetch>(
    async (_url, init) =>
      new Response(
        JSON.stringify(
          init?.method === 'POST'
            ? {
                ratingId: '33333333-3333-4333-8333-333333333333',
                eventId,
                sessionId: null,
                targetType: 'event',
                completed: true,
                submittedAt: new Date().toISOString(),
              }
            : {
                eventId,
                sessionId: null,
                targetType: 'event',
                completed: false,
              },
        ),
        {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'event-rating-test',
          },
        },
      ),
  );
  const screen = await renderComponent(
    <EventRating
      api={createFetchApiClient({ fetch: fetcher })}
      endsAt="2020-01-01T00:00:00Z"
    />,
  );
  await screen.getByRole('combobox', { name: 'Hodnocení' }).selectOptions('4');
  await screen
    .getByRole('textbox', { name: 'Volitelný komentář' })
    .fill('Díky za konferenci.');
  await expectComponentToPassAxe(screen.container);
  await screen.getByRole('button', { name: 'Odeslat hodnocení' }).click();
  await expect
    .element(screen.getByRole('status'))
    .toHaveTextContent('Děkujeme, vaše hodnocení už je uložené.');
  expect(String(fetcher.mock.calls[0]![0])).toContain('targetType=event');
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({
    targetType: 'event',
    score: 4,
    comment: 'Díky za konferenci.',
  });
  expect(new Headers(post?.[1]?.headers).get('idempotency-key')).toBeTruthy();
});
