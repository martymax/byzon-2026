import { expect, test, type Page } from '@playwright/test';
import {
  identityFixtureIds,
  identityFixtureProfile,
} from '@byzon/test-support/fixtures';
import { targetViewports } from '@byzon/test-support/viewports';

const activateSyntheticParticipantBeforeBootstrap = async (page: Page) => {
  await page.addInitScript(
    ({ privacyNoticeDocumentId, profile, termsDocumentId }) => {
      const nativeFetch = window.fetch.bind(window);
      let activationRequest: Promise<void> | null = null;

      window.fetch = async (input, init) => {
        const requestUrl =
          input instanceof Request
            ? input.url
            : input instanceof URL
              ? input.href
              : input;
        const url = new URL(requestUrl, window.location.href);
        if (url.pathname === '/api/v1/me/bootstrap') {
          activationRequest ??= nativeFetch('/api/v1/me/onboarding', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': 'onboarding:e2e-active-participant',
            },
            body: JSON.stringify({
              profile,
              legal: {
                termsDocumentId,
                termsAccepted: true,
                privacyNoticeDocumentId,
                privacyAcknowledged: true,
              },
            }),
          }).then((response) => {
            if (!response.ok) {
              throw new Error(
                `Synthetic participant activation failed (${response.status}).`,
              );
            }
          });
          await activationRequest;
        }
        return nativeFetch(input, init);
      };
    },
    {
      privacyNoticeDocumentId: identityFixtureIds.privacyNotice,
      profile: identityFixtureProfile,
      termsDocumentId: identityFixtureIds.terms,
    },
  );
};

test('brand shell, manifest and health endpoints are available', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Přihlášení');
  await expect(
    page.getByRole('heading', { name: 'Přihlaste se do BYZON' }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'E-mail' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Poslat přihlašovací odkaz' }),
  ).toBeVisible();
  await expect(page.locator('.brand-logo')).toHaveAttribute(
    'src',
    '/brand/logo.png',
  );
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

test('participant reserves the available place and downloads the Prague-time agenda', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await activateSyntheticParticipantBeforeBootstrap(page);
  await page.goto('/app/agenda');
  await expect(
    page.getByRole('heading', { name: 'Osobní agenda', level: 1 }),
  ).toBeVisible();

  const offeredPlace = page.getByRole('dialog', {
    name: 'Nabídka místa z čekací listiny',
  });
  await expect(offeredPlace).toBeVisible({ timeout: 20_000 });
  await offeredPlace.getByRole('button', { name: 'Zavřít' }).click();

  const opening = page.getByRole('article').filter({
    has: page.getByRole('link', { name: 'Otevření konference' }),
  });
  await expect(opening).toContainText('09:00–10:00');

  const reservable = page.getByRole('article').filter({
    has: page.getByRole('link', {
      name: 'Workshop s opuštěným pořadníkem',
    }),
  });
  await reservable.getByRole('button', { name: 'Rezervovat místo' }).click();
  await expect(
    reservable.getByText('Rezervováno', { exact: true }),
  ).toBeVisible();

  const exportLink = page.getByRole('link', {
    name: 'Stáhnout osobní agendu (.ics)',
  });
  await expect(exportLink).toHaveAttribute('href', '/api/v1/me/agenda.ics');
  await expect(exportLink).toHaveAttribute(
    'download',
    'byzon-2026-moje-agenda.ics',
  );
  const calendarResponse = await page.evaluate(async () => {
    const response = await fetch('/api/v1/me/agenda.ics');
    return {
      body: await response.text(),
      contentDisposition: response.headers.get('content-disposition'),
      contentType: response.headers.get('content-type'),
      ok: response.ok,
    };
  });
  expect(calendarResponse.ok).toBe(true);
  expect(calendarResponse.contentDisposition).toBe(
    'attachment; filename="byzon-2026-moje-agenda.ics"',
  );
  expect(calendarResponse.contentType).toBe('text/calendar; charset=utf-8');
  const calendar = calendarResponse.body;
  const downloadStarted = page.waitForEvent('download');
  await exportLink.click();
  const download = await downloadStarted;
  expect(download.suggestedFilename()).toBe('byzon-2026-moje-agenda.ics');
  expect(calendar).toContain('BEGIN:VCALENDAR\r\n');
  expect(calendar).toContain('DTSTART:20260918T070000Z');
  expect(calendar).toContain('SUMMARY:Otevření konference');
  expect(calendar).toContain('DTSTART:20260919T143000Z');
  expect(calendar).toContain('SUMMARY:Workshop s opuštěným pořadníkem');
  expect(calendar).not.toContain('@example.test');
  expect(calendar.endsWith('\r\n')).toBe(true);
});

test('reduced motion preference disables decorative transitions', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.brand-logo')).toHaveCSS(
    'transition-duration',
    '0s',
  );
});
