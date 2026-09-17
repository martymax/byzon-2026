import { expect, test } from '@playwright/test';
import { expectPageToPassAxe } from '../support/accessibility';

test('selects across roles, queues exact recipients once and restores progress after reopening', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const invitationRequests: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      (new URL(request.url()).pathname.endsWith('/invitations/batches') ||
        new URL(request.url()).pathname.endsWith('/invite'))
    )
      invitationRequests.push(request.url());
  });
  await page.goto('/admin/pozvanky');
  await expect(page.locator('#byzon-mock-mode-indicator')).toHaveAttribute(
    'data-state',
    'active',
    { timeout: 30_000 },
  );
  const heading = page.getByRole('heading', { level: 1, name: 'Pozvánky' });
  const retry = page.getByRole('button', { name: 'Ověřit přístup znovu' });
  await Promise.race([
    heading.waitFor({ state: 'visible' }),
    retry.waitFor({ state: 'visible' }),
  ]);
  if (await retry.isVisible()) await retry.click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Pozvánky' }),
  ).toBeVisible({ timeout: 30_000 });
  const list = page.getByRole('list', { name: 'Seznam příjemců' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(
    page.getByRole('button', { name: 'Odeslat pozvánky (0)' }),
  ).toBeDisabled();
  expect(invitationRequests).toHaveLength(0);
  await page.getByRole('checkbox', { name: 'Řečník (1)', exact: true }).check();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page
    .getByRole('checkbox', { name: 'Vybrat všechny zobrazené (1)' })
    .check();
  await page
    .getByRole('checkbox', { name: 'Administrátor (1)', exact: true })
    .check();
  await page
    .getByRole('checkbox', { name: 'Řečník (1)', exact: true })
    .uncheck();
  await expect(
    page.getByText('Z toho 1 mimo aktuální filtr.', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('checkbox', { name: 'Vybrat všechny zobrazené (1)' })
    .check();
  await page
    .getByRole('checkbox', { name: 'Vybrat všechny zobrazené (1)' })
    .uncheck();
  await expect(
    page.getByRole('button', { name: 'Odeslat pozvánky (1)' }),
  ).toBeEnabled();
  await page
    .getByRole('checkbox', { name: 'Vybrat: Demo administrátor', exact: true })
    .check();
  await page
    .getByRole('checkbox', { name: 'Administrátor (1)', exact: true })
    .uncheck();
  await page
    .getByRole('searchbox', { name: 'Jméno nebo e-mail' })
    .fill('katerina');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Jméno nebo e-mail' }).fill('');
  await expectPageToPassAxe(page);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.screenshot({
    path: testInfo.outputPath('invitations.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Odeslat pozvánky (2)' }).click();
  const review = page.getByRole('dialog');
  await expect(
    review.getByText('katerina@example.test', { exact: true }),
  ).toBeVisible();
  await expect(
    review.getByText('admin@example.test', { exact: true }),
  ).toBeVisible();
  await expect(
    review.getByText('martin@example.test', { exact: true }),
  ).toHaveCount(0);
  await expectPageToPassAxe(page);
  await review.getByRole('button', { name: 'Potvrdit a odeslat (2)' }).click();
  await expect(
    page.getByText('Zařazeno do fronty: 2.', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Průběh rozesílání' }),
  ).toBeVisible();
  expect(invitationRequests).toHaveLength(1);
  expect(invitationRequests[0]).toContain('/invitations/batches');
  await expectPageToPassAxe(page);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({
    path: testInfo.outputPath('invitation-queue.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.reload();
  await expect(page.locator('#byzon-mock-mode-indicator')).toHaveAttribute(
    'data-state',
    'active',
    { timeout: 30_000 },
  );
  await Promise.race([
    heading.waitFor({ state: 'visible' }),
    retry.waitFor({ state: 'visible' }),
  ]);
  if (await retry.isVisible()) await retry.click();
  await expect(
    page.getByRole('heading', { name: 'Průběh rozesílání' }),
  ).toBeVisible();
  await expect(
    page.getByText('Rozesílání dokončeno', { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('2 z 2', { exact: true })).toBeVisible();
  expect(invitationRequests).toHaveLength(1);
  await expect(
    page.getByRole('button', { name: 'Odeslat pozvánky (0)' }),
  ).toBeDisabled();
});
