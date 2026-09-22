import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../../app/styles.css';
import { ConferenceFeedback } from '../../components/conference-feedback';
import type { ConferenceFeedbackState } from '../../lib/conference-feedback';
import { expectComponentToPassAxe } from './accessibility';
import { page, renderComponent } from './render';

const token = 'a'.repeat(64);
const storageKey = `byzon-feedback-pending:${token.slice(-16)}`;
const initial = (
  overrides: Partial<ConferenceFeedbackState> = {},
): ConferenceFeedbackState => ({
  answers: { participantRole: 'attendee' },
  currentStep: 'overall',
  completedAt: null,
  suggestedRole: 'attendee',
  eventName: 'BYZON 2026',
  program: null,
  ...overrides,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify({ data: value }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const choose = (label: string, value: string) =>
  page
    .getByRole('group', { name: label, exact: true })
    .getByRole('radio', { name: value, exact: true })
    .click();

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.setProperty('--font-inter', 'Arial');
  document.documentElement.style.setProperty('--font-khand', 'Arial');
});
afterEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty('--font-inter');
  document.documentElement.style.removeProperty('--font-khand');
});

it('keeps demo answers local, branches by role and resumes after reopening', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const screen = await renderComponent(
    <ConferenceFeedback demo fetcher={fetcher} />,
  );
  await expect
    .element(page.getByRole('heading', { name: 'Váš BYZON. Vašima očima.' }))
    .toBeVisible();
  await expectComponentToPassAxe(screen.container);
  await choose(
    'V jaké roli jste na BYZONu byli?',
    'Moderátor / moderátorka Provázel/a jsem programem nebo diskusí.',
  );
  await page.getByRole('button', { name: 'Začít hodnocení' }).click();
  await choose('Jak hodnotíte konferenci celkově?', 'Výborná');
  await page.getByRole('button', { name: 'Pokračovat', exact: true }).click();
  await expect
    .element(
      page.getByRole('heading', { name: 'Inspirace, kterou si odnášíte' }),
    )
    .toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
  const stored = JSON.parse(
    localStorage.getItem('byzon-conference-feedback-demo-v1')!,
  );
  expect(stored).toMatchObject({
    currentStep: 'program',
    answers: { participantRole: 'moderator', score: '5' },
  });
  await screen.unmount();
  await renderComponent(<ConferenceFeedback demo fetcher={fetcher} />);
  await expect
    .element(
      page.getByRole('heading', { name: 'Inspirace, kterou si odnášíte' }),
    )
    .toBeVisible();
  await expect.element(page.getByText('Část 3 z 11')).toBeVisible();
  expect(fetcher).not.toHaveBeenCalled();
});

it('serializes quick choice, text and navigation changes without losing an answer', async () => {
  let resolveFirst!: (response: Response) => void;
  const firstSave = new Promise<Response>((resolve) => {
    resolveFirst = resolve;
  });
  let patchCount = 0;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'PATCH') {
      patchCount++;
      if (patchCount === 1) return firstSave;
    }
    return json(initial());
  });
  await renderComponent(<ConferenceFeedback token={token} fetcher={fetcher} />);
  await choose('Jak hodnotíte konferenci celkově?', 'Výborná');
  await page
    .getByRole('textbox', {
      name: 'Co vám z letošního BYZONu nejvíc utkvělo? Volitelné',
    })
    .fill('Lidé a nové kontakty.');
  await page.getByRole('button', { name: 'Pokračovat', exact: true }).click();
  expect(patchCount).toBe(1);
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({
    answers: { score: '5', comment: 'Lidé a nové kontakty.' },
    currentStep: 'program',
  });
  resolveFirst(json(initial()));
  await expect.poll(() => patchCount).toBe(2);
  const patches = fetcher.mock.calls.filter(
    ([, init]) => init?.method === 'PATCH',
  );
  expect(JSON.parse(patches[1]![1]!.body as string)).toMatchObject({
    answers: { comment: 'Lidé a nové kontakty.' },
    currentStep: 'program',
  });
  expect(
    patches.every(
      ([, init]) => init?.keepalive === true && init?.credentials === 'omit',
    ),
  ).toBe(true);
  await expect
    .element(page.getByText('Vše uloženo', { exact: true }))
    .toBeVisible();
  expect(localStorage.getItem(storageKey)).toBeNull();
});

it('retains failed answers, retries explicitly and restores a pending step without answers', async () => {
  localStorage.setItem(storageKey, JSON.stringify({ currentStep: 'music' }));
  let online = false;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'PATCH' && !online) throw new TypeError('Offline');
    return json(
      initial({
        answers: {
          participantRole: 'attendee',
          ...(init?.method === 'PATCH'
            ? JSON.parse(init.body as string).answers
            : {}),
        },
      }),
    );
  });
  await renderComponent(<ConferenceFeedback token={token} fetcher={fetcher} />);
  await expect
    .element(page.getByRole('heading', { name: 'Jak BYZON zněl?' }))
    .toBeVisible();
  await choose(
    'Jak jste byli spokojeni s DJ na afterparty?',
    'Afterparty jsem se nezúčastnil/a',
  );
  await expect.element(page.getByRole('alert')).toBeVisible();
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toMatchObject({
    currentStep: 'music',
    answers: { djScore: 'skip' },
  });
  online = true;
  await page.getByRole('button', { name: 'Zkusit uložit znovu' }).click();
  await expect
    .element(page.getByText('Vše uloženo', { exact: true }))
    .toBeVisible();
  expect(localStorage.getItem(storageKey)).toBeNull();
  await expect
    .element(
      page.getByRole('radio', { name: 'Afterparty jsem se nezúčastnil/a' }),
    )
    .toBeChecked();
});

it('finishes only after the last answer saves and can reopen completed feedback', async () => {
  const operations: string[] = [];
  let answers = { participantRole: 'attendee' } as Record<string, string>;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const method = init?.method ?? 'GET';
    operations.push(method);
    if (method === 'PATCH')
      answers = { ...answers, ...JSON.parse(init!.body as string).answers };
    return json(
      initial({
        currentStep: 'about',
        answers,
        ...(method === 'POST' ? { completedAt: '2026-09-21T10:00:00Z' } : {}),
      }),
    );
  });
  const screen = await renderComponent(
    <ConferenceFeedback token={token} fetcher={fetcher} />,
  );
  await page
    .getByRole('textbox', {
      name: 'Odkud jste (město nebo obec)? Volitelné',
    })
    .fill('Praha');
  await page.getByRole('button', { name: 'Dokončit hodnocení' }).click();
  await expect
    .element(page.getByRole('heading', { name: 'Děkujeme. Tohle má smysl.' }))
    .toBeVisible();
  expect(operations.indexOf('PATCH')).toBeLessThan(operations.indexOf('POST'));
  expect(
    fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH')?.[1]?.body,
  ).toContain('Praha');
  await expectComponentToPassAxe(screen.container);
  await page
    .getByRole('button', { name: 'Prohlédnout nebo upravit odpovědi' })
    .click();
  await expect
    .element(page.getByRole('heading', { name: 'Váš BYZON. Vašima očima.' }))
    .toBeVisible();
});

it('restores an earlier role answer returned by the server when the role is selected again', async () => {
  let answers: Record<string, string> = {
    participantRole: 'attendee',
    collaborationScore: '4',
  };
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'PATCH')
      answers = { ...answers, ...JSON.parse(init.body as string).answers };
    return json(
      initial({
        currentStep: 'intro',
        answers:
          answers.participantRole === 'attendee'
            ? { participantRole: 'attendee' }
            : { ...answers },
      }),
    );
  });
  await renderComponent(<ConferenceFeedback token={token} fetcher={fetcher} />);
  await choose(
    'V jaké roli jste na BYZONu byli?',
    'Speaker / speakerka Vystupoval/a jsem v programu.',
  );
  await page.getByRole('button', { name: 'Začít hodnocení' }).click();
  for (let index = 0; index < 6; index++)
    await page.getByRole('button', { name: 'Pokračovat', exact: true }).click();
  await expect
    .element(page.getByRole('heading', { name: 'BYZON z druhé strany' }))
    .toBeVisible();
  await expect
    .element(
      page
        .getByRole('group', {
          name: 'Jak jste byli spokojeni se spoluprací s týmem BYZON?',
        })
        .getByRole('radio', { name: 'Velmi spokojen/a', exact: true }),
    )
    .toBeChecked();
});

it('offers a working completion retry when confirmation fails after answers are saved', async () => {
  let completions = 0;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'POST') {
      completions++;
      if (completions === 1) return json({}, 503);
      return json(initial({ completedAt: '2026-09-21T10:00:00Z' }));
    }
    return json(initial({ currentStep: 'about' }));
  });
  await renderComponent(<ConferenceFeedback token={token} fetcher={fetcher} />);
  await page.getByRole('button', { name: 'Dokončit hodnocení' }).click();
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('Odpovědi jsou uložené');
  await page.getByRole('button', { name: 'Zkusit dokončit znovu' }).click();
  await expect
    .element(page.getByRole('heading', { name: 'Děkujeme. Tohle má smysl.' }))
    .toBeVisible();
  expect(completions).toBe(2);
});

it.each(['server', 'local'] as const)(
  'asks before replaying an old offline draft over a newer device answer: %s',
  async (choice) => {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        answers: { score: '2' },
        currentStep: 'overall',
        baseUpdatedAt: '2026-09-21T10:00:00Z',
      }),
    );
    const fetcher = vi.fn<typeof fetch>(async (_url, init) =>
      json(
        initial({
          answers: {
            participantRole: 'attendee',
            score: init?.method === 'PATCH' ? '2' : '5',
          },
          updatedAt: '2026-09-21T10:05:00Z',
        }),
      ),
    );
    await renderComponent(
      <ConferenceFeedback token={token} fetcher={fetcher} />,
    );
    await expect
      .element(
        page.getByRole('heading', { name: 'Na serveru jsou novější odpovědi' }),
      )
      .toBeVisible();
    window.dispatchEvent(new Event('online'));
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH'),
    ).toHaveLength(0);
    expect(localStorage.getItem(storageKey)).not.toBeNull();
    await page
      .getByRole('button', {
        name:
          choice === 'server'
            ? 'Použít odpovědi ze serveru'
            : 'Použít mé neodeslané změny',
      })
      .click();
    await expect
      .element(
        page
          .getByRole('group', { name: 'Jak hodnotíte konferenci celkově?' })
          .getByRole('radio', {
            name: choice === 'server' ? 'Výborná' : 'Průměrná',
            exact: true,
          }),
      )
      .toBeChecked();
    await expect
      .element(page.getByText('Vše uloženo', { exact: true }))
      .toBeVisible();
    expect(localStorage.getItem(storageKey)).toBeNull();
    const patches = fetcher.mock.calls.filter(
      ([, init]) => init?.method === 'PATCH',
    );
    expect(patches).toHaveLength(choice === 'server' ? 0 : 1);
    if (choice === 'local')
      expect(JSON.parse(patches[0]![1]!.body as string)).toEqual({
        answers: { score: '2' },
        currentStep: 'overall',
      });
  },
);

it('rechecks another device before retrying offline changes without a page reload', async () => {
  let changedElsewhere = false;
  let patchCount = 0;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'PATCH') {
      patchCount++;
      throw new TypeError('Offline');
    }
    return json(
      initial({
        answers: {
          participantRole: 'attendee',
          score: changedElsewhere ? '5' : '3',
        },
        updatedAt: changedElsewhere
          ? '2026-09-21T10:05:00Z'
          : '2026-09-21T10:00:00Z',
      }),
    );
  });
  await renderComponent(<ConferenceFeedback token={token} fetcher={fetcher} />);
  await choose('Jak hodnotíte konferenci celkově?', 'Průměrná');
  await expect.element(page.getByRole('alert')).toBeVisible();
  changedElsewhere = true;
  window.dispatchEvent(new Event('online'));
  await expect
    .element(
      page.getByRole('heading', { name: 'Na serveru jsou novější odpovědi' }),
    )
    .toBeVisible();
  expect(patchCount).toBe(1);
  await page
    .getByRole('button', { name: 'Použít odpovědi ze serveru' })
    .click();
  await expect
    .element(
      page
        .getByRole('group', { name: 'Jak hodnotíte konferenci celkově?' })
        .getByRole('radio', { name: 'Výborná', exact: true }),
    )
    .toBeChecked();
});
