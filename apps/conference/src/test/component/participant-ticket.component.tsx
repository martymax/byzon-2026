import type { ParticipantTicketProblem } from '@byzon/domain/contracts';
import {
  participantTicketFixtures,
  participantTicketProblemFixtures,
  ticketFixtureEventId,
} from '@byzon/test-support/fixtures';
import type { CSSProperties } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import { ParticipantLayoutShell as ParticipantLayout } from '../../components/participant-layout-shell';
import { ParticipantTicket } from '../../components/participant-ticket';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

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

const apiForProblem = (fixture: ParticipantTicketProblem) =>
  createFetchApiClient({
    maxRetries: 0,
    fetch: async () =>
      Response.json(fixture, {
        status: fixture.status,
        headers: {
          'content-type': 'application/problem+json',
          'x-request-id': fixture.requestId,
        },
      }),
  });

const TicketProbe = ({
  fixture = participantTicketFixtures.valid,
}: {
  readonly fixture?: unknown;
}) => (
  <main
    id="main"
    data-testid="participant-ticket-shell"
    style={visualTestStyle}
    tabIndex={-1}
  >
    <ParticipantLayout
      accountScope={{ kind: 'active', eventId: ticketFixtureEventId }}
      navigationMode="active-preview"
    >
      <ParticipantTicket
        api={apiFor(fixture, 'component-ticket-0001')}
        eventId={ticketFixtureEventId}
      />
    </ParticipantLayout>
  </main>
);

beforeEach(() => {
  window.history.replaceState({}, '', '/app/vstupenka');
});

describe('F2-04 participant ticket status slice', () => {
  it('shows validated holder and status without inventing a credential', async () => {
    const screen = await renderComponent(<TicketProbe />);

    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Vstupenka' }))
      .toHaveFocus();
    await expect.element(screen.getByText('Platná')).toBeVisible();
    await expect.element(screen.getByText('Alex Novák')).toBeVisible();
    await expect.element(screen.getByText('•••• TST6')).toBeVisible();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Skenovatelná vstupenka zatím není dostupná',
        }),
      )
      .toBeVisible();

    const shell = screen.getByTestId('participant-ticket-shell').element();
    if (!(shell instanceof HTMLElement)) {
      throw new TypeError('Participant ticket shell must be an HTML element.');
    }
    expect(shell.querySelector('[data-ticket-credential]')).toBeNull();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(shell);
    await expect
      .element(screen.getByTestId('participant-ticket-shell'))
      .toMatchScreenshot('participant-ticket-valid', {
        comparatorOptions: {
          allowedMismatchedPixelRatio: 0.04,
        },
      });
  });

  it.each([
    [participantTicketFixtures.cancelled, 'Zrušená'],
    [participantTicketFixtures.refunded, 'Vrácená'],
    [participantTicketFixtures.blocked, 'Blokovaná'],
  ])('renders an explicit inactive state %#', async (fixture, label) => {
    const screen = await renderComponent(<TicketProbe fixture={fixture} />);

    await expect
      .element(screen.getByText(label, { exact: true }))
      .toBeVisible();
    await expect
      .element(
        screen.getByRole('heading', {
          name: 'Prezentační plocha není aktivní',
        }),
      )
      .toBeVisible();
  });

  it('keeps private ticket state unavailable offline', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Synthetic offline transport failure');
    });
    const api = createFetchApiClient({
      fetch,
      isOnline: () => false,
      maxRetries: 0,
    });
    const screen = await renderComponent(
      <ParticipantTicket api={api} eventId={ticketFixtureEventId} />,
    );

    await expect.element(screen.getByText('Jste offline')).toBeVisible();
    const retry = screen.getByRole('button', { name: 'Zkusit znovu' });
    expect(
      retry.element().getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
    expect(fetch).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('Alex Novák');
  });

  it.each([
    [
      participantTicketProblemFixtures.authentication!,
      'Je potřeba se přihlásit',
    ],
    [participantTicketProblemFixtures.session_expired!, 'Přihlášení vypršelo'],
    [participantTicketProblemFixtures.permission!, 'Vstupenka není dostupná'],
    [
      participantTicketProblemFixtures.internal_error!,
      'Vstupenku se nepodařilo načíst',
    ],
  ])(
    'maps a private endpoint failure without raw detail %#',
    async (fixture, title) => {
      const screen = await renderComponent(
        <ParticipantTicket
          api={apiForProblem(fixture)}
          eventId={ticketFixtureEventId}
        />,
      );

      await expect.element(screen.getByText(title)).toBeVisible();
      expect(document.body.textContent).not.toContain(fixture.detail);
      if (
        fixture.code === 'AUTHENTICATION_REQUIRED' ||
        fixture.code === 'AUTH_SESSION_EXPIRED'
      ) {
        await expect
          .element(screen.getByRole('link', { name: 'Přihlásit se znovu' }))
          .toHaveAttribute(
            'href',
            '/prihlaseni?mode=recovery&returnTo=%2Fapp%2Fvstupenka',
          );
      } else if (fixture.code === 'TICKET_NOT_FOUND') {
        await expect
          .element(screen.getByRole('link', { name: 'Zpět na přehled' }))
          .toHaveAttribute('href', '/app');
      } else {
        await expect
          .element(screen.getByRole('button', { name: 'Zkusit znovu' }))
          .toBeVisible();
      }
    },
  );

  it('shows bounded loading feedback while the private read is pending', async () => {
    const api = createFetchApiClient({
      fetch: () => new Promise<Response>(() => undefined),
      maxRetries: 0,
    });
    const screen = await renderComponent(
      <ParticipantTicket api={api} eventId={ticketFixtureEventId} />,
    );

    await expect
      .element(screen.getByText('Načítám stav vstupenky…'))
      .toBeVisible();
  });
});
