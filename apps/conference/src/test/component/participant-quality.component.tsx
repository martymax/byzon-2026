import {
  participantContentFixtures,
  participantProgramFixtures,
} from '@byzon/test-support/fixtures';
import type { CSSProperties, ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';

import '../../app/styles.css';
import ParticipantLayout from '../../app/app/layout';
import { SpeakerDetail } from '../../components/content-directory';
import { ResourceStatus } from '../../components/content-state';
import { ProgramView } from '../../components/program-view';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const program = participantProgramFixtures.happy!;
const content = participantContentFixtures.happy!;

const apiFor = (fixture: unknown, requestId: string) =>
  createFetchApiClient({
    maxRetries: 0,
    fetch: async () =>
      Response.json(fixture, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': requestId,
        },
      }),
  });

const visualTestStyle = {
  '--byzon-font-body': 'Arial, sans-serif',
  '--byzon-font-display': 'Arial, sans-serif',
  fontFamily: 'Arial, sans-serif',
} as CSSProperties;

const ParticipantProbe = ({ children }: { readonly children: ReactNode }) => (
  <main
    id="main"
    data-testid="participant-shell"
    style={visualTestStyle}
    tabIndex={-1}
  >
    <ParticipantLayout>{children}</ParticipantLayout>
  </main>
);

const ParticipantProgramProbe = () => (
  <ParticipantProbe>
    <section
      className="app-page"
      data-testid="participant-program"
      aria-labelledby="program-heading"
    >
      <h1 id="program-heading" data-route-heading tabIndex={-1}>
        Program
      </h1>
      <ProgramView
        eventId={program.eventId}
        api={apiFor(program, 'component-quality-program-0001')}
      />
    </section>
  </ParticipantProbe>
);

const ParticipantSpeakerProbe = () => (
  <ParticipantProbe>
    <section className="app-page">
      <SpeakerDetail
        eventId={content.eventId}
        slug={content.content.speakers[0]!.slug}
        api={apiFor(content, 'component-quality-speaker-0001')}
      />
    </section>
  </ParticipantProbe>
);

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/app/program');
});

describe('F2-06 participant shell and program quality gate', () => {
  it('passes the automatic WCAG A/AA component baseline', async () => {
    const screen = await renderComponent(<ParticipantProgramProbe />);

    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await expectComponentToPassAxe(screen.container);
  });

  it('preserves the approved responsive layout and visual baseline', async () => {
    const screen = await renderComponent(<ParticipantProgramProbe />);

    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Program' }))
      .toHaveFocus();

    const navigation = screen.getByRole('navigation', {
      name: 'Hlavní navigace',
    });
    const navigationElement = navigation.element();
    const pageElement = screen.getByTestId('participant-program').element();
    const filters = pageElement.querySelectorAll('select');

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    expect(navigationElement.querySelectorAll('a')).toHaveLength(5);
    for (const link of navigationElement.querySelectorAll('a')) {
      const bounds = link.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(link.querySelector('svg')).not.toBeNull();
    }
    await expect
      .element(screen.getByRole('link', { name: 'Program', exact: true }))
      .toHaveAttribute('aria-current', 'page');
    await expect
      .element(screen.getByRole('link', { name: 'Oznámení', exact: true }))
      .toHaveAttribute('href', '/app/oznameni');
    expect(filters).toHaveLength(2);
    for (const filter of filters) {
      expect(filter.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }

    const firstFilter = filters[0]!.getBoundingClientRect();
    const secondFilter = filters[1]!.getBoundingClientRect();
    if (window.innerWidth <= 576) {
      expect(secondFilter.top).toBeGreaterThanOrEqual(firstFilter.bottom);
    } else {
      expect(Math.abs(secondFilter.top - firstFilter.top)).toBeLessThan(2);
    }

    const shellContent = pageElement.closest<HTMLElement>(
      '.participant-shell-content',
    );
    expect(shellContent).not.toBeNull();
    if (window.innerWidth < 768) {
      expect(getComputedStyle(navigationElement).position).toBe('fixed');
      expect(navigationElement.getBoundingClientRect().bottom).toBeCloseTo(
        window.innerHeight,
        0,
      );
      expect(
        Number.parseFloat(getComputedStyle(shellContent!).paddingBottom),
      ).toBeGreaterThanOrEqual(
        navigationElement.getBoundingClientRect().height,
      );
    } else {
      expect(getComputedStyle(navigationElement).position).toBe('sticky');
      expect(
        Number.parseFloat(getComputedStyle(shellContent!).paddingBottom),
      ).toBe(0);
    }

    await expect
      .element(screen.getByTestId('participant-shell'))
      .toMatchScreenshot('participant-shell-program', {
        comparatorOptions: {
          allowedMismatchedPixelRatio: 0.04,
          threshold: 0.2,
        },
        screenshotOptions: {
          animations: 'disabled',
          caret: 'hide',
          scale: 'css',
        },
      });
  });

  it('keeps the parent destination active and a canonical return on a deep link', async () => {
    window.history.replaceState({}, '', '/app/recnici/jana-novakova');
    const screen = await renderComponent(<ParticipantSpeakerProbe />);

    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Jana Nováková' }))
      .toHaveFocus();
    await expect
      .element(screen.getByRole('link', { name: 'Řečníci', exact: true }))
      .toHaveAttribute('aria-current', 'page');
    await expect
      .element(screen.getByRole('link', { name: 'Zpět na řečníky' }))
      .toHaveAttribute('href', '/app/recnici');
  });

  it('removes content progress animation for reduced-motion users', async () => {
    const session = cdp();
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });

    try {
      const screen = await renderComponent(
        <ResourceStatus
          state={{ status: 'loading' }}
          onRetry={() => undefined}
        />,
      );
      const progress =
        screen.container.querySelector<HTMLElement>('.resource-progress');

      expect(
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      ).toBe(true);
      expect(progress).not.toBeNull();
      expect(getComputedStyle(progress!).animationName).toBe('none');
    } finally {
      await session.send('Emulation.setEmulatedMedia', {
        features: [],
      });
    }
  });
});
