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
    return 'Tato část administrace vyžaduje připojení. Citlivá data jsme skryli. Zkontrolujte internet a zkuste to znovu.';
  }
  if (failure.kind === 'timeout') {
    return 'Nepodařilo se ověřit, zda byla změna dokončena. Ověřte aktuální stav; další kontrola nevytvoří duplicitu.';
  }
  if (failure.kind === 'transport' || failure.kind === 'invalid_response') {
    return 'Nepodařilo se ověřit, zda byla změna dokončena. Ověřte aktuální stav; další kontrola nevytvoří duplicitu.';
  }
  if (failure.kind === 'session_expired') {
    return 'Přihlášení vypršelo. Citlivá rozpracovaná data jsme skryli. Přihlaste se znovu a změnu znovu připravte a zkontrolujte.';
  }
  switch (failure.problem.code) {
    case 'IDEMPOTENCY_IN_PROGRESS':
      return 'Stejná operace se ještě zpracovává. Po chvíli zopakujte stejný pokus.';
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'Tento pokus už patří jiné změně. Zkontrolujte aktuální stav a změnu připravte znovu.';
    case 'STALE_VERSION':
    case 'IMPORT_PREVIEW_STALE':
    case 'ANNOUNCEMENT_PREVIEW_STALE':
      return 'Data se mezitím změnila. Načtěte aktuální stav a změnu zkontrolujte znovu.';
    case 'ANNOUNCEMENT_PREVIEW_EXPIRED':
      return 'Kontrola už není aktuální. Vytvořte novou a oznámení znovu zkontrolujte.';
    case 'IMPORT_PREVIEW_BLOCKED':
      return 'Kontrola obsahuje konflikt nebo neznámý stav. Změny zatím nelze použít.';
    case 'ANNOUNCEMENT_EMPTY_AUDIENCE':
      return 'Vybrané publikum nemá žádné příjemce.';
    case 'EVENT_ACCESS_DENIED':
      return 'K této části nemáte přístup. Pokud ji potřebujete pro svou práci, obraťte se na správce týmu.';
    case 'AUTHENTICATION_REQUIRED':
      return 'Je nutné znovu ověřit přihlášení.';
    case 'AUTH_SESSION_EXPIRED':
      return 'Přihlášení vypršelo. Citlivá rozpracovaná data jsme skryli. Přihlaste se znovu a změnu znovu připravte a zkontrolujte.';
    case 'SUPPORT_RATE_LIMITED':
      return 'Vyhledávání je dočasně omezené. Zkuste to později.';
    case 'INVITATION_DELIVERY_UNAVAILABLE':
      return 'Pozvánku se nepodařilo odeslat. Zkontrolujte nastavení e-mailové služby a zkuste to znovu.';
    case 'SUPPORT_INVALID_TRANSITION':
      return 'Pozvánku lze poslat pouze účastníkovi s aktivním přístupem.';
    case 'EXPORT_UNAVAILABLE':
      return 'Export nyní není dostupný.';
    case 'SELF_LOCKOUT_GUARD':
      return 'Tuto změnu nelze provést, protože by odebrala vaše vlastní potřebné oprávnění.';
    case 'LAST_ADMINISTRATOR_GUARD':
      return 'Poslední administrátorské oprávnění akce nelze odebrat.';
    case 'VALIDATION_FAILED':
    case 'IMPORT_VALIDATION_FAILED':
      return 'Server odmítl neplatná vstupní data.';
    default:
      return 'Tuto část se nepodařilo načíst. Zkuste to znovu. Pokud problém trvá, otevřete Technické údaje a předejte referenci podpoře.';
  }
};

export const adminFailureMessage = (
  failure: ApiFailure<ApiProblem>,
  requestId?: string,
): string => {
  const message = baseAdminFailureMessage(failure);
  return requestId ? `${message} Reference požadavku: ${requestId}.` : message;
};
