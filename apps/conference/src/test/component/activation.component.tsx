import type { ActivationLandingProblem } from '@byzon/domain/contracts';
import {
  activationLandingFixtures,
  activationLandingProblemFixtures,
} from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import ActivationLayout from '../../app/aktivace/layout';
import { ActivationEntry } from '../../components/activation-entry';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const apiFor = (fixture: unknown) =>
  createFetchApiClient({
    maxRetries: 0,
    fetch: async () =>
      Response.json(fixture, {
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'component-activation-0001',
        },
      }),
  });

const apiForProblem = (problem: ActivationLandingProblem) =>
  createFetchApiClient({
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

const ActivationProbe = ({
  fixture = activationLandingFixtures.anonymous,
}: {
  readonly fixture?: unknown;
}) => (
  <main id="main" tabIndex={-1}>
    <ActivationLayout>
      <ActivationEntry api={apiFor(fixture)} />
    </ActivationLayout>
  </main>
);

beforeEach(() => {
  window.history.replaceState({}, '', '/aktivace');
});

describe('F1-01 activation landing', () => {
  it('offers manual and progressive camera paths accessibly', async () => {
    const screen = await renderComponent(<ActivationProbe />);

    await expect
      .element(
        screen.getByRole('heading', {
          level: 1,
          name: 'Aktivujte si BYZON',
        }),
      )
      .toHaveFocus();
    await expect
      .element(screen.getByRole('link', { name: 'Zadat kód' }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Použít kameru' }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText('Nevytvoří účet, členství ani skutečnou relaci.'),
      )
      .toBeVisible();

    const main = document.querySelector('main');
    if (!(main instanceof HTMLElement)) {
      throw new TypeError('Activation probe must render a main element.');
    }
    expect(
      screen
        .getByRole('link', { name: 'Zadat kód' })
        .element()
        .getBoundingClientRect().height,
    ).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(main);
  });

  it('only exposes activation methods allowed by the server contract', async () => {
    const screen = await renderComponent(
      <ActivationProbe
        fixture={{
          ...activationLandingFixtures.anonymous,
          availability: {
            state: 'open',
            methods: ['manual_code'],
          },
        }}
      />,
    );

    await expect
      .element(screen.getByRole('link', { name: 'Zadat kód' }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Použít kameru');
  });

  it.each([
    [activationLandingFixtures.closed_before, 'Aktivace ještě není otevřená'],
    [activationLandingFixtures.closed_ended, 'Aktivace už skončila'],
    [activationLandingFixtures.closed_archived, 'Ročník je archivovaný'],
  ])('renders an explicit phase gate %#', async (fixture, title) => {
    const screen = await renderComponent(<ActivationProbe fixture={fixture} />);

    await expect.element(screen.getByText(title)).toBeVisible();
    expect(document.querySelector('a[href="/aktivace/kod"]')).toBeNull();
  });

  it('maps session expiry to a safe return path without raw detail', async () => {
    const problem = activationLandingProblemFixtures.session_expired!;
    const screen = await renderComponent(
      <ActivationEntry api={apiForProblem(problem)} />,
    );

    await expect.element(screen.getByText('Přihlášení vypršelo')).toBeVisible();
    const login = screen.getByRole('link', { name: 'Obnovit přihlášení' });
    expect(login.element().getAttribute('href')).toBe(
      '/prihlaseni?returnTo=%2Faktivace',
    );
    expect(document.body.textContent).not.toContain(problem.detail);
  });

  it('keeps activation online-only when the browser is offline', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Synthetic offline');
    });
    const screen = await renderComponent(
      <ActivationEntry
        api={createFetchApiClient({
          fetch,
          isOnline: () => false,
          maxRetries: 0,
        })}
      />,
    );

    await expect
      .element(screen.getByText('Aktivace vyžaduje připojení'))
      .toBeVisible();
    expect(fetch).toHaveBeenCalled();
  });
});
