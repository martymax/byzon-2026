import { publicContentResponseSchema } from '@byzon/domain/contracts';
import {
  participantContentFixtures,
  participantProgramFixtures,
} from '@byzon/test-support/fixtures';
import type { CSSProperties } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';

import '../../app/styles.css';
import { OfflineExperience } from '../../components/offline-experience';
import type { PublicOfflineContentResult } from '../../lib/offline/public-offline-content';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const visualTestStyle = {
  '--byzon-font-body': 'Arial, sans-serif',
  '--byzon-font-display': 'Arial, sans-serif',
  fontFamily: 'Arial, sans-serif',
} as CSSProperties;

const content = publicContentResponseSchema.parse({
  ...participantContentFixtures.happy!.content,
  program: participantProgramFixtures.happy!.program,
  version: 3,
  publishedAt: '2026-07-24T08:00:00.000Z',
});

const cached = (
  freshness: 'fresh' | 'stale' = 'stale',
  data = content,
): PublicOfflineContentResult => ({
  status: 'ready',
  data,
  source: 'cache',
  freshness,
  storedAt: '2026-07-24T08:00:00.000Z',
});

const network = (): PublicOfflineContentResult => ({
  status: 'ready',
  data: content,
  source: 'network',
  freshness: 'fresh',
  storedAt: '2026-07-25T09:15:00.000Z',
});

afterEach(() => {
  delete document.documentElement.dataset.byzonMockMode;
});

describe('offline experience', () => {
  it('shows versioned stale public content without hiding its age', async () => {
    const screen = await renderComponent(
      <div style={visualTestStyle}>
        <OfflineExperience loader={async () => cached()} />
      </div>,
    );

    await expect
      .element(screen.getByText('Uložená data mohou být zastaralá'))
      .toBeVisible();
    await expect.element(screen.getByText('verze 3')).toBeVisible();
    await expect.element(screen.getByText('BYZON 2026')).toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Nejbližší program' }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Praktické informace' }))
      .toBeVisible();
    expect(screen.container.textContent).toContain('Rezervace');
    expect(screen.container.textContent).toContain('check-in');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(screen.container);
  });

  it('makes the empty-device retry usable by keyboard and a 44px target', async () => {
    let available = false;
    const loader = vi.fn(async (): Promise<PublicOfflineContentResult> =>
      available
        ? network()
        : {
            status: 'unavailable',
            reason: 'offline',
          },
    );
    const screen = await renderComponent(
      <div style={visualTestStyle}>
        <OfflineExperience loader={loader} />
      </div>,
    );

    const retry = screen.getByRole('button', { name: 'Zkusit znovu' });
    await expect.element(retry).toBeVisible();
    expect(
      retry.element().getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
    available = true;
    retry.element().focus();
    await userEvent.keyboard('{Enter}');
    await expect
      .element(screen.getByText('Aktuální veřejná data'))
      .toBeVisible();
    expect(loader.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('identifies preview data and safely wraps long Czech content', async () => {
    document.documentElement.dataset.byzonMockMode = 'active';
    const longContent = publicContentResponseSchema.parse({
      ...content,
      event: {
        ...content.event,
        name: `BYZON ${'Nejdelšíčesképojmenováníbezmezery'.repeat(6)}`,
      },
      practical: {
        ...content.practical,
        pages: content.practical.pages.map((page, index) =>
          index === 0
            ? {
                ...page,
                summary:
                  'Přístupnost, navigace a extrémnědlouhéčeskéslovoproověřeníbezpečnéhozalomenínamalémtelefonu.',
              }
            : page,
        ),
      },
    });
    const screen = await renderComponent(
      <div style={visualTestStyle}>
        <OfflineExperience loader={async () => cached('fresh', longContent)} />
      </div>,
    );

    await expect
      .element(screen.getByText('Ukázková data · vývoj'))
      .toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(screen.container);
  });

  it('removes loading animation for reduced motion in mobile landscape', async () => {
    const browser = cdp();
    await browser.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 812,
      height: 375,
      deviceScaleFactor: 1,
      mobile: true,
      screenOrientation: { type: 'landscapePrimary', angle: 90 },
    });

    try {
      const screen = await renderComponent(
        <div style={visualTestStyle}>
          <OfflineExperience
            loader={() => new Promise<PublicOfflineContentResult>(() => {})}
          />
        </div>,
      );
      const loading = screen.getByText(
        'Ověřuji bezpečně uložený veřejný obsah…',
      );
      await expect.element(loading).toBeVisible();
      const spinner = loading.element().previousElementSibling;
      expect(spinner).toBeInstanceOf(HTMLElement);
      expect(getComputedStyle(spinner as HTMLElement).animationName).toBe(
        'none',
      );
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
      await expectComponentToPassAxe(screen.container);
    } finally {
      await browser.send('Emulation.clearDeviceMetricsOverride');
      await browser.send('Emulation.setEmulatedMedia', { features: [] });
    }
  });
});
