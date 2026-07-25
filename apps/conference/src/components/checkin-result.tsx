'use client';

import type {
  CheckinConfirmResponse,
  CheckinLookupResponse,
  CheckinRecord,
  CheckinUndoResponse,
} from '@byzon/domain/contracts/check-in';
import {
  CHECKIN_UNDO_REASON_MAX_LENGTH,
  CHECKIN_UNDO_REASON_MIN_LENGTH,
} from '@byzon/domain/contracts/check-in';
import { Button, FormField } from '@byzon/ui';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import styles from './checkin.module.css';

export interface CheckinUiFailure {
  readonly title: string;
  readonly detail: string;
  readonly requestId?: string;
  readonly ambiguous?: boolean;
}

export type CheckinResultStage =
  | {
      readonly kind: 'lookup_pending';
    }
  | {
      readonly kind: 'lookup';
      readonly lookup: CheckinLookupResponse;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'lookup_failure';
      readonly failure: CheckinUiFailure;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'confirming';
      readonly lookup: Extract<CheckinLookupResponse, { outcome: 'valid' }>;
    }
  | {
      readonly kind: 'confirm_failure';
      readonly lookup: Extract<CheckinLookupResponse, { outcome: 'valid' }>;
      readonly failure: CheckinUiFailure;
      readonly retryExact: boolean;
    }
  | {
      readonly kind: 'confirmed';
      readonly confirmation: CheckinConfirmResponse;
    }
  | {
      readonly kind: 'undoing';
      readonly record: CheckinRecord;
    }
  | {
      readonly kind: 'undo_failure';
      readonly record: CheckinRecord;
      readonly failure: CheckinUiFailure;
      readonly retryExact: boolean;
    }
  | {
      readonly kind: 'undone';
      readonly outcome: CheckinUndoResponse;
    };

const outcomeCopy = {
  valid: {
    label: 'Platný lookup',
    title: 'Záznam je platný — čeká na potvrzení',
    detail: 'Ověřte osobu a teprve potom proveďte samostatnou check-in mutaci.',
    icon: 'check',
    tone: 'success',
  },
  duplicate: {
    label: 'Duplicitní scan',
    title: 'Vstup už byl zaznamenán',
    detail:
      'Nevznikl druhý check-in. Zobrazený čas a stanoviště jsou kanonický původní záznam.',
    icon: 'duplicate',
    tone: 'warning',
  },
  cancelled: {
    label: 'Zrušená vstupenka',
    title: 'Vstup nelze potvrdit',
    detail:
      'Vstupenka je zrušená. Osobu neodbavujte a předejte případ podpoře.',
    icon: 'x',
    tone: 'danger',
  },
  refunded: {
    label: 'Vrácená vstupenka',
    title: 'Vstup nelze potvrdit',
    detail:
      'Platba byla vrácena. Check-in není dostupný; případ předejte podpoře.',
    icon: 'refund',
    tone: 'danger',
  },
  blocked: {
    label: 'Blokovaná vstupenka',
    title: 'Vstup je blokovaný',
    detail:
      'Nevytvářejte check-in. Pokračujte podle provozního postupu podpory.',
    icon: 'lock',
    tone: 'danger',
  },
  unknown: {
    label: 'Neznámý kód',
    title: 'Záznam se nepodařilo najít',
    detail:
      'Zkontrolujte opsaný kód nebo použijte omezené vyhledání osoby. Žádná mutace neproběhla.',
    icon: 'question',
    tone: 'neutral',
  },
} as const;

const ResultIcon = ({
  kind,
}: {
  readonly kind:
    | 'check'
    | 'duplicate'
    | 'x'
    | 'refund'
    | 'lock'
    | 'question'
    | 'error'
    | 'progress'
    | 'undo';
}) => {
  const glyph = {
    check: <path d="m14 25 7 7 14-17" />,
    duplicate: (
      <>
        <path d="M12 17a14 14 0 1 1-1 12" />
        <path d="M5 19l7-2-2-7M24 16v10l7 4" />
      </>
    ),
    x: <path d="m15 15 18 18m0-18L15 33" />,
    refund: (
      <>
        <path d="M13 18h17a8 8 0 0 1 0 16H18" />
        <path d="m19 12-6 6 6 6" />
      </>
    ),
    lock: (
      <>
        <rect height="19" rx="3" width="25" x="11.5" y="22" />
        <path d="M17 22v-6a7 7 0 0 1 14 0v6M24 29v5" />
      </>
    ),
    question: (
      <>
        <path d="M18 18a7 7 0 1 1 10 6c-3 1.5-4 3-4 6" />
        <path d="M24 37h.01" />
      </>
    ),
    error: (
      <>
        <path d="M24 6 43 40H5L24 6Z" />
        <path d="M24 18v10m0 5h.01" />
      </>
    ),
    progress: (
      <>
        <path d="M40 24a16 16 0 1 1-5-12" />
        <path d="M34 6v8h8" />
      </>
    ),
    undo: (
      <>
        <path d="M10 16h22a10 10 0 1 1 0 20H20" />
        <path d="m17 9-7 7 7 7" />
      </>
    ),
  } as const;
  return (
    <svg
      aria-hidden="true"
      className={styles.resultIcon}
      data-result-icon={kind}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
      viewBox="0 0 48 48"
    >
      {glyph[kind]}
    </svg>
  );
};

const formatDate = (value: string, timezone: string) =>
  new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: timezone,
  }).format(new Date(value));

const PersonSummary = ({
  lookup,
}: {
  readonly lookup: Exclude<CheckinLookupResponse, { outcome: 'unknown' }>;
}) => (
  <dl className={styles.personSummary}>
    <div>
      <dt>Osoba k ověření</dt>
      <dd>{lookup.person.displayName}</dd>
    </div>
    <div>
      <dt>Maskovaný e-mail</dt>
      <dd>{lookup.person.maskedEmail}</dd>
    </div>
    <div>
      <dt>Reference</dt>
      <dd>•••• {lookup.ticket.referenceSuffix}</dd>
    </div>
  </dl>
);

const CanonicalRecord = ({
  record,
  timezone,
}: {
  readonly record: CheckinRecord;
  readonly timezone: string;
}) => (
  <dl className={styles.canonicalRecord}>
    <div>
      <dt>Čas check-inu</dt>
      <dd>{formatDate(record.occurredAt, timezone)}</dd>
    </div>
    <div>
      <dt>Stanoviště</dt>
      <dd>{record.station.name}</dd>
    </div>
    <div>
      <dt>ID záznamu</dt>
      <dd className={styles.monospace}>{record.id.slice(-8)}</dd>
    </div>
  </dl>
);

export const CheckinResult = ({
  mutationDisabled = false,
  onConfirm,
  onReset,
  onRetryConfirm,
  onRetryUndo,
  onUndo,
  stage,
  timezone,
}: {
  readonly mutationDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onReset: () => void;
  readonly onRetryConfirm: () => void;
  readonly onRetryUndo: () => void;
  readonly onUndo: (checkinId: string, reason: string) => void;
  readonly stage: CheckinResultStage;
  readonly timezone: string;
}) => {
  const [undoOpen, setUndoOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);

  const focusKey =
    stage.kind === 'lookup'
      ? `${stage.kind}:${stage.lookup.outcome}`
      : stage.kind === 'confirmed'
        ? `${stage.kind}:${stage.confirmation.outcome}`
        : stage.kind;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      heading.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [focusKey]);
  useEffect(() => {
    if (!undoOpen) return;
    const frame = window.requestAnimationFrame(() =>
      reasonInput.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [undoOpen]);

  const record = useMemo(() => {
    if (stage.kind === 'confirmed') return stage.confirmation.checkin;
    if (stage.kind === 'undoing' || stage.kind === 'undo_failure') {
      return stage.record;
    }
    if (stage.kind === 'lookup' && stage.lookup.outcome === 'duplicate') {
      return stage.lookup.previousCheckin;
    }
    return undefined;
  }, [stage]);

  const submitUndo = (event: FormEvent) => {
    event.preventDefault();
    const canonical = reason.trim();
    if (canonical.length < CHECKIN_UNDO_REASON_MIN_LENGTH) {
      setReasonError(
        `Uveďte konkrétní důvod alespoň na ${CHECKIN_UNDO_REASON_MIN_LENGTH} znaků.`,
      );
      return;
    }
    if (canonical.length > CHECKIN_UNDO_REASON_MAX_LENGTH) {
      setReasonError(
        `Důvod může mít nejvýše ${CHECKIN_UNDO_REASON_MAX_LENGTH} znaků.`,
      );
      return;
    }
    if (record) onUndo(record.id, canonical);
  };

  if (stage.kind === 'lookup_failure') {
    return (
      <section
        className={`${styles.resultScreen} ${styles.resultDanger}`}
        role="alert"
      >
        <div className={styles.resultSymbol}>
          <ResultIcon kind="error" />
        </div>
        <div className={styles.resultBody}>
          <p className={styles.resultLabel}>Lookup selhal · bez mutace</p>
          <h1 ref={heading} tabIndex={-1}>
            {stage.failure.title}
          </h1>
          <p className={styles.resultLead}>{stage.failure.detail}</p>
          {stage.failure.requestId && (
            <p className={styles.requestId}>
              ID požadavku: {stage.failure.requestId}
            </p>
          )}
          <p
            className={styles.performance}
            data-lookup-duration-ms={stage.durationMs}
          >
            Lookup skončil za {Math.round(stage.durationMs)} ms.
          </p>
          <Button onClick={onReset}>Zpět ke scanneru</Button>
        </div>
      </section>
    );
  }

  if (stage.kind === 'lookup_pending') {
    return (
      <section className={`${styles.resultScreen} ${styles.resultNeutral}`}>
        <div className={styles.resultSymbol}>
          <ResultIcon kind="progress" />
        </div>
        <div aria-live="polite" className={styles.resultBody} role="status">
          <p className={styles.resultLabel}>KROK 1 · LOOKUP BEZ MUTACE</p>
          <h1 ref={heading} tabIndex={-1}>
            Ověřuji syntetický záznam…
          </h1>
          <p className={styles.resultLead}>
            Zatím nevzniká check-in. Čekáme pouze na minimální lookup výsledek.
          </p>
        </div>
      </section>
    );
  }

  if (stage.kind === 'confirming') {
    return (
      <section className={`${styles.resultScreen} ${styles.resultNeutral}`}>
        <div className={styles.resultSymbol}>
          <ResultIcon kind="progress" />
        </div>
        <div aria-live="polite" className={styles.resultBody} role="status">
          <p className={styles.resultLabel}>KROK 2 · AUTORITATIVNÍ MUTACE</p>
          <h1 ref={heading} tabIndex={-1}>
            Potvrzuji check-in…
          </h1>
          <p className={styles.resultLead}>
            Čekáme na kanonický výsledek serveru. Tlačítko je uzamčené proti
            dvojitému odeslání.
          </p>
        </div>
      </section>
    );
  }

  if (stage.kind === 'confirm_failure') {
    return (
      <section
        className={`${styles.resultScreen} ${styles.resultDanger}`}
        role="alert"
      >
        <div className={styles.resultSymbol}>
          <ResultIcon kind="error" />
        </div>
        <div className={styles.resultBody}>
          <p className={styles.resultLabel}>
            {stage.failure.ambiguous
              ? 'Výsledek mutace je nejistý'
              : 'Check-in nebyl potvrzen'}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {stage.failure.title}
          </h1>
          <p className={styles.resultLead}>{stage.failure.detail}</p>
          {stage.failure.requestId && (
            <p className={styles.requestId}>
              ID požadavku: {stage.failure.requestId}
            </p>
          )}
          <div className={styles.resultActions}>
            {stage.retryExact && (
              <Button disabled={mutationDisabled} onClick={onRetryConfirm}>
                Bezpečně zopakovat stejný požadavek
              </Button>
            )}
            {!stage.retryExact && (
              <Button onClick={onReset} variant="secondary">
                Nový lookup
              </Button>
            )}
          </div>
          {stage.retryExact && (
            <p className={styles.safetyNote}>
              Retry používá stejný payload i idempotency key. Nevytvoří druhý
              check-in.
            </p>
          )}
        </div>
      </section>
    );
  }

  if (stage.kind === 'undone') {
    return (
      <section className={`${styles.resultScreen} ${styles.resultWarning}`}>
        <div className={styles.resultSymbol}>
          <ResultIcon kind="undo" />
        </div>
        <div className={styles.resultBody} role="status">
          <p className={styles.resultLabel}>Auditovaná reverzní operace</p>
          <h1 ref={heading} tabIndex={-1}>
            {stage.outcome.outcome === 'undone'
              ? 'Check-in byl vrácen'
              : 'Check-in už byl vrácen dříve'}
          </h1>
          <p className={styles.resultLead}>
            Původní záznam nebyl smazán. Server uložil samostatnou auditovanou
            reverzní událost.
          </p>
          <Button onClick={onReset}>Další návštěvník</Button>
        </div>
      </section>
    );
  }

  if (stage.kind === 'undoing') {
    return (
      <section className={`${styles.resultScreen} ${styles.resultWarning}`}>
        <div className={styles.resultSymbol}>
          <ResultIcon kind="progress" />
        </div>
        <div aria-live="polite" className={styles.resultBody} role="status">
          <p className={styles.resultLabel}>Auditovaná reverzní operace</p>
          <h1 ref={heading} tabIndex={-1}>
            Vracím check-in…
          </h1>
          <p className={styles.resultLead}>
            Ověřujeme roli, časové okno a ukládáme povinný důvod.
          </p>
        </div>
      </section>
    );
  }

  if (stage.kind === 'undo_failure') {
    return (
      <section
        className={`${styles.resultScreen} ${styles.resultDanger}`}
        role="alert"
      >
        <div className={styles.resultSymbol}>
          <ResultIcon kind="error" />
        </div>
        <div className={styles.resultBody}>
          <p className={styles.resultLabel}>Vrácení check-inu selhalo</p>
          <h1 ref={heading} tabIndex={-1}>
            {stage.failure.title}
          </h1>
          <p className={styles.resultLead}>{stage.failure.detail}</p>
          {stage.failure.requestId && (
            <p className={styles.requestId}>
              ID požadavku: {stage.failure.requestId}
            </p>
          )}
          <div className={styles.resultActions}>
            {stage.retryExact && (
              <Button disabled={mutationDisabled} onClick={onRetryUndo}>
                Zopakovat stejnou reverzní operaci
              </Button>
            )}
            {!stage.retryExact && (
              <Button onClick={onReset} variant="secondary">
                Zpět ke scanneru
              </Button>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (stage.kind === 'confirmed') {
    const isNew = stage.confirmation.outcome === 'checked_in';
    return (
      <section
        className={`${styles.resultScreen} ${
          isNew ? styles.resultSuccess : styles.resultWarning
        }`}
        role="status"
      >
        <div className={styles.resultSymbol}>
          <ResultIcon kind={isNew ? 'check' : 'duplicate'} />
        </div>
        <div className={styles.resultBody}>
          <p className={styles.resultLabel}>
            {isNew ? 'Check-in potvrzen' : 'Idempotentní duplicate'}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {isNew ? 'Vstup je zaznamenaný' : 'Vstup už byl zaznamenaný'}
          </h1>
          <p className={styles.resultLead}>
            {isNew
              ? `${stage.confirmation.person.displayName} může pokračovat do prostoru akce.`
              : 'Server vrátil původní záznam a nevytvořil druhý check-in.'}
          </p>
          <CanonicalRecord
            record={stage.confirmation.checkin}
            timezone={timezone}
          />
          <div className={styles.resultActions}>
            <Button onClick={onReset}>Další návštěvník</Button>
            {stage.confirmation.checkin.undo.allowed && (
              <Button
                disabled={mutationDisabled}
                onClick={() => setUndoOpen((current) => !current)}
                variant="danger"
              >
                Vrátit check-in
              </Button>
            )}
          </div>
          {stage.confirmation.checkin.undo.allowed &&
            stage.confirmation.checkin.undo.expiresAt && (
              <p className={styles.safetyNote}>
                Undo je dostupné pouze oprávněné roli do{' '}
                {formatDate(
                  stage.confirmation.checkin.undo.expiresAt,
                  timezone,
                )}
                .
              </p>
            )}
          {undoOpen && (
            <form className={styles.undoForm} onSubmit={submitUndo}>
              <h2>Auditované vrácení check-inu</h2>
              <p>
                Tato operace nemaže historii. Uveďte konkrétní provozní důvod.
              </p>
              <FormField
                {...(reasonError ? { error: reasonError } : {})}
                helperText={`${reason.length}/${CHECKIN_UNDO_REASON_MAX_LENGTH} znaků`}
                label="Důvod vrácení"
                required
              >
                <textarea
                  className={`ui-control ui-textarea ${styles.reasonControl}`}
                  maxLength={CHECKIN_UNDO_REASON_MAX_LENGTH}
                  onChange={(event) => {
                    setReason(event.currentTarget.value);
                    setReasonError(undefined);
                  }}
                  ref={reasonInput}
                  rows={3}
                  value={reason}
                />
              </FormField>
              <div className={styles.resultActions}>
                <Button
                  disabled={mutationDisabled}
                  type="submit"
                  variant="danger"
                >
                  Potvrdit auditované vrácení
                </Button>
                <Button onClick={() => setUndoOpen(false)} variant="secondary">
                  Zrušit
                </Button>
              </div>
            </form>
          )}
        </div>
      </section>
    );
  }

  const copy = outcomeCopy[stage.lookup.outcome];
  const toneClass = {
    success: styles.resultSuccess,
    warning: styles.resultWarning,
    danger: styles.resultDanger,
    neutral: styles.resultNeutral,
  }[copy.tone];
  const lookupRecord =
    stage.lookup.outcome === 'duplicate'
      ? stage.lookup.previousCheckin
      : undefined;
  return (
    <section
      className={`${styles.resultScreen} ${toneClass}`}
      role={
        stage.lookup.outcome === 'valid' || stage.lookup.outcome === 'duplicate'
          ? 'status'
          : 'alert'
      }
    >
      <div className={styles.resultSymbol}>
        <ResultIcon kind={copy.icon} />
      </div>
      <div className={styles.resultBody}>
        <p className={styles.resultLabel}>{copy.label}</p>
        <h1 ref={heading} tabIndex={-1}>
          {copy.title}
        </h1>
        <p className={styles.resultLead}>{copy.detail}</p>
        {stage.lookup.outcome !== 'unknown' && (
          <PersonSummary lookup={stage.lookup} />
        )}
        {lookupRecord && (
          <CanonicalRecord record={lookupRecord} timezone={timezone} />
        )}
        <p
          className={styles.performance}
          data-lookup-duration-ms={stage.durationMs}
        >
          Scan-to-result: {Math.round(stage.durationMs)} ms (syntetické měření)
        </p>
        <div className={styles.resultActions}>
          {stage.lookup.outcome === 'valid' && (
            <Button disabled={mutationDisabled} onClick={onConfirm}>
              Potvrdit check-in této osoby
            </Button>
          )}
          <Button
            onClick={onReset}
            variant={stage.lookup.outcome === 'valid' ? 'secondary' : 'primary'}
          >
            {stage.lookup.outcome === 'valid'
              ? 'Zrušit bez změny'
              : 'Nový scan'}
          </Button>
          {lookupRecord?.undo.allowed && (
            <Button
              disabled={mutationDisabled}
              onClick={() => setUndoOpen((current) => !current)}
              variant="danger"
            >
              Vrátit původní check-in
            </Button>
          )}
        </div>
        {stage.lookup.outcome === 'valid' && (
          <p className={styles.safetyNote}>
            Až následující tlačítko odešle idempotentní mutaci. Dosavadní scan
            nic nezměnil.
          </p>
        )}
        {undoOpen && lookupRecord && (
          <form className={styles.undoForm} onSubmit={submitUndo}>
            <h2>Auditované vrácení check-inu</h2>
            <FormField
              {...(reasonError ? { error: reasonError } : {})}
              helperText={`${reason.length}/${CHECKIN_UNDO_REASON_MAX_LENGTH} znaků`}
              label="Důvod vrácení"
              required
            >
              <textarea
                className={`ui-control ui-textarea ${styles.reasonControl}`}
                maxLength={CHECKIN_UNDO_REASON_MAX_LENGTH}
                onChange={(event) => {
                  setReason(event.currentTarget.value);
                  setReasonError(undefined);
                }}
                ref={reasonInput}
                rows={3}
                value={reason}
              />
            </FormField>
            <div className={styles.resultActions}>
              <Button
                disabled={mutationDisabled}
                type="submit"
                variant="danger"
              >
                Potvrdit auditované vrácení
              </Button>
              <Button onClick={() => setUndoOpen(false)} variant="secondary">
                Zrušit
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
};
