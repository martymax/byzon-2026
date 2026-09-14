import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../../app/styles.css';
import { TimelessTestSettings } from '../../components/timeless-test-settings';
import {
  ParticipantSessionContextProvider,
  ParticipantAdminNotice,
} from '../../components/participant-session-context';
import { EventRating } from '../../components/event-survey';
import { SessionRating } from '../../components/live-interactions';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { expectComponentToPassAxe } from './accessibility';
import { page, renderComponent } from './render';

beforeEach(() => {
  document.documentElement.style.setProperty('--font-inter', 'Arial');
  document.documentElement.style.setProperty('--font-khand', 'Arial');
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty('--font-inter');
  document.documentElement.style.removeProperty('--font-khand');
});

it('hides the switch from ordinary participants', async () => {
  await renderComponent(
    <ParticipantSessionContextProvider
      value={{ isAdmin: false, isParticipant: true }}
    >
      <TimelessTestSettings />
    </ParticipantSessionContextProvider>,
  );
  await expect
    .element(
      page.getByRole('heading', { name: 'Testování časově omezených funkcí' }),
    )
    .not.toBeInTheDocument();
});

it('shows scope and real-write notice; enables with one request and reports errors', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 403 }))
    .mockResolvedValueOnce(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const applied = vi.fn();
  await renderComponent(
    <ParticipantSessionContextProvider
      value={{ isAdmin: true, isParticipant: true, timelessTestMode: false }}
    >
      <TimelessTestSettings onApplied={applied} />
    </ParticipantSessionContextProvider>,
  );
  const button = page.getByRole('button', { name: 'Zapnout testovací režim' });
  await expectComponentToPassAxe(document.body);
  await page.screenshot({
    path: `test-results/timeless-settings-${window.innerWidth}.png`,
  });
  await button.click();
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Změna se nepodařila.');
  expect(applied).not.toHaveBeenCalled();
  await button.click();
  await expect.poll(() => applied.mock.calls.length).toBe(1);
  expect(fetchMock.mock.calls[1]?.[1].body).toBe('{"enabled":true}');
});

it('shows active mode throughout the app and can disable it', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  await renderComponent(
    <ParticipantSessionContextProvider
      value={{ isAdmin: true, isParticipant: true, timelessTestMode: true }}
    >
      <ParticipantAdminNotice />
      <TimelessTestSettings onApplied={vi.fn()} />
    </ParticipantSessionContextProvider>,
  );
  await expect
    .element(page.getByRole('complementary'))
    .toHaveTextContent('Časová omezení pro váš účet neplatí');
  const button = page.getByRole('button', { name: 'Vypnout testovací režim' });
  await expect.element(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  expect(fetchMock.mock.calls[0]?.[1].body).toBe('{"enabled":false}');
});

it('loads conference and session ratings before their end in authorized context', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://app.example.test');
    const targetType = url.searchParams.get('targetType');
    return new Response(
      JSON.stringify({
        eventId: '22222222-2222-4222-8222-222222222222',
        targetType,
        sessionId:
          targetType === 'session'
            ? '33333333-3333-4333-8333-333333333333'
            : null,
        completed: false,
        ...(targetType === 'event' ? { surveyProgram: null } : {}),
      }),
      {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'timeless-ui-test',
        },
      },
    );
  });
  const api = createFetchApiClient({ fetch: fetchMock });
  await renderComponent(
    <ParticipantSessionContextProvider
      value={{ isAdmin: true, isParticipant: true, timelessTestMode: true }}
    >
      <EventRating endsAt="2099-09-19T20:00:00Z" api={api} />
      <SessionRating
        sessionId="33333333-3333-4333-8333-333333333333"
        endsAt="2099-09-18T11:00:00Z"
        api={api}
        explicit
      />
    </ParticipantSessionContextProvider>,
  );
  await expect
    .element(page.getByRole('button', { name: 'Pokračovat' }))
    .toBeVisible();
  await expect
    .element(page.getByRole('heading', { name: 'Ohodnotit přednášku' }))
    .toBeVisible();
});
