import { participantProgramFixtures } from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';

import '../../app/styles.css';
import ParticipantLayout from '../../app/app/layout';
import { ResourceStatus } from '../../components/content-state';
import { ProgramView } from '../../components/program-view';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const program = participantProgramFixtures.happy!;

const api = createFetchApiClient({
  maxRetries: 0,
  fetch: async () =>
    Response.json(program, {
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'component-quality-0001',
      },
    }),
});

const ParticipantProgramProbe = () => (
  <main
    id="main"
    data-testid="participant-shell-program"
    style={
      {
        '--byzon-font-body': 'Arial, sans-serif',
        '--byzon-font-display': 'Arial, sans-serif',
        fontFamily: 'Arial, sans-serif',
      } as React.CSSProperties
    }
  >
    <ParticipantLayout>
      <section
        className="app-page"
        data-testid="participant-program"
        aria-labelledby="program-heading"
      >
        <h1 id="program-heading" data-route-heading tabIndex={-1}>
          Program
        </h1>
        <ProgramView eventId={program.eventId} api={api} />
      </section>
    </ParticipantLayout>
  </main>
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
    expect(getComputedStyle(navigationElement).position).toBe('sticky');
    expect(navigationElement.querySelectorAll('a')).toHaveLength(4);
    for (const link of navigationElement.querySelectorAll('a')) {
      const bounds = link.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
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

    await expect
      .element(screen.getByTestId('participant-shell-program'))
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
