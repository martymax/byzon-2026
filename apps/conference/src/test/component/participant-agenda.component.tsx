import {
  identityBootstrapResponseSchema,
  participantAgendaMutationRequestSchema,
  participantAgendaMutationResponseSchema,
  participantAgendaResponseSchema,
  type ApiProblem,
  type IdentityBootstrapResponse,
  type ParticipantAgendaMutationRequest,
  type ParticipantAgendaMutationResponse,
  type ParticipantAgendaResponse,
} from '@byzon/domain/contracts';
import {
  agendaFixtureIds,
  identityBootstrapFixtures,
  participantAgendaFixtures,
  participantAgendaMutationFixtures,
  participantAgendaMutationProblemFixtures,
  participantProgramFixtures,
} from '@byzon/test-support/fixtures';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cdp, userEvent } from 'vitest/browser';

import '../../app/styles.css';
import { ParticipantAccountResourceProvider } from '../../components/participant-account-resource';
import { ParticipantAgenda } from '../../components/participant-agenda';
import {
  useParticipantAgendaResource,
  type ParticipantAgendaResource,
} from '../../components/participant-agenda-resource';
import { ParticipantSessionAgendaAction } from '../../components/participant-session-agenda-action';
import { SessionView } from '../../components/program-view';
import { RouteFocus } from '../../components/route-focus';
import type { ApiPort } from '../../lib/api';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { queueApprovedOfflineAgendaMutation } from '../../lib/offline/offline-agenda';
import {
  listOfflineAgendaQueue,
  readParticipantOfflineEpoch,
  updateOfflineAgendaQueueRecord,
  wipeAllParticipantOfflineData,
  writeOfflineAgendaSnapshot,
} from '../../lib/offline/offline-database';
import { waitForParticipantPrivateResourceCleanup } from '../../lib/private-resource-events';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const visualTestStyle = {
  '--byzon-font-body': 'Arial, sans-serif',
  '--byzon-font-display': 'Arial, sans-serif',
  fontFamily: 'Arial, sans-serif',
} as CSSProperties;

const responseHeaders = {
  'content-type': 'application/json',
  'x-request-id': 'component-agenda-0001',
};

const jsonResponse = (fixture: unknown) =>
  Response.json(fixture, { headers: responseHeaders });

const problemResponse = (problem: ApiProblem) =>
  Response.json(problem, {
    status: problem.status,
    headers: {
      'content-type': 'application/problem+json',
      'x-request-id': problem.requestId,
    },
  });

const requestUrl = (input: RequestInfo | URL): URL => {
  const value =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.toString()
        : input;
  return new URL(value, window.location.origin);
};

const requestMethod = (input: RequestInfo | URL, init?: RequestInit): string =>
  init?.method ?? (input instanceof Request ? input.method : 'GET');

const activeIdentity = identityBootstrapResponseSchema.parse({
  ...identityBootstrapFixtures.complete!,
  event: {
    ...identityBootstrapFixtures.complete!.event,
    id: agendaFixtureIds.event,
    phase: 'live',
  },
  user: {
    ...identityBootstrapFixtures.complete!.user,
    id: agendaFixtureIds.user,
  },
  membership: {
    access: { state: 'active' },
    roles: ['participant'],
  },
});

const endedIdentity = identityBootstrapResponseSchema.parse({
  ...activeIdentity,
  event: { ...activeIdentity.event, phase: 'ended' },
  profileManagement: { state: 'read_only' },
});

const otherScope = {
  eventId: '01930000-0000-7000-8000-0000000000e1',
  userId: '01930000-0000-7000-8000-0000000000e2',
} as const;

const identityForScope = (
  eventId: string,
  userId: string,
): IdentityBootstrapResponse =>
  identityBootstrapResponseSchema.parse({
    ...activeIdentity,
    event: { ...activeIdentity.event, id: eventId },
    user: { ...activeIdentity.user, id: userId },
  });

const accountApiFor = (identity: IdentityBootstrapResponse): ApiPort =>
  createFetchApiClient({
    maxRetries: 0,
    fetch: async (input) => {
      expect(requestUrl(input).pathname).toBe('/api/v1/me/bootstrap');
      return jsonResponse(identity);
    },
  });

type AgendaMutationResponder = (
  body: ParticipantAgendaMutationRequest,
  init: RequestInit | undefined,
  callIndex: number,
) => Promise<Response> | Response;

const agendaApiFor = ({
  onRead,
  onMutation,
}: {
  readonly onRead:
    (() => Promise<Response> | Response) | ParticipantAgendaResponse;
  readonly onMutation?: AgendaMutationResponder;
}) => {
  let mutationCalls = 0;
  const fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = requestUrl(input);
      if (
        url.pathname === '/api/v1/me/agenda' &&
        requestMethod(input, init) === 'GET'
      ) {
        return typeof onRead === 'function' ? onRead() : jsonResponse(onRead);
      }
      if (
        url.pathname === '/api/v1/me/agenda/actions' &&
        requestMethod(input, init) === 'POST' &&
        onMutation
      ) {
        const request = participantAgendaMutationRequestSchema.parse(
          JSON.parse(String(init?.body)),
        );
        const index = mutationCalls;
        mutationCalls += 1;
        return onMutation(request, init, index);
      }
      throw new TypeError(
        `Unexpected agenda component request ${requestMethod(
          input,
          init,
        )} ${url.pathname}`,
      );
    },
  );
  return {
    api: createFetchApiClient({ fetch, maxRetries: 0 }),
    fetch,
    mutationCount: () => mutationCalls,
  };
};

const mutationResponse = (
  snapshot: ParticipantAgendaResponse,
  mutation: ParticipantAgendaMutationResponse['mutation'],
  expectedVersion: number,
): ParticipantAgendaMutationResponse =>
  participantAgendaMutationResponseSchema.parse({
    ...snapshot,
    version: Math.max(snapshot.version, expectedVersion + 1),
    mutation,
    timeConflict: null,
  });

const emptyMutationResponse = (
  request: ParticipantAgendaMutationRequest,
): ParticipantAgendaMutationResponse =>
  mutationResponse(
    participantAgendaFixtures.empty!,
    {
      action: request.action,
      outcome: 'applied',
      sessionId: request.sessionId,
    },
    request.expectedVersion,
  );

const reservableAgenda = participantAgendaResponseSchema.parse({
  ...participantAgendaFixtures.reserved!,
  items: participantAgendaFixtures.reserved!.items.map((item) => ({
    day: item.day,
    session: item.session,
    state: 'saved',
    source: 'manual',
    savedAt: participantAgendaFixtures.reserved!.serverNow,
    capacity: item.capacity,
    action: { state: 'available' },
  })),
});

const coachingAgenda = participantAgendaResponseSchema.parse({
  ...reservableAgenda,
  items: reservableAgenda.items.map((item) => ({
    ...item,
    day: { localDate: '2026-09-18', title: 'Pátek' },
    session: {
      ...item.session,
      title: 'Koučink – Radim Roček',
      startsAt: '2026-09-18T07:15:00.000Z',
      endsAt: '2026-09-18T07:45:00.000Z',
      room: null,
    },
    capacity: {
      mode: 'reservation',
      capacity: 1,
      confirmed: 0,
      held: 0,
      remaining: 1,
      waitlistAvailable: false,
      actorAvailability: { state: 'available' },
    },
  })),
});

const joinableAgenda = participantAgendaResponseSchema.parse({
  ...participantAgendaFixtures.waiting!,
  items: participantAgendaFixtures.waiting!.items.map((item) => ({
    day: item.day,
    session: item.session,
    state: 'saved',
    source: 'manual',
    savedAt: participantAgendaFixtures.waiting!.serverNow,
    capacity: item.capacity,
    action: { state: 'capacity_full' },
  })),
});

const conflictMutation =
  participantAgendaMutationFixtures.reserved_with_conflict!;
const conflictWarning = conflictMutation.timeConflict;
if (!conflictWarning) {
  throw new TypeError('Conflict mutation fixture must carry a warning.');
}
const reservationConflictProblem = (() => {
  const problem = participantAgendaMutationProblemFixtures.reservation_conflict;
  if (problem?.code !== 'RESERVATION_CONFLICT') {
    throw new TypeError('Reservation conflict fixture must be available.');
  }
  return problem;
})();
const conflictInitialAgenda = reservationConflictProblem.agenda;

const agendaForScope = (
  snapshot: ParticipantAgendaResponse,
  eventId: string,
  userId: string,
): ParticipantAgendaResponse =>
  participantAgendaResponseSchema.parse({
    ...snapshot,
    eventId,
    userId,
    items: snapshot.items.map((item) => ({
      ...item,
      session: { ...item.session, eventId },
    })),
  });

const AgendaProbe = ({
  agendaApi,
  children,
  eventId = agendaFixtureIds.event,
  identity = activeIdentity,
}: {
  readonly agendaApi: ApiPort;
  readonly children?: ReactNode;
  readonly eventId?: string;
  readonly identity?: IdentityBootstrapResponse;
}) => (
  <main
    data-testid="participant-agenda-shell"
    id="main"
    style={visualTestStyle}
    tabIndex={-1}
  >
    <ParticipantAccountResourceProvider
      api={accountApiFor(identity)}
      scope={{ kind: 'active', eventId }}
    >
      <RouteFocus />
      {children ?? <ParticipantAgenda api={agendaApi} eventId={eventId} />}
    </ParticipantAccountResourceProvider>
  </main>
);

const AgendaResourceProbe = ({
  agendaApi,
  eventId,
  onResource,
}: {
  readonly agendaApi: ApiPort;
  readonly eventId: string;
  readonly onResource: (resource: ParticipantAgendaResource) => void;
}) => {
  const resource = useParticipantAgendaResource(eventId, agendaApi);
  useEffect(() => onResource(resource), [onResource, resource]);
  return <p data-testid="agenda-resource-state">{resource.state.status}</p>;
};

beforeEach(async () => {
  vi.restoreAllMocks();
  await waitForParticipantPrivateResourceCleanup();
  await wipeAllParticipantOfflineData('user_request');
  window.history.replaceState({}, '', '/app/agenda');
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('F3-01..F3-05 participant agenda', () => {
  it('renders grouped canonical states, an ICS download, responsive geometry and an axe-clean baseline', async () => {
    const { api } = agendaApiFor({
      onRead: participantAgendaFixtures.happy!,
    });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Osobní agenda' }))
      .toHaveFocus();
    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await expect.element(screen.getByText('Rezervováno')).toBeVisible();
    await expect
      .element(screen.getByText('Čekací listina', { exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText('Aktuální pořadí: 3.')).toBeVisible();

    const exportLink = screen
      .getByRole('link', { name: 'Přidat celou agendu' })
      .element();
    expect(exportLink.getAttribute('href')).toBe('/api/v1/me/agenda.ics');
    expect(exportLink.getAttribute('download')).toBe(
      'byzon-2026-moje-agenda.ics',
    );

    for (const target of screen.container.querySelectorAll<
      HTMLAnchorElement | HTMLButtonElement
    >('a, button')) {
      if (target.getClientRects().length === 0) continue;
      const bounds = target.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(screen.container);
  });

  it('wraps maximum-length agenda labels without horizontal overflow', async () => {
    const boundaryAgenda = participantAgendaResponseSchema.parse({
      ...participantAgendaFixtures.saved!,
      items: participantAgendaFixtures.saved!.items.map((item) => ({
        ...item,
        day: { ...item.day, title: 'D'.repeat(256) },
        session: {
          ...item.session,
          title: 'T'.repeat(512),
          room: item.session.room
            ? { ...item.session.room, name: 'R'.repeat(256) }
            : null,
        },
      })),
    });
    const { api } = agendaApiFor({ onRead: boundaryAgenda });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Osobní agenda' }))
      .toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });

  it('uses a strict agenda return origin and restores owner-scoped scroll continuity', async () => {
    const { api } = agendaApiFor({
      onRead: participantAgendaFixtures.saved!,
    });
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
    const agendaScreen = await renderComponent(<AgendaProbe agendaApi={api} />);
    const detailLink = agendaScreen.getByRole('link', {
      name: 'Otevření konference',
    });

    await expect
      .element(detailLink)
      .toHaveAttribute(
        'href',
        `/app/program/${agendaFixtureIds.savedSession}?from=agenda`,
      );
    detailLink
      .element()
      .addEventListener('click', (event) => event.preventDefault(), {
        once: true,
      });
    await detailLink.click();
    await agendaScreen.unmount();
    scrollY.mockReturnValue(0);
    window.history.replaceState({}, '', '/app/agenda');

    const restoredScreen = await renderComponent(
      <AgendaProbe agendaApi={api} />,
    );
    await expect
      .element(restoredScreen.getByText('Otevření konference'))
      .toBeVisible();
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
    expect(scrollTo).toHaveBeenCalledWith({ top: 640 });
    await restoredScreen.unmount();

    const programApi = createFetchApiClient({
      maxRetries: 0,
      fetch: async () => jsonResponse(participantProgramFixtures.happy!),
    });
    const detailScreen = await renderComponent(
      <AgendaProbe agendaApi={api}>
        <SessionView
          api={programApi}
          eventId={agendaFixtureIds.event}
          returnOrigin="agenda"
          sessionId={agendaFixtureIds.savedSession}
        />
      </AgendaProbe>,
    );
    await expect
      .element(
        detailScreen.getByRole('link', {
          name: 'Zpět do osobní agendy',
        }),
      )
      .toHaveAttribute('href', '/app/agenda');
  });

  it('shows an actionable empty state without exposing a fake calendar export', async () => {
    const { api } = agendaApiFor({
      onRead: participantAgendaFixtures.empty!,
    });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await expect
      .element(screen.getByText('Osobní agenda je zatím prázdná'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Prohlédnout program' }))
      .toHaveAttribute('href', '/app/program');
    await expect
      .element(
        screen.getByText(
          'Export bude dostupný, jakmile si do osobní agendy přidáte první bod.',
        ),
      )
      .toBeVisible();
    expect(
      screen
        .getByRole('link', {
          name: 'Přidat celou agendu',
        })
        .elements(),
    ).toHaveLength(0);
  });

  it('keeps an ended event read-only while retaining canonical items and export', async () => {
    const { api } = agendaApiFor({
      onRead: participantAgendaFixtures.reserved!,
    });
    const screen = await renderComponent(
      <AgendaProbe agendaApi={api} identity={endedIdentity} />,
    );

    await expect
      .element(screen.getByText('Agenda je jen ke čtení'))
      .toBeVisible();
    await expect.element(screen.getByText('Růst bez zkratek')).toBeVisible();
    await expect
      .element(
        screen.getByText('Po skončení akce je tato položka jen ke čtení.'),
      )
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Zrušit rezervaci' }).elements(),
    ).toHaveLength(0);
    await expect
      .element(
        screen.getByRole('link', {
          name: 'Přidat celou agendu',
        }),
      )
      .toBeVisible();
  });

  it('does not expose actionable waitlist controls after the event ended', async () => {
    const { api } = agendaApiFor({
      onRead: participantAgendaFixtures.waiting!,
    });
    const screen = await renderComponent(
      <AgendaProbe agendaApi={api} identity={endedIdentity} />,
    );

    await expect.element(screen.getByText('Čekací listina')).toBeVisible();
    await expect
      .element(
        screen.getByText('Po skončení akce je tato položka jen ke čtení.'),
      )
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Opustit čekací listinu' }).elements(),
    ).toHaveLength(0);
  });

  it('does not expose waitlist controls when server actions are disabled', async () => {
    const waiting = participantAgendaFixtures.waiting!;
    const item = waiting.items[0];
    if (!item || item.state !== 'waitlisted') {
      throw new TypeError('Waiting fixture must expose a waitlist entry.');
    }
    const disabledWaitlist = participantAgendaResponseSchema.parse({
      ...waiting,
      items: [
        {
          ...item,
          waitlist: { ...item.waitlist, actionsAvailable: false },
        },
      ],
    });
    const { api } = agendaApiFor({ onRead: disabledWaitlist });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await expect.element(screen.getByText('Čekací listina')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Opustit čekací listinu' }).elements(),
    ).toHaveLength(0);
  });

  it('adds a session from its detail and adopts only the canonical saved response', async () => {
    const { api, fetch } = agendaApiFor({
      onRead: participantAgendaFixtures.empty!,
      onMutation: (request) =>
        jsonResponse(
          mutationResponse(
            participantAgendaFixtures.saved!,
            {
              action: 'add',
              outcome: 'applied',
              sessionId: request.sessionId,
            },
            request.expectedVersion,
          ),
        ),
    });
    const screen = await renderComponent(
      <AgendaProbe agendaApi={api}>
        <ParticipantSessionAgendaAction
          agendaApi={api}
          eventId={agendaFixtureIds.event}
          sessionId={agendaFixtureIds.savedSession}
        />
      </AgendaProbe>,
    );

    await expect
      .element(screen.getByText('Tento bod ještě nemáte v osobní agendě.'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Přidat do agendy' }).click();
    await expect
      .element(screen.getByText('Uloženo', { exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByText('Bod je uložený v osobní agendě.'))
      .toBeVisible();

    const mutationCall = fetch.mock.calls.find(
      ([input, init]) =>
        requestUrl(input).pathname === '/api/v1/me/agenda/actions' &&
        requestMethod(input, init) === 'POST',
    );
    expect(mutationCall).toBeDefined();
    expect(JSON.parse(String(mutationCall?.[1]?.body))).toEqual({
      action: 'add',
      expectedVersion: participantAgendaFixtures.empty!.version,
      sessionId: agendaFixtureIds.savedSession,
    });
    expect(
      new Headers(mutationCall?.[1]?.headers).get('idempotency-key'),
    ).toMatch(/^agenda-action:/);
  });

  it('offers the required reservation immediately after adding a capacity session', async () => {
    const { api } = agendaApiFor({
      onRead: participantAgendaFixtures.empty!,
      onMutation: (request, _init, index) => {
        if (index === 0) {
          expect(request).toMatchObject({
            action: 'add',
            sessionId: agendaFixtureIds.reservedSession,
          });
          return jsonResponse(
            mutationResponse(
              reservableAgenda,
              {
                action: 'add',
                outcome: 'applied',
                sessionId: request.sessionId,
              },
              request.expectedVersion,
            ),
          );
        }
        expect(request).toMatchObject({
          action: 'reserve',
          sessionId: agendaFixtureIds.reservedSession,
        });
        return jsonResponse(
          mutationResponse(
            participantAgendaFixtures.reserved!,
            {
              action: 'reserve',
              outcome: 'applied',
              sessionId: request.sessionId,
            },
            request.expectedVersion,
          ),
        );
      },
    });
    const screen = await renderComponent(
      <AgendaProbe agendaApi={api}>
        <ParticipantSessionAgendaAction
          agendaApi={api}
          eventId={agendaFixtureIds.event}
          sessionId={agendaFixtureIds.reservedSession}
        />
      </AgendaProbe>,
    );

    await screen.getByRole('button', { name: 'Přidat do agendy' }).click();
    await expect
      .element(screen.getByRole('heading', { name: 'Rezervovat místo?' }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          'Tento bod vyžaduje registraci. V agendě už ho máte; místo je potřeba potvrdit zvlášť.',
        ),
      )
      .toBeVisible();
    await screen
      .getByRole('dialog')
      .getByRole('button', { name: 'Rezervovat místo' })
      .click();
    await expect
      .element(screen.getByText('Rezervováno', { exact: true }))
      .toBeVisible();
    expect(document.querySelector('dialog[open]')).toBeNull();
    await expectComponentToPassAxe(screen.container);
  });

  it('shows session-detail transport recovery and reuses the same idempotency key', async () => {
    const keys: string[] = [];
    const { api } = agendaApiFor({
      onRead: participantAgendaFixtures.empty!,
      onMutation: (request, init, index) => {
        keys.push(new Headers(init?.headers).get('idempotency-key') ?? '');
        if (index === 0) throw new TypeError('Synthetic transport failure');
        return jsonResponse(
          mutationResponse(
            participantAgendaFixtures.saved!,
            {
              action: 'add',
              outcome: 'applied',
              sessionId: request.sessionId,
            },
            request.expectedVersion,
          ),
        );
      },
    });
    const screen = await renderComponent(
      <AgendaProbe agendaApi={api}>
        <ParticipantSessionAgendaAction
          agendaApi={api}
          eventId={agendaFixtureIds.event}
          sessionId={agendaFixtureIds.savedSession}
        />
      </AgendaProbe>,
    );

    await screen.getByRole('button', { name: 'Přidat do agendy' }).click();
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Zkontrolovat stejný požadavek',
        }),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Přidat do agendy' }))
      .toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Zavřít zprávu' }).elements(),
    ).toHaveLength(0);

    await screen
      .getByRole('button', { name: 'Zkontrolovat stejný požadavek' })
      .click();
    await expect.element(screen.getByText('Uloženo')).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('shows an acknowledged add-conflict warning on the session detail', async () => {
    const { api } = agendaApiFor({
      onRead: participantAgendaFixtures.saved!,
      onMutation: (request) => {
        expect(request).toMatchObject({
          action: 'add',
          sessionId: agendaFixtureIds.conflictTargetSession,
        });
        return jsonResponse(
          participantAgendaMutationResponseSchema.parse({
            ...participantAgendaFixtures.saved!,
            version: request.expectedVersion + 1,
            items: [
              ...participantAgendaFixtures.saved!.items,
              ...participantAgendaFixtures.conflict_target!.items,
            ],
            mutation: {
              action: 'add',
              outcome: 'applied',
              sessionId: request.sessionId,
            },
            timeConflict: conflictWarning,
          }),
        );
      },
    });
    const screen = await renderComponent(
      <AgendaProbe agendaApi={api}>
        <h1 data-route-heading tabIndex={-1}>
          Detail programu
        </h1>
        <ParticipantSessionAgendaAction
          agendaApi={api}
          eventId={agendaFixtureIds.event}
          sessionId={agendaFixtureIds.conflictTargetSession}
        />
      </AgendaProbe>,
    );

    await screen.getByRole('button', { name: 'Přidat do agendy' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Uložený bod se překrývá s programem',
        }),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          'Bod jsme uložili do agendy. Jeho čas se ale překrývá s dalšími body; svůj plán můžete kdykoli změnit.',
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText('Uloženo', { exact: true }))
      .toBeVisible();

    await screen
      .getByRole('button', { name: 'Rozumím, ponechat v agendě' })
      .click();
    await expect
      .element(screen.getByRole('heading', { name: 'Rezervovat místo?' }))
      .toBeVisible();
    await screen
      .getByRole('button', { name: 'Zatím ponechat jen v agendě' })
      .click();
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
    await expect
      .element(
        screen.getByRole('heading', { level: 1, name: 'Detail programu' }),
      )
      .toHaveFocus();
  });

  it.each([
    [
      'remove',
      participantAgendaFixtures.saved!,
      'Odebrat z agendy',
      'Osobní agenda je zatím prázdná',
    ],
    [
      'cancel',
      participantAgendaFixtures.reserved!,
      'Zrušit rezervaci',
      'Osobní agenda je zatím prázdná',
    ],
    [
      'leave_waitlist',
      participantAgendaFixtures.waiting!,
      'Opustit čekací listinu',
      'Osobní agenda je zatím prázdná',
    ],
  ] as const)(
    'applies canonical %s without preserving optimistic private state',
    async (action, initial, buttonName, terminalCopy) => {
      const { api } = agendaApiFor({
        onRead: initial,
        onMutation: (request) => {
          expect(request.action).toBe(action);
          return jsonResponse(emptyMutationResponse(request));
        },
      });
      const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

      await screen.getByRole('button', { name: buttonName }).click();
      await expect.element(screen.getByText(terminalCopy)).toBeVisible();
    },
  );

  it.each([
    [
      'reserve',
      reservableAgenda,
      'Rezervovat místo',
      participantAgendaFixtures.reserved!,
      'Rezervováno',
    ],
    [
      'join_waitlist',
      joinableAgenda,
      'Přidat se na čekací listinu',
      participantAgendaFixtures.waiting!,
      'Čekací listina',
    ],
  ] as const)(
    'submits %s once and replaces the card with the server canonical state',
    async (action, initial, buttonName, target, terminalCopy) => {
      let releaseMutation: (() => void) | undefined;
      const mutationGate = new Promise<void>((resolve) => {
        releaseMutation = resolve;
      });
      const { api, mutationCount } = agendaApiFor({
        onRead: initial,
        onMutation: async (request) => {
          await mutationGate;
          expect(request.action).toBe(action);
          return jsonResponse(
            mutationResponse(
              target,
              {
                action,
                outcome: 'applied',
                sessionId: request.sessionId,
              },
              request.expectedVersion,
            ),
          );
        },
      });
      const screen = await renderComponent(<AgendaProbe agendaApi={api} />);
      const buttonLocator = screen.getByRole('button', { name: buttonName });
      await expect.element(buttonLocator).toBeVisible();
      const button = buttonLocator.element();
      if (!(button instanceof HTMLButtonElement)) {
        throw new TypeError('Agenda action must render a native button.');
      }

      button.click();
      button.click();
      await expect
        .element(screen.getByText('Potvrzuji se serverem…'))
        .toBeVisible();
      expect(mutationCount()).toBe(1);
      expect(button).toBeDisabled();

      releaseMutation?.();
      await expect.element(screen.getByText(terminalCopy)).toBeVisible();
      expect(mutationCount()).toBe(1);
    },
  );

  it('renders a capacity-one coaching slot through the canonical reservation action without holder data', async () => {
    const { api } = agendaApiFor({ onRead: coachingAgenda });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await expect
      .element(screen.getByText('Koučink – Radim Roček'))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          'Poslední stav serveru: 1 místo k okamžité rezervaci. Rezervaci potvrdí až další odpověď serveru.',
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Rezervovat místo' }))
      .toBeVisible();
    expect(screen.container.textContent).not.toMatch(/rezervoval/i);
    await expectComponentToPassAxe(screen.container);
  });

  it('locks the prior canonical card when an applied mutation does not advance its version', async () => {
    const { api } = agendaApiFor({
      onRead: reservableAgenda,
      onMutation: (request) =>
        jsonResponse({
          ...participantAgendaMutationFixtures.reserved!,
          version: request.expectedVersion,
        }),
    });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await screen.getByRole('button', { name: 'Rezervovat místo' }).click();
    await expect
      .element(screen.getByText('Změnu se nepodařilo potvrdit'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Rezervovat místo' }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole('button', { name: 'Načíst aktuální agendu' }))
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Zavřít zprávu' }).elements(),
    ).toHaveLength(0);
    expect(screen.container.textContent).not.toContain('Rezervováno');
  });

  it('removes stale private cards when agenda is disabled during a mutation', async () => {
    const { api } = agendaApiFor({
      onRead: participantAgendaFixtures.saved!,
      onMutation: () =>
        problemResponse(participantAgendaMutationProblemFixtures.disabled!),
    });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await expect.element(screen.getByText('Otevření konference')).toBeVisible();
    await screen.getByRole('button', { name: 'Odebrat z agendy' }).click();
    await expect
      .element(screen.getByText('Osobní agenda není zapnutá'))
      .toBeVisible();
    expect(screen.container.textContent).not.toContain('Otevření konference');
  });

  it('retries an in-progress mutation with the exact same idempotency key and accepts a canonical replay', async () => {
    const keys: string[] = [];
    const { api, mutationCount } = agendaApiFor({
      onRead: reservableAgenda,
      onMutation: (request, init, index) => {
        keys.push(new Headers(init?.headers).get('idempotency-key') ?? '');
        if (index === 0) {
          return problemResponse(
            participantAgendaMutationProblemFixtures.in_progress!,
          );
        }
        return jsonResponse({
          ...participantAgendaMutationFixtures.idempotent_replay!,
          version: request.expectedVersion + 1,
        });
      },
    });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await screen.getByRole('button', { name: 'Rezervovat místo' }).click();
    await expect
      .element(screen.getByText('Předchozí požadavek se ještě zpracovává'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Rezervovat místo' }))
      .toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Zavřít zprávu' }).elements(),
    ).toHaveLength(0);
    await screen
      .getByRole('button', { name: 'Zkontrolovat stejný požadavek' })
      .click();
    await expect.element(screen.getByText('Rezervováno')).toBeVisible();
    expect(mutationCount()).toBe(2);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('keeps transport recovery visible and retries with the same idempotency key', async () => {
    const keys: string[] = [];
    const { api } = agendaApiFor({
      onRead: reservableAgenda,
      onMutation: (request, init, index) => {
        keys.push(new Headers(init?.headers).get('idempotency-key') ?? '');
        if (index === 0) throw new TypeError('Synthetic transport failure');
        return jsonResponse(
          mutationResponse(
            participantAgendaFixtures.reserved!,
            {
              action: 'reserve',
              outcome: 'applied',
              sessionId: request.sessionId,
            },
            request.expectedVersion,
          ),
        );
      },
    });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await screen.getByRole('button', { name: 'Rezervovat místo' }).click();
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Zkontrolovat stejný požadavek',
        }),
      )
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Zavřít zprávu' }).elements(),
    ).toHaveLength(0);
    await expect
      .element(screen.getByRole('button', { name: 'Rezervovat místo' }))
      .toBeDisabled();

    await screen
      .getByRole('button', { name: 'Zkontrolovat stejný požadavek' })
      .click();
    await expect.element(screen.getByText('Rezervováno')).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('locks mutations after an invalid success payload until a canonical read reconciles state', async () => {
    let reads = 0;
    const { api, mutationCount } = agendaApiFor({
      onRead: () => {
        reads += 1;
        return jsonResponse(
          reads === 1 ? reservableAgenda : participantAgendaFixtures.reserved!,
        );
      },
      onMutation: () =>
        jsonResponse({
          ...participantAgendaMutationFixtures.reserved!,
          unexpectedPrivateField: 'must be rejected',
        }),
    });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await screen.getByRole('button', { name: 'Rezervovat místo' }).click();
    await expect
      .element(screen.getByRole('button', { name: 'Načíst aktuální agendu' }))
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Zavřít zprávu' }).elements(),
    ).toHaveLength(0);
    await expect
      .element(screen.getByRole('button', { name: 'Rezervovat místo' }))
      .toBeDisabled();

    await screen
      .getByRole('button', { name: 'Načíst aktuální agendu' })
      .click();
    await expect.element(screen.getByText('Rezervováno')).toBeVisible();
    expect(reads).toBe(2);
    expect(mutationCount()).toBe(1);
  });

  it('distinguishes full, waiting, closed and cancelled states without color alone', async () => {
    const cases = [
      [
        participantAgendaFixtures.full!,
        'K okamžité rezervaci zbývá 0 míst. Čekací listina není dostupná.',
      ],
      [participantAgendaFixtures.waiting!, 'Aktuální pořadí: 3.'],
      [participantAgendaFixtures.closed!, 'Rezervace jsou uzavřené.'],
      [
        participantAgendaFixtures.cancelled!,
        'Organizátor tento bod programu zrušil.',
      ],
    ] as const;

    for (const [fixture, copy] of cases) {
      const { api } = agendaApiFor({ onRead: fixture });
      const screen = await renderComponent(<AgendaProbe agendaApi={api} />);
      await expect.element(screen.getByText(copy)).toBeVisible();
      await expectComponentToPassAxe(screen.container);
      await screen.unmount();
    }
  });

  it('keeps the original reservation when the conflict choice is dismissed', async () => {
    const { api, mutationCount } = agendaApiFor({
      onRead: conflictInitialAgenda,
      onMutation: (request) => {
        expect(request).toMatchObject({
          action: 'reserve',
          sessionId: agendaFixtureIds.conflictTargetSession,
        });
        return problemResponse(reservationConflictProblem);
      },
    });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);
    const triggerLocator = screen.getByRole('button', {
      name: 'Rezervovat místo',
    });
    await expect.element(triggerLocator).toBeVisible();
    const trigger = triggerLocator.element();
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new TypeError('Conflict trigger must render a native button.');
    }

    await triggerLocator.click();
    const dialog = screen.getByRole('dialog');
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Rezervace se časově překrývají',
        }),
      )
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          'Na překrývající se aktivity nelze mít dvě rezervace. Novou rezervaci jsme zatím nevytvořili.',
        ),
      )
      .toBeVisible();
    await expect
      .element(screen.getByText('Uloženo', { exact: true }))
      .toBeVisible();
    const conflictLink = Array.from(
      dialog.element().querySelectorAll<HTMLAnchorElement>('a'),
    ).find(
      ({ pathname }) =>
        pathname === `/app/program/${agendaFixtureIds.savedSession}`,
    );
    expect(conflictLink).toBeDefined();
    expect(conflictLink?.textContent).toContain('Otevření konference');
    expect(dialog.element().contains(document.activeElement)).toBe(true);

    await userEvent.keyboard('{Tab}');
    expect(dialog.element().contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('dialog[open]')).toBeNull();
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Osobní agenda' }))
      .toHaveFocus();
    expect(mutationCount()).toBe(1);
  });

  it('atomically replaces the original reservation after explicit confirmation', async () => {
    const switchedAgenda = participantAgendaResponseSchema.parse({
      ...conflictInitialAgenda,
      version: conflictInitialAgenda.version + 1,
      items: conflictInitialAgenda.items.map((item) => {
        if (item.session.id === agendaFixtureIds.savedSession) {
          return {
            day: item.day,
            session: item.session,
            capacity: item.capacity,
            action: item.action,
            state: 'saved' as const,
            source: 'manual' as const,
            savedAt: conflictInitialAgenda.serverNow,
          };
        }
        if (item.capacity.mode !== 'reservation') return item;
        return {
          day: item.day,
          session: item.session,
          capacity: item.capacity,
          action: item.action,
          state: 'reserved' as const,
          reservation: {
            id: agendaFixtureIds.reservation,
            version: 1,
            confirmedAt: conflictInitialAgenda.serverNow,
          },
        };
      }),
    });
    const { api, mutationCount } = agendaApiFor({
      onRead: conflictInitialAgenda,
      onMutation: (request, _init, index) => {
        if (index === 0) return problemResponse(reservationConflictProblem);
        expect(request).toMatchObject({
          action: 'reserve',
          sessionId: agendaFixtureIds.conflictTargetSession,
          replaceReservationSessionIds: [agendaFixtureIds.savedSession],
        });
        return jsonResponse(
          mutationResponse(
            switchedAgenda,
            {
              action: 'reserve',
              outcome: 'applied',
              sessionId: request.sessionId,
            },
            request.expectedVersion,
          ),
        );
      },
    });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await screen.getByRole('button', { name: 'Rezervovat místo' }).click();
    await expect
      .element(
        screen.getByRole('button', {
          name: 'Přihlásit na novou a odhlásit z původní',
        }),
      )
      .toBeVisible();
    await screen
      .getByRole('button', {
        name: 'Přihlásit na novou a odhlásit z původní',
      })
      .click();
    await expect
      .element(screen.getByText('Rezervováno', { exact: true }))
      .toBeVisible();
    expect(document.querySelector('dialog[open]')).toBeNull();
    expect(mutationCount()).toBe(2);
  });

  it('remembers agenda scroll before following a conflict-session deep link', async () => {
    const { api } = agendaApiFor({
      onRead: conflictInitialAgenda,
      onMutation: () => problemResponse(reservationConflictProblem),
    });
    const scrollTo = vi
      .spyOn(window, 'scrollTo')
      .mockImplementation(() => undefined);
    const scrollY = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(720);
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await screen.getByRole('button', { name: 'Rezervovat místo' }).click();
    const conflictLink = Array.from(
      screen.getByRole('dialog').element().querySelectorAll('a'),
    ).find(
      (link) =>
        link instanceof HTMLAnchorElement &&
        link.pathname === `/app/program/${agendaFixtureIds.savedSession}`,
    );
    if (!(conflictLink instanceof HTMLAnchorElement)) {
      throw new TypeError('Conflict session link must be available.');
    }
    conflictLink.addEventListener('click', (event) => event.preventDefault(), {
      once: true,
    });
    await conflictLink.click();
    expect(document.querySelector('dialog[open]')).toBeNull();
    await screen.unmount();

    scrollY.mockReturnValue(0);
    const restored = await renderComponent(<AgendaProbe agendaApi={api} />);
    await expect
      .element(restored.getByText('Překrývající se workshop', { exact: true }))
      .toBeVisible();
    await new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
    expect(scrollTo).toHaveBeenCalledWith({ top: 720 });
  });

  it('adopts the correlated canonical snapshot carried by a stale-version problem', async () => {
    let reads = 0;
    const { api } = agendaApiFor({
      onRead: () => {
        reads += 1;
        return jsonResponse(participantAgendaFixtures.saved!);
      },
      onMutation: () =>
        problemResponse(
          participantAgendaMutationProblemFixtures.stale_version!,
        ),
    });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await screen.getByRole('button', { name: 'Odebrat z agendy' }).click();
    await expect
      .element(screen.getByText('Agenda se mezitím změnila'))
      .toBeVisible();
    await expect.element(screen.getByText('Růst bez zkratek')).toBeVisible();
    expect(reads).toBe(1);
  });

  it.each([
    participantAgendaMutationProblemFixtures.authentication!,
    participantAgendaMutationProblemFixtures.permission!,
  ])(
    'globally wipes agenda contents after authoritative $code',
    async (problem) => {
      const { api } = agendaApiFor({
        onRead: participantAgendaFixtures.saved!,
        onMutation: () => problemResponse(problem),
      });
      const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

      await expect
        .element(screen.getByText('Otevření konference'))
        .toBeVisible();
      await screen.getByRole('button', { name: 'Odebrat z agendy' }).click();
      await expect
        .element(
          screen.getByText(
            problem.status === 401
              ? 'Přihlášení vypršelo'
              : 'Agenda není dostupná',
          ),
        )
        .toBeVisible();
      expect(screen.container.textContent).not.toContain('Otevření konference');
      if (problem.status === 401) {
        await expect
          .element(screen.getByRole('link', { name: 'Přihlásit se znovu' }))
          .toHaveAttribute(
            'href',
            '/prihlaseni?mode=recovery&returnTo=%2Fapp%2Fagenda',
          );
      }
    },
  );

  it.each([
    [
      agendaForScope(
        participantAgendaFixtures.saved!,
        otherScope.eventId,
        agendaFixtureIds.user,
      ),
      'event',
    ],
    [
      agendaForScope(
        participantAgendaFixtures.saved!,
        agendaFixtureIds.event,
        otherScope.userId,
      ),
      'owner',
    ],
  ] as const)(
    'fails closed for a cross-%s canonical read',
    async (fixture, scope) => {
      expect(['event', 'owner']).toContain(scope);
      const { api } = agendaApiFor({ onRead: fixture });
      const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

      await expect
        .element(screen.getByText('Agenda není dostupná'))
        .toBeVisible();
      expect(screen.container.textContent).not.toContain('Otevření konference');
    },
  );

  it('aborts an old scope read and never restores it after an event/account switch', async () => {
    let releaseOldRead: (() => void) | undefined;
    let oldSignal: AbortSignal | undefined;
    const oldRead = new Promise<Response>((resolve) => {
      releaseOldRead = () =>
        resolve(jsonResponse(participantAgendaFixtures.saved!));
    });
    const oldFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        oldSignal = init?.signal ?? undefined;
        expect(requestUrl(input).pathname).toBe('/api/v1/me/agenda');
        return oldRead;
      },
    );
    const oldApi = createFetchApiClient({ fetch: oldFetch, maxRetries: 0 });
    const otherAgenda = agendaForScope(
      participantAgendaFixtures.empty!,
      otherScope.eventId,
      otherScope.userId,
    );
    const { api: otherApi } = agendaApiFor({ onRead: otherAgenda });
    const otherIdentity = identityForScope(
      otherScope.eventId,
      otherScope.userId,
    );

    const screen = await renderComponent(<AgendaProbe agendaApi={oldApi} />);
    await vi.waitFor(() => expect(oldFetch).toHaveBeenCalledOnce());

    await screen.rerender(
      <AgendaProbe
        agendaApi={otherApi}
        eventId={otherScope.eventId}
        identity={otherIdentity}
      />,
    );
    await expect
      .element(screen.getByText('Osobní agenda je zatím prázdná'))
      .toBeVisible();
    await vi.waitFor(() => expect(oldSignal?.aborted).toBe(true));

    releaseOldRead?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect
      .element(screen.getByText('Osobní agenda je zatím prázdná'))
      .toBeVisible();
    expect(screen.container.textContent).not.toContain('Otevření konference');
  });

  it('fences stale offline retry and discard callbacks after an account switch', async () => {
    const oldScope = {
      eventId: agendaFixtureIds.event,
      userId: agendaFixtureIds.user,
    } as const;
    const offlineEpoch = await readParticipantOfflineEpoch();
    let queued = await queueApprovedOfflineAgendaMutation(
      oldScope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      '01930000-0000-7000-8000-0000000000e0',
      offlineEpoch,
    );
    for (let attempts = 1; attempts <= 5; attempts += 1) {
      queued = await updateOfflineAgendaQueueRecord(
        queued,
        {
          attempts,
          lastProblemCode: 'TRANSPORT',
          status: attempts === 5 ? 'failed' : 'retry',
        },
        { expectedEpoch: offlineEpoch },
      );
    }
    let currentRead = participantAgendaFixtures.happy!;
    const switchedAgenda = agendaForScope(
      participantAgendaFixtures.empty!,
      agendaFixtureIds.event,
      otherScope.userId,
    );
    const switchedIdentity = identityForScope(
      agendaFixtureIds.event,
      otherScope.userId,
    );
    const { api } = agendaApiFor({
      onRead: () => jsonResponse(currentRead),
    });
    let oldResource: ParticipantAgendaResource | undefined;
    let oldPeerResource: ParticipantAgendaResource | undefined;
    let newResource: ParticipantAgendaResource | undefined;
    let newPeerResource: ParticipantAgendaResource | undefined;
    const captureOld = (resource: ParticipantAgendaResource) => {
      oldResource = resource;
    };
    const captureOldPeer = (resource: ParticipantAgendaResource) => {
      oldPeerResource = resource;
    };
    const captureNew = (resource: ParticipantAgendaResource) => {
      newResource = resource;
    };
    const captureNewPeer = (resource: ParticipantAgendaResource) => {
      newPeerResource = resource;
    };

    try {
      const screen = await renderComponent(
        <AgendaProbe agendaApi={api}>
          <AgendaResourceProbe
            agendaApi={api}
            eventId={agendaFixtureIds.event}
            onResource={captureOld}
          />
          <AgendaResourceProbe
            agendaApi={api}
            eventId={agendaFixtureIds.event}
            onResource={captureOldPeer}
          />
        </AgendaProbe>,
      );
      await vi.waitFor(() => {
        expect(oldResource?.state.status).toBe('ready');
        expect(oldPeerResource?.state.status).toBe('ready');
        expect(oldResource?.offline.queue.failed).toBe(1);
        expect(oldPeerResource?.offline.queue.failed).toBe(1);
      });
      const staleDiscard = oldResource!.discardFailedOfflineQueue;
      const staleRetry = oldResource!.retryOfflineQueue;

      currentRead = switchedAgenda;
      await screen.rerender(
        <AgendaProbe agendaApi={api} identity={switchedIdentity}>
          <AgendaResourceProbe
            agendaApi={api}
            eventId={agendaFixtureIds.event}
            onResource={captureNew}
          />
          <AgendaResourceProbe
            agendaApi={api}
            eventId={agendaFixtureIds.event}
            onResource={captureNewPeer}
          />
        </AgendaProbe>,
      );
      await vi.waitFor(() => {
        expect(newResource?.state.status).toBe('ready');
        expect(newPeerResource?.state.status).toBe('ready');
        if (newResource?.state.status === 'ready') {
          expect(newResource.state.data.userId).toBe(otherScope.userId);
        }
        if (newPeerResource?.state.status === 'ready') {
          expect(newPeerResource.state.data.userId).toBe(otherScope.userId);
        }
      });

      const switchedScope = {
        eventId: agendaFixtureIds.event,
        userId: otherScope.userId,
      } as const;
      const switchedEpoch = await readParticipantOfflineEpoch();
      const switchedQueueRecord = await queueApprovedOfflineAgendaMutation(
        switchedScope,
        {
          action: 'add',
          expectedVersion: switchedAgenda.version,
          sessionId: agendaFixtureIds.savedSession,
        },
        '01930000-0000-7000-8000-0000000000e3',
        switchedEpoch,
      );
      expect(
        await listOfflineAgendaQueue(oldScope, {
          expectedEpoch: switchedEpoch,
        }),
      ).toHaveLength(0);

      await staleDiscard();
      await staleRetry();

      expect(
        await listOfflineAgendaQueue(switchedScope, {
          expectedEpoch: switchedEpoch,
        }),
      ).toEqual([switchedQueueRecord]);
      expect(newResource?.feedback).toBeNull();
      expect(newResource?.offline.syncing).toBe(false);
      expect(newResource?.offline.queue).toEqual({
        conflict: 0,
        failed: 0,
        pending: 0,
        retry: 0,
        total: 0,
      });
    } finally {
      await wipeAllParticipantOfflineData('user_request');
    }
  });

  it('ignores a late old-owner auto-sync result after an account switch', async () => {
    const oldScope = {
      eventId: agendaFixtureIds.event,
      userId: agendaFixtureIds.user,
    } as const;
    const offlineEpoch = await readParticipantOfflineEpoch();
    await queueApprovedOfflineAgendaMutation(
      oldScope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      '01930000-0000-7000-8000-0000000000e4',
      offlineEpoch,
    );
    let currentRead = participantAgendaFixtures.happy!;
    let readCount = 0;
    let releaseOldSync: (() => void) | undefined;
    const oldSyncRead = new Promise<Response>((resolve) => {
      releaseOldSync = () =>
        resolve(jsonResponse(participantAgendaFixtures.happy!));
    });
    const switchedAgenda = agendaForScope(
      participantAgendaFixtures.empty!,
      agendaFixtureIds.event,
      otherScope.userId,
    );
    const switchedIdentity = identityForScope(
      agendaFixtureIds.event,
      otherScope.userId,
    );
    const { api } = agendaApiFor({
      onRead: () => {
        readCount += 1;
        return readCount === 2 ? oldSyncRead : jsonResponse(currentRead);
      },
    });
    let resource: ParticipantAgendaResource | undefined;
    const capture = (next: ParticipantAgendaResource) => {
      resource = next;
    };

    try {
      const screen = await renderComponent(
        <AgendaProbe agendaApi={api}>
          <AgendaResourceProbe
            agendaApi={api}
            eventId={agendaFixtureIds.event}
            onResource={capture}
          />
        </AgendaProbe>,
      );
      await vi.waitFor(() => {
        expect(readCount).toBe(2);
        expect(resource?.state.status).toBe('ready');
        expect(resource?.offline.queue.pending).toBe(1);
        expect(resource?.offline.syncing).toBe(true);
      });

      currentRead = switchedAgenda;
      await screen.rerender(
        <AgendaProbe agendaApi={api} identity={switchedIdentity}>
          <AgendaResourceProbe
            agendaApi={api}
            eventId={agendaFixtureIds.event}
            onResource={capture}
          />
        </AgendaProbe>,
      );
      await vi.waitFor(() => {
        expect(resource?.state.status).toBe('ready');
        if (resource?.state.status === 'ready') {
          expect(resource.state.data.userId).toBe(otherScope.userId);
        }
        expect(resource?.offline.queue.total).toBe(0);
        expect(resource?.offline.syncing).toBe(false);
      });

      releaseOldSync?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(resource?.feedback).toBeNull();
      expect(resource?.offline.queue.total).toBe(0);
      expect(resource?.offline.syncing).toBe(false);
    } finally {
      releaseOldSync?.();
      await wipeAllParticipantOfflineData('user_request');
    }
  });

  it('aborts a pending old-owner mutation and unlocks the new owner scope', async () => {
    let resolveOldMutation: ((response: Response) => void) | undefined;
    let oldMutationSignal: AbortSignal | undefined;
    const oldMutation = new Promise<Response>((resolve) => {
      resolveOldMutation = resolve;
    });
    const originalOwnerAgenda = participantAgendaResponseSchema.parse({
      ...reservableAgenda,
      items: reservableAgenda.items.map((item) => ({
        ...item,
        session: { ...item.session, title: 'Agenda původního účtu' },
      })),
    });
    let currentRead: ParticipantAgendaResponse = originalOwnerAgenda;
    const switchedIdentity = identityForScope(
      agendaFixtureIds.event,
      otherScope.userId,
    );
    const switchedReservableAgenda = participantAgendaResponseSchema.parse({
      ...agendaForScope(
        reservableAgenda,
        agendaFixtureIds.event,
        otherScope.userId,
      ),
      items: reservableAgenda.items.map((item) => ({
        ...item,
        session: { ...item.session, title: 'Agenda nového účtu' },
      })),
    });
    const switchedReservedAgenda = participantAgendaResponseSchema.parse({
      ...agendaForScope(
        participantAgendaFixtures.reserved!,
        agendaFixtureIds.event,
        otherScope.userId,
      ),
      items: participantAgendaFixtures.reserved!.items.map((item) => ({
        ...item,
        session: {
          ...item.session,
          title: 'Rezervace nového účtu',
        },
      })),
    });
    const { api, mutationCount } = agendaApiFor({
      onRead: () => jsonResponse(currentRead),
      onMutation: (request, init, index) => {
        if (index === 0) {
          oldMutationSignal = init?.signal ?? undefined;
          return oldMutation;
        }
        expect(request.action).toBe('reserve');
        return jsonResponse(
          mutationResponse(
            switchedReservedAgenda,
            {
              action: 'reserve',
              outcome: 'applied',
              sessionId: request.sessionId,
            },
            request.expectedVersion,
          ),
        );
      },
    });
    const screen = await renderComponent(<AgendaProbe agendaApi={api} />);

    await expect
      .element(screen.getByText('Agenda původního účtu'))
      .toBeVisible();
    await screen.getByRole('button', { name: 'Rezervovat místo' }).click();
    await expect
      .element(screen.getByText('Potvrzuji se serverem…'))
      .toBeVisible();
    expect(mutationCount()).toBe(1);

    currentRead = switchedReservableAgenda;
    await screen.rerender(
      <AgendaProbe agendaApi={api} identity={switchedIdentity} />,
    );
    expect(screen.container.textContent).not.toContain('Agenda původního účtu');
    await vi.waitFor(() => expect(oldMutationSignal?.aborted).toBe(true));
    await expect.element(screen.getByText('Agenda nového účtu')).toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Rezervovat místo' }))
      .toBeEnabled();

    await screen.getByRole('button', { name: 'Rezervovat místo' }).click();
    await expect.element(screen.getByText('Rezervováno')).toBeVisible();
    await expect
      .element(screen.getByText('Rezervace nového účtu'))
      .toBeVisible();
    expect(mutationCount()).toBe(2);

    resolveOldMutation?.(
      jsonResponse(
        mutationResponse(
          participantAgendaFixtures.reserved!,
          {
            action: 'reserve',
            outcome: 'applied',
            sessionId: agendaFixtureIds.reservedSession,
          },
          reservableAgenda.version,
        ),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect.element(screen.getByText('Rezervováno')).toBeVisible();
    await expect
      .element(screen.getByText('Rezervace nového účtu'))
      .toBeVisible();
    expect(screen.container.textContent).not.toContain('Otevření konference');
  });

  it('respects reduced motion while keeping loading feedback visible', async () => {
    const browser = cdp();
    await browser.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    let releaseRead: (() => void) | undefined;
    const pendingRead = new Promise<Response>((resolve) => {
      releaseRead = () =>
        resolve(jsonResponse(participantAgendaFixtures.empty!));
    });
    const { api } = agendaApiFor({ onRead: () => pendingRead });

    try {
      const screen = await renderComponent(<AgendaProbe agendaApi={api} />);
      await expect
        .element(screen.getByRole('status', { name: 'Načítám osobní agendu' }))
        .toBeVisible();
      expect(
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      ).toBe(true);
      for (const animated of screen.container.querySelectorAll<HTMLElement>(
        '.ui-skeleton__bar, .resource-progress, .agenda-loading *',
      )) {
        expect(getComputedStyle(animated).animationName).toBe('none');
      }
      releaseRead?.();
      await expect
        .element(screen.getByText('Osobní agenda je zatím prázdná'))
        .toBeVisible();
    } finally {
      await browser.send('Emulation.setEmulatedMedia', { features: [] });
    }
  });

  it('uses the owner-scoped offline copy and queues only agenda remove', async () => {
    const onlineDescriptor = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      'onLine',
    );
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    const scope = {
      eventId: agendaFixtureIds.event,
      userId: agendaFixtureIds.user,
    } as const;
    await writeOfflineAgendaSnapshot(
      scope,
      participantAgendaFixtures.happy!,
      '2026-09-18T06:00:00.000Z',
    );
    const { api, fetch } = agendaApiFor({
      onRead: () => {
        throw new TypeError('Synthetic offline read');
      },
    });

    try {
      const screen = await renderComponent(<AgendaProbe agendaApi={api} />);
      await expect
        .element(screen.getByText('Zobrazuje se offline kopie agendy'))
        .toBeVisible();
      expect(
        screen
          .getByText('Tato změna potřebuje aktuální potvrzení serveru.', {
            exact: true,
          })
          .elements(),
      ).toHaveLength(2);

      await screen.getByRole('button', { name: 'Odebrat z agendy' }).click();
      await expect
        .element(screen.getByText('Změna čeká na připojení'))
        .toBeVisible();
      const queue = await listOfflineAgendaQueue(scope);
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        action: 'remove',
        sessionId: agendaFixtureIds.savedSession,
        status: 'pending',
      });
      expect(
        fetch.mock.calls.filter(
          ([input, init]) => requestMethod(input, init) === 'POST',
        ),
      ).toHaveLength(0);
    } finally {
      await wipeAllParticipantOfflineData('user_request');
      if (onlineDescriptor) {
        Object.defineProperty(Navigator.prototype, 'onLine', onlineDescriptor);
      }
      Reflect.deleteProperty(navigator, 'onLine');
    }
  });

  it('offers an explicit discard recovery and unlocks mutations after a failed offline replay', async () => {
    const scope = {
      eventId: agendaFixtureIds.event,
      userId: agendaFixtureIds.user,
    } as const;
    const offlineEpoch = await readParticipantOfflineEpoch();
    await writeOfflineAgendaSnapshot(
      scope,
      participantAgendaFixtures.happy!,
      new Date(),
      { expectedEpoch: offlineEpoch },
    );
    let failed = await queueApprovedOfflineAgendaMutation(
      scope,
      {
        action: 'remove',
        expectedVersion: participantAgendaFixtures.happy!.version,
        sessionId: agendaFixtureIds.savedSession,
      },
      '01930000-0000-7000-8000-0000000000d9',
      offlineEpoch,
    );
    for (let attempts = 1; attempts <= 5; attempts += 1) {
      failed = await updateOfflineAgendaQueueRecord(
        failed,
        {
          attempts,
          lastProblemCode: 'TRANSPORT',
          status: attempts === 5 ? 'failed' : 'retry',
        },
        { expectedEpoch: offlineEpoch },
      );
    }
    const { api, fetch } = agendaApiFor({
      onRead: participantAgendaFixtures.happy!,
    });

    try {
      const screen = await renderComponent(<AgendaProbe agendaApi={api} />);
      await expect
        .element(
          screen.getByText('Odloženou změnu se nepodařilo potvrdit', {
            exact: true,
          }),
        )
        .toBeVisible();
      const discard = screen.getByRole('button', {
        name: 'Zahodit neprovedené změny',
      });
      await expect.element(discard).toBeVisible();
      const remove = screen.getByRole('button', {
        name: 'Odebrat z agendy',
      });
      await expect.element(remove).toBeDisabled();
      expect(
        fetch.mock.calls.filter(
          ([input, init]) => requestMethod(input, init) === 'POST',
        ),
      ).toHaveLength(0);

      await discard.click();

      await expect
        .element(
          screen.getByText('Neprovedená změna byla zahozena', {
            exact: true,
          }),
        )
        .toBeVisible();
      await expect.element(remove).not.toBeDisabled();
      expect(await listOfflineAgendaQueue(scope)).toHaveLength(0);
    } finally {
      await wipeAllParticipantOfflineData('user_request');
    }
  });
});
