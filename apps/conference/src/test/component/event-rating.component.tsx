import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../../app/styles.css';
import { EventRating } from '../../components/event-survey';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { invalidateParticipantPrivateResources } from '../../lib/private-resource-events';
import { expectComponentToPassAxe } from './accessibility';
import { page, renderComponent } from './render';

// The Next font classes are not loaded in the isolated component iframe.
beforeEach(() => {
  document.documentElement.style.setProperty('--font-inter', 'Arial');
  document.documentElement.style.setProperty('--font-khand', 'Arial');
});
afterEach(() => {
  document.documentElement.style.removeProperty('--font-inter');
  document.documentElement.style.removeProperty('--font-khand');
});

const eventId = '22222222-2222-4222-8222-222222222222';
const talkId = '44444444-4444-4444-8444-444444444444';
const workshopId = '55555555-5555-4555-8555-555555555555';
const program = {
  version: 7,
  sessions: [
    {
      id: talkId,
      title: 'Letošní přednáška',
      stage: 'BYZON stage',
      day: '2026-09-18',
      speakers: ['Jana Nová'],
      type: 'talk',
    },
    {
      id: workshopId,
      title: 'Letošní workshop',
      stage: 'Workshop zóna',
      day: '2026-09-19',
      speakers: ['Petr Nový'],
      type: 'workshop',
    },
  ],
};
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type':
        status >= 400 ? 'application/problem+json' : 'application/json',
      'x-request-id': 'event-rating-test',
    },
  });
const saved = () =>
  response({
    ratingId: '33333333-3333-4333-8333-333333333333',
    eventId,
    sessionId: null,
    targetType: 'event',
    completed: true,
    submittedAt: new Date().toISOString(),
  });
const ready = (completed = false) =>
  response({
    eventId,
    sessionId: null,
    targetType: 'event',
    completed,
    surveyProgram: program,
  });
const setup = async (
  fetcher = vi.fn<typeof fetch>(async (_url, init) =>
    init?.method === 'POST' ? saved() : ready(),
  ),
) => {
  const screen = await renderComponent(
    <EventRating
      api={createFetchApiClient({ fetch: fetcher })}
      endsAt="2020-01-01T00:00:00Z"
    />,
  );
  return { screen, fetcher };
};
const next = () =>
  page.getByRole('button', { name: 'Pokračovat', exact: true }).click();
const choose = (label: string, choice: string) =>
  page
    .getByRole('group', { name: label, exact: true })
    .getByRole('radio', { name: choice, exact: true })
    .click();
const throughBasics = async () => {
  await next();
  await next();
  await choose('Využili jste koučovací zónu? (povinné)', 'Ne');
  await choose(
    'Zúčastnili jste se workshopů nebo extra tréninků? (povinné)',
    'Ne',
  );
  await next();
  await choose('Jak hodnotíte oběd? (povinné)', 'Oběd jsem nevyužil/a');
  await choose('Jak hodnotíte coffee breaky? (povinné)', 'Spokojen/a');
  await choose('Jak hodnotíte networking? (povinné)', 'Spíše spokojen/a');
  await next();
};
const finish = async () => {
  await choose(
    'Jak hodnotíte web konference byzon.cz? (povinné)',
    'Spíše spokojen/a',
  );
  await choose('Jak hodnotíte účastnickou appku? (povinné)', 'Spokojen/a');
  await next();
  await next();
  await choose(
    'Jak hodnotíte organizaci před konferencí? (povinné)',
    'Spokojen/a',
  );
  await choose(
    'Jak hodnotíte organizaci během konference? (povinné)',
    'Spíše spokojen/a',
  );
  await choose('Jak hodnotíte konferenci celkově? (povinné)', 'Velmi dobrá');
  await choose('Dorazíte na další ročník (2021)? (povinné)', 'Určitě ano');
};

it('submits the full survey with separate web/app ratings, published talks and conditional workshops', async () => {
  const { screen, fetcher } = await setup();
  await expect
    .element(
      page.getByText('Odpověď se ukládá k vašemu účtu', { exact: false }),
    )
    .toBeVisible();
  await expectComponentToPassAxe(screen.container);
  await next();
  await page.getByText('BYZON stage', { exact: false }).click();
  await choose('Letošní přednáška (volitelné)', 'Spokojen/a');
  await next();
  await choose('Využili jste koučovací zónu? (povinné)', 'Ano');
  await choose('Jak hodnotíte koučovací zónu? (povinné)', 'Spíše spokojen/a');
  await choose(
    'Zúčastnili jste se workshopů nebo extra tréninků? (povinné)',
    'Ano',
  );
  await choose(
    'Jak hodnotíte workshopy a extra tréninky celkově? (povinné)',
    'Spokojen/a',
  );
  await page.getByText('Workshop zóna', { exact: false }).click();
  await choose('Letošní workshop (volitelné)', 'Spíše spokojen/a');
  await next();
  await choose('Jak hodnotíte oběd? (povinné)', 'Oběd jsem nevyužil/a');
  await choose('Jak hodnotíte coffee breaky? (povinné)', 'Spokojen/a');
  await choose(
    'Jak hodnotíte networking? (povinné)',
    'Networkingu jsem se nezúčastnil/a',
  );
  await next();
  await page
    .getByRole('textbox', { name: 'Co na webu fungovalo' })
    .fill('Přehledný program.');
  await page
    .getByRole('textbox', { name: 'Co v appce fungovalo' })
    .fill('Lepší vyhledávání.\nDíky!');
  await expectComponentToPassAxe(screen.container);
  expect(screen.container.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  // Capture the whole iframe to avoid clipping above the scrolled viewport.
  await page.viewport(
    viewport.width,
    Math.ceil(screen.container.scrollHeight) + 32,
  );
  window.scrollTo(0, 0);
  await page.screenshot({
    element: screen.container,
    path: `../../../../../test-results/event-survey-web-${viewport.width}.png`,
  });
  await page.viewport(viewport.width, viewport.height);
  await finish();
  await page
    .getByRole('textbox', { name: 'Co se povedlo' })
    .fill('Díky za konferenci.');
  await expectComponentToPassAxe(screen.container);
  await page.getByRole('button', { name: 'Odeslat hodnocení' }).click();
  await expect
    .element(page.getByRole('status'))
    .toHaveTextContent('Děkujeme, vaše hodnocení už je uložené.');
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
  const body = JSON.parse(String(post?.[1]?.body));
  expect(body).toMatchObject({
    targetType: 'event',
    score: 4,
    comment: 'Díky za konferenci.',
    survey: {
      version: 1,
      programVersion: 7,
      websiteScore: 3,
      appScore: 4,
      lunchScore: null,
      websiteComment: 'Přehledný program.',
      appComment: 'Lepší vyhledávání.\nDíky!',
      sessions: [
        { sessionId: talkId, score: 4 },
        { sessionId: workshopId, score: 3 },
      ],
    },
  });
  expect(new Headers(post?.[1]?.headers).get('idempotency-key')).toBeTruthy();
});

it('has no preselected ratings, validates each step and retains answers going back', async () => {
  const { screen, fetcher } = await setup();
  await next();
  await next();
  await next();
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Doplňte prosím označené otázky (2).');
  expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(
    false,
  );
  await choose('Využili jste koučovací zónu? (povinné)', 'Ano');
  await choose('Jak hodnotíte koučovací zónu? (povinné)', 'Spokojen/a');
  await choose(
    'Zúčastnili jste se workshopů nebo extra tréninků? (povinné)',
    'Ne',
  );
  await next();
  await page.getByRole('button', { name: 'Zpět', exact: true }).click();
  await expect
    .element(
      page
        .getByRole('group', {
          name: 'Jak hodnotíte koučovací zónu? (povinné)',
          exact: true,
        })
        .getByRole('radio', { name: 'Spokojen/a', exact: true }),
    )
    .toBeChecked();
  await choose('Využili jste koučovací zónu? (povinné)', 'Ne');
  await expect
    .element(
      page.getByRole('group', {
        name: 'Jak hodnotíte koučovací zónu? (povinné)',
        exact: true,
      }),
    )
    .not.toBeInTheDocument();
  await expectComponentToPassAxe(screen.container);
});

it('preserves answers and idempotency key when a submission cannot be confirmed', async () => {
  let posts = 0;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method !== 'POST') return ready();
    if (++posts === 1) throw new TypeError('Network error');
    return saved();
  });
  await setup(fetcher);
  await throughBasics();
  await finish();
  await page.getByRole('button', { name: 'Odeslat hodnocení' }).click();
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Odpovědi zůstaly na této stránce');
  await page.getByRole('button', { name: 'Odeslat hodnocení' }).click();
  await expect
    .element(page.getByRole('status'))
    .toHaveTextContent('už je uložené');
  const calls = fetcher.mock.calls.filter(
    ([, init]) => init?.method === 'POST',
  );
  expect(calls).toHaveLength(2);
  expect(new Headers(calls[0]![1]?.headers).get('idempotency-key')).toBe(
    new Headers(calls[1]![1]?.headers).get('idempotency-key'),
  );
  expect(calls[0]![1]?.body).toBe(calls[1]![1]?.body);
});

it('does not request or expose the survey before the event ends', async () => {
  const fetcher = vi.fn<typeof fetch>();
  await renderComponent(
    <EventRating
      api={createFetchApiClient({ fetch: fetcher })}
      endsAt="2099-01-01T00:00:00Z"
    />,
  );
  await expect
    .element(page.getByRole('status'))
    .toHaveTextContent('po skončení konference');
  expect(fetcher).not.toHaveBeenCalled();
});
it('shows completion after a reload without offering another submission', async () => {
  await setup(vi.fn<typeof fetch>(async () => ready(true)));
  await expect
    .element(page.getByRole('status'))
    .toHaveTextContent('už je uložené');
  await expect
    .element(page.getByRole('button', { name: 'Pokračovat' }))
    .not.toBeInTheDocument();
});
it('clears the draft when the participant signs out', async () => {
  await setup();
  await page
    .getByRole('textbox', { name: 'Odkud jste' })
    .fill('Soukromé město');
  await invalidateParticipantPrivateResources('permission', 'logout');
  await expect
    .element(page.getByRole('link', { name: 'Přihlásit se k hodnocení' }))
    .toBeVisible();
  await expect
    .element(page.getByRole('textbox', { name: 'Odkud jste' }))
    .not.toBeInTheDocument();
});
