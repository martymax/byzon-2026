import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { expectPageToPassAxe } from '../support/accessibility';

const adminRoutes = [
  ['/admin', 'Přehled akce'],
  ['/admin/obsah', 'Program a obsah'],
  ['/admin/vstupenky', 'Aktualizace vstupenek'],
  ['/admin/ucastnici', 'Účastníci'],
  ['/admin/rezervace', 'Rezervace a kapacity'],
  ['/admin/oznameni', 'Oznámení'],
  ['/admin/interakce', 'Networking, otázky a hodnocení'],
  ['/admin/role', 'Tým a oprávnění'],
  ['/admin/reporty', 'Reporty'],
  ['/admin/audit', 'Historie změn'],
  ['/admin/nastaveni', 'Nastavení akce'],
] as const;

const waitForAdminRoute = async (
  page: Page,
  path: string,
  heading: string,
): Promise<void> => {
  await page.goto(path);
  await expect(page.locator('#byzon-mock-mode-indicator')).toHaveAttribute(
    'data-state',
    'active',
    { timeout: 30_000 },
  );
  const retryAccess = page.getByRole('button', {
    name: 'Ověřit přístup znovu',
  });
  const routeHeading = page.getByRole('heading', { level: 1, name: heading });
  await Promise.race([
    routeHeading.waitFor({ state: 'visible', timeout: 30_000 }),
    retryAccess.waitFor({ state: 'visible', timeout: 30_000 }),
  ]);
  if (await retryAccess.isVisible()) await retryAccess.click();
  await expect(routeHeading).toBeVisible({ timeout: 30_000 });
};

const expectNoPageOverflow = async (page: Page): Promise<void> => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

const expectLogicalHeadingOrder = async (page: Page): Promise<void> => {
  const levels = await page
    .locator('h1, h2, h3, h4, h5, h6')
    .evaluateAll((headings) =>
      headings
        .filter((heading) => {
          const style = getComputedStyle(heading);
          return style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map((heading) => Number(heading.tagName.slice(1))),
    );
  expect(levels[0]).toBe(1);
  for (let index = 1; index < levels.length; index += 1) {
    expect(levels[index]! - levels[index - 1]!).toBeLessThanOrEqual(1);
  }
};

const maybeCapture = async (
  page: Page,
  testInfo: TestInfo,
  path: string,
): Promise<void> => {
  if (process.env.ADMIN_QA_SCREENSHOTS !== '1') return;
  const name = path === '/admin' ? 'overview' : path.split('/').at(-1)!;
  await page.screenshot({
    animations: 'disabled',
    fullPage: true,
    path: testInfo.outputPath(`${name}.png`),
  });
};

const installPerformanceObservers = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const state = { cls: 0, longTasks: [] as number[] };
    Object.defineProperty(window, '__adminQaPerformance', {
      configurable: true,
      value: state,
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          readonly hadRecentInput: boolean;
          readonly value: number;
        };
        if (!shift.hadRecentInput) state.cls += shift.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      state.longTasks.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ type: 'longtask', buffered: true });
  });
};

const readPerformance = (page: Page) =>
  page.evaluate(() => {
    const state = (
      window as Window & {
        __adminQaPerformance: { cls: number; longTasks: number[] };
      }
    ).__adminQaPerformance;
    return {
      cls: state.cls,
      maxLongTask: Math.max(0, ...state.longTasks),
    };
  });

const resetLongTasks = (page: Page) =>
  page.evaluate(() => {
    (
      window as Window & {
        __adminQaPerformance: { longTasks: number[] };
      }
    ).__adminQaPerformance.longTasks = [];
  });

test.describe('AUX-12 admin cross-route quality gate', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test('passes axe, landmarks, heading order and responsive overflow on every route', async ({
    page,
  }, testInfo) => {
    for (const [path, heading] of adminRoutes) {
      await waitForAdminRoute(page, path, heading);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(
        page.getByRole('link', { name: 'Přeskočit na hlavní obsah' }),
      ).toHaveCount(1);
      await expect(page.locator('#admin-main')).toHaveAttribute(
        'tabindex',
        '-1',
      );
      await expectLogicalHeadingOrder(page);
      await expectNoPageOverflow(page);
      await expectPageToPassAxe(page);
      await maybeCapture(page, testInfo, path);
    }
  });

  test('keeps the shell and representative controls keyboard operable', async ({
    page,
  }) => {
    await waitForAdminRoute(page, '/admin/audit', 'Historie změn');
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
    });
    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', {
      name: 'Přeskočit na hlavní obsah',
    });
    await expect(skipLink).toBeFocused();
    await skipLink.press('Enter');
    await expect(page.locator('#admin-main')).toBeFocused();

    const width = page.viewportSize()?.width ?? 0;
    if (width < 1024) {
      const openNavigation = page.getByRole('button', {
        name: 'Otevřít navigaci administrace',
      });
      await openNavigation.focus();
      await page.keyboard.press('Enter');
      const drawer = page.getByRole('dialog', {
        name: 'Navigace administrace',
      });
      await expect(drawer).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).not.toBeVisible();
      await expect(openNavigation).toBeFocused();
    } else {
      const navigation = page.getByRole('navigation', {
        name: 'Hlavní administrace',
      });
      await expect(navigation).toBeVisible();
      await navigation.getByRole('link', { name: 'Reporty' }).focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/admin\/reporty$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Reporty' }),
      ).toBeVisible();
    }

    await waitForAdminRoute(page, '/admin/audit', 'Historie změn');
    const category = page.getByRole('combobox', { name: 'Oblast' });
    await category.focus();
    await category.selectOption('settings');
    await expect(category).toHaveValue('settings');
    await page.getByText('Technické údaje').first().focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('textbox', { name: 'Request ID' }),
    ).toBeVisible();
  });

  test('supports 200% reflow and reduced motion on representative dense routes', async ({
    page,
  }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) !== 1280,
      'One stable 1280 × 800 project represents browser 200% reflow.',
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const [path, heading] of [
      ['/admin/obsah', 'Program a obsah'],
      ['/admin/rezervace', 'Rezervace a kapacity'],
      ['/admin/audit', 'Historie změn'],
    ] as const) {
      await waitForAdminRoute(page, path, heading);
      await page.evaluate(() => {
        document.documentElement.style.zoom = '2';
      });
      await expectNoPageOverflow(page);
      await expect(
        page.getByRole('heading', { level: 1, name: heading }),
      ).toBeVisible();
      const animated = await page.locator('main *').evaluateAll(
        (elements) =>
          elements.filter((element) => {
            const style = getComputedStyle(element);
            return (
              Number.parseFloat(style.animationDuration) > 0 ||
              Number.parseFloat(style.transitionDuration) > 0
            );
          }).length,
      );
      expect(animated).toBe(0);
    }
  });

  test('keeps CLS and user-triggered interactions inside the numeric budgets', async ({
    page,
  }, testInfo) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) !== 1280,
      'Performance evidence uses one stable Chromium viewport and runner.',
    );
    await installPerformanceObservers(page);

    await waitForAdminRoute(page, '/admin/audit', 'Historie změn');
    await page.waitForTimeout(250);
    const auditLoad = await readPerformance(page);
    expect(auditLoad.cls).toBeLessThan(0.1);
    await resetLongTasks(page);
    await page
      .getByRole('combobox', { name: 'Oblast' })
      .selectOption('settings');
    await page.getByText('Technické údaje').first().click();
    await page.waitForTimeout(250);
    const auditInteraction = await readPerformance(page);
    expect(auditInteraction.maxLongTask).toBeLessThanOrEqual(50);

    await waitForAdminRoute(page, '/admin/rezervace', 'Rezervace a kapacity');
    await page.waitForTimeout(250);
    const reservationLoad = await readPerformance(page);
    expect(reservationLoad.cls).toBeLessThan(0.1);
    await resetLongTasks(page);
    await page
      .getByRole('combobox', { name: 'Aktivita' })
      .selectOption({ index: 1 });
    await page
      .getByRole('button', { name: 'Zobrazit aktivitu' })
      .first()
      .click();
    await page.waitForTimeout(250);
    const reservationInteraction = await readPerformance(page);
    expect(reservationInteraction.maxLongTask).toBeLessThanOrEqual(50);
    await testInfo.attach('admin-performance.json', {
      body: JSON.stringify(
        {
          audit: { interaction: auditInteraction, load: auditLoad },
          reservations: {
            interaction: reservationInteraction,
            load: reservationLoad,
          },
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });

  test('keeps contract-maximum admin pages within interaction budgets', async ({
    page,
  }, testInfo) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) !== 1280,
      'The reproducible max-page trace uses the stable 1280 × 800 project.',
    );
    await installPerformanceObservers(page);
    const evidence: Record<
      string,
      { cls: number; interactions: Record<string, number> }
    > = {};
    const capture = async (
      route: string,
      interaction: string,
      action: () => Promise<void>,
    ) => {
      await resetLongTasks(page);
      await action();
      await page.waitForTimeout(300);
      const performance = await readPerformance(page);
      expect(performance.cls).toBeLessThan(0.1);
      expect(performance.maxLongTask).toBeLessThanOrEqual(50);
      const current = evidence[route] ?? {
        cls: performance.cls,
        interactions: {},
      };
      current.cls = Math.max(current.cls, performance.cls);
      current.interactions[interaction] = performance.maxLongTask;
      evidence[route] = current;
    };

    await waitForAdminRoute(page, '/admin/audit', 'Historie změn');
    await page.getByText('Technické údaje').first().click();
    await capture('audit-100', 'server-filter-and-render', async () => {
      await page
        .getByRole('textbox', { name: 'Request ID' })
        .fill('admin-qa-max-page');
      await expect(page.getByText('100 položek')).toBeVisible();
    });
    await capture('audit-100', 'open-detail', async () => {
      await page.getByText('Zobrazit důvod a podrobnosti').first().click();
      await expect(
        page.getByText('Syntetický redigovaný důvod pro max-page QA.').first(),
      ).toBeVisible();
    });
    await expectNoPageOverflow(page);

    await waitForAdminRoute(
      page,
      '/admin/rezervace?adminQa=max-page',
      'Rezervace a kapacity',
    );
    const loadMoreReservations = page.getByRole('button', {
      name: 'Načíst další aktivity',
    });
    for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
      await expect(loadMoreReservations).toBeVisible();
      await loadMoreReservations.click();
    }
    await expect(page.getByText('100 aktivit')).toBeVisible();
    await capture('reservations-100', 'filter', async () => {
      await page
        .getByRole('combobox', { name: 'Kapacitní stav' })
        .selectOption('nearly_full');
      await expect(
        page.getByRole('button', { name: 'Zobrazit aktivitu' }).first(),
      ).toBeVisible();
    });
    await capture('reservations-100', 'open-detail', async () => {
      await page
        .getByRole('button', { name: 'Zobrazit aktivitu' })
        .first()
        .click();
      await expect(page.getByText('Detail aktivity')).toBeVisible();
    });
    await expectNoPageOverflow(page);

    await waitForAdminRoute(page, '/admin/obsah', 'Program a obsah');
    await capture('content-50', 'scenario-and-render', async () => {
      await page
        .getByRole('combobox', { name: 'Stav následujícího průchodu' })
        .selectOption('max_page');
      await expect(page.getByRole('button', { name: /^Upravit:/ })).toHaveCount(
        50,
      );
    });
    await capture('content-50', 'open-editor', async () => {
      await page
        .getByRole('button', { name: /^Upravit:/ })
        .first()
        .click();
      await expect(page.getByText('Úprava obsahu')).toBeVisible();
    });
    await expectNoPageOverflow(page);

    await waitForAdminRoute(
      page,
      '/admin/vstupenky?adminQa=max-page',
      'Aktualizace vstupenek',
    );
    await capture('ticket-preview-500', 'load-and-render', async () => {
      await page.getByRole('button', { name: 'Načíst ze SimpleShopu' }).click();
      await expect(page.getByText('500 záznamů')).toBeVisible({
        timeout: 30_000,
      });
    });
    await capture('ticket-preview-500', 'filter', async () => {
      await page
        .getByRole('combobox', { name: 'Filtrovat záznamy' })
        .selectOption('new');
      await expect(page.getByText('Nové vstupenky').first()).toBeVisible();
    });
    const ticketPagination = page.getByRole('navigation', {
      name: 'Stránkování kontroly vstupenek',
    });
    await expect(
      ticketPagination.getByText('Zobrazeno 1–25 z 500'),
    ).toBeVisible();
    await capture('ticket-preview-500', 'keyboard-next-page', async () => {
      const nextPage = ticketPagination.getByRole('button', {
        name: 'Další záznamy',
      });
      await nextPage.focus();
      await page.keyboard.press('Enter');
      await expect(
        ticketPagination.getByText('Zobrazeno 26–50 z 500'),
      ).toBeVisible();
    });
    await expectPageToPassAxe(page);
    await expectNoPageOverflow(page);

    await waitForAdminRoute(
      page,
      '/admin/ucastnici?adminQa=max-page',
      'Účastníci',
    );
    await page
      .getByRole('searchbox', { name: 'Jméno, e-mail nebo reference' })
      .fill('admin-qa-max-page');
    await capture('support-search-5', 'search-and-render', async () => {
      await page.getByRole('button', { name: 'Vyhledat účastníka' }).click();
      await expect(
        page.getByRole('button', { name: 'Zobrazit detail' }),
      ).toHaveCount(5);
    });
    await capture('support-search-5', 'open-detail', async () => {
      await page
        .getByRole('button', { name: 'Zobrazit detail' })
        .first()
        .click();
      await expect(page.getByText('Detail účastníka')).toBeVisible();
    });
    await expectNoPageOverflow(page);

    await testInfo.attach('admin-max-page-performance.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  });
});
