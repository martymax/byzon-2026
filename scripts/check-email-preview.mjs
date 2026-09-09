import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  createAuthEmail,
  createNotificationEmail,
  notificationPayloadSchema,
} from '../packages/mail/dist/index.js';

const directory = new URL('../docs/email-preview/', import.meta.url);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const files = (await readdir(directory)).filter(
    (file) => file.endsWith('.html') && file !== 'index.html',
  );
  assert.equal(files.length, 12);
  const checks = [];
  for (const width of [375, 660]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of files) {
      await page.goto(new URL(name, directory).href);
      await page.evaluate(() => document.fonts.ready);
      const check = {
        name,
        width,
        ...(await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          links: document.querySelectorAll('a').length,
          logoLoaded: document.querySelector('img').naturalWidth > 0,
        }))),
      };
      assert.equal(check.overflow, false, `${name} must fit ${width}px`);
      assert.equal(check.logoLoaded, true, `${name} logo must load`);
      checks.push(check);
    }
  }
  for (const [name, width, colorScheme, screenshot] of [
    ['participant-invitation', 660, 'light', 'desktop'],
    ['program_changed', 375, 'light', 'mobile'],
    ['waitlist_promoted', 375, 'dark', 'dark'],
  ]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme });
    await page.goto(new URL(`${name}.html`, directory).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: fileURLToPath(new URL(`${screenshot}.png`, directory)),
      fullPage: true,
    });
  }
  // Images and fonts unavailable: the meaningful text and long values still fit.
  await page.route('**/*', (route) => route.abort());
  // Webmail may remove the head/body while retaining inline styles. The layout,
  // typography and action must still work without media queries or CSS resets.
  await page.emulateMedia({ colorScheme: 'light' });
  for (const width of [375, 660]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of files) {
      const html = await readFile(new URL(name, directory), 'utf8');
      const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
      await page.setContent(body);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      assert.equal(overflow, false, `${name} must fit without head/body CSS`);
      assert.ok(await page.locator('a.cta').isVisible());
      const font = await page
        .locator('.copy')
        .first()
        .evaluate((element) => getComputedStyle(element).fontFamily);
      assert.ok(font.includes('Arial'), `${name} retains its font fallback`);
      checks.push({ name, width, mode: 'no-head-body-or-assets', overflow });
    }
  }
  const appOrigin = 'https://app.example.test';
  const longAuth = createAuthEmail({
    purpose: 'participant-invitation',
    appOrigin,
    url: `${appOrigin}/api/auth/magic-link/verify?token=${'x'.repeat(900)}`,
    expiresInSeconds: 86400,
    emailSalutation: 'M'.repeat(128),
  });
  const longAnnouncement = createNotificationEmail(
    notificationPayloadSchema.parse({
      kind: 'announcement',
      eventName: 'W'.repeat(200),
      timezone: 'Europe/Prague',
      announcementId: '11111111-1111-4111-8111-111111111111',
      title: 'W'.repeat(160),
      body: 'W'.repeat(1000),
    }),
    {},
    appOrigin,
  );
  for (const [name, content] of [
    ['long-auth-no-assets', longAuth],
    ['long-announcement-no-assets', longAnnouncement],
  ]) {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.setContent(content.html);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(
      overflow,
      false,
      `${name} must fit mobile with fonts unavailable`,
    );
    assert.ok(await page.locator('a.cta').isVisible());
    checks.push({ name, width: 375, overflow });
  }
  await writeFile(
    new URL('layout-checks.json', directory),
    `${JSON.stringify(checks, null, 2)}\n`,
  );
  console.log(
    `${checks.length} email layout checks passed; desktop, mobile and dark screenshots updated.`,
  );
} finally {
  await browser.close();
}
