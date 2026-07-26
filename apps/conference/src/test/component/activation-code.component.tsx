import type {
  ActivationClaimProblem,
  ActivationClaimResponse,
} from '@byzon/domain/contracts';
import {
  activationClaimFixtures,
  activationClaimProblemFixtures,
} from '@byzon/test-support/fixtures';
import { beforeEach, describe, expect, it } from 'vitest';

import '../../app/styles.css';
import ActivationLayout from '../../app/aktivace/layout';
import { ActivationCodeForm } from '../../components/activation-code-form';
import type { ApiPort, ApiRequestCommonOptions } from '../../lib/api';
import { expectComponentToPassAxe } from './accessibility';
import { renderComponent } from './render';

const metadata = { requestId: 'component-claim-0001' } as const;

const apiForOutcome = (
  outcome: ActivationClaimResponse,
  onRequest?: (options: ApiRequestCommonOptions & { body?: unknown }) => void,
): ApiPort => ({
  request: async (endpoint, options) => {
    onRequest?.(options);
    return {
      ok: true,
      kind: 'success',
      status: 200,
      data: endpoint.successSchema.parse(outcome),
      metadata,
    };
  },
});

const apiForProblem = (problem: ActivationClaimProblem): ApiPort => ({
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

const CodeProbe = ({
  api,
  createKey = () => 'claim-component-0001',
}: {
  readonly api: ApiPort;
  readonly createKey?: () => string;
}) => (
  <main id="main" tabIndex={-1}>
    <ActivationLayout>
      <ActivationCodeForm api={api} createIdempotencyKey={createKey} />
    </ActivationLayout>
  </main>
);

beforeEach(() => {
  window.history.replaceState({}, '', '/aktivace/kod');
});

describe('F1-02 manual opaque activation code', () => {
  it('submits the exact synthetic code and never repeats it after success', async () => {
    const calls: Array<ApiRequestCommonOptions & { body?: unknown }> = [];
    const api = apiForOutcome(
      activationClaimFixtures.identity_required,
      (options) => calls.push(options),
    );
    const screen = await renderComponent(<CodeProbe api={api} />);

    const input = screen.getByLabelText('Ticket kód');
    await input.fill('TST-OPAQUE-2026');
    await screen.getByRole('button', { name: 'Pokračovat' }).click();

    await expect
      .element(screen.getByText('Kód byl přijat v mock režimu'))
      .toBeVisible();
    expect(calls[0]?.body).toEqual({
      code: 'TST-OPAQUE-2026',
      method: 'manual_code',
    });
    expect(document.body.textContent).not.toContain('TST-OPAQUE-2026');
    expect(document.body.textContent).toContain(
      'Nevznikl skutečný účet, účast na akci ani přihlášení.',
    );
  });

  it('does not trim or submit a code with surrounding spaces', async () => {
    let callCount = 0;
    const api = apiForOutcome(activationClaimFixtures.identity_required, () => {
      callCount += 1;
    });
    const screen = await renderComponent(<CodeProbe api={api} />);

    await screen.getByLabelText('Ticket kód').fill(' TST-OPAQUE-2026 ');
    await screen.getByRole('button', { name: 'Pokračovat' }).click();

    await expect
      .element(
        screen.getByText(
          'Zadejte celý kód přesně tak, jak jste jej obdrželi.',
          { exact: true },
        ),
      )
      .toBeVisible();
    expect(callCount).toBe(0);
    const summaryHeading = screen
      .getByRole('heading', { name: 'Zkontrolujte zadané údaje' })
      .element();
    expect(summaryHeading.closest('section')).toHaveFocus();
  });

  it('uses one generic rejection without rendering raw server detail', async () => {
    const problem = activationClaimProblemFixtures.rejected!;
    const api = apiForProblem(problem);
    const screen = await renderComponent(<CodeProbe api={api} />);

    await screen.getByLabelText('Ticket kód').fill('WRONG-CODE-2026');
    await screen.getByRole('button', { name: 'Pokračovat' }).click();

    await expect
      .element(
        screen.getByText(
          'Kód nelze použít. Zkontrolujte jej nebo zvolte obnovu přístupu.',
          { exact: true },
        ),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain(problem.detail);
  });

  it('keeps one key for an ambiguous retry and focuses a non-field error', async () => {
    let requests = 0;
    let keyCreations = 0;
    const keys: string[] = [];
    const api: ApiPort = {
      request: async (endpoint, options) => {
        requests += 1;
        if (options.idempotencyKey) keys.push(options.idempotencyKey);
        if (requests === 1) {
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
          data: endpoint.successSchema.parse(
            activationClaimFixtures.identity_required,
          ),
          metadata,
        };
      },
    };
    const screen = await renderComponent(
      <CodeProbe
        api={api}
        createKey={() => {
          keyCreations += 1;
          return `claim-retry-${keyCreations}`;
        }}
      />,
    );

    const input = screen.getByLabelText('Ticket kód');
    await input.fill('TST-OPAQUE-2026');
    await screen.getByRole('button', { name: 'Pokračovat' }).click();

    await expect.element(screen.getByText('Jste offline')).toBeVisible();
    expect(document.querySelector('[data-form-failure]')).toHaveFocus();
    expect(input.element()).not.toHaveAttribute('aria-invalid', 'true');

    await screen.getByRole('button', { name: 'Pokračovat' }).click();
    await expect
      .element(screen.getByText('Kód byl přijat v mock režimu'))
      .toBeVisible();
    await expect
      .element(screen.getByRole('heading', { name: 'Ověřte svou identitu' }))
      .toHaveFocus();
    expect(keys).toEqual(['claim-retry-1', 'claim-retry-1']);
    expect(keyCreations).toBe(1);
  });

  it('keeps the form keyboard-accessible without overflow', async () => {
    const screen = await renderComponent(
      <CodeProbe
        api={apiForOutcome(activationClaimFixtures.identity_required)}
      />,
    );
    const main = document.querySelector('main');
    if (!(main instanceof HTMLElement)) {
      throw new TypeError('Activation code probe must render main.');
    }

    expect(
      screen.getByLabelText('Ticket kód').element().getBoundingClientRect()
        .height,
    ).toBeGreaterThanOrEqual(44);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await expectComponentToPassAxe(main);
  });
});
