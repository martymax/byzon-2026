import { expect, test } from '@playwright/test';
import { targetViewports } from '@byzon/test-support/viewports';

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
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /viewport-fit=cover/,
  );
  const live = await request.get('/health/live');
  expect(live.ok()).toBeTruthy();
  expect(live.headers()['x-request-id']).toBeTruthy();
  const ready = await request.get('/health/ready');
  expect(ready.ok()).toBeTruthy();
});

test('participant shell is keyboard accessible at every target viewport', async ({
  page,
}) => {
  const missingKeyWarnings: string[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      message
        .text()
        .includes('Each child in a list should have a unique "key" prop')
    ) {
      missingKeyWarnings.push(message.text());
    }
  });

  await page.goto('/app/program');
  const routeHeading = page.getByRole('heading', {
    name: 'Program',
    level: 1,
  });
  await expect(routeHeading).toBeVisible();
  await expect(routeHeading).toBeFocused();
  const navigation = page.getByRole('navigation', {
    name: 'Hlavní navigace',
  });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('link')).toHaveCount(5);
  await expect(
    navigation.getByRole('link', { name: 'Program', exact: true }),
  ).toHaveAttribute('aria-current', 'page');

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(targetViewports).toContainEqual(
    expect.objectContaining({
      width: page.viewportSize()?.width,
      height: page.viewportSize()?.height,
    }),
  );
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  for (const link of await navigation.getByRole('link').all()) {
    await expect(link.locator('svg')).toHaveCount(1);
    const box = await link.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }

  const shellContent = page.locator('.participant-shell-content');
  const navigationBox = await navigation.boundingBox();
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await expect(navigation).toHaveCSS('position', 'fixed');
    const paddingBottom = await shellContent.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).paddingBottom),
    );
    expect(paddingBottom).toBeGreaterThanOrEqual(navigationBox?.height ?? 0);
  } else {
    await expect(navigation).toHaveCSS('position', 'sticky');
    await expect(shellContent).toHaveCSS('padding-bottom', '0px');
  }
  expect(missingKeyWarnings).toEqual([]);
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
