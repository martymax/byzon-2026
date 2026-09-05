import {
  contentFixtureIds,
  participantContentProblemFixtures,
  participantContentFixtures,
  participantProgramFixtures,
  participantProgramProblemFixtures,
} from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import {
  PracticalContent,
  SpeakerDetail,
} from '../../components/content-directory';
import { EmptyContent, ResourceStatus } from '../../components/content-state';
import { ProgramView, SessionView } from '../../components/program-view';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const apiFor = (fixture: unknown) =>
  createFetchApiClient({
    maxRetries: 0,
    fetch: async () =>
      new Response(JSON.stringify(fixture), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'component-content-0001',
        },
      }),
  });

const contentAndProgramApi = createFetchApiClient({
  maxRetries: 0,
  fetch: async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    const fixture = url.endsWith('/program')
      ? participantProgramFixtures.happy
      : participantContentFixtures.happy;
    return new Response(JSON.stringify(fixture), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'component-content-program-0001',
      },
    });
  },
});

const coachingIds = {
  zone: '01910000-0000-7000-8000-00000000000d',
  radimRoom: '01910000-0000-7000-8000-00000000000e',
  stanaRoom: '01910000-0000-7000-8000-00000000000f',
  radim: '01910000-0000-7000-8000-000000000010',
  stana: '01910000-0000-7000-8000-000000000011',
} as const;

const coachingProgram = (() => {
  const fixture = participantProgramFixtures.happy!;
  const room = fixture.program.rooms[0]!;
  const session = fixture.program.sessions[0]!;
  return {
    ...fixture,
    program: {
      ...fixture.program,
      days: fixture.program.days.map((day) => ({
        ...day,
        title:
          day.localDate === '2026-09-18' ? '18. září 2026' : '19. září 2026',
      })),
      rooms: [
        ...fixture.program.rooms,
        {
          ...room,
          id: coachingIds.zone,
          slug: 'koucovaci-zona',
          name: 'Koučovací zóna',
          sortOrder: 2,
        },
        {
          ...room,
          id: coachingIds.radimRoom,
          slug: 'koucovaci-zona-radim',
          name: 'Koučovací zóna · Radim Roček',
          sortOrder: 3,
        },
        {
          ...room,
          id: coachingIds.stanaRoom,
          slug: 'koucovaci-zona-stana',
          name: 'Koučovací zóna · Stanislava Maunová',
          sortOrder: 4,
        },
      ],
      sessions: [
        ...fixture.program.sessions,
        {
          ...session,
          id: coachingIds.radim,
          roomId: coachingIds.radimRoom,
          slug: 'koucink-radim-0915',
          title: 'Koučink – Radim Roček',
          summary: 'Koučovací zóna · Individuální 30minutový koučink',
          description: null,
          type: 'coaching' as const,
          startsAt: '2026-09-18T07:15:00.000Z',
          endsAt: '2026-09-18T07:45:00.000Z',
          sortOrder: 20,
        },
        {
          ...session,
          id: coachingIds.stana,
          roomId: coachingIds.stanaRoom,
          slug: 'koucink-stana-0915',
          title: 'Koučink – Stanislava Maunová',
          summary: 'Koučovací zóna · Individuální 30minutový koučink',
          description: null,
          type: 'coaching' as const,
          startsAt: '2026-09-18T07:15:00.000Z',
          endsAt: '2026-09-18T07:45:00.000Z',
          sortOrder: 21,
        },
      ],
    },
  };
})();

const budeHubProgram = (() => {
  const fixture = participantProgramFixtures.happy!;
  return {
    ...fixture,
    program: {
      ...fixture.program,
      rooms: fixture.program.rooms.map((room) =>
        room.id === contentFixtureIds.workshopRoom
          ? {
              ...room,
              name: 'Bude Hub',
              description: 'Rudolfovská tř. 34, České Budějovice',
            }
          : room,
      ),
    },
  };
})();

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, '', window.location.pathname);
});

describe('CS-CONTENT-01 participant UI', () => {
  it('switches conference days and preserves the selection in the URL', async () => {
    const screen = await renderComponent(
      <ProgramView
        eventId={participantProgramFixtures.happy!.eventId}
        api={apiFor(participantProgramFixtures.happy)}
      />,
    );

    await expect
      .element(
        screen.getByRole('link', {
          name: 'Detail programu: Otevření konference',
        }),
      )
      .toBeVisible();
    await screen.getByRole('tab', { name: 'Sobota' }).click();
    await expect
      .element(
        screen.getByRole('link', {
          name: 'Detail programu: Růst bez zkratek',
        }),
      )
      .toBeVisible();
    expect(
      screen
        .getByRole('link', {
          name: 'Detail programu: Otevření konference',
        })
        .elements(),
    ).toHaveLength(0);
    expect(new URL(window.location.href).searchParams.get('day')).toBe(
      contentFixtureIds.saturday,
    );
    expect(new URL(window.location.href).searchParams.get('type')).toBeNull();
  });

  it('shows the Bude Hub address in desktop and mobile program layouts', async () => {
    const screen = await renderComponent(
      <ProgramView
        eventId={budeHubProgram.eventId}
        api={apiFor(budeHubProgram)}
      />,
    );

    await screen.getByRole('tab', { name: 'Sobota' }).click();
    const stageHeaders = Array.from(
      screen.container.querySelectorAll('.program-calendar__stage-head'),
    );
    const budeHubHeader = stageHeaders.find(
      (header) => header.querySelector('h3')?.textContent === 'Bude Hub',
    );
    expect(budeHubHeader?.querySelector('p')?.textContent).toBe(
      'Rudolfovská tř. 34, České Budějovice',
    );
    expect(
      Array.from(
        screen.container.querySelectorAll('.program-mobile-event__stage'),
      ).some(
        ({ textContent }) =>
          textContent === 'Bude Hub · Rudolfovská tř. 34, České Budějovice',
      ),
    ).toBe(true);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
  });

  it('shows one static-site coaching slot and defers the coach choice to its detail', async () => {
    const fixture = coachingProgram;
    const screen = await renderComponent(
      <ProgramView eventId={fixture.eventId} api={apiFor(fixture)} />,
    );

    const coachingLinks = screen
      .getByRole('link', { name: 'Detail programu: Koučovací sloty' })
      .elements();
    expect(coachingLinks).toHaveLength(1);
    expect(screen.getByText('Koučink – Radim Roček').elements()).toHaveLength(
      0,
    );
    expect(
      screen.getByText('Koučink – Stanislava Maunová').elements(),
    ).toHaveLength(0);
    expect(coachingLinks[0]?.getAttribute('href')).toContain('coaching=choose');
    expect(
      Array.from(
        screen.container.querySelectorAll('.program-calendar__stage-head h3'),
      ).filter(({ textContent }) => textContent === 'Koučovací zóna'),
    ).toHaveLength(1);

    await screen.unmount();
    const detail = await renderComponent(
      <SessionView
        chooseCoach
        eventId={fixture.eventId}
        sessionId={coachingIds.radim}
        api={apiFor(fixture)}
      />,
    );

    await expect
      .element(
        detail.getByRole('heading', { level: 1, name: 'Koučovací slot' }),
      )
      .toBeVisible();
    expect(
      detail.getByRole('link', { name: 'Přidat tento bod' }).elements(),
    ).toHaveLength(0);
    await detail
      .getByRole('button', { name: /Radim Roček.*Vybrat kouče/ })
      .click();
    await expect
      .element(detail.getByRole('link', { name: 'Přidat tento bod' }))
      .toHaveAttribute(
        'href',
        `/api/v1/events/${fixture.eventId}/program/${coachingIds.radim}/calendar.ics`,
      );
    await expect
      .element(
        detail.getByRole('button', {
          name: /Stanislava Maunová.*Vybrat kouče/,
        }),
      )
      .toBeVisible();
    await expectComponentToPassAxe(detail.container);
  });

  it('renders explicit empty and offline recovery states with touch targets', async () => {
    const retry = vi.fn();
    const screen = await renderComponent(
      <>
        <ResourceStatus state={{ status: 'offline' }} onRetry={retry} />
        <EmptyContent
          title="Program zatím není publikovaný"
          detail="Obsah se objeví po publikaci."
        />
      </>,
    );

    const action = screen.getByRole('button', { name: 'Zkusit znovu' });
    await expect.element(screen.getByText('Jste offline')).toBeVisible();
    await expect
      .element(screen.getByText('Program zatím není publikovaný'))
      .toBeVisible();
    await action.click();
    expect(retry).toHaveBeenCalledOnce();
    const bounds = await action.element().getBoundingClientRect();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  });

  it('offers a portable calendar export on the program detail', async () => {
    const fixture = participantProgramFixtures.happy!;
    const session = fixture.program.sessions[0]!;
    const screen = await renderComponent(
      <SessionView
        eventId={fixture.eventId}
        sessionId={session.id}
        api={apiFor(fixture)}
      />,
    );

    await expect
      .element(screen.getByText(/Google Kalendáři, Apple Kalendáři/))
      .toBeVisible();
    const exportLink = screen
      .getByRole('link', { name: 'Přidat tento bod' })
      .element();
    expect(exportLink.getAttribute('href')).toBe(
      `/api/v1/events/${fixture.eventId}/program/${session.id}/calendar.ics`,
    );
    expect(exportLink.getAttribute('download')).toBe(
      `byzon-2026-${session.slug}.ics`,
    );
    const bounds = exportLink.getBoundingClientRect();
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });

  it('maps an obfuscated server permission response to safe participant copy', async () => {
    const problem = participantProgramProblemFixtures.permission!;
    const api = createFetchApiClient({
      maxRetries: 0,
      fetch: async () =>
        Response.json(problem, {
          status: problem.status,
          headers: {
            'content-type': 'application/problem+json',
            'x-request-id': problem.requestId,
          },
        }),
    });
    const screen = await renderComponent(
      <ProgramView
        eventId={participantProgramFixtures.happy!.eventId}
        api={api}
      />,
    );

    await expect.element(screen.getByText('Obsah není dostupný')).toBeVisible();
    await expect.element(screen.getByText(/nemáte přístup/)).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Zpět na přehled' }))
      .toHaveAttribute('href', '/app');
    expect(document.body.textContent).not.toContain(problem.detail);
  });

  it('returns an expired content session to the original safe task', async () => {
    const screen = await renderComponent(
      <ResourceStatus
        loginReturnTo="/app/program"
        onRetry={vi.fn()}
        state={{ status: 'session_expired' }}
      />,
    );

    await expect
      .element(screen.getByRole('link', { name: 'Přihlásit se znovu' }))
      .toHaveAttribute(
        'href',
        '/prihlaseni?mode=recovery&returnTo=%2Fapp%2Fprogram',
      );
    expect(
      screen.getByRole('button', { name: 'Zkusit znovu' }).elements(),
    ).toHaveLength(0);
  });

  it('keeps list and detail recovery links on their original production routes', async () => {
    const programProblem = participantProgramProblemFixtures.authentication!;
    const programApi = createFetchApiClient({
      maxRetries: 0,
      fetch: async () =>
        Response.json(programProblem, {
          status: programProblem.status,
          headers: {
            'content-type': 'application/problem+json',
            'x-request-id': programProblem.requestId,
          },
        }),
    });
    const programScreen = await renderComponent(
      <ProgramView
        eventId={participantProgramFixtures.happy!.eventId}
        api={programApi}
      />,
    );
    await expect
      .element(programScreen.getByRole('link', { name: 'Přihlásit se znovu' }))
      .toHaveAttribute(
        'href',
        '/prihlaseni?mode=recovery&returnTo=%2Fapp%2Fprogram',
      );
    await programScreen.unmount();

    const sessionId = participantProgramFixtures.happy!.program.sessions[0]!.id;
    const sessionScreen = await renderComponent(
      <SessionView
        eventId={participantProgramFixtures.happy!.eventId}
        sessionId={sessionId}
        api={programApi}
      />,
    );
    await expect
      .element(sessionScreen.getByRole('link', { name: 'Přihlásit se znovu' }))
      .toHaveAttribute(
        'href',
        `/prihlaseni?mode=recovery&returnTo=${encodeURIComponent(
          `/app/program/${sessionId}`,
        )}`,
      );
    await sessionScreen.unmount();

    const agendaSessionScreen = await renderComponent(
      <SessionView
        eventId={participantProgramFixtures.happy!.eventId}
        returnOrigin="agenda"
        sessionId={sessionId}
        api={programApi}
      />,
    );
    await expect
      .element(
        agendaSessionScreen.getByRole('link', {
          name: 'Přihlásit se znovu',
        }),
      )
      .toHaveAttribute(
        'href',
        `/prihlaseni?mode=recovery&returnTo=${encodeURIComponent(
          `/app/program/${sessionId}?from=agenda`,
        )}`,
      );
    await agendaSessionScreen.unmount();

    const contentProblem = participantContentProblemFixtures.authentication!;
    const contentApi = createFetchApiClient({
      maxRetries: 0,
      fetch: async () =>
        Response.json(contentProblem, {
          status: contentProblem.status,
          headers: {
            'content-type': 'application/problem+json',
            'x-request-id': contentProblem.requestId,
          },
        }),
    });
    const speakerSlug =
      participantContentFixtures.happy!.content.speakers[0]!.slug;
    const speakerScreen = await renderComponent(
      <SpeakerDetail
        eventId={participantContentFixtures.happy!.eventId}
        slug={speakerSlug}
        api={contentApi}
      />,
    );
    await expect
      .element(speakerScreen.getByRole('link', { name: 'Přihlásit se znovu' }))
      .toHaveAttribute(
        'href',
        `/prihlaseni?mode=recovery&returnTo=${encodeURIComponent(
          `/app/recnici/${speakerSlug}`,
        )}`,
      );
  });

  it('shows the published speaker medallion and all configured social links', async () => {
    const speaker = participantContentFixtures.happy!.content.speakers[0]!;
    const screen = await renderComponent(
      <SpeakerDetail
        eventId={participantContentFixtures.happy!.eventId}
        slug={speaker.slug}
        api={apiFor(participantContentFixtures.happy)}
      />,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          name: `${speaker.firstName} ${speaker.lastName}`,
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Instagram' }))
      .toHaveAttribute('href', speaker.instagramUrl!);
    await expect
      .element(screen.getByRole('link', { name: 'Facebook' }))
      .toHaveAttribute('href', speaker.facebookUrl!);
  });

  it('links the speaker to their published program item', async () => {
    const speaker = participantContentFixtures.happy!.content.speakers[0]!;
    const session = participantProgramFixtures.happy!.program.sessions.find(
      (item) => item.speakerIds?.includes(speaker.id),
    )!;
    const screen = await renderComponent(
      <SpeakerDetail
        eventId={participantContentFixtures.happy!.eventId}
        slug={speaker.slug}
        api={contentAndProgramApi}
      />,
    );

    await expect
      .element(screen.getByRole('heading', { level: 2, name: 'V programu' }))
      .toBeVisible();
    const link = screen.getByRole('link', {
      name: `Detail bodu programu: ${session.title}`,
    });
    await expect
      .element(link)
      .toHaveAttribute('href', `/app/program/${session.id}`);
    await expect.element(screen.getByText(session.summary!)).toBeVisible();
    const bounds = await link.element().getBoundingClientRect();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
    await expectComponentToPassAxe(screen.container);
  });

  it('wraps long Czech practical content without horizontal overflow', async () => {
    const screen = await renderComponent(
      <PracticalContent
        eventId={participantContentFixtures.happy!.eventId}
        api={apiFor(participantContentFixtures.happy)}
      />,
    );

    await expect.element(screen.getByText('Před příjezdem')).toBeVisible();
    await expect
      .element(screen.getByText(/Extrémnědlouhéčeskéslovoproověřeníbezpečného/))
      .toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth,
    );
  });

  it('shows a useful empty state for an empty practical-content response', async () => {
    const screen = await renderComponent(
      <PracticalContent
        eventId={participantContentFixtures.empty!.eventId}
        api={apiFor(participantContentFixtures.empty)}
      />,
    );

    await expect
      .element(screen.getByText('Praktické informace zatím nejsou zveřejněné'))
      .toBeVisible();
  });
});
