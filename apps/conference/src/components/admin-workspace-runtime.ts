import type { ApiFailure, ApiProblem } from '@byzon/domain/contracts';

import type { ApiFailureResult } from '@/lib/api/endpoint';

type AdminFailureResult<Problem extends ApiProblem = ApiProblem> = Pick<
  ApiFailureResult<Problem>,
  'failure' | 'status'
>;

export const createAdminIdempotencyKey = (operation: string): string => {
  const entropy =
    globalThis.crypto?.randomUUID() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `admin:${operation}:${entropy}`;
};

export const isStaleAdminFailure = (failure: ApiFailure<ApiProblem>): boolean =>
  failure.kind === 'problem' &&
  (failure.problem.code === 'STALE_VERSION' ||
    failure.problem.code === 'IMPORT_PREVIEW_STALE' ||
    failure.problem.code === 'ANNOUNCEMENT_PREVIEW_STALE' ||
    failure.problem.code === 'ANNOUNCEMENT_PREVIEW_EXPIRED');

export const isAmbiguousAdminMutationFailure = (
  result: AdminFailureResult,
): boolean =>
  result.status !== 401 &&
  result.status !== 403 &&
  (result.failure.kind === 'timeout' ||
    result.failure.kind === 'transport' ||
    result.failure.kind === 'invalid_response' ||
    (result.failure.kind === 'problem' &&
      (result.failure.problem.code === 'IDEMPOTENCY_IN_PROGRESS' ||
        result.failure.problem.code === 'INTERNAL_ERROR')));

export const isAdminSecurityFailure = (result: AdminFailureResult): boolean =>
  result.status === 401 ||
  result.status === 403 ||
  result.failure.kind === 'offline' ||
  result.failure.kind === 'session_expired' ||
  (result.failure.kind === 'problem' &&
    (result.failure.problem.status === 401 ||
      result.failure.problem.status === 403 ||
      result.failure.problem.code === 'AUTHENTICATION_REQUIRED' ||
      result.failure.problem.code === 'AUTH_SESSION_EXPIRED' ||
      result.failure.problem.code === 'EVENT_ACCESS_DENIED'));

const baseAdminFailureMessage = (failure: ApiFailure<ApiProblem>): string => {
  if (failure.kind === 'aborted') return 'Požadavek byl zrušen.';
  if (failure.kind === 'offline') {
    return 'Připojení není dostupné. Administrace je online-only.';
  }
  if (failure.kind === 'timeout') {
    return 'Výsledek operace není jistý. Opakujte přesně stejný pokus.';
  }
  if (failure.kind === 'transport' || failure.kind === 'invalid_response') {
    return 'Server nepotvrdil výsledek. Bezpečně lze zopakovat stejný pokus.';
  }
  if (failure.kind === 'session_expired') {
    return 'Relace vypršela.';
  }
  switch (failure.problem.code) {
    case 'IDEMPOTENCY_IN_PROGRESS':
      return 'Stejná operace se ještě zpracovává. Po chvíli zopakujte stejný pokus.';
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'Klíč operace byl použit pro jiné tělo. Vytvořte nový záměr.';
    case 'STALE_VERSION':
    case 'IMPORT_PREVIEW_STALE':
    case 'ANNOUNCEMENT_PREVIEW_STALE':
      return 'Snapshot se mezitím změnil. Data byla obnovena; akci zkontrolujte znovu.';
    case 'ANNOUNCEMENT_PREVIEW_EXPIRED':
      return 'Preview vypršelo. Vytvořte nové a akci znovu zkontrolujte.';
    case 'IMPORT_PREVIEW_BLOCKED':
      return 'Preview obsahuje konflikt nebo neznámý stav a nelze jej aplikovat.';
    case 'ANNOUNCEMENT_EMPTY_AUDIENCE':
      return 'Vybrané publikum nemá žádné příjemce.';
    case 'EVENT_ACCESS_DENIED':
      return 'Oprávnění k akci bylo odebráno.';
    case 'AUTHENTICATION_REQUIRED':
    case 'AUTH_SESSION_EXPIRED':
      return 'Je nutné znovu ověřit přihlášení.';
    case 'SUPPORT_RATE_LIMITED':
      return 'Vyhledávání je dočasně omezené. Zkuste to později.';
    case 'EXPORT_UNAVAILABLE':
      return 'Export nyní není dostupný.';
    case 'VALIDATION_FAILED':
    case 'IMPORT_VALIDATION_FAILED':
      return 'Server odmítl neplatná vstupní data.';
    default:
      return 'Operaci se nepodařilo dokončit.';
  }
};

export const adminFailureMessage = (
  failure: ApiFailure<ApiProblem>,
  requestId?: string,
): string => {
  const message = baseAdminFailureMessage(failure);
  return requestId ? `${message} Reference požadavku: ${requestId}.` : message;
};
