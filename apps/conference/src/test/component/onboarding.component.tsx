import type {
  IdentityBootstrapProblem,
  IdentityBootstrapResponse,
  IdentityOnboardingProblem,
  IdentityOnboardingResponse,
} from '@byzon/domain/contracts';
import {
  identityBootstrapFixtures,
  identityBootstrapProblemFixtures,
  identityFixtureIds,
  identityOnboardingFixtures,
  identityOnboardingProblemFixtures,
} from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it } from 'vitest';

import '../../app/styles.css';
import OnboardingLayout from '../../app/onboarding/layout';
import { OnboardingFlow } from '../../components/onboarding-flow';
import type { ApiPort, ApiRequestCommonOptions } from '../../lib/api';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const metadata = { requestId: 'component-onboarding-0001' } as const;
type RecordedRequest = ApiRequestCommonOptions & { body?: unknown };

const apiForOnboarding = ({
  bootstrap = identityBootstrapFixtures.profile_required!,
  onSubmit,
  outcome = identityOnboardingFixtures.opted_out!,
  submitResults,
}: {
  readonly bootstrap?: IdentityBootstrapResponse;
  readonly onSubmit?: (options: RecordedRequest) => void;
  readonly outcome?: IdentityOnboardingResponse;
  readonly submitResults?: readonly (
    { readonly kind: 'offline' } | IdentityOnboardingResponse
  )[];
} = {}): ApiPort => {
  let submitCount = 0;
  return {
    request: async (endpoint, options) => {
      if (options.path === '/api/v1/me/bootstrap') {
        return {
          ok: true,
          kind: 'success',
          status: 200,
          data: endpoint.successSchema.parse(bootstrap),
          metadata,
        };
      }
      onSubmit?.(options);
      const selected = submitResults?.[submitCount] ?? outcome;
      submitCount += 1;
      if (!selected) {
        throw new TypeError('Missing synthetic onboarding outcome.');
      }
      if ('kind' in selected && selected.kind === 'offline') {
        return {
          ok: false,
          kind: 'failure',
          failure: { kind: 'offline' },
        };
      }
      return {
        ok: true,
        kind: 'success',
        status: 200,
        data: endpoint.successSchema.parse(selected),
        metadata,
      };
    },
  };
};

const apiForOnboardingProblem = (
  problem: IdentityOnboardingProblem,
): ApiPort => ({
  request: async (endpoint, options) => {
    if (options.path === '/api/v1/me/bootstrap') {
      return {
        ok: true,
        kind: 'success',
        status: 200,
        data: endpoint.successSchema.parse(
          identityBootstrapFixtures.networking_choice!,
        ),
        metadata,
      };
    }
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
  },
});

const apiForBootstrapProblem = (
  problem: IdentityBootstrapProblem,
): ApiPort => ({
  request: async (endpoint) => ({
    ok: false,
    kind: 'failure',
    status: problem.status,
    failure: {
      kind: 'problem',
      problem: endpoint.problemSchema.parse(problem),
    },
    metadata: { requestId: problem.requestId },
  }),
});

const OnboardingProbe = ({
  api = apiForOnboarding(),
  createKey = () => 'onboarding-component-0001',
}: {
  readonly api?: ApiPort;
  readonly createKey?: () => string;
}) => (
  <main id="main" tabIndex={-1}>
    <OnboardingLayout>
      <OnboardingFlow api={api} createIdempotencyKey={createKey} />
    </OnboardingLayout>
  </main>
);

const completeProfileStep = async (
  screen: Awaited<ReturnType<typeof renderComponent>>,
) => {
  await screen.getByLabelText('Jméno').fill('  Alex  ');
  await screen.getByLabelText('Příjmení').fill('  Novák  ');
  await screen.getByLabelText('Kontaktní e-mail').fill('ALEX@EXAMPLE.TEST');
  await screen.getByRole('button', { name: 'Pokračovat' }).click();
};

const completeLegalStep = async (
  screen: Awaited<ReturnType<typeof renderComponent>>,
) => {
  await screen
    .getByLabelText('Souhlasím s podmínkami, verze synthetic-v1')
    .click();
  await screen
    .getByLabelText(
      'Potvrzuji seznámení s informacemi o soukromí, verze synthetic-v1',
    )
    .click();
  await screen.getByRole('button', { name: 'Pokračovat' }).click();
};

beforeEach(() => {
  window.history.replaceState({}, '', '/onboarding');
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('F1-05 onboarding and legal acknowledgement', () => {
  it('completes opt-out once with canonical profile and no networking consent', async () => {
    const calls: RecordedRequest[] = [];
    const screen = await renderComponent(
      <OnboardingProbe
        api={apiForOnboarding({
          onSubmit: (options) => calls.push(options),
        })}
      />,
    );

    await completeProfileStep(screen);
    await expect
      .element(screen.getByText('Podmínky používání – syntetický náhled'))
      .toBeVisible();
    await completeLegalStep(screen);
    await expect
      .element(screen.getByText('Dobrovolný networking'))
      .toBeVisible();
    expect(
      screen.getByLabelText('Ano, chci networking').element(),
    ).not.toBeChecked();
    expect(
      screen.getByLabelText('Ne, pokračovat bez networkingu').element(),
    ).not.toBeChecked();
    await screen.getByLabelText('Ne, pokračovat bez networkingu').click();
    const submit = screen
      .getByRole('button', { name: 'Dokončit onboarding' })
      .element();
    if (!(submit instanceof HTMLButtonElement)) {
      throw new TypeError('Onboarding submit must be a button.');
    }
    submit.click();
    submit.click();

    await expect
      .element(screen.getByText('Nastavení je dokončené'))
      .toBeVisible();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      profile: {
        firstName: 'Alex',
        lastName: 'Novák',
        contactEmail: 'alex@example.test',
      },
      legal: {
        termsDocumentId: identityFixtureIds.terms,
        termsAccepted: true,
        privacyNoticeDocumentId: identityFixtureIds.privacyNotice,
        privacyAcknowledged: true,
      },
      networking: { enabled: false },
    });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.location.search).toBe('');
  });

  it('keeps opt-in separate and submits its exact consent version', async () => {
    const calls: RecordedRequest[] = [];
    const screen = await renderComponent(
      <OnboardingProbe
        api={apiForOnboarding({
          onSubmit: (options) => calls.push(options),
          outcome: identityOnboardingFixtures.opted_in!,
        })}
      />,
    );

    await completeProfileStep(screen);
    await completeLegalStep(screen);
    await screen.getByLabelText('Ano, chci networking').click();
    await expect
      .element(screen.getByText('Networking – syntetický náhled'))
      .toBeVisible();
    await screen
      .getByLabelText('Samostatně souhlasím s networkingem, verze synthetic-v1')
      .click();
    await screen.getByRole('button', { name: 'Dokončit onboarding' }).click();

    await expect
      .element(screen.getByText('Nastavení je dokončené'))
      .toBeVisible();
    expect(calls[0]?.body).toMatchObject({
      networking: {
        enabled: true,
        consentDocumentId: identityFixtureIds.networkingConsent,
        consentAccepted: true,
      },
    });
  });

  it('focuses validation summary and preserves in-memory values when going back', async () => {
    const screen = await renderComponent(<OnboardingProbe />);

    await screen.getByRole('button', { name: 'Pokračovat' }).click();
    const summary = screen
      .getByRole('heading', { name: 'Zkontrolujte zadané údaje' })
      .element();
    expect(summary.closest('section')).toHaveFocus();

    await screen.getByLabelText('Jméno').fill('Alex');
    await screen.getByLabelText('Příjmení').fill('Novák');
    await screen.getByRole('button', { name: 'Pokračovat' }).click();
    await screen.getByRole('button', { name: 'Zpět' }).click();

    await expect.element(screen.getByLabelText('Jméno')).toHaveValue('Alex');
    await expect
      .element(screen.getByLabelText('Příjmení'))
      .toHaveValue('Novák');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('reuses one idempotency key after an ambiguous offline result', async () => {
    const keys: string[] = [];
    let keyCreations = 0;
    const screen = await renderComponent(
      <OnboardingProbe
        api={apiForOnboarding({
          bootstrap: identityBootstrapFixtures.networking_choice!,
          onSubmit: (options) => {
            if (options.idempotencyKey) keys.push(options.idempotencyKey);
          },
          submitResults: [
            { kind: 'offline' },
            identityOnboardingFixtures.opted_out!,
          ],
        })}
        createKey={() => {
          keyCreations += 1;
          return `onboarding-retry-${keyCreations}`;
        }}
      />,
    );

    await screen.getByLabelText('Ne, pokračovat bez networkingu').click();
    await screen.getByRole('button', { name: 'Dokončit onboarding' }).click();
    await expect
      .element(
        screen.getByText(
          'Jste offline. Připojte se a odešlete stejný požadavek znovu.',
        ),
      )
      .toBeVisible();
    await screen.getByRole('button', { name: 'Dokončit onboarding' }).click();

    await expect
      .element(screen.getByText('Nastavení je dokončené'))
      .toBeVisible();
    expect(keys).toEqual(['onboarding-retry-1', 'onboarding-retry-1']);
    expect(keyCreations).toBe(1);
  });

  it('rejects a completion that acknowledges a different legal document', async () => {
    const outcome = identityOnboardingFixtures.opted_out!;
    const screen = await renderComponent(
      <OnboardingProbe
        api={apiForOnboarding({
          bootstrap: identityBootstrapFixtures.networking_choice!,
          outcome: {
            ...outcome,
            acknowledgements: outcome.acknowledgements.map((record) =>
              record.type === 'terms'
                ? {
                    ...record,
                    documentId: '01910000-0000-7000-8000-000000000299',
                  }
                : record,
            ),
          },
        })}
      />,
    );

    await screen.getByLabelText('Ne, pokračovat bez networkingu').click();
    await screen.getByRole('button', { name: 'Dokončit onboarding' }).click();

    await expect
      .element(
        screen.getByText(
          'Server vrátil nekonzistentní výsledek. Nic nepředstíráme.',
        ),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Nastavení je dokončené');
  });

  it('fails closed for missing legal configuration and suspended access', async () => {
    const blocked = await renderComponent(
      <OnboardingProbe
        api={apiForOnboarding({
          bootstrap: identityBootstrapFixtures.blocked_unpublished!,
        })}
      />,
    );
    await expect
      .element(blocked.getByText('Aktuální právní verze není publikovaná'))
      .toBeVisible();
    expect(document.body.textContent).not.toContain('Dokončit onboarding');

    await blocked.unmount();
    const suspended = await renderComponent(
      <OnboardingProbe
        api={apiForOnboarding({
          bootstrap: identityBootstrapFixtures.suspended!,
        })}
      />,
    );
    await expect
      .element(suspended.getByText('Účast nelze dokončit'))
      .toBeVisible();
    expect(document.body.textContent).toContain('MOCK-SUSPENDED-2026');
  });

  it('maps a deterministic networking rejection without leaking server detail', async () => {
    const problem = identityOnboardingProblemFixtures.networking_disabled!;
    const screen = await renderComponent(
      <OnboardingProbe api={apiForOnboardingProblem(problem)} />,
    );

    await screen.getByLabelText('Ne, pokračovat bez networkingu').click();
    await screen.getByRole('button', { name: 'Dokončit onboarding' }).click();

    await expect
      .element(
        screen.getByText('Networking už pro tuto událost není dostupný.'),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain(problem.detail);
  });

  it('offers a safe login recovery for an expired bootstrap session', async () => {
    const screen = await renderComponent(
      <OnboardingProbe
        api={apiForBootstrapProblem(
          identityBootstrapProblemFixtures.session_expired!,
        )}
      />,
    );

    await expect.element(screen.getByText('Přihlášení vypršelo')).toBeVisible();
    expect(
      screen
        .getByRole('link', { name: 'Obnovit přihlášení' })
        .element()
        .getAttribute('href'),
    ).toBe('/prihlaseni?mode=recovery&returnTo=%2Fonboarding');
  });

  it('is accessible, overflow-safe and keeps full choice rows touch-sized', async () => {
    const screen = await renderComponent(
      <OnboardingProbe
        api={apiForOnboarding({
          bootstrap: identityBootstrapFixtures.networking_choice!,
        })}
      />,
    );
    const main = document.querySelector('main');
    if (!(main instanceof HTMLElement)) {
      throw new TypeError('Onboarding probe must render main.');
    }
    const choice = screen
      .getByLabelText('Ne, pokračovat bez networkingu')
      .element()
      .closest('label');
    if (!(choice instanceof HTMLLabelElement)) {
      throw new TypeError('Networking choice must use a full-row label.');
    }

    expect(choice.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(main);
  });
});
