import { afterEach, expect, it, vi } from 'vitest';
import { SpeakerAnswerEditor } from '../../components/speaker-questions';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';
import '../../app/styles.css';
import styles from '../../components/question-workspace.module.css';
const id = '019fa200-0000-7000-8000-000000000001';
afterEach(() => vi.unstubAllGlobals());
it('retains answer and key after network loss and retries the same write', async () => {
  const keys: string[] = [];
  const saved = vi.fn(async () => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
      keys.push(new Headers(options?.headers).get('idempotency-key')!);
      if (keys.length === 1) throw new TypeError('offline');
      return Response.json({ answerId: id, version: 1 });
    }),
  );
  const screen = await renderComponent(
    <main className={styles.workspace}>
      <h1>Odpověď řečníka</h1>
      <SpeakerAnswerEditor
        item={{
          questionId: id,
          text: 'Jak začít?',
          submittedAt: '2026-09-18T09:30:00.000Z',
          answer: null,
          canEdit: false,
        }}
        onSaved={saved}
        onDenied={vi.fn()}
      />
    </main>,
  );
  await screen
    .getByRole('textbox', { name: 'Vaše písemná odpověď' })
    .fill('Začněte rozhovorem.');
  await Promise.all(
    screen.container.getAnimations({ subtree: true }).map((a) => a.finished),
  );
  await expectComponentToPassAxe(screen.container);
  await screen
    .getByRole('button', { name: 'Zveřejnit soukromou odpověď' })
    .click();
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Spojení bylo přerušeno');
  await expect
    .element(screen.getByRole('textbox'))
    .toHaveValue('Začněte rozhovorem.');
  await screen
    .getByRole('button', { name: 'Zveřejnit soukromou odpověď' })
    .click();
  await expect.poll(() => saved.mock.calls.length).toBe(1);
  expect(keys[0]).toBe(keys[1]);
});
it('keeps the draft when another speaker wins and requires a conflict review', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        { code: 'QUESTION_ANSWER_CONFLICT', detail: 'Odpověď už existuje.' },
        { status: 409 },
      ),
    ),
  );
  const screen = await renderComponent(
    <main className={styles.workspace}>
      <h1>Odpověď řečníka</h1>
      <SpeakerAnswerEditor
        item={{
          questionId: id,
          text: 'Jak začít?',
          submittedAt: '2026-09-18T09:30:00.000Z',
          answer: null,
          canEdit: false,
        }}
        onSaved={async () => {}}
        onDenied={vi.fn()}
      />
    </main>,
  );
  await screen.getByRole('textbox').fill('Můj návrh');
  await screen
    .getByRole('button', { name: 'Zveřejnit soukromou odpověď' })
    .click();
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('Odpověď už existuje.');
  await expect.element(screen.getByRole('textbox')).toHaveValue('Můj návrh');
  expect(
    screen
      .getByRole('button', { name: 'Zveřejnit soukromou odpověď' })
      .elements(),
  ).toHaveLength(0);
});
