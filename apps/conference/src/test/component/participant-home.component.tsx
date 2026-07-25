import {
  participantContentFixtures,
  participantProgramFixtures,
} from '@byzon/test-support/fixtures';
import type { CSSProperties } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import ParticipantLayout from '../../app/app/layout';
import {
  ParticipantHome,
  type ParticipantEventPhase,
  type ParticipantHomeEvent,
} from '../../components/participant-home';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const program = participantProgramFixtures.happy!;
const content = participantContentFixtures.happy!;
const event: ParticipantHomeEvent = {
  id: program.eventId,
  phase: 'live',
  timezone: content.content.event.timezone,
  startsAt: content.content.event.startsAt,
  endsAt: content.content.event.endsAt,
};
const visualTestStyle = {
  '--byzon-font-body': 'Arial, sans-serif',
  '--byzon-font-display': 'Arial, sans-serif',
  fontFamily: 'Arial, sans-serif',
} as CSSProperties;

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

const HomeProbe = ({
  nextSavedSessionId,
  now = '2026-09-18T07:30:00.000Z',
  phase = 'live',
}: {
  readonly nextSavedSessionId?: string | null;
  readonly now?: string;
  readonly phase?: ParticipantEventPhase;
}) => (
  <main
    id="main"
    data-testid="participant-home-shell"
    style={visualTestStyle}
    tabIndex={-1}
  >
    <ParticipantLayout>
      <ParticipantHome
        contentApi={apiFor(content, 'component-home-content-0001')}
        event={{ ...event, phase }}
        now={now}
        programApi={apiFor(program, 'component-home-program-0001')}
        {...(nextSavedSessionId === undefined ? {} : { nextSavedSessionId })}
      />
    </ParticipantLayout>
  </main>
);

beforeEach(() => {
  window.history.replaceState({}, '', '/app');
});

describe('F2-02 participant home overview', () => {
  it('prioritizes phase-safe program, saved and practical information', async () => {
    const screen = await renderComponent(
      <HomeProbe nextSavedSessionId={program.program.sessions[1]!.id} />,
    );

    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Dnes na BYZON' }))
      .toHaveFocus();
    await expect
      .element(screen.getByText('Právě podle času v programu'))
      .toBeVisible();
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await expect.element(screen.getByText('Růst bez zkratek')).toBeVisible();
    await expect.element(screen.getByText('Výstaviště')).toBeVisible();

    const navigation = screen.getByRole('navigation', {
      name: 'Hlavní navigace',
    });
    expect(navigation.element().querySelectorAll('a')).toHaveLength(5);
    await expect
      .element(navigation.getByRole('link', { name: 'Přehled', exact: true }))
      .toHaveAttribute('aria-current', 'page');

    const visibleHomeLinks = Array.from(
      screen
        .getByTestId('participant-home-shell')
        .element()
        .querySelectorAll<HTMLElement>('.home-page a'),
    ).filter((link) => link.getClientRects().length > 0);
    for (const link of visibleHomeLinks) {
      expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    const homeShell = screen.getByTestId('participant-home-shell').element();
    if (!(homeShell instanceof HTMLElement)) {
      throw new TypeError('Participant home shell must be an HTML element.');
    }
    await expectComponentToPassAxe(homeShell);
    await expect
      .element(screen.getByTestId('participant-home-shell'))
      .toMatchScreenshot('participant-home-live', {
        comparatorOptions: {
          allowedMismatchedPixelRatio: 0.04,
        },
      });
  });

  it('states that personal agenda data is unavailable instead of inventing it', async () => {
    const screen = await renderComponent(<HomeProbe />);

    await expect
      .element(
        screen.getByText('Uložené body zatím nejsou v přehledu dostupné'),
      )
      .toBeVisible();
    expect(
      screen.getByTestId('participant-home-shell').element().textContent,
    ).not.toContain('Otevřít detail');
  });

  it('uses post-event copy and rejects an already ended saved session', async () => {
    const screen = await renderComponent(
      <HomeProbe
        nextSavedSessionId={program.program.sessions[0]!.id}
        now="2026-09-20T08:00:00.000Z"
        phase="ended"
      />,
    );

    await expect
      .element(screen.getByRole('heading', { name: 'Program po akci' }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Praktické informace' }))
      .toBeVisible();
    expect(
      screen.getByTestId('participant-home-shell').element().textContent,
    ).not.toContain('Otevřít detail');
  });

  it('does not request participant content for a closed phase', async () => {
    const fetch = vi.fn();
    const api = createFetchApiClient({ fetch });
    const screen = await renderComponent(
      <ParticipantHome
        contentApi={api}
        event={{ ...event, phase: 'archived' }}
        now="2026-10-01T08:00:00.000Z"
        programApi={api}
      />,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          level: 1,
          name: 'Tato akce už je uzavřená',
        }),
      )
      .toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });
});
