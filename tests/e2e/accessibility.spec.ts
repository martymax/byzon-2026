import { targetViewports } from '@byzon/test-support/viewports';
import { expect, test } from '@playwright/test';

import { expectPageToPassAxe } from '../support/accessibility';

test('public shell passes the automatic WCAG A/AA baseline', async ({
  page,
}) => {
  await page.goto('/');
  await expectPageToPassAxe(page);
});

test('public shell preserves keyboard access and layout at the target viewport', async ({
  page,
}) => {
  await page.goto('/');

  expect(targetViewports).toContainEqual(
    expect.objectContaining(page.viewportSize() ?? {}),
  );
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);

  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Přejít na obsah' });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await skipLink.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  const brandTarget = await page
    .getByRole('link', { name: 'BYZON 2026 – úvod' })
    .boundingBox();
  expect(brandTarget?.width).toBeGreaterThanOrEqual(44);
  expect(brandTarget?.height).toBeGreaterThanOrEqual(44);
});
