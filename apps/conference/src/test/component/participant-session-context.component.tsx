import {
  identityBootstrapFixtures,
  identitySessionActionFixtures,
} from '@byzon/test-support/fixtures';
import { identityBootstrapResponseSchema } from '@byzon/domain/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import { ParticipantLayoutShell } from '../../components/participant-layout-shell';
import { ParticipantMoreHub } from '../../components/participant-account-more';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import { renderComponent } from './render';
import { expectComponentToPassAxe } from './accessibility';

const identity = identityBootstrapResponseSchema.parse({
  ...identityBootstrapFixtures.complete!,
  membership: {
    access: { state: 'active' },
    roles: ['organizer_admin', 'participant'],
  },
});
const scope = { kind: 'active', eventId: identity.event.id } as const;

beforeEach(() => {
  window.history.replaceState({}, '', '/app/vice');
});

describe('escaping the participant app with an admin session', () => {
  it('keeps the admin return and real session actions available when profile loading fails', async () => {
    const actions: string[] = [];
    const api = createFetchApiClient({
      maxRetries: 0,
      fetch: async (_input, options) => {
        if (options?.method === 'POST') {
          actions.push(JSON.parse(String(options.body)).action);
          return Response.json(identitySessionActionFixtures.switch_account, {
            headers: { 'x-request-id': 'admin-switch-session-request' },
          });
        }
        return new Response('profile unavailable', { status: 500 });
      },
    });
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <ParticipantLayoutShell
          accountApi={api}
          accountScope={scope}
          sessionContext={{ isAdmin: true, isParticipant: false }}
        >
          <ParticipantMoreHub api={api} />
        </ParticipantLayoutShell>
      </main>,
    );
    await expect
      .element(screen.getByText('Používáte administrátorský účet'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Zpět do administrace' }))
      .toHaveAttribute('href', '/admin');
    await expect
      .element(screen.getByRole('button', { name: 'Odhlásit tento účet' }))
      .toBeVisible();
    expect(
      screen.getByText('Účet se nepodařilo načíst').elements(),
    ).toHaveLength(0);
    await expectComponentToPassAxe(screen.container);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );

    await screen.getByRole('button', { name: 'Použít jiný účet' }).click();
    expect(actions).toEqual([]);
    await screen
      .getByRole('button', { name: 'Pokračovat k jinému účtu' })
      .click();
    await expect
      .element(screen.getByText('Náhled je připravený pro jiný účet'))
      .toBeVisible();
    expect(actions).toEqual(['switch_account']);
  });

  it('lets an admin with a participant role use their profile and return without signing out', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(identity, {
        headers: { 'x-request-id': 'admin-participant-bootstrap' },
      }),
    );
    const api = createFetchApiClient({ fetch, maxRetries: 0 });
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <ParticipantLayoutShell
          accountApi={api}
          accountScope={scope}
          sessionContext={{ isAdmin: true, isParticipant: true }}
        >
          <ParticipantMoreHub api={api} />
        </ParticipantLayoutShell>
      </main>,
    );
    await expect.element(screen.getByText('Alex Novák')).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Zpět do administrace' }))
      .toHaveAttribute('href', '/admin');
    expect(
      screen.getByText('Používáte administrátorský účet').elements(),
    ).toHaveLength(0);
    expect(
      fetch.mock.calls.every(([, options]) => options?.method !== 'POST'),
    ).toBe(true);
  });

  it('offers session controls even when neither profile nor role context is available', async () => {
    const api = createFetchApiClient({
      maxRetries: 0,
      fetch: async () => new Response('unavailable', { status: 500 }),
    });
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <ParticipantLayoutShell accountApi={api} accountScope={scope}>
          <ParticipantMoreHub api={api} />
        </ParticipantLayoutShell>
      </main>,
    );
    await expect
      .element(screen.getByText('Účet se nepodařilo načíst'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Použít jiný účet' }))
      .toBeVisible();
    await expect
      .element(screen.getByRole('button', { name: 'Odhlásit tento účet' }))
      .toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Zpět do administrace' }).elements(),
    ).toHaveLength(0);
  });
});
