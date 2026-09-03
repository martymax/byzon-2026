import {
  contentFixtureIds,
  identityBootstrapFixtures,
  participantContentFixtures,
  participantContentProblemFixtures,
  participantAgendaFixtures,
  participantProgramFixtures,
  participantProgramProblemFixtures,
} from '@byzon/test-support/fixtures';
import type { CSSProperties } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import { ParticipantLayoutShell as ParticipantLayout } from '../../components/participant-layout-shell';
import {
  ParticipantHome,
  type ParticipantEventPhase,
  type ParticipantHomeEvent,
} from '../../components/participant-home';
import {
  ParticipantAccountResourceProvider,
  useParticipantAccountResource,
} from '../../components/participant-account-resource';
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
}) => {
  const agendaFixture =
    nextSavedSessionId === undefined
      ? null
      : nextSavedSessionId === contentFixtureIds.workshop
        ? participantAgendaFixtures.reserved!
        : nextSavedSessionId === contentFixtureIds.opening
          ? participantAgendaFixtures.saved!
          : participantAgendaFixtures.empty!;
  const scopedAgenda = agendaFixture
    ? {
        ...agendaFixture,
        eventId: event.id,
        userId: identityBootstrapFixtures.complete!.user.id,
        eventTimezone: event.timezone,
      }
    : null;
  const scopedIdentity = {
    ...identityBootstrapFixtures.complete!,
    event: {
      ...identityBootstrapFixtures.complete!.event,
      id: event.id,
      phase,
    },
    membership: {
      access: { state: 'active' as const },
      roles: ['participant' as const],
    },
  };
  return (
    <main
      id="main"
      data-testid="participant-home-shell"
      style={visualTestStyle}
      tabIndex={-1}
    >
      <ParticipantLayout
        accountApi={apiFor(scopedIdentity, 'component-home-account-probe-0001')}
        accountScope={{ kind: 'active', eventId: event.id }}
        navigationMode="active-preview"
      >
        <ParticipantHome
          contentApi={apiFor(content, 'component-home-content-0001')}
          enableAgendaJourney
          event={{ ...event, phase }}
          now={now}
          programApi={apiFor(program, 'component-home-program-0001')}
          {...(scopedAgenda
            ? {
                agendaApi: apiFor(scopedAgenda, 'component-home-agenda-0001'),
              }
            : {})}
        />
      </ParticipantLayout>
    </main>
  );
};

const CanonicalPrivateClear = () => {
  const resource = useParticipantAccountResource();
  return (
    <button onClick={() => void resource.clearPrivateData()} type="button">
      Potvrdit globální vymazání
    </button>
  );
};

const AccountResourceActivationProbe = () => {
  const resource = useParticipantAccountResource();
  return <span data-testid="account-probe-state">{resource.state.status}</span>;
};

beforeEach(() => {
  window.history.replaceState({}, '', '/app');
});

describe('F2-02 participant home overview', () => {
  it('prioritizes phase-safe program, saved and practical information', async () => {
    const screen = await renderComponent(
      <HomeProbe nextSavedSessionId={contentFixtureIds.workshop} />,
    );

    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Dnes na BYZON' }))
      .toHaveFocus();
    const currentTimingLabels = screen
      .getByText('Právě podle času v programu')
      .elements();
    expect(currentTimingLabels).toHaveLength(2);
    for (const label of currentTimingLabels) {
      expect(label.getClientRects()).not.toHaveLength(0);
    }
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await expect
      .element(screen.getByText('Překrývající se workshop', { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText('Růst bez zkratek')).toBeVisible();
    await expect.element(screen.getByText('Výstaviště')).toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Naši partneři' }))
      .toBeVisible();
    await expect.element(screen.getByText('Syntetický partner')).toBeVisible();
    const partnersFooter = screen.getByTestId('participant-partners-footer');
    await expect.element(partnersFooter).toBeVisible();
    await expect.element(partnersFooter).toMatchScreenshot('home-partners', {
      comparatorOptions: { allowedMismatchedPixelRatio: 0.02 },
      screenshotOptions: {
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      },
    });

    const navigation = screen.getByRole('navigation', {
      name: 'Hlavní navigace',
    });
    expect(navigation.element().querySelectorAll('a')).toHaveLength(5);
    expect(
      Array.from(navigation.element().querySelectorAll('a')).map((link) =>
        link.textContent?.trim(),
      ),
    ).toEqual(['Program', 'Agenda', 'Networking', 'Řečníci', 'Můj účet']);
    expect(
      navigation.element().querySelector('[aria-current="page"]'),
    ).toBeNull();

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

  it('does not mount or expose the mock-only agenda outside frontend preview', async () => {
    const agendaFetch = vi.fn();
    const screen = await renderComponent(
      <ParticipantHome
        agendaApi={createFetchApiClient({ fetch: agendaFetch })}
        contentApi={apiFor(content, 'component-home-content-production-0001')}
        enableAgendaJourney={false}
        event={event}
        now="2026-09-18T07:30:00.000Z"
        programApi={apiFor(program, 'component-home-program-production-0001')}
      />,
    );

    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    expect(agendaFetch).not.toHaveBeenCalled();
    expect(screen.getByText('Moje další položka').elements()).toHaveLength(0);
    expect(document.querySelectorAll('a[href="/app/agenda"]')).toHaveLength(0);
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
        enableAgendaJourney
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

  it.each(['content', 'program'] as const)(
    'wipes a ready sibling resource when delayed %s auth expires',
    async (delayedResource) => {
      let releaseFailure: (() => void) | undefined;
      const failureGate = new Promise<void>((resolve) => {
        releaseFailure = resolve;
      });
      const delayedApi = createFetchApiClient({
        maxRetries: 0,
        fetch: async () => {
          await failureGate;
          const fixture =
            delayedResource === 'content'
              ? participantContentProblemFixtures.authentication!
              : participantProgramProblemFixtures.authentication!;
          return Response.json(fixture, {
            status: fixture.status,
            headers: {
              'content-type': 'application/problem+json',
              'x-request-id': fixture.requestId,
            },
          });
        },
      });
      const screen = await renderComponent(
        <ParticipantHome
          contentApi={
            delayedResource === 'content'
              ? delayedApi
              : apiFor(content, 'component-home-content-ready-0001')
          }
          enableAgendaJourney
          event={event}
          now="2026-09-18T07:30:00.000Z"
          programApi={
            delayedResource === 'program'
              ? delayedApi
              : apiFor(program, 'component-home-program-ready-0001')
          }
        />,
      );
      const privateCopy =
        delayedResource === 'content' ? 'Otevření konference' : 'Výstaviště';
      await expect.element(screen.getByText(privateCopy)).toBeVisible();

      releaseFailure?.();

      await vi.waitFor(() => {
        expect(
          screen.getByText('Přihlášení vypršelo').elements().length,
        ).toBeGreaterThan(0);
        expect(screen.getByText(privateCopy).elements()).toHaveLength(0);
      });
      await screen.unmount();
    },
  );

  it('wipes a ready sibling even when a 401 problem response is malformed', async () => {
    let releaseFailure: (() => void) | undefined;
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const malformedUnauthorizedApi = createFetchApiClient({
      maxRetries: 0,
      fetch: async () => {
        await failureGate;
        return new Response('malformed unauthorized response', {
          status: 401,
          headers: { 'content-type': 'text/plain' },
        });
      },
    });
    const screen = await renderComponent(
      <ParticipantHome
        contentApi={malformedUnauthorizedApi}
        enableAgendaJourney
        event={event}
        now="2026-09-18T07:30:00.000Z"
        programApi={apiFor(program, 'component-home-program-malformed-0001')}
      />,
    );
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();

    releaseFailure?.();

    await vi.waitFor(() => {
      expect(screen.getByText('Otevření konference').elements()).toHaveLength(
        0,
      );
      expect(
        screen.getByText('Přihlášení vypršelo').elements().length,
      ).toBeGreaterThan(0);
      expect(
        screen.getByText('Obsah se nepodařilo načíst').elements(),
      ).toHaveLength(0);
      expect(
        screen.getByRole('link', { name: 'Přihlásit se znovu' }).elements()
          .length,
      ).toBeGreaterThan(0);
    });
  });

  it('wipes all ready home resources after a canonical account clear', async () => {
    const screen = await renderComponent(
      <ParticipantAccountResourceProvider
        api={apiFor(
          {
            ...identityBootstrapFixtures.complete!,
            membership: {
              access: { state: 'active' },
              roles: ['participant'],
            },
          },
          'component-home-account-0001',
        )}
        scope={{ kind: 'active', eventId: event.id }}
      >
        <CanonicalPrivateClear />
        <ParticipantHome
          contentApi={apiFor(content, 'component-home-content-clear-0001')}
          enableAgendaJourney
          event={event}
          now="2026-09-18T07:30:00.000Z"
          programApi={apiFor(program, 'component-home-program-clear-0001')}
        />
      </ParticipantAccountResourceProvider>,
    );
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await expect.element(screen.getByText('Výstaviště')).toBeVisible();

    await screen
      .getByRole('button', { name: 'Potvrdit globální vymazání' })
      .click();

    await vi.waitFor(() => {
      expect(screen.getByText('Otevření konference').elements()).toHaveLength(
        0,
      );
      expect(screen.getByText('Výstaviště').elements()).toHaveLength(0);
      expect(
        screen.getByText('Přihlášení vypršelo').elements().length,
      ).toBeGreaterThan(0);
    });
  });

  it('wipes ready resources when a canonical 200 bootstrap revokes membership', async () => {
    let releaseBootstrap: (() => void) | undefined;
    const bootstrapGate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const delayedSuspendedAccountApi = createFetchApiClient({
      maxRetries: 0,
      fetch: async () => {
        await bootstrapGate;
        return Response.json(identityBootstrapFixtures.suspended!, {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'component-home-suspended-0001',
          },
        });
      },
    });
    const screen = await renderComponent(
      <ParticipantAccountResourceProvider
        api={delayedSuspendedAccountApi}
        scope={{ kind: 'active', eventId: event.id }}
      >
        <AccountResourceActivationProbe />
        <ParticipantHome
          contentApi={apiFor(content, 'component-home-content-revoked-0001')}
          enableAgendaJourney
          event={event}
          now="2026-09-18T07:30:00.000Z"
          programApi={apiFor(program, 'component-home-program-revoked-0001')}
        />
      </ParticipantAccountResourceProvider>,
    );
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await expect.element(screen.getByText('Výstaviště')).toBeVisible();

    releaseBootstrap?.();

    await vi.waitFor(() => {
      expect(screen.getByText('Otevření konference').elements()).toHaveLength(
        0,
      );
      expect(screen.getByText('Výstaviště').elements()).toHaveLength(0);
      expect(
        screen.getByTestId('account-probe-state').element().textContent,
      ).toContain('suspended');
    });
  });
});
