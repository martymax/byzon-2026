/** Capture only a local development server with synthetic responses.
 * Start: BYZON_FRONTEND_PREVIEW=enabled pnpm --filter @byzon/conference exec next dev --port 3100
 * Run: node scripts/capture-guide-screenshots.mjs (requires cwebp and Playwright Chromium).
 * No real invitations or API mutations are sent. */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import * as fixtures from '../packages/test-support/dist/fixtures/index.js';
const base = 'http://127.0.0.1:3100';
const output = 'apps/conference/public/guides';
await mkdir(output, { recursive: true });
const identity = structuredClone(fixtures.identityBootstrapFixtures.complete);
identity.membership = {
  access: { state: 'active' },
  roles: ['participant', 'moderator', 'speaker'],
};
const eventId = identity.event.id;
const sessionId = '019fa200-0000-7000-8000-000000000002';
const now = '2026-09-18T09:30:00.000Z';
const session = {
  id: sessionId,
  title: 'Jak vést tým a neztratit důvěru lidí',
  roomName: 'Leadership Stage',
  startsAt: now,
  endsAt: '2026-09-18T10:00:00.000Z',
};
const questions = [
  'Jak získat důvěru týmu, když přicházím jako nový vedoucí?',
  'Jak poznám, že moje změny týmu opravdu pomáhají?',
].map((text, i) => ({
  questionId: `019fa200-0000-7000-8000-00000000001${i}`,
  text,
  authorName: ['Alex Novák', 'Jana Malá'][i],
  submittedAt: now,
  answeredAt: i ? now : null,
  moderationVersion: 1,
  originals: [],
}));
const invitations = {
  eventId: fixtures.adminFixtureIds.event,
  nextCursor: null,
  items: ['moderator', 'speaker', 'room_operator'].map((role, i) => ({
    userId: `019fa200-0000-7000-8000-00000000002${i}`,
    displayName: ['Alex Novák', 'Jana Malá', 'Petr Dvořák'][i],
    email: ['alex', 'jana', 'petr'][i] + '@example.test',
    roles: [role],
    invitation: { status: i ? 'sent' : 'not_sent', lastSentAt: i ? now : null },
    delivery: 'team',
  })),
};
const browser = await chromium.launch();
try {
  for (const [device, viewport] of Object.entries({
    mobile: { width: 390, height: 844 },
    laptop: { width: 1280, height: 800 },
  })) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      locale: 'cs-CZ',
      timezoneId: 'Europe/Prague',
      serviceWorkers: 'block',
    });
    await context.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET')
        throw new Error(`Unexpected mutation: ${path}`);
      let data;
      if (path.endsWith('/me/bootstrap')) data = identity;
      else if (path.endsWith('/me/host-capabilities'))
        data = {
          eventId,
          userId: identity.user.id,
          activities: true,
          moderation: true,
          followUps: true,
          pendingAnswerCount: 1,
        };
      else if (path.endsWith('/me/announcements'))
        data = fixtures.participantAnnouncementInboxFixtures.empty_unread;
      else if (path.endsWith('/me/agenda'))
        data = fixtures.participantAgendaFixtures.empty;
      else if (path.endsWith('/program'))
        data = fixtures.participantProgramFixtures.happy;
      else if (path.endsWith('/question-context'))
        data = {
          eventId,
          session,
          serverTime: now,
          state: 'open',
          canSubmit: true,
          canReadOwn: true,
        };
      else if (
        path.includes('/moderator/sessions/') &&
        path.endsWith('/questions')
      )
        data = {
          eventId,
          sessionId,
          serverTime: now,
          items: questions,
          nextCursor: null,
          pollAfterMs: 30000,
        };
      else if (
        path.includes('/speaker/sessions/') &&
        path.endsWith('/questions')
      )
        data = {
          eventId,
          session,
          serverTime: now,
          nextCursor: null,
          items: questions.map(
            ({ authorName, moderationVersion, originals, ...q }) => ({
              ...q,
              answer: null,
              canEdit: false,
            }),
          ),
        };
      else if (path.endsWith('/admin/context'))
        data = fixtures.adminContextFixtures.organizer;
      else if (path.endsWith('/invitations')) data = invitations;
      else {
        console.log('Unhandled fixture:', path);
        return route.fulfill({ status: 404, json: {} });
      }
      await route.fulfill({
        json: data,
        headers: {
          'x-request-id': 'mock-request-0001',
          'cache-control': 'private, no-store',
          etag: '"content-program-v3"',
        },
      });
    });
    const page = await context.newPage();
    const shots = [
      ['prihlaseni', '/prihlaseni', 'h1'],
      ['program', '/app/program', 'text=Otevření konference'],
      [
        'moderovani',
        `/host/moderace/${sessionId}`,
        'text=' + questions[0].text,
      ],
      ['odpoved', `/host/dotazy/${sessionId}`, 'text=' + questions[0].text],
      ['aktivita', '/host/aktivity', 'text=Alex Novák'],
      ['pozvanky', '/admin/pozvanky', 'text=alex@example.test'],
    ];
    for (const [name, path, ready] of shots) {
      await page.goto(base + path);
      await page
        .locator(ready)
        .filter({ visible: true })
        .first()
        .waitFor({ timeout: 20000 })
        .catch(async (e) => {
          console.log(await page.locator('body').innerText());
          throw e;
        });
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({
        content:
          'nextjs-portal, #byzon-mock-mode-indicator { display: none !important; }',
      });
      if (name === 'odpoved') {
        await page
          .getByText('Napsat soukromou odpověď', { exact: true })
          .first()
          .click();
        await page
          .getByRole('textbox', { name: 'Vaše písemná odpověď' })
          .fill(
            'Začněte rozhovory s jednotlivými členy týmu. Ptejte se, co funguje a s čím potřebují pomoci.',
          );
      }
      if (['moderovani', 'odpoved', 'aktivita', 'pozvanky'].includes(name)) {
        await page
          .locator(name === 'odpoved' ? 'text=' + questions[0].text : ready)
          .filter({ visible: true })
          .first()
          .evaluate((el) => {
            window.scrollTo(
              0,
              Math.max(
                0,
                el.getBoundingClientRect().top + window.scrollY - 220,
              ),
            );
          });
      }
      await page.waitForTimeout(300);
      const tmp = `${output}/${name}-${device}.png`;
      await page.screenshot({ path: tmp, animations: 'disabled' });
      execFileSync('cwebp', [
        '-quiet',
        '-q',
        '88',
        tmp,
        '-o',
        tmp.replace('.png', '.webp'),
      ]);
      await rm(tmp);
      console.log('Captured', name, device);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
