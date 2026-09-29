import '../../app/styles.css';
import { expect, it } from 'vitest';
import { createNotificationEmail } from '@byzon/mail';
import { ConferenceFeedbackDemo } from '../../components/conference-feedback';
import { expectComponentToPassAxe } from './accessibility';
import { page, renderComponent } from './render';

it('previews the invitation and all five real reminder templates without sending mail', async () => {
  const variants = [0, 1, 2, 3, 4, 5].map((number) => {
    const email = createNotificationEmail(
      {
        kind: 'conference_feedback',
        sessions: [],
        eventName: 'BYZON 2026',
        timezone: 'Europe/Prague',
        feedbackId: '01940000-0000-7000-8000-000000000001',
        feedbackUrl: 'https://app.byzon.cz/hodnoceni/demo',
        reminder: number > 0,
        ...(number ? { reminderNumber: number } : {}),
      },
      {},
      'https://app.byzon.cz',
    );
    return {
      label: number ? `${number}. připomínka` : 'První pozvánka',
      ...email,
    };
  });
  const screen = await renderComponent(
    <main>
      <ConferenceFeedbackDemo
        emailHtml={variants[0]!.html}
        emailSubject={variants[0]!.subject}
        emailVariants={variants}
      />
    </main>,
  );
  for (let index = 0; index < variants.length; index++) {
    await screen
      .getByRole('combobox', { name: 'Varianta e-mailu' })
      .selectOptions(String(index));
    await expect
      .element(screen.getByText(variants[index]!.subject, { exact: true }))
      .toBeVisible();
    expect(document.querySelector('iframe')?.getAttribute('srcdoc')).toContain(
      variants[index]!.subject,
    );
  }
  await expect
    .poll(() =>
      document
        .querySelector('iframe')
        ?.contentDocument?.body.textContent?.includes(
          'další připomínku už neposíláme',
        ),
    )
    .toBe(true);
  window.scrollTo(0, 0);
  await expectComponentToPassAxe(document.querySelector('main')!);
  await page.screenshot({
    path: `.vitest-attachments/feedback-email-variants-${window.innerWidth}.png`,
    fullPage: true,
  });
});
