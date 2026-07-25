import {
  identityBootstrapResponseSchema,
  sessionExpiredProblemSchema,
  type ApiProblem,
  type IdentityBootstrapResponse,
} from '@byzon/domain/contracts';
import {
  identityBootstrapFixtures,
  identityBootstrapProblemFixtures,
  identityPrivacyRequestProblemFixtures,
  identityPrivacyRequestFixtures,
  identityProfileUpdateFixtures,
  identityProfileUpdateProblemFixtures,
  identitySessionActionFixtures,
  participantAnnouncementDetailProblemFixtures,
  participantProgramProblemFixtures,
  participantTicketProblemFixtures,
} from '@byzon/test-support/fixtures';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../app/styles.css';
import { ParticipantLayoutShell as ParticipantLayout } from '../../components/participant-layout-shell';
import { AppMain } from '../../components/app-main';
import { ParticipantMoreHub } from '../../components/participant-account-more';
import { ParticipantPrivacy } from '../../components/participant-account-privacy';
import { ParticipantProfile } from '../../components/participant-account-profile';
import {
  ParticipantAccountResourceProvider,
  type ParticipantAccountScope,
  useParticipantAccountResource,
} from '../../components/participant-account-resource';
import { ParticipantAccountSettings } from '../../components/participant-account-settings';
import { ParticipantShellNavigation } from '../../components/participant-shell-navigation';
import type { ApiPort, ApiRequestCommonOptions } from '../../lib/api';
import { createFetchApiClient } from '../../lib/api/fetch-client';
import {
  invalidateParticipantPrivateResources,
  privateResourceInvalidationReason,
} from '../../lib/private-resource-events';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const visualTestStyle = {
  '--byzon-font-body': 'Arial, sans-serif',
  '--byzon-font-display': 'Arial, sans-serif',
  fontFamily: 'Arial, sans-serif',
} as CSSProperties;
const metadata = { requestId: 'component-account-0001' } as const;
type RecordedRequest = ApiRequestCommonOptions & { readonly body?: unknown };

const activeIdentity = identityBootstrapResponseSchema.parse({
  ...identityBootstrapFixtures.complete!,
  membership: {
    access: { state: 'active' },
    roles: ['participant'],
  },
});
const updatedIdentity = identityBootstrapResponseSchema.parse({
  ...activeIdentity,
  profile: identityProfileUpdateFixtures.updated!.profile,
  profileManagement: identityProfileUpdateFixtures.updated!.profileManagement,
});
const draftIdentity = identityBootstrapResponseSchema.parse({
  ...activeIdentity,
  event: { ...activeIdentity.event, phase: 'draft' },
});
const activeAccountScope = {
  kind: 'active',
  eventId: activeIdentity.event.id,
} as const;
const archivedAccountScope = {
  kind: 'archived',
  eventFingerprint:
    '9caa2f149fcc7d8e862b204f15035cc4a72782f6d49ef14698672e50dd3ee86a',
} as const;
const missingProfileIdentity = identityBootstrapResponseSchema.parse({
  ...identityBootstrapFixtures.profile_required!,
  membership: {
    access: { state: 'active' },
    roles: ['participant'],
  },
});
const activeReadOnlyIdentity = identityBootstrapResponseSchema.parse({
  ...activeIdentity,
  profileManagement: { state: 'read_only' },
});

const accountApi = ({
  bootstrap = [activeIdentity],
  bootstrapGate,
  bootstrapGates = [],
  bootstrapProblems = [],
  onRequest,
  privacyResponse = identityPrivacyRequestFixtures.export_pending!,
  privacyGate,
  privacyProblem,
  profileGate,
  profileProblem,
  profileResponse = identityProfileUpdateFixtures.updated!,
}: {
  readonly bootstrap?: readonly IdentityBootstrapResponse[];
  readonly bootstrapGate?: Promise<void>;
  readonly bootstrapGates?: readonly (Promise<void> | undefined)[];
  readonly bootstrapProblems?: readonly (ApiProblem | undefined)[];
  readonly onRequest?: (request: RecordedRequest) => void;
  readonly privacyResponse?: unknown;
  readonly privacyGate?: Promise<void>;
  readonly privacyProblem?: ApiProblem;
  readonly profileGate?: Promise<void>;
  readonly profileProblem?: ApiProblem;
  readonly profileResponse?: unknown;
} = {}): ApiPort => {
  let bootstrapIndex = 0;
  return {
    request: async (endpoint, options) => {
      onRequest?.(options);
      if (options.path === '/api/v1/me/bootstrap') {
        await (bootstrapGates[bootstrapIndex] ?? bootstrapGate);
        const problem = bootstrapProblems[bootstrapIndex];
        if (problem) {
          bootstrapIndex += 1;
          return {
            ok: false,
            kind: 'failure',
            status: problem.status,
            failure: {
              kind: 'problem',
              problem: endpoint.problemSchema.parse(problem),
            },
            metadata: { requestId: problem.requestId },
          };
        }
        const fixture =
          bootstrap[Math.min(bootstrapIndex, bootstrap.length - 1)];
        bootstrapIndex += 1;
        if (!fixture) throw new TypeError('Missing account bootstrap fixture.');
        return {
          ok: true,
          kind: 'success',
          status: 200,
          data: endpoint.successSchema.parse(fixture),
          metadata,
        };
      }
      if (options.path === '/api/v1/me/profile') {
        await profileGate;
        if (profileProblem) {
          return {
            ok: false,
            kind: 'failure',
            status: profileProblem.status,
            failure: {
              kind: 'problem',
              problem: endpoint.problemSchema.parse(profileProblem),
            },
            metadata: { requestId: profileProblem.requestId },
          };
        }
        return {
          ok: true,
          kind: 'success',
          status: 200,
          data: endpoint.successSchema.parse(profileResponse),
          metadata,
        };
      }
      if (options.path === '/api/v1/me/privacy-requests') {
        await privacyGate;
        if (privacyProblem) {
          return {
            ok: false,
            kind: 'failure',
            status: privacyProblem.status,
            failure: {
              kind: 'problem',
              problem: endpoint.problemSchema.parse(privacyProblem),
            },
            metadata: { requestId: privacyProblem.requestId },
          };
        }
        return {
          ok: true,
          kind: 'success',
          status: 202,
          data: endpoint.successSchema.parse(privacyResponse),
          metadata,
        };
      }
      if (options.path === '/api/v1/me/session-action') {
        return {
          ok: true,
          kind: 'success',
          status: 200,
          data: endpoint.successSchema.parse(
            identitySessionActionFixtures.logout_current,
          ),
          metadata,
        };
      }
      throw new TypeError(`Unexpected account component path ${options.path}`);
    },
  };
};

const AccountProbe = ({
  api,
  children,
}: {
  readonly api: ApiPort;
  readonly children: ReactNode;
}) => (
  <main
    data-testid="participant-account-shell"
    id="main"
    style={visualTestStyle}
    tabIndex={-1}
  >
    <ParticipantLayout accountScope={activeAccountScope}>
      <ParticipantAccountResourceProvider api={api} scope={activeAccountScope}>
        {children}
      </ParticipantAccountResourceProvider>
    </ParticipantLayout>
  </main>
);

const AccountResourceProbe = () => {
  const resource = useParticipantAccountResource();
  return (
    <section>
      <p data-testid="account-resource-status">{resource.state.status}</p>
      {resource.state.status === 'ready' ? (
        <p>{resource.state.data.user.email}</p>
      ) : null}
      <button onClick={() => void resource.clearPrivateData()} type="button">
        Vyčistit účet
      </button>
      <button
        onClick={() => resource.discardPrivateData('session_expired')}
        type="button"
      >
        Zahodit účet
      </button>
    </section>
  );
};

const AccountRetryProbe = () => {
  const resource = useParticipantAccountResource();
  return (
    <button onClick={resource.retry} type="button">
      Znovu ověřit účet
    </button>
  );
};

const ScopedProfileProbe = ({
  api,
  scope,
}: {
  readonly api: ApiPort;
  readonly scope: ParticipantAccountScope;
}) => (
  <main id="main" style={visualTestStyle} tabIndex={-1}>
    <ParticipantAccountResourceProvider api={api} scope={scope}>
      <ParticipantProfile api={api} />
    </ParticipantAccountResourceProvider>
  </main>
);

const ScopedAccountPageProbe = ({
  api,
  children,
  scope,
}: {
  readonly api: ApiPort;
  readonly children: ReactNode;
  readonly scope: ParticipantAccountScope;
}) => (
  <main id="main" style={visualTestStyle} tabIndex={-1}>
    <ParticipantAccountResourceProvider api={api} scope={scope}>
      {children}
    </ParticipantAccountResourceProvider>
  </main>
);

const AccountResourceRemountProbe = () => {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button onClick={() => setVisible((current) => !current)} type="button">
        {visible ? 'Opustit účet' : 'Vrátit se k účtu'}
      </button>
      {visible ? <AccountResourceProbe /> : <p>Jiná participant route</p>}
    </>
  );
};

const useBrowserPathname = () => {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', update);
    update();
    return () => window.removeEventListener('popstate', update);
  }, []);
  return pathname;
};

const AccountProviderLifetime = ({
  onMount,
}: {
  readonly onMount?: () => void;
}) => {
  useEffect(() => {
    onMount?.();
  }, [onMount]);
  return null;
};

const AccountJourney = ({
  api,
  onMount,
  rawProfileLink = false,
}: {
  readonly api: ApiPort;
  readonly onMount?: () => void;
  readonly rawProfileLink?: boolean;
}) => {
  const pathname = useBrowserPathname();
  return (
    <AppMain>
      <div style={visualTestStyle}>
        <ParticipantAccountResourceProvider
          api={api}
          scope={activeAccountScope}
        >
          <AccountProviderLifetime {...(onMount ? { onMount } : {})} />
          <ParticipantShellNavigation />
          <div className="participant-shell-content">
            {pathname === '/app/profil' ? (
              <ParticipantProfile api={api} />
            ) : (
              <>
                {rawProfileLink ? (
                  <a href="/app/profil">
                    Otevřít profil obyčejným interním odkazem
                  </a>
                ) : null}
                <ParticipantMoreHub />
              </>
            )}
          </div>
        </ParticipantAccountResourceProvider>
      </div>
    </AppMain>
  );
};

const waitForPopstate = () =>
  new Promise<void>((resolve) =>
    window.addEventListener('popstate', () => resolve(), { once: true }),
  );

const profileGuardIsActive = () =>
  Boolean(
    window.history.state &&
    typeof window.history.state === 'object' &&
    !Array.isArray(window.history.state) &&
    (window.history.state as Record<string, unknown>)[
      '__byzonParticipantProfileDraftGuard'
    ] === true,
  );

const invalidationReasonForProblem = (problem: ApiProblem) =>
  privateResourceInvalidationReason<ApiProblem>({
    kind: 'problem',
    problem,
  });

beforeEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/app/vice');
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('F2-07 participant account, profile and privacy', () => {
  it('keeps the account bootstrap lazy outside account consumers', async () => {
    const request = vi.fn();
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <ParticipantAccountResourceProvider
          api={accountApi({ onRequest: request })}
          scope={activeAccountScope}
        >
          <p>Veřejný participant obsah</p>
        </ParticipantAccountResourceProvider>
      </main>,
    );

    await expect
      .element(screen.getByText('Veřejný participant obsah'))
      .toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });

  it('never restores a deferred bootstrap after explicit clear or discard', async () => {
    for (const action of ['Vyčistit účet', 'Zahodit účet'] as const) {
      let releaseBootstrap: (() => void) | undefined;
      const bootstrapGate = new Promise<void>((resolve) => {
        releaseBootstrap = resolve;
      });
      const screen = await renderComponent(
        <main id="main" tabIndex={-1}>
          <ParticipantAccountResourceProvider
            api={accountApi({ bootstrapGate })}
            scope={activeAccountScope}
          >
            <AccountResourceProbe />
          </ParticipantAccountResourceProvider>
        </main>,
      );

      await expect
        .element(screen.getByTestId('account-resource-status'))
        .toHaveTextContent('loading');
      await screen.getByRole('button', { name: action }).click();
      await expect
        .element(screen.getByTestId('account-resource-status'))
        .toHaveTextContent(
          action === 'Vyčistit účet' ? 'cleared' : 'session_expired',
        );

      releaseBootstrap?.();
      await new Promise((resolve) => setTimeout(resolve, 0));

      await expect
        .element(screen.getByTestId('account-resource-status'))
        .toHaveTextContent(
          action === 'Vyčistit účet' ? 'cleared' : 'session_expired',
        );
      expect(screen.container.textContent).not.toContain('alex@example.test');
      await screen.unmount();
    }
  });

  it('does not refetch a terminally cleared account when a consumer remounts', async () => {
    const requests: RecordedRequest[] = [];
    const screen = await renderComponent(
      <main id="main" tabIndex={-1}>
        <ParticipantAccountResourceProvider
          api={accountApi({
            onRequest: (request) => requests.push(request),
          })}
          scope={activeAccountScope}
        >
          <AccountResourceRemountProbe />
        </ParticipantAccountResourceProvider>
      </main>,
    );

    await expect.element(screen.getByText('alex@example.test')).toBeVisible();
    expect(
      requests.filter(({ path }) => path === '/api/v1/me/bootstrap'),
    ).toHaveLength(1);
    await screen.getByRole('button', { name: 'Vyčistit účet' }).click();
    await screen.getByRole('button', { name: 'Opustit účet' }).click();
    await screen.getByRole('button', { name: 'Vrátit se k účtu' }).click();

    await expect
      .element(screen.getByTestId('account-resource-status'))
      .toHaveTextContent('cleared');
    expect(screen.container.textContent).not.toContain('alex@example.test');
    expect(
      requests.filter(({ path }) => path === '/api/v1/me/bootstrap'),
    ).toHaveLength(1);
  });

  it('revalidates a cached account before showing it to a remounted route', async () => {
    const requests: RecordedRequest[] = [];
    const screen = await renderComponent(
      <AccountJourney
        api={accountApi({
          bootstrapProblems: [
            undefined,
            identityBootstrapProblemFixtures.authentication!,
          ],
          onRequest: (request) => requests.push(request),
        })}
      />,
    );
    await expect.element(screen.getByText('Alex Novák')).toBeVisible();

    await screen.getByRole('link', { name: 'Profilové údaje' }).click();

    await expect.element(screen.getByText('Přihlášení vypršelo')).toBeVisible();
    expect(screen.container.textContent).not.toContain('alex@example.test');
    expect(screen.getByLabelText('Jméno').elements()).toHaveLength(0);
    expect(
      requests.filter(({ path }) => path === '/api/v1/me/bootstrap'),
    ).toHaveLength(2);
  });

  it('renders the responsive More hub with focus, 44px targets and an axe-clean hierarchy', async () => {
    const screen = await renderComponent(
      <AccountProbe api={accountApi()}>
        <ParticipantMoreHub />
      </AccountProbe>,
    );

    await expect
      .element(
        screen.getByRole('heading', {
          level: 1,
          name: 'Účet a informace',
        }),
      )
      .toHaveFocus();
    await expect.element(screen.getByText('Alex Novák')).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Profilové údaje' }))
      .toHaveAttribute('href', '/app/profil');

    for (const target of screen.container.querySelectorAll('a, button')) {
      const bounds = target.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(screen.container);
  });

  it('fails closed without serializing account or event PII for a draft bootstrap', async () => {
    const screen = await renderComponent(
      <AccountProbe api={accountApi({ bootstrap: [draftIdentity] })}>
        <ParticipantMoreHub />
      </AccountProbe>,
    );

    await expect
      .element(screen.getByText('K účtu nemáte přístup'))
      .toBeVisible();
    expect(screen.container.textContent).not.toContain('BYZON 2026');
    expect(screen.container.textContent).not.toContain('alex@example.test');
    expect(screen.container.textContent).not.toContain('Alex Novák');
  });

  it.each([
    [
      'a different active event',
      {
        kind: 'active',
        eventId: '01910000-0000-7000-8000-000000000999',
      } as const,
    ],
    ['an archived server scope', archivedAccountScope],
  ])('rejects an active bootstrap in %s', async (_label, scope) => {
    const screen = await renderComponent(
      <ScopedProfileProbe api={accountApi()} scope={scope} />,
    );

    await expect
      .element(screen.getByText('K účtu nemáte přístup'))
      .toBeVisible();
    expect(screen.getByLabelText('Jméno').elements()).toHaveLength(0);
    expect(screen.container.textContent).not.toContain('alex@example.test');
    expect(screen.container.textContent).not.toContain('Alex Novák');
  });

  it('never requests or renders account data for an unavailable server scope', async () => {
    const request = vi.fn();
    const screen = await renderComponent(
      <ScopedProfileProbe
        api={accountApi({ onRequest: request })}
        scope={{ kind: 'unavailable' }}
      />,
    );

    await expect
      .element(screen.getByText('K účtu nemáte přístup'))
      .toBeVisible();
    expect(request).not.toHaveBeenCalled();
    expect(screen.container.textContent).not.toContain('alex@example.test');
  });

  it('never requests account data for a malformed archived fingerprint', async () => {
    const request = vi.fn();
    const screen = await renderComponent(
      <ScopedProfileProbe
        api={accountApi({ onRequest: request })}
        scope={{ kind: 'archived', eventFingerprint: '' }}
      />,
    );

    await expect
      .element(screen.getByText('K účtu nemáte přístup'))
      .toBeVisible();
    expect(request).not.toHaveBeenCalled();
    expect(screen.container.textContent).not.toContain('alex@example.test');
  });

  it('accepts only a canonical read-only account in the archived server scope', async () => {
    const screen = await renderComponent(
      <ScopedProfileProbe
        api={accountApi({
          bootstrap: [identityBootstrapFixtures.read_only!],
        })}
        scope={archivedAccountScope}
      />,
    );

    await expect
      .element(screen.getByText('Profil spravuje organizátor'))
      .toBeVisible();
    expect(screen.getByLabelText('Jméno').elements()).toHaveLength(0);
  });

  it.each([
    ['privacy', '/app/soukromi', 'Obnovit přihlášení'],
    ['settings', '/app/nastaveni', 'Obnovit přihlášení'],
  ] as const)(
    'returns an expired archived %s account task to its exact route',
    async (page, returnTo, actionName) => {
      const api = accountApi({
        bootstrapProblems: [identityBootstrapProblemFixtures.session_expired!],
      });
      const screen = await renderComponent(
        <ScopedAccountPageProbe api={api} scope={archivedAccountScope}>
          {page === 'privacy' ? (
            <ParticipantPrivacy api={api} />
          ) : (
            <ParticipantAccountSettings api={api} />
          )}
        </ScopedAccountPageProbe>,
      );

      await expect
        .element(screen.getByRole('link', { name: actionName }))
        .toHaveAttribute(
          'href',
          `/prihlaseni?mode=recovery&returnTo=${encodeURIComponent(returnTo)}`,
        );
    },
  );

  it('rejects a read-only archived bootstrap from a different event fingerprint', async () => {
    const otherArchivedIdentity = identityBootstrapResponseSchema.parse({
      ...identityBootstrapFixtures.read_only!,
      event: {
        ...identityBootstrapFixtures.read_only!.event,
        id: '01910000-0000-7000-8000-000000000998',
      },
    });
    const screen = await renderComponent(
      <ScopedProfileProbe
        api={accountApi({ bootstrap: [otherArchivedIdentity] })}
        scope={archivedAccountScope}
      />,
    );

    await expect
      .element(screen.getByText('K účtu nemáte přístup'))
      .toBeVisible();
    expect(screen.getByLabelText('Jméno').elements()).toHaveLength(0);
    expect(screen.container.textContent).not.toContain('alex@example.test');
    expect(screen.container.textContent).not.toContain('Alex Novák');
  });

  it('hides archived PII synchronously when the server fingerprint changes', async () => {
    let releaseChangedScope: (() => void) | undefined;
    const changedScopeGate = new Promise<void>((resolve) => {
      releaseChangedScope = resolve;
    });
    const api = accountApi({
      bootstrap: [identityBootstrapFixtures.read_only!],
      bootstrapGates: [undefined, changedScopeGate],
    });
    const screen = await renderComponent(
      <ScopedProfileProbe api={api} scope={archivedAccountScope} />,
    );
    await expect
      .element(screen.getByText('Profil spravuje organizátor'))
      .toBeVisible();
    await expect.element(screen.getByText('alex@example.test')).toBeVisible();

    await screen.rerender(
      <ScopedProfileProbe
        api={api}
        scope={{
          kind: 'archived',
          eventFingerprint:
            '1e5a982ed2804d2527ffdd52454744aa05ed5ecf7b06e5c076dab94583ff5bf0',
        }}
      />,
    );

    expect(screen.container.textContent).not.toContain('alex@example.test');
    expect(screen.container.textContent).not.toContain('Alex Novák');
    releaseChangedScope?.();
  });

  it('hides ready PII synchronously when the server account scope changes', async () => {
    let releaseWrongScope: (() => void) | undefined;
    const wrongScopeGate = new Promise<void>((resolve) => {
      releaseWrongScope = resolve;
    });
    const api = accountApi({
      bootstrapGates: [undefined, wrongScopeGate],
    });
    const screen = await renderComponent(
      <ScopedProfileProbe api={api} scope={activeAccountScope} />,
    );
    await expect.element(screen.getByLabelText('Jméno')).toHaveValue('Alex');

    await screen.rerender(
      <ScopedProfileProbe
        api={api}
        scope={{
          kind: 'active',
          eventId: '01910000-0000-7000-8000-000000000999',
        }}
      />,
    );

    expect(screen.getByLabelText('Jméno').elements()).toHaveLength(0);
    expect(screen.container.textContent).not.toContain('alex@example.test');
    expect(screen.container.textContent).not.toContain('Alex Novák');
    releaseWrongScope?.();
  });

  it('guards an edited profile and accepts only its correlated canonical version', async () => {
    window.history.replaceState({}, '', '/app/profil');
    const requests: RecordedRequest[] = [];
    const api = accountApi({
      onRequest: (request) => requests.push(request),
    });
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <ParticipantProfile api={api} />
      </AccountProbe>,
    );

    const firstName = screen.getByLabelText('Jméno');
    await expect.element(firstName).toHaveValue('Alex');
    await firstName.fill(' Alexandr ');
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    const save = screen.getByRole('button', { name: 'Uložit profil' });
    const bounds = save.element().getBoundingClientRect();
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    await save.click();

    await expect.element(screen.getByText('Profil je uložený')).toBeVisible();
    await expect
      .element(
        screen.getByText('Zobrazujeme kanonickou podobu potvrzenou serverem.'),
      )
      .toHaveFocus();
    await expect.element(firstName).toHaveValue('Alexandr');
    expect(
      requests.find(({ path }) => path === '/api/v1/me/profile')?.body,
    ).toEqual({
      expectedVersion: 1,
      profile: {
        firstName: 'Alexandr',
        lastName: 'Novák',
        contactEmail: 'alex@example.test',
      },
    });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it.each([
    { responseVersion: 2, scenario: 'stejnou' },
    { responseVersion: 1, scenario: 'nižší' },
  ])(
    'rejects a schema-valid profile response with $scenario version and keeps the draft',
    async ({ responseVersion }) => {
      window.history.replaceState({}, '', '/app/profil');
      const versionTwoIdentity = identityBootstrapResponseSchema.parse({
        ...activeIdentity,
        profileManagement: { state: 'editable', version: 2 },
      });
      const api = accountApi({
        bootstrap: [versionTwoIdentity],
        profileResponse: {
          ...identityProfileUpdateFixtures.updated!,
          profile: {
            ...identityProfileUpdateFixtures.updated!.profile,
            firstName: 'Serverem vnucené',
          },
          profileManagement: {
            state: 'editable',
            version: responseVersion,
          },
        },
      });
      const screen = await renderComponent(
        <AccountProbe api={api}>
          <ParticipantProfile api={api} />
        </AccountProbe>,
      );

      const firstName = screen.getByLabelText('Jméno');
      await expect.element(firstName).toHaveValue('Alex');
      await firstName.fill('Rozepsané');
      await screen.getByRole('button', { name: 'Uložit profil' }).click();

      await expect
        .element(screen.getByText('Profil se nepodařilo uložit'))
        .toBeVisible();
      await expect.element(firstName).toHaveValue('Rozepsané');
      expect(screen.container.textContent).not.toContain('Serverem vnucené');
      expect(screen.getByText('Profil je uložený').elements()).toHaveLength(0);
    },
  );

  it('disables every editable profile control while PATCH is pending', async () => {
    window.history.replaceState({}, '', '/app/profil');
    let releaseProfile: (() => void) | undefined;
    const profileGate = new Promise<void>((resolve) => {
      releaseProfile = resolve;
    });
    const api = accountApi({ profileGate });
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <ParticipantProfile api={api} />
      </AccountProbe>,
    );

    await screen.getByLabelText('Jméno').fill('Alexandr');
    await screen.getByRole('button', { name: 'Uložit profil' }).click();

    await expect.element(screen.getByLabelText('Jméno')).toBeDisabled();
    await expect.element(screen.getByLabelText('Příjmení')).toBeDisabled();
    await expect
      .element(screen.getByLabelText('Kontaktní e-mail'))
      .toBeDisabled();
    await expect
      .element(screen.getByRole('button', { name: 'Ukládám profil…' }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole('button', { name: 'Zahodit změny' }))
      .toBeDisabled();

    releaseProfile?.();
    await expect.element(screen.getByText('Profil je uložený')).toBeVisible();
  });

  it('preserves a stale draft until explicit reload and never applies a mismatched profile response', async () => {
    window.history.replaceState({}, '', '/app/profil');
    const api = accountApi({
      bootstrap: [activeIdentity, updatedIdentity],
      profileProblem: identityProfileUpdateProblemFixtures.stale!,
    });
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <ParticipantProfile api={api} />
      </AccountProbe>,
    );

    const firstName = screen.getByLabelText('Jméno');
    await firstName.fill('Rozepsané');
    await screen.getByRole('button', { name: 'Uložit profil' }).click();
    await expect.element(firstName).toHaveValue('Rozepsané');
    await expect
      .element(screen.getByText('Profil se mezitím změnil'))
      .toBeVisible();

    await screen
      .getByRole('button', {
        name: 'Zahodit změny a načíst aktuální profil',
      })
      .click();
    await expect
      .element(screen.getByLabelText('Jméno'))
      .toHaveValue('Alexandr');
  });

  it('purges a stale editable profile when the server confirms it no longer exists', async () => {
    window.history.replaceState({}, '', '/app/profil');
    const api = accountApi({
      bootstrap: [activeIdentity, missingProfileIdentity],
      profileProblem: identityProfileUpdateProblemFixtures.not_found!,
    });
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <ParticipantProfile api={api} />
      </AccountProbe>,
    );

    await screen.getByLabelText('Jméno').fill('Citlivý rozepsaný profil');
    await screen.getByRole('button', { name: 'Uložit profil' }).click();

    await expect
      .element(screen.getByText('Profil ještě není vytvořený'))
      .toBeVisible();
    expect(screen.getByLabelText('Jméno').elements()).toHaveLength(0);
    expect(screen.container.textContent).not.toContain(
      'Citlivý rozepsaný profil',
    );
  });

  it('replaces a stale editable form with the canonical read-only profile', async () => {
    window.history.replaceState({}, '', '/app/profil');
    const api = accountApi({
      bootstrap: [activeIdentity, activeReadOnlyIdentity],
      profileProblem: identityProfileUpdateProblemFixtures.not_editable!,
    });
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <ParticipantProfile api={api} />
      </AccountProbe>,
    );

    await screen.getByLabelText('Jméno').fill('Neplatná rozepsaná změna');
    await screen.getByRole('button', { name: 'Uložit profil' }).click();

    await expect
      .element(screen.getByText('Profil spravuje organizátor'))
      .toBeVisible();
    expect(screen.getByLabelText('Jméno').elements()).toHaveLength(0);
    expect(screen.container.textContent).not.toContain(
      'Neplatná rozepsaná změna',
    );
  });

  it('fails closed when an archived bootstrap contradicts the read-only profile policy', async () => {
    window.history.replaceState({}, '', '/app/profil');
    const api = createFetchApiClient({
      maxRetries: 0,
      fetch: async () =>
        Response.json({
          ...activeIdentity,
          event: { ...activeIdentity.event, phase: 'archived' },
        }),
    });
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <ParticipantProfile api={api} />
      </AccountProbe>,
    );

    await expect
      .element(screen.getByText('Účet se nepodařilo načíst'))
      .toBeVisible();
    expect(screen.getByLabelText('Jméno').elements()).toHaveLength(0);
    expect(screen.container.textContent).not.toContain('alex@example.test');
    expect(screen.container.textContent).not.toContain('Alex Novák');
  });

  it('shows current legal acknowledgements and submits an explicitly confirmed export once', async () => {
    window.history.replaceState({}, '', '/app/soukromi');
    const requests: RecordedRequest[] = [];
    const api = accountApi({
      onRequest: (request) => requests.push(request),
    });
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <ParticipantPrivacy
          api={api}
          createIdempotencyKey={() => 'privacy-export-0001'}
        />
      </AccountProbe>,
    );

    await expect
      .element(screen.getByText('Podmínky používání – syntetický náhled'))
      .toBeVisible();
    expect(screen.getByText('Souhlas potvrzen').elements()).not.toHaveLength(0);
    await screen.getByRole('button', { name: 'Požádat o export' }).click();
    await expect
      .element(
        screen.getByRole('heading', {
          level: 2,
          name: 'Odeslat žádost o export?',
        }),
      )
      .toBeVisible();
    await screen.getByRole('button', { name: 'Odeslat žádost' }).click();

    await expect.element(screen.getByText('Žádost byla přijata')).toBeVisible();
    await expect
      .element(screen.getByText('Žádost se zpracovává'))
      .toBeVisible();
    const mutation = requests.find(
      ({ path }) => path === '/api/v1/me/privacy-requests',
    );
    expect(mutation?.body).toEqual({ kind: 'data_export' });
    expect(mutation?.idempotencyKey).toBe('privacy-export-0001');
    expect(
      requests.filter(({ path }) => path === '/api/v1/me/privacy-requests'),
    ).toHaveLength(1);
    await expectComponentToPassAxe(screen.container);
  });

  it('locks an unavailable privacy request after the canonical server rejection', async () => {
    window.history.replaceState({}, '', '/app/soukromi');
    const api = accountApi({
      privacyProblem: identityPrivacyRequestProblemFixtures.unavailable!,
    });
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <ParticipantPrivacy
          api={api}
          createIdempotencyKey={() => 'privacy-unavailable-0001'}
        />
      </AccountProbe>,
    );

    await screen.getByRole('button', { name: 'Požádat o export' }).click();
    await screen.getByRole('button', { name: 'Odeslat žádost' }).click();

    await expect
      .element(screen.getByText('Žádost už není dostupná'))
      .toBeVisible();
    await expect
      .element(screen.getByText('Žádost teď není dostupná'))
      .toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Požádat o export' }).elements(),
    ).toHaveLength(0);
  });

  it('does not let a late pending privacy response overwrite a revalidated terminal state', async () => {
    window.history.replaceState({}, '', '/app/soukromi');
    let releasePrivacy: (() => void) | undefined;
    const privacyGate = new Promise<void>((resolve) => {
      releasePrivacy = resolve;
    });
    const completedExportIdentity = identityBootstrapResponseSchema.parse({
      ...activeIdentity,
      privacy: {
        ...activeIdentity.privacy,
        exportRequest: 'completed',
      },
    });
    const api = accountApi({
      bootstrap: [activeIdentity, completedExportIdentity],
      privacyGate,
    });
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <AccountRetryProbe />
        <ParticipantPrivacy
          api={api}
          createIdempotencyKey={() => 'privacy-late-pending-0001'}
        />
      </AccountProbe>,
    );

    await screen.getByRole('button', { name: 'Požádat o export' }).click();
    await screen.getByRole('button', { name: 'Odeslat žádost' }).click();
    const retryAccount = screen
      .getByRole('button', { name: 'Znovu ověřit účet' })
      .element();
    if (!(retryAccount instanceof HTMLButtonElement)) {
      throw new TypeError('Expected account retry button.');
    }
    retryAccount.click();
    await expect.element(screen.getByText('Žádost je dokončená')).toBeVisible();

    releasePrivacy?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect.element(screen.getByText('Žádost je dokončená')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Požádat o export' }).elements(),
    ).toHaveLength(0);
  });

  it('requires a separate deletion confirmation and keeps removed profiles private', async () => {
    window.history.replaceState({}, '', '/app/soukromi');
    const requests: RecordedRequest[] = [];
    const api = accountApi({
      onRequest: (request) => requests.push(request),
      privacyResponse: identityPrivacyRequestFixtures.deletion_pending!,
    });
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <ParticipantPrivacy
          api={api}
          createIdempotencyKey={() => 'privacy-deletion-0001'}
        />
      </AccountProbe>,
    );

    await screen.getByRole('button', { name: 'Požádat o smazání' }).click();
    const confirm = screen.getByRole('button', {
      name: 'Potvrdit žádost o smazání',
    });
    await expect.element(confirm).toBeDisabled();
    await screen
      .getByLabelText('Rozumím důsledkům a chci odeslat žádost o smazání')
      .click();
    await expect.element(confirm).toBeEnabled();
    await confirm.click();

    expect(
      requests.find(({ path }) => path === '/api/v1/me/privacy-requests')?.body,
    ).toEqual({ kind: 'data_deletion' });

    const removedScreen = await renderComponent(
      <AccountProbe
        api={accountApi({ bootstrap: [identityBootstrapFixtures.removed!] })}
      >
        <ParticipantProfile />
      </AccountProbe>,
    );
    await expect
      .element(removedScreen.getByText('Profil byl odstraněn'))
      .toBeVisible();
    expect(removedScreen.container.textContent).not.toContain('Alex Novák');
    expect(removedScreen.container.textContent).not.toContain(
      'alex@example.test',
    );
  });

  it('keeps the confirmed logout outcome visible after wiping the account resource', async () => {
    window.history.replaceState({}, '', '/app/nastaveni');
    const api = accountApi();
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <ParticipantAccountSettings api={api} />
      </AccountProbe>,
    );

    await expect.element(screen.getByText('alex@example.test')).toBeVisible();
    await screen.getByRole('button', { name: 'Odhlásit tento účet' }).click();
    await screen.getByRole('button', { name: 'Odhlásit', exact: true }).click();

    await expect
      .element(screen.getByText('Aktuální přihlášení bylo v náhledu ukončeno'))
      .toBeVisible();
    await expect
      .element(screen.getByText('Údaje účtu už nejsou na stránce'))
      .toBeVisible();
    expect(screen.container.textContent).not.toContain('alex@example.test');
  });

  it('wipes visible account data and recovers to settings after a malformed session-action 401', async () => {
    window.history.replaceState({}, '', '/app/nastaveni');
    const api = createFetchApiClient({
      maxRetries: 0,
      fetch: async (input) => {
        const url = new URL(
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
          window.location.origin,
        );
        if (url.pathname === '/api/v1/me/bootstrap') {
          return Response.json(activeIdentity, {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'component-account-bootstrap-401',
            },
          });
        }
        if (url.pathname === '/api/v1/me/session-action') {
          return new Response('upstream session expired', {
            status: 401,
            headers: {
              'content-type': 'text/plain',
              'x-request-id': 'component-account-session-401',
            },
          });
        }
        throw new TypeError(`Unexpected account fetch path ${url.pathname}`);
      },
    });
    const screen = await renderComponent(
      <AccountProbe api={api}>
        <ParticipantAccountSettings api={api} />
      </AccountProbe>,
    );

    await expect.element(screen.getByText('alex@example.test')).toBeVisible();
    await screen.getByRole('button', { name: 'Odhlásit tento účet' }).click();
    await screen.getByRole('button', { name: 'Odhlásit', exact: true }).click();

    await expect
      .element(screen.getByText('Přihlášení už vypršelo'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Přihlásit se znovu' }))
      .toHaveAttribute(
        'href',
        '/prihlaseni?mode=recovery&returnTo=%2Fapp%2Fnastaveni',
      );
    expect(screen.container.textContent).not.toContain('alex@example.test');
  });

  it.each(['save', 'discard'] as const)(
    'keeps one profile history entry after a dirty draft is %s',
    async (resolution) => {
      const api = accountApi();
      const screen = await renderComponent(<AccountJourney api={api} />);

      await expect
        .element(
          screen.getByRole('heading', {
            level: 1,
            name: 'Účet a informace',
          }),
        )
        .toBeVisible();
      await screen.getByRole('link', { name: 'Profilové údaje' }).click();
      await expect
        .element(screen.getByRole('heading', { level: 1, name: 'Profil' }))
        .toBeVisible();

      await screen.getByLabelText('Jméno').fill('Rozepsané');
      await vi.waitFor(() => expect(profileGuardIsActive()).toBe(true));
      const sentinelConsumed = waitForPopstate();
      if (resolution === 'save') {
        await screen.getByRole('button', { name: 'Uložit profil' }).click();
      } else {
        await screen.getByRole('button', { name: 'Zahodit změny' }).click();
      }
      await sentinelConsumed;
      expect(window.location.pathname).toBe('/app/profil');
      expect(profileGuardIsActive()).toBe(false);

      const returnedToMore = waitForPopstate();
      window.history.back();
      await returnedToMore;
      expect(window.location.pathname).toBe('/app/vice');
      await expect
        .element(
          screen.getByRole('heading', {
            level: 1,
            name: 'Účet a informace',
          }),
        )
        .toBeVisible();
    },
  );

  it('falls back safely when a confirmed deep-link Back has no older entry', async () => {
    window.history.replaceState({}, '', '/app/profil');
    const navigationDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'navigation',
    );
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: { canGoBack: false },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const screen = await renderComponent(<AccountJourney api={accountApi()} />);

    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Profil' }))
      .toBeVisible();
    await screen.getByLabelText('Jméno').fill('Rozepsané');
    await vi.waitFor(() => expect(profileGuardIsActive()).toBe(true));
    window.history.back();

    await vi.waitFor(() => expect(window.location.pathname).toBe('/app/vice'));
    await expect
      .element(
        screen.getByRole('heading', {
          level: 1,
          name: 'Účet a informace',
        }),
      )
      .toBeVisible();
    expect(confirm).toHaveBeenCalledOnce();
    expect(profileGuardIsActive()).toBe(false);
    await screen.unmount();
    if (navigationDescriptor) {
      Object.defineProperty(window, 'navigation', navigationDescriptor);
    } else {
      Reflect.deleteProperty(window, 'navigation');
    }
  });

  it('consumes the dirty sentinel before More navigation and preserves the account provider', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const providerMounted = vi.fn();
    const screen = await renderComponent(
      <AccountJourney api={accountApi()} onMount={providerMounted} />,
    );

    await screen.getByRole('link', { name: 'Profilové údaje' }).click();
    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Profil' }))
      .toBeVisible();
    await screen.getByLabelText('Jméno').fill('Rozepsané');
    await vi.waitFor(() => expect(profileGuardIsActive()).toBe(true));
    const providerMountEffectsBeforeNavigation =
      providerMounted.mock.calls.length;

    await screen.getByRole('link', { name: 'Více', exact: true }).click();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/app/vice'));
    await expect
      .element(
        screen.getByRole('heading', {
          level: 1,
          name: 'Účet a informace',
        }),
      )
      .toBeVisible();
    await expect.element(screen.getByText('Alex Novák')).toBeVisible();
    expect(profileGuardIsActive()).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(providerMountEffectsBeforeNavigation).toBeGreaterThan(0);
    expect(providerMounted).toHaveBeenCalledTimes(
      providerMountEffectsBeforeNavigation,
    );
  });

  it('keeps local not-found failures scoped but wipes the account on global auth and event access invalidation', async () => {
    const localProblems = [
      participantTicketProblemFixtures.permission!,
      participantProgramProblemFixtures.permission!,
      participantAnnouncementDetailProblemFixtures.not_found!,
    ] as const;
    const screen = await renderComponent(<AccountJourney api={accountApi()} />);
    await expect.element(screen.getByText('Alex Novák')).toBeVisible();

    for (const problem of localProblems) {
      expect(invalidationReasonForProblem(problem)).toBeNull();
    }
    await expect.element(screen.getByText('alex@example.test')).toBeVisible();

    const authenticationReason = invalidationReasonForProblem(
      identityBootstrapProblemFixtures.authentication!,
    );
    expect(authenticationReason).toBe('session_expired');
    if (authenticationReason) {
      invalidateParticipantPrivateResources(authenticationReason);
    }
    await expect.element(screen.getByText('Přihlášení vypršelo')).toBeVisible();
    expect(screen.container.textContent).not.toContain('alex@example.test');
    await screen.unmount();

    const sessionScreen = await renderComponent(
      <AccountJourney api={accountApi()} />,
    );
    await expect.element(sessionScreen.getByText('Alex Novák')).toBeVisible();
    const sessionFailure = {
      kind: 'session_expired',
      problem: sessionExpiredProblemSchema.parse(
        identityBootstrapProblemFixtures.session_expired,
      ),
    } as const;
    const sessionReason = privateResourceInvalidationReason(sessionFailure);
    expect(sessionReason).toBe('session_expired');
    if (sessionReason) invalidateParticipantPrivateResources(sessionReason);
    await expect
      .element(sessionScreen.getByText('Přihlášení vypršelo'))
      .toBeVisible();
    expect(sessionScreen.container.textContent).not.toContain(
      'alex@example.test',
    );
    await sessionScreen.unmount();

    const permissionScreen = await renderComponent(
      <AccountJourney api={accountApi()} />,
    );
    await expect
      .element(permissionScreen.getByText('Alex Novák'))
      .toBeVisible();
    const permissionReason = invalidationReasonForProblem(
      identityBootstrapProblemFixtures.permission!,
    );
    expect(permissionReason).toBe('permission');
    if (permissionReason) {
      invalidateParticipantPrivateResources(permissionReason);
    }
    await expect
      .element(permissionScreen.getByText('K účtu nemáte přístup'))
      .toBeVisible();
    expect(permissionScreen.container.textContent).not.toContain(
      'alex@example.test',
    );
  });

  it('routes a raw internal anchor through AppMain without reloading or remounting the account provider', async () => {
    const providerMounted = vi.fn();
    const screen = await renderComponent(
      <AccountJourney
        api={accountApi()}
        onMount={providerMounted}
        rawProfileLink
      />,
    );
    await expect.element(screen.getByText('Alex Novák')).toBeVisible();
    const initialProviderMountEffects = providerMounted.mock.calls.length;

    await screen
      .getByRole('link', {
        name: 'Otevřít profil obyčejným interním odkazem',
      })
      .click();

    await vi.waitFor(() =>
      expect(window.location.pathname).toBe('/app/profil'),
    );
    await expect
      .element(screen.getByRole('heading', { level: 1, name: 'Profil' }))
      .toBeVisible();
    await expect.element(screen.getByLabelText('Jméno')).toHaveValue('Alex');
    expect(initialProviderMountEffects).toBeGreaterThan(0);
    expect(providerMounted).toHaveBeenCalledTimes(initialProviderMountEffects);
  });
});
