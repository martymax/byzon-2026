import { expect, test } from '@playwright/test';
import { expectPageToPassAxe } from '../support/accessibility';

test('public guides work without login, including all invitation destinations', async ({
  page,
  context,
}) => {
  await context.clearCookies();
  const privateRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(v1\/me|auth\/get-session)/.test(request.url()))
      privateRequests.push(request.url());
  });
  const response = await page.goto('/navody');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Váš průvodce',
  );
  for (const [slug, title] of [
    ['ucastnik', 'Účastník'],
    ['moderator', 'Moderátor'],
    ['recnik', 'Řečník'],
    ['vedouci-aktivity', 'Vedoucí aktivity'],
    ['administrator', 'Administrátor'],
    ['organizacni-podpora', 'Organizační podpora'],
  ]) {
    const guide = await page.request.get(`/navody/${slug}`);
    expect(guide.status()).toBe(200);
    const html = await guide.text();
    expect(html).toContain(title);
    expect(html).toContain('Rychlý start');
  }
  await expectPageToPassAxe(page);
  await page.getByRole('link', { name: /^Moderátor Příprava Q&A/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Moderátor',
  );
  await page
    .getByRole('navigation', { name: 'Obsah návodu' })
    .getByRole('link', { name: 'Během živého Q&A' })
    .click();
  await expect(page).toHaveURL(/\/navody\/moderator#zive-qa$/);
  await expect(page.locator('#zive-qa')).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expectPageToPassAxe(page);
  expect(privateRequests).toEqual([]);
  const unknown = await page.request.get('/navody/neexistujici-role');
  expect(unknown.status()).toBe(404);
});

test('expired or incomplete sessions cannot gate public instructions', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: 'synthetic-expired-session',
      url: baseURL!,
    },
  ]);
  const response = await page.goto('/navody/administrator');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/navody\/administrator$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Administrátor',
  );
  await expect(
    page
      .locator('#dalsi-kroky')
      .getByRole('link', { name: 'Přihlásit se do aplikace', exact: true }),
  ).toHaveAttribute('href', '/prihlaseni?returnTo=%2Fadmin');
});

test('guide screenshots select the matching device and stay public', async ({
  page,
  request,
}) => {
  const images: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/guides/') && request.url().endsWith('.webp'))
      images.push(request.url());
  });
  await page.goto('/navody/moderator#zive-qa');
  const figure = page.locator('#zive-qa figure');
  const screenshot = figure.getByRole('img');
  await screenshot.scrollIntoViewIfNeeded();
  const mobile = page.viewportSize()!.width <= 760;
  await expect
    .poll(() =>
      screenshot.evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
    )
    .toBe(true);
  await expect
    .poll(() => screenshot.evaluate((img: HTMLImageElement) => img.currentSrc))
    .toContain(mobile ? '-mobile.webp' : '-laptop.webp');
  if (mobile) {
    await expect(figure.getByRole('button', { name: 'Notebook' })).toBeHidden();
    expect(images.every((url) => url.endsWith('-mobile.webp'))).toBe(true);
  } else {
    await figure.getByRole('button', { name: 'Mobil', exact: true }).click();
    await expect(
      figure.getByRole('button', { name: 'Mobil', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() =>
        screenshot.evaluate((img: HTMLImageElement) => img.currentSrc),
      )
      .toContain('-mobile.webp');
    await figure.getByRole('button', { name: 'Notebook' }).click();
    await expect
      .poll(() =>
        screenshot.evaluate((img: HTMLImageElement) => img.currentSrc),
      )
      .toContain('-laptop.webp');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(figure.getByRole('button', { name: 'Notebook' })).toBeHidden();
    await expect
      .poll(() =>
        screenshot.evaluate((img: HTMLImageElement) => img.currentSrc),
      )
      .toContain('-mobile.webp');
    await expect(
      figure.getByRole('link', { name: 'Zvětšit snímek (nová karta)' }),
    ).toHaveAttribute('href', '/guides/moderovani-mobile.webp');
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const name of [
    'prihlaseni',
    'program',
    'moderovani',
    'odpoved',
    'aktivita',
    'pozvanky',
  ]) {
    for (const device of ['mobile', 'laptop']) {
      const response = await request.get(`/guides/${name}-${device}.webp`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('image/webp');
      expect((await response.body()).length).toBeGreaterThan(5000);
    }
  }
});
