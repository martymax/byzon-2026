'use client';

import type { ApiFailure, RequestId } from '@byzon/domain/contracts';
import {
  checkinLookupRequestSchema,
  type CheckinBootstrapResponse,
  type CheckinConfirmProblem,
  type CheckinConfirmRequest,
  type CheckinLookupProblem,
  type CheckinLookupRequest,
  type CheckinLookupResponse,
  type CheckinRecord,
  type CheckinUndoProblem,
  type CheckinUndoRequest,
} from '@byzon/domain/contracts/check-in';
import { Button, StatePanel } from '@byzon/ui';
import { useEffect, useRef, useState } from 'react';

import type { ApiPort } from '@/lib/api';
import {
  browserCheckinApi,
  requestCheckinBootstrap,
  requestCheckinConfirm,
  requestCheckinLookup,
  requestCheckinUndo,
} from '@/lib/checkin-api';
import { shouldRetainMutationKey } from '@/lib/mutation-retry';
import {
  CheckinResult,
  type CheckinResultStage,
  type CheckinUiFailure,
} from './checkin-result';
import {
  CheckinScanner,
  type CheckinCameraPort,
  type CheckinScenarioCode,
} from './checkin-scanner';
import { CheckinSearch } from './checkin-search';
import { CheckinShell } from './checkin-shell';
import styles from './checkin.module.css';

type BootstrapState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: CheckinBootstrapResponse }
  | {
      readonly status: 'failure';
      readonly title: string;
      readonly requestId?: RequestId;
    };

interface ConfirmAttempt {
  readonly body: CheckinConfirmRequest;
  readonly idempotencyKey: string;
  readonly lookup: Extract<CheckinLookupResponse, { outcome: 'valid' }>;
}

interface UndoAttempt {
  readonly body: CheckinUndoRequest;
  readonly checkinId: string;
  readonly idempotencyKey: string;
  readonly record: CheckinRecord;
}

const defaultNow = () =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

const createMutationKey = (prefix: 'confirm' | 'undo') => {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `checkin-${prefix}-${suffix}`;
};

const requestIdFromFailure = <
  Problem extends
    CheckinLookupProblem | CheckinConfirmProblem | CheckinUndoProblem,
>(
  failure: ApiFailure<Problem>,
): RequestId | undefined => {
  if (failure.kind === 'problem' || failure.kind === 'session_expired') {
    return failure.problem.requestId;
  }
  if (failure.kind === 'invalid_response' || failure.kind === 'transport') {
    return failure.requestId;
  }
  return undefined;
};

const mapLookupFailure = (
  failure: ApiFailure<CheckinLookupProblem>,
): CheckinUiFailure | null => {
  if (failure.kind === 'aborted') return null;
  const requestId = requestIdFromFailure(failure);
  if (failure.kind === 'offline') {
    return {
      title: 'Zařízení je offline',
      detail:
        'Lookup nebyl odeslán. Offline check-in není podporovaný a nic se nezařadilo do fronty.',
    };
  }
  if (failure.kind === 'session_expired') {
    return {
      title: 'Relace operátora vypršela',
      detail: 'Znovu se přihlaste a ověřte event, stanoviště i zařízení.',
      ...(requestId ? { requestId } : {}),
    };
  }
  if (failure.kind === 'problem') {
    const copy =
      failure.problem.code === 'CHECKIN_RATE_LIMITED'
        ? {
            title: 'Příliš mnoho pokusů',
            detail: 'Chvíli počkejte a potom proveďte nový lookup.',
          }
        : failure.problem.code === 'CHECKIN_DEVICE_REVOKED'
          ? {
              title: 'Zařízení bylo revokované',
              detail:
                'Na tomto zařízení nepokračujte. Kontaktujte administrátora akce.',
            }
          : failure.problem.code === 'CHECKIN_PERMISSION_DENIED'
            ? {
                title: 'Role nemá oprávnění',
                detail:
                  'Ověřte přihlášeného operátora. Žádná změna neproběhla.',
              }
            : {
                title: 'Lookup se nepodařilo dokončit',
                detail:
                  'Zkuste nový scan. Pokud se chyba opakuje, předejte podpoře ID požadavku.',
              };
    return { ...copy, ...(requestId ? { requestId } : {}) };
  }
  return {
    title: failure.kind === 'timeout' ? 'Lookup vypršel' : 'Lookup selhal',
    detail:
      'Žádná check-in mutace neproběhla. Zkontrolujte spojení a zkuste nový scan.',
    ...(requestId ? { requestId } : {}),
  };
};

const mapConfirmFailure = (
  failure: ApiFailure<CheckinConfirmProblem>,
): CheckinUiFailure | null => {
  if (failure.kind === 'aborted') return null;
  const requestId = requestIdFromFailure(failure);
  if (failure.kind === 'problem') {
    if (failure.problem.code === 'CHECKIN_LOOKUP_EXPIRED') {
      return {
        title: 'Platnost lookupu vypršela',
        detail: 'Proveďte nový scan a znovu ověřte osobu.',
        ...(requestId ? { requestId } : {}),
      };
    }
    if (failure.problem.code === 'CHECKIN_TICKET_STATE_CHANGED') {
      return {
        title: 'Stav vstupenky se změnil',
        detail: 'Nepokračujte starým výsledkem. Proveďte nový lookup.',
        ...(requestId ? { requestId } : {}),
      };
    }
  }
  const ambiguous =
    failure.kind === 'offline' ||
    failure.kind === 'timeout' ||
    failure.kind === 'transport' ||
    failure.kind === 'invalid_response' ||
    (failure.kind === 'problem' &&
      (failure.problem.code === 'INTERNAL_ERROR' ||
        failure.problem.code === 'IDEMPOTENCY_IN_PROGRESS'));
  return {
    title: ambiguous
      ? 'Serverový výsledek je potřeba bezpečně dočíst'
      : failure.kind === 'session_expired'
        ? 'Relace operátora vypršela'
        : 'Check-in server odmítl',
    detail: ambiguous
      ? 'Požadavek mohl být přijat. Použijte pouze nabízený retry se stejným idempotency key.'
      : 'Žádný další pokus neprovádějte ze starého lookupu. Začněte znovu.',
    ambiguous,
    ...(requestId ? { requestId } : {}),
  };
};

const mapUndoFailure = (
  failure: ApiFailure<CheckinUndoProblem>,
): CheckinUiFailure | null => {
  if (failure.kind === 'aborted') return null;
  const requestId = requestIdFromFailure(failure);
  if (failure.kind === 'problem') {
    if (failure.problem.code === 'CHECKIN_UNDO_WINDOW_EXPIRED') {
      return {
        title: 'Časové okno pro vrácení skončilo',
        detail:
          'Operátor už tuto změnu provést nemůže. Předejte případ administrátorovi.',
        ...(requestId ? { requestId } : {}),
      };
    }
    if (failure.problem.code === 'CHECKIN_UNDO_FORBIDDEN') {
      return {
        title: 'Role nemá oprávnění vrátit check-in',
        detail:
          'Původní záznam zůstal beze změny. Předejte případ administrátorovi.',
        ...(requestId ? { requestId } : {}),
      };
    }
  }
  const ambiguous =
    failure.kind === 'offline' ||
    failure.kind === 'timeout' ||
    failure.kind === 'transport' ||
    failure.kind === 'invalid_response' ||
    (failure.kind === 'problem' &&
      (failure.problem.code === 'INTERNAL_ERROR' ||
        failure.problem.code === 'IDEMPOTENCY_IN_PROGRESS'));
  return {
    title: ambiguous
      ? 'Výsledek vrácení je nejistý'
      : 'Check-in se nepodařilo vrátit',
    detail: ambiguous
      ? 'Použijte jen exact retry se stejným důvodem a idempotency key.'
      : 'Kanonický záznam zůstal beze změny.',
    ambiguous,
    ...(requestId ? { requestId } : {}),
  };
};

const useConnectivity = (): 'online' | 'offline' => {
  const [state, setState] = useState<'online' | 'offline'>(() =>
    typeof navigator === 'undefined' || navigator.onLine !== false
      ? 'online'
      : 'offline',
  );
  useEffect(() => {
    const online = () => setState('online');
    const offline = () => setState('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);
  return state;
};

export const CheckinOperator = ({
  api,
  camera,
  createKey = createMutationKey,
  debounceMs,
  now = defaultNow,
  scenarioCodes,
  wallClockNow = Date.now,
}: {
  readonly api?: ApiPort;
  readonly camera?: CheckinCameraPort;
  readonly createKey?: (prefix: 'confirm' | 'undo') => string;
  readonly debounceMs?: number;
  readonly now?: () => number;
  readonly scenarioCodes?: readonly CheckinScenarioCode[];
  readonly wallClockNow?: () => number;
}) => {
  const resolvedApi = api ?? browserCheckinApi;
  const connectivity = useConnectivity();
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [bootstrap, setBootstrap] = useState<BootstrapState>({
    status: 'loading',
  });
  const [stage, setStage] = useState<CheckinResultStage>();
  const [scannerGeneration, setScannerGeneration] = useState(0);
  const operation = useRef<AbortController | undefined>(undefined);
  const lookupLocked = useRef(false);
  const confirmLocked = useRef(false);
  const undoLocked = useRef(false);
  const confirmAttempt = useRef<ConfirmAttempt | undefined>(undefined);
  const undoAttempt = useRef<UndoAttempt | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void requestCheckinBootstrap(resolvedApi, controller.signal).then(
      (result) => {
        if (result.ok && result.kind === 'success') {
          setBootstrap({ status: 'ready', data: result.data });
          return;
        }
        if (result.ok || result.failure.kind === 'aborted') return;
        const requestId = requestIdFromFailure(result.failure);
        setBootstrap({
          status: 'failure',
          title:
            result.failure.kind === 'offline'
              ? 'Kontext check-inu nelze načíst offline'
              : 'Operátorský kontext se nepodařilo ověřit',
          ...(requestId ? { requestId } : {}),
        });
      },
    );
    return () => controller.abort();
  }, [bootstrapAttempt, resolvedApi]);

  useEffect(
    () => () => {
      operation.current?.abort();
    },
    [],
  );

  const reset = () => {
    if (
      confirmLocked.current ||
      undoLocked.current ||
      (stage?.kind === 'confirm_failure' && stage.retryExact) ||
      (stage?.kind === 'undo_failure' && stage.retryExact)
    ) {
      return;
    }
    operation.current?.abort();
    operation.current = undefined;
    lookupLocked.current = false;
    confirmAttempt.current = undefined;
    undoAttempt.current = undefined;
    setStage(undefined);
    setScannerGeneration((current) => current + 1);
  };

  const lookup = async (request: CheckinLookupRequest) => {
    if (
      lookupLocked.current ||
      confirmLocked.current ||
      undoLocked.current ||
      connectivity === 'offline'
    ) {
      return;
    }
    const canonicalRequest = checkinLookupRequestSchema.safeParse(request);
    if (!canonicalRequest.success) {
      setStage({
        kind: 'lookup_failure',
        durationMs: 0,
        failure: {
          title: 'Syntetický kód nemá platný formát',
          detail: 'Žádná mutace neproběhla. Použijte ruční zadání.',
        },
      });
      return;
    }
    lookupLocked.current = true;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    const startedAt = now();
    setStage({ kind: 'lookup_pending' });
    const result = await requestCheckinLookup(
      resolvedApi,
      canonicalRequest.data,
      controller.signal,
    );
    const durationMs = Math.max(0, now() - startedAt);
    lookupLocked.current = false;
    if (controller.signal.aborted) return;
    if (result.ok && result.kind === 'success') {
      setStage({ kind: 'lookup', lookup: result.data, durationMs });
      return;
    }
    if (result.ok) {
      setStage({
        kind: 'lookup_failure',
        durationMs,
        failure: {
          title: 'Lookup vrátil neplatný stav',
          detail: 'Žádná mutace neproběhla. Proveďte nový scan.',
        },
      });
      return;
    }
    const failure = mapLookupFailure(result.failure);
    if (failure) setStage({ kind: 'lookup_failure', failure, durationMs });
  };

  const executeConfirm = async (attempt: ConfirmAttempt) => {
    if (confirmLocked.current) return;
    confirmLocked.current = true;
    const controller = new AbortController();
    operation.current = controller;
    setStage({ kind: 'confirming', lookup: attempt.lookup });
    const result = await requestCheckinConfirm(
      resolvedApi,
      attempt.body,
      attempt.idempotencyKey,
      controller.signal,
    );
    confirmLocked.current = false;
    if (controller.signal.aborted) return;
    if (result.ok && result.kind === 'success') {
      confirmAttempt.current = undefined;
      setStage({ kind: 'confirmed', confirmation: result.data });
      return;
    }
    if (result.ok) {
      setStage({
        kind: 'confirm_failure',
        lookup: attempt.lookup,
        retryExact: true,
        failure: {
          title: 'Kanonický výsledek chybí',
          detail:
            'Použijte exact retry se stejným požadavkem a idempotency key.',
          ambiguous: true,
        },
      });
      return;
    }
    const failure = mapConfirmFailure(result.failure);
    if (!failure) return;
    const retryExact = shouldRetainMutationKey(result.failure);
    if (!retryExact) confirmAttempt.current = undefined;
    setStage({
      kind: 'confirm_failure',
      lookup: attempt.lookup,
      failure,
      retryExact,
    });
  };

  const confirm = () => {
    if (
      stage?.kind !== 'lookup' ||
      stage.lookup.outcome !== 'valid' ||
      bootstrap.status !== 'ready' ||
      connectivity === 'offline' ||
      bootstrap.data.device.state === 'revoked' ||
      !bootstrap.data.actor.permissions.confirm ||
      Date.parse(stage.lookup.expiresAt) <= wallClockNow()
    ) {
      return;
    }
    const attempt: ConfirmAttempt = {
      lookup: stage.lookup,
      body: {
        lookupId: stage.lookup.lookupId,
        stationId: bootstrap.data.station.id,
        deviceId: bootstrap.data.device.id,
      },
      idempotencyKey: createKey('confirm'),
    };
    confirmAttempt.current = attempt;
    void executeConfirm(attempt);
  };

  const retryConfirm = () => {
    const attempt = confirmAttempt.current;
    if (attempt) void executeConfirm(attempt);
  };

  const executeUndo = async (attempt: UndoAttempt) => {
    if (undoLocked.current) return;
    undoLocked.current = true;
    const controller = new AbortController();
    operation.current = controller;
    setStage({ kind: 'undoing', record: attempt.record });
    const result = await requestCheckinUndo(
      resolvedApi,
      attempt.checkinId,
      attempt.body,
      attempt.idempotencyKey,
      controller.signal,
    );
    undoLocked.current = false;
    if (controller.signal.aborted) return;
    if (result.ok && result.kind === 'success') {
      undoAttempt.current = undefined;
      setStage({ kind: 'undone', outcome: result.data });
      return;
    }
    if (result.ok) {
      setStage({
        kind: 'undo_failure',
        record: attempt.record,
        retryExact: true,
        failure: {
          title: 'Kanonický výsledek vrácení chybí',
          detail: 'Zopakujte přesně stejnou reverzní operaci.',
          ambiguous: true,
        },
      });
      return;
    }
    const failure = mapUndoFailure(result.failure);
    if (!failure) return;
    const retryExact = shouldRetainMutationKey(result.failure);
    if (!retryExact) undoAttempt.current = undefined;
    setStage({
      kind: 'undo_failure',
      record: attempt.record,
      failure,
      retryExact,
    });
  };

  const undo = (checkinId: string, reason: string) => {
    if (
      connectivity === 'offline' ||
      bootstrap.status !== 'ready' ||
      bootstrap.data.device.state === 'revoked' ||
      !bootstrap.data.actor.permissions.undo
    ) {
      return;
    }
    let record: CheckinRecord | undefined;
    if (stage?.kind === 'confirmed') record = stage.confirmation.checkin;
    if (stage?.kind === 'lookup' && stage.lookup.outcome === 'duplicate') {
      record = stage.lookup.previousCheckin;
    }
    if (
      !record ||
      record.id !== checkinId ||
      !record.undo.allowed ||
      !record.undo.expiresAt ||
      Date.parse(record.undo.expiresAt) <= wallClockNow()
    ) {
      return;
    }
    const attempt: UndoAttempt = {
      body: { reason },
      checkinId,
      idempotencyKey: createKey('undo'),
      record,
    };
    undoAttempt.current = attempt;
    void executeUndo(attempt);
  };

  const retryUndo = () => {
    const attempt = undoAttempt.current;
    if (attempt) void executeUndo(attempt);
  };

  if (bootstrap.status !== 'ready') {
    return (
      <main className={styles.bootstrapPage}>
        <section className={styles.bootstrapCard}>
          <p className={styles.overline}>BYZON · CHECK-IN</p>
          <h1 data-route-heading tabIndex={-1}>
            Ověřuji operátorský kontext
          </h1>
          {bootstrap.status === 'loading' ? (
            <div aria-live="polite" className={styles.bootstrapLoading}>
              <span aria-hidden="true" className={styles.spinner} />
              <p>Načítám event, stanoviště, zařízení a roli…</p>
            </div>
          ) : (
            <StatePanel
              action={
                <Button
                  onClick={() => {
                    setBootstrap({ status: 'loading' });
                    setBootstrapAttempt((current) => current + 1);
                  }}
                >
                  Zkusit znovu
                </Button>
              }
              kind={connectivity === 'offline' ? 'offline' : 'error'}
              title={bootstrap.title}
            >
              <p>Bez ověřeného kontextu nelze provádět lookup ani check-in.</p>
              {bootstrap.requestId && (
                <p>ID požadavku: {bootstrap.requestId}</p>
              )}
            </StatePanel>
          )}
        </section>
      </main>
    );
  }

  const mutationPending =
    stage?.kind === 'confirming' || stage?.kind === 'undoing';
  const reconciliationLocked =
    (stage?.kind === 'confirm_failure' && stage.retryExact) ||
    (stage?.kind === 'undo_failure' && stage.retryExact);
  const deviceRevoked = bootstrap.data.device.state === 'revoked';
  const lookupDisabled = connectivity === 'offline' || deviceRevoked;
  const confirmUnavailableReason =
    connectivity === 'offline'
      ? 'Potvrzení vyžaduje online připojení.'
      : deviceRevoked
        ? 'Zařízení bylo revokované. Potvrzení není dostupné.'
        : !bootstrap.data.actor.permissions.confirm
          ? 'Přihlášená role nemá oprávnění potvrdit check-in.'
          : undefined;
  const undoUnavailableReason =
    connectivity === 'offline'
      ? 'Vrácení vyžaduje online připojení.'
      : deviceRevoked
        ? 'Zařízení bylo revokované. Vrácení není dostupné.'
        : !bootstrap.data.actor.permissions.undo
          ? 'Přihlášená role nemá oprávnění vrátit check-in.'
          : undefined;

  return (
    <CheckinShell
      connectivity={connectivity}
      context={bootstrap.data}
      onReset={reset}
      resetDisabled={mutationPending || reconciliationLocked}
    >
      {(deviceRevoked || !bootstrap.data.actor.permissions.confirm) && (
        <div className={styles.deviceBlock} role="alert">
          <strong>Na tomto zařízení nelze potvrzovat check-in.</strong>
          <span>
            {confirmUnavailableReason} Lookup zůstává dostupný pouze na
            důvěryhodném zařízení.
          </span>
        </div>
      )}
      {!stage ? (
        <div key={`${scannerGeneration}:${lookupDisabled}`}>
          <CheckinScanner
            {...(camera ? { camera } : {})}
            disabled={lookupDisabled}
            onLookup={(request) => void lookup(request)}
            {...(scenarioCodes ? { scenarioCodes } : {})}
          />
          <CheckinSearch
            api={resolvedApi}
            {...(debounceMs === undefined ? {} : { debounceMs })}
            disabled={lookupDisabled}
            onLookup={(request) => void lookup(request)}
          />
        </div>
      ) : (
        <CheckinResult
          {...(confirmUnavailableReason ? { confirmUnavailableReason } : {})}
          onConfirm={confirm}
          onReset={reset}
          onRetryConfirm={retryConfirm}
          onRetryUndo={retryUndo}
          onUndo={undo}
          stage={stage}
          timezone={bootstrap.data.event.timezone}
          {...(undoUnavailableReason ? { undoUnavailableReason } : {})}
          wallClockNow={wallClockNow}
        />
      )}
    </CheckinShell>
  );
};
