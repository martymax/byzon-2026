import { targetViewports } from '@byzon/test-support/viewports';
import { expect, test } from '@playwright/test';

import { expectPageToPassAxe } from '../support/accessibility';

test('public shell passes the automatic WCAG A/AA baseline', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Přihlaste se do BYZON' }),
  ).toBeVisible();
  await expectPageToPassAxe(page);
});

test('public shell preserves keyboard access and layout at the target viewport', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Přihlaste se do BYZON' }),
  ).toBeVisible();

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
    .getByRole('link', { name: 'BYZON – přihlášení' })
    .boundingBox();
  expect(brandTarget?.width).toBeGreaterThanOrEqual(44);
  expect(brandTarget?.height).toBeGreaterThanOrEqual(44);

  const controls = [
    page.getByLabel('E-mail'),
    page.getByRole('button', { name: 'Poslat přihlašovací odkaz' }),
  ];
  const controlTargets = [];
  for (const control of controls) {
    const target = await control.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
    if (target) controlTargets.push(target);
  }

  const mockIndicator = await page
    .getByText('Mock data · pouze vývoj/test', { exact: true })
    .boundingBox();
  expect(mockIndicator).not.toBeNull();
  for (const target of controlTargets) {
    expect(
      target.x + target.width <= (mockIndicator?.x ?? 0) ||
        (mockIndicator?.x ?? 0) + (mockIndicator?.width ?? 0) <= target.x ||
        target.y + target.height <= (mockIndicator?.y ?? 0) ||
        (mockIndicator?.y ?? 0) + (mockIndicator?.height ?? 0) <= target.y,
    ).toBe(true);
  }
});
