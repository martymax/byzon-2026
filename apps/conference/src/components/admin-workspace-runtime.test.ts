import {
  adminMutationProblemFixtures,
  adminReadProblemFixtures,
} from '@byzon/test-support/fixtures';
import {
  apiProblemSchema,
  sessionExpiredProblemSchema,
} from '@byzon/domain/contracts';
import { describe, expect, it } from 'vitest';

import {
  adminFailureMessage,
  isAdminSecurityFailure,
  isAmbiguousAdminMutationFailure,
} from './admin-workspace-runtime';

describe('admin failure classification', () => {
  it.each([401, 403])(
    'treats a malformed top-level %s as a security failure, never as retryable',
    (status) => {
      const result = {
        status,
        failure: {
          kind: 'invalid_response' as const,
          requestId: 'admin-malformed-security-0001',
        },
      };

      expect(isAdminSecurityFailure(result)).toBe(true);
      expect(isAmbiguousAdminMutationFailure(result)).toBe(false);
    },
  );

  it('keeps a non-security invalid success response eligible only for exact retry', () => {
    const result = {
      status: 200,
      failure: {
        kind: 'invalid_response' as const,
        requestId: 'admin-invalid-success-0001',
      },
    };

    expect(isAdminSecurityFailure(result)).toBe(false);
    expect(isAmbiguousAdminMutationFailure(result)).toBe(true);
  });
});

describe('admin shared feedback copy', () => {
  it('shows the Q&A readiness rejection and preserves its technical reference', () => {
    const problem = apiProblemSchema.parse({
      type: 'urn:byzon:problem:admin-invalid-transition',
      title: 'Dotazy nejsou dostupné',
      status: 409,
      code: 'ADMIN_INVALID_TRANSITION',
      detail:
        'Nelze zapnout sběr: 1 přednášek nemá připraveného moderátora nebo není publikována. Podrobnosti jsou v přehledu přiřazení.',
      requestId: '15306555-7e4f-4e24-8a1c-0d6d7d43054b',
    });
    const failure = { kind: 'problem', problem } as const;

    expect(adminFailureMessage(failure)).toBe(problem.detail);
    expect(adminFailureMessage(failure, problem.requestId)).toBe(
      `${problem.detail} Reference požadavku: ${problem.requestId}.`,
    );
    expect(isAmbiguousAdminMutationFailure({ status: 409, failure })).toBe(
      false,
    );
  });

  it('keeps unexpected server error details out of user feedback', () => {
    const problem = {
      ...adminReadProblemFixtures.internal_error!,
      detail: 'Database query failed: internal diagnostic information.',
    };

    expect(adminFailureMessage({ kind: 'problem', problem })).toBe(
      'Tuto část se nepodařilo načíst. Zkuste to znovu. Pokud problém trvá, otevřete Technické údaje a předejte referenci podpoře.',
    );
  });

  it.each([
    [
      { kind: 'offline' } as const,
      'Tato část administrace vyžaduje připojení. Citlivá data jsme skryli. Zkontrolujte internet a zkuste to znovu.',
    ],
    [
      {
        kind: 'session_expired',
        problem: sessionExpiredProblemSchema.parse(
          adminReadProblemFixtures.session_expired!,
        ),
      } as const,
      'Přihlášení vypršelo. Citlivá rozpracovaná data jsme skryli. Přihlaste se znovu a změnu znovu připravte a zkontrolujte.',
    ],
    [
      { kind: 'timeout' } as const,
      'Nepodařilo se ověřit, zda byla změna dokončena. Ověřte aktuální stav; další kontrola nevytvoří duplicitu.',
    ],
    [
      { kind: 'transport' } as const,
      'Nepodařilo se ověřit, zda byla změna dokončena. Ověřte aktuální stav; další kontrola nevytvoří duplicitu.',
    ],
    [
      {
        kind: 'problem',
        problem: adminMutationProblemFixtures.stale!,
      } as const,
      'Data se mezitím změnila. Načtěte aktuální stav a změnu zkontrolujte znovu.',
    ],
    [
      {
        kind: 'problem',
        problem: adminReadProblemFixtures.permission!,
      } as const,
      'K této části nemáte přístup. Pokud ji potřebujete pro svou práci, obraťte se na správce týmu.',
    ],
    [
      {
        kind: 'problem',
        problem: adminReadProblemFixtures.session_expired!,
      } as const,
      'Přihlášení vypršelo. Citlivá rozpracovaná data jsme skryli. Přihlaste se znovu a změnu znovu připravte a zkontrolujte.',
    ],
    [
      {
        kind: 'problem',
        problem: adminReadProblemFixtures.internal_error!,
      } as const,
      'Tuto část se nepodařilo načíst. Zkuste to znovu. Pokud problém trvá, otevřete Technické údaje a předejte referenci podpoře.',
    ],
  ])('uses the prescribed shared message %#', (failure, expected) => {
    expect(adminFailureMessage(failure)).toBe(expected);
  });

  it('keeps a request reference separable for technical details', () => {
    expect(adminFailureMessage({ kind: 'offline' }, 'admin-request-0001')).toBe(
      'Tato část administrace vyžaduje připojení. Citlivá data jsme skryli. Zkontrolujte internet a zkuste to znovu. Reference požadavku: admin-request-0001.',
    );
  });
});
