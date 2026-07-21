import { expect, test } from '@playwright/test';

test('brand shell, manifest and health endpoints are available', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/BYZON 2026/);
  await expect(
    page.getByRole('heading', { name: /Byznys bez náhubku/i }),
  ).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  const live = await request.get('/health/live');
  expect(live.ok()).toBeTruthy();
  expect(live.headers()['x-request-id']).toBeTruthy();
  const ready = await request.get('/health/ready');
  expect(ready.ok()).toBeTruthy();
});

test('participant shell is keyboard accessible and responsive on mobile', async ({
  page,
}) => {
  await page.goto('/app/program');
  await expect(
    page.getByRole('heading', { name: 'Program', level: 1 }),
  ).toBeVisible();
  const navigation = page.getByRole('navigation', {
    name: 'Hlavní navigace',
  });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('link')).toHaveCount(4);

  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Přejít na obsah' });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await skipLink.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  for (const link of await navigation.getByRole('link').all()) {
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
});

test('reduced motion preference disables decorative transitions', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.brand-mark')).toHaveCSS(
    'transition-duration',
    '0s',
  );
});
