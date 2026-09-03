import {
  contentFixtureIds,
  identityBootstrapFixtures,
  participantContentFixtures,
  participantProgramFixtures,
} from '@byzon/test-support/fixtures';
import type { CSSProperties, ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { cdp } from 'vitest/browser';

import '../../app/styles.css';
import { ParticipantLayoutShell as ParticipantLayout } from '../../components/participant-layout-shell';
import { SpeakerDetail } from '../../components/content-directory';
import { ResourceStatus } from '../../components/content-state';
import { ProgramView } from '../../components/program-view';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const program = participantProgramFixtures.happy!;
const qualityProgram = {
  ...program,
  program: {
    ...program.program,
    sessions: program.program.sessions.filter(
      ({ id }) =>
        id === contentFixtureIds.opening || id === contentFixtureIds.workshop,
    ),
  },
};
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
    <ParticipantLayout
      accountScope={{ kind: 'active', eventId: program.eventId }}
      navigationMode="active-preview"
    >
      {children}
    </ParticipantLayout>
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
        api={apiFor(qualityProgram, 'component-quality-program-0001')}
      />
    </section>
  </ParticipantProbe>
);

const SpeakerParticipantProbe = () => (
  <main
    id="main"
    data-testid="speaker-participant-shell"
    style={visualTestStyle}
    tabIndex={-1}
  >
    <ParticipantLayout
      accountApi={apiFor(
        {
          ...identityBootstrapFixtures.complete!,
          membership: {
            ...identityBootstrapFixtures.complete!.membership,
            access: { state: 'active' },
            roles: ['participant', 'speaker'],
          },
        },
        'component-speaker-account-0001',
      )}
      accountScope={{ kind: 'active', eventId: program.eventId }}
      navigationMode="active-preview"
    >
      <section className="app-page">
        <h1 data-route-heading tabIndex={-1}>
          Program
        </h1>
      </section>
    </ParticipantLayout>
  </main>
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

const ArchivedParticipantProbe = () => (
  <main
    id="main"
    data-testid="archived-participant-shell"
    style={visualTestStyle}
    tabIndex={-1}
  >
    <ParticipantLayout
      accountScope={{
        kind: 'archived',
        eventFingerprint:
          '9caa2f149fcc7d8e862b204f15035cc4a72782f6d49ef14698672e50dd3ee86a',
      }}
      navigationMode="archived-preview"
    >
      <section className="app-page">
        <h1 data-route-heading tabIndex={-1}>
          Soukromí
        </h1>
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

    await expect
      .element(
        screen.getByRole('link', {
          name: 'Detail programu: Otevření konference',
        }),
      )
      .toBeVisible();
    await expectComponentToPassAxe(screen.container);
  });

  it('preserves the approved responsive layout and visual baseline', async () => {
    const screen = await renderComponent(<ParticipantProgramProbe />);

    await expect
      .element(
        screen.getByRole('link', {
          name: 'Detail programu: Otevření konference',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Program' }))
      .toHaveFocus();

    const navigation = screen.getByRole('navigation', {
      name: 'Hlavní navigace',
    });
    const navigationElement = navigation.element();
    const pageElement = screen.getByTestId('participant-program').element();
    const tabs =
      pageElement.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    const calendar = pageElement.querySelector<HTMLElement>(
      '.program-calendar-wrap',
    );
    const mobileAgenda = pageElement.querySelector<HTMLElement>(
      '.program-mobile-agenda',
    );

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
    expect(
      navigationElement.querySelector('a[href="/app/oznameni"]'),
    ).toBeNull();
    expect(pageElement.querySelectorAll('select')).toHaveLength(0);
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      expect(tab.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    expect(calendar).not.toBeNull();
    expect(mobileAgenda).not.toBeNull();
    if (window.innerWidth <= 640) {
      expect(getComputedStyle(calendar!).display).toBe('none');
      expect(getComputedStyle(mobileAgenda!).display).toBe('block');
    } else {
      expect(getComputedStyle(calendar!).display).toBe('block');
      expect(getComputedStyle(mobileAgenda!).display).toBe('none');
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

  it('shows an accessible non-overlapping context switch to linked speakers', async () => {
    const screen = await renderComponent(<SpeakerParticipantProbe />);
    const switchLink = screen.getByRole('link', { name: 'Správa aktivit' });

    await expect.element(switchLink).toBeVisible();
    await expect.element(switchLink).toHaveAttribute('href', '/host/aktivity');
    const switchBounds = switchLink.element().getBoundingClientRect();
    const navigationBounds = screen
      .getByRole('navigation', { name: 'Hlavní navigace' })
      .element()
      .getBoundingClientRect();
    expect(switchBounds.width).toBeGreaterThanOrEqual(44);
    expect(switchBounds.height).toBeGreaterThanOrEqual(44);
    if (window.innerWidth < 768) {
      expect(switchBounds.bottom).toBeLessThanOrEqual(navigationBounds.top);
    }
    await expectComponentToPassAxe(screen.container);
  });

  it('offers only account-safe destinations in the archived shell', async () => {
    window.history.replaceState({}, '', '/app/soukromi');
    const screen = await renderComponent(<ArchivedParticipantProbe />);
    const navigation = screen.getByRole('navigation', {
      name: 'Navigace archivovaného účtu',
    });
    const links = Array.from(
      navigation.element().querySelectorAll<HTMLAnchorElement>('a'),
    );

    expect(links.map(({ pathname }) => pathname)).toEqual([
      '/app',
      '/app/soukromi',
      '/app/nastaveni',
    ]);
    expect(links.map(({ textContent }) => textContent?.trim())).toEqual([
      'Přehled',
      'Soukromí',
      'Nastavení',
    ]);
    expect(
      navigation.element().querySelector('a[href="/app/program"]'),
    ).toBeNull();
    expect(
      navigation.element().querySelector('a[href="/app/oznameni"]'),
    ).toBeNull();
    expect(
      navigation.element().querySelector('a[href="/app/vice"]'),
    ).toBeNull();
    await expect
      .element(screen.getByRole('link', { name: 'Soukromí', exact: true }))
      .toHaveAttribute('aria-current', 'page');
    for (const link of links) {
      expect(link.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    const archivedShell = screen
      .getByTestId('archived-participant-shell')
      .element();
    if (!(archivedShell instanceof HTMLElement)) {
      throw new TypeError(
        'Archived participant shell must be an HTML element.',
      );
    }
    await expectComponentToPassAxe(archivedShell);
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
