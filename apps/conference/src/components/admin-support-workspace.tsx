'use client';

import {
  supportMutationRequestSchema,
  supportSearchQuerySchema,
  type SupportAction,
  type SupportMutationRequest,
  type SupportRecord,
} from '@byzon/domain/contracts/support';
import { AdminTechnicalDetails } from '@byzon/ui';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  requestAdminSupportMutation,
  requestAdminSupportSearch,
} from '@/lib/admin-api';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import {
  supportAccessStateLabels,
  supportActionLabels,
  ticketStateLabels,
} from './admin-ui-registry';
import {
  adminFailureMessage,
  createAdminIdempotencyKey,
  isAmbiguousAdminMutationFailure,
  isStaleAdminFailure,
} from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

const visibleSupportActions = [
  'resend',
  'block',
  'reactivate',
] as const satisfies readonly SupportAction[];

const actionGuidance: Record<
  (typeof visibleSupportActions)[number],
  Readonly<{
    when: string;
    impact: string;
    success: string;
    recovery: string;
    danger: boolean;
  }>
> = {
  resend: {
    when: 'Účastník aktivační výzvu nedostal nebo její platnost skončila.',
    impact:
      'Odešle novou aktivační výzvu. Stav vstupenky ani rezervace se nezmění.',
    success: 'Aktivační výzva byla znovu odeslána.',
    recovery:
      'Pokud zpráva nedorazí, ověřte maskovaný kontakt a zkuste akci později.',
    danger: false,
  },
  block: {
    when: 'Vstupenka nesmí dál umožnit vstup do aplikace ani na akci.',
    impact:
      'Zablokuje přístup a zruší potvrzené rezervace i čekání na uvolněná místa.',
    success: 'Přístup byl zablokován a související rezervace byly zrušeny.',
    recovery:
      'Přístup lze později obnovit; zrušené rezervace se samy neobnoví.',
    danger: true,
  },
  reactivate: {
    when: 'Dříve zablokovaná vstupenka má znovu umožnit přístup.',
    impact:
      'Obnoví přístup. Dříve zrušené rezervace ani místo na čekací listině se neobnoví.',
    success: 'Přístup byl obnoven.',
    recovery: 'Pokud účastník potřebuje aktivity, musí si je znovu rezervovat.',
    danger: false,
  },
};

const isVisibleSupportAction = (
  action: SupportAction,
): action is (typeof visibleSupportActions)[number] =>
  visibleSupportActions.includes(
    action as (typeof visibleSupportActions)[number],
  );

type PendingMutation = Readonly<{
  body: SupportMutationRequest;
  idempotencyKey: string;
}>;

export const AdminSupportWorkspace = () => {
  const { api, eventId, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const canReadSupport = permissions.includes('participant:operational:read');
  const canMutateSupport = permissions.includes('ticket:any:manage');
  const requestFence = useAdminRequestFence();
  const mutationErrorSummaryRef = useRef<HTMLElement | null>(null);
  const searchErrorSummaryRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<readonly SupportRecord[]>([]);
  const [searchOutcome, setSearchOutcome] = useState<
    'idle' | 'no_match' | 'single_match' | 'ambiguous'
  >('idle');
  const [selected, setSelected] = useState<SupportRecord | null>(null);
  const [solving, setSolving] = useState(false);
  const [action, setAction] = useState<SupportAction>('resend');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState<PendingMutation | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState<'search' | 'mutation' | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    message: string;
    auditId: string;
  } | null>(null);
  const [searchInvalid, setSearchInvalid] = useState(false);

  const availableActions = useMemo<
    readonly (typeof visibleSupportActions)[number][]
  >(
    () => selected?.availableActions.filter(isVisibleSupportAction) ?? [],
    [selected],
  );
  const selectedGuidance = isVisibleSupportAction(action)
    ? actionGuidance[action]
    : null;
  const requestCandidate = selected
    ? supportMutationRequestSchema.safeParse({
        participantId: selected.participantId,
        ticketId: selected.ticketId,
        action,
        expectedVersion: selected.version,
        reason,
        targetTicketId: null,
      })
    : null;
  const mutationValidationFailed =
    attempted && requestCandidate?.success === false;
  const mutationInvalidPaths = new Set(
    mutationValidationFailed && requestCandidate
      ? requestCandidate.error.issues.map(({ path }) => path[0])
      : [],
  );

  useEffect(() => {
    if (searchInvalid) {
      searchErrorSummaryRef.current?.focus();
    } else if (mutationValidationFailed || mutationError) {
      mutationErrorSummaryRef.current?.focus();
    }
  }, [mutationError, mutationValidationFailed, searchInvalid]);

  const clearMutationDraft = () => {
    setSelected(null);
    setSolving(false);
    setReason('');
    setAttempted(false);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    setMutationError(null);
    setSuccess(null);
  };

  const wipeSensitiveState = () => {
    setQuery('');
    setRecords([]);
    setSearchOutcome('idle');
    clearMutationDraft();
  };

  const search = async (staleMessage?: string) => {
    if (!canReadSupport) return;
    const validated = supportSearchQuerySchema.safeParse({ query, limit: 5 });
    if (!validated.success) {
      setSearchInvalid(true);
      setSearchError('Zadejte 2 až 80 bezpečných znaků.');
      return;
    }
    const request = requestFence.begin('support-search');
    setSearchInvalid(false);
    setBusy('search');
    setSearchError(null);
    clearMutationDraft();
    const result = await requestAdminSupportSearch(
      api,
      eventId,
      validated.data.query,
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(null);
    if (!result.ok) {
      setRecords([]);
      setSearchOutcome('idle');
      if (isAdminSecurityFailure(result)) {
        wipeSensitiveState();
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      setSearchError(
        adminFailureMessage(result.failure, result.metadata?.requestId),
      );
      return;
    }
    if (result.kind === 'success') {
      setRecords(result.data.matches);
      setSearchOutcome(result.data.outcome);
      if (staleMessage) setSearchError(staleMessage);
    }
  };

  const selectRecord = (record: SupportRecord) => {
    setSelected(record);
    setSolving(false);
    setAction(record.availableActions.find(isVisibleSupportAction) ?? 'resend');
    setReason('');
    setAttempted(false);
    setPending(null);
    setConfirming(false);
    setAmbiguous(false);
    setSearchError(null);
    setMutationError(null);
    setSuccess(null);
  };

  const openActions = () => {
    if (!canMutateSupport || availableActions.length === 0) return;
    setAction(availableActions[0]!);
    setSolving(true);
  };

  const prepare = () => {
    setAttempted(true);
    if (
      !canMutateSupport ||
      !isVisibleSupportAction(action) ||
      !availableActions.includes(action) ||
      !requestCandidate?.success
    ) {
      return;
    }
    setPending({
      body: requestCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('support'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const mutate = async (attempt: PendingMutation) => {
    if (!canMutateSupport || !isVisibleSupportAction(attempt.body.action)) {
      return;
    }
    const request = requestFence.begin('support-mutation');
    setBusy('mutation');
    setConfirming(false);
    setMutationError(null);
    const result = await requestAdminSupportMutation(
      api,
      eventId,
      attempt.body,
      attempt.idempotencyKey,
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(null);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
        wipeSensitiveState();
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        setPending(null);
        setAmbiguous(false);
        setReason('');
        setSolving(false);
        await search(
          'Záznam se mezitím změnil. Načetli jsme aktuální stav; změnu připravte znovu.',
        );
        return;
      }
      const retryable = isAmbiguousAdminMutationFailure(result);
      setAmbiguous(retryable);
      if (!retryable) setPending(null);
      setMutationError(
        adminFailureMessage(result.failure, result.metadata?.requestId),
      );
      return;
    }
    if (result.kind === 'success') {
      setRecords((current) =>
        current.map((record) =>
          record.participantId === result.data.record.participantId
            ? result.data.record
            : record,
        ),
      );
      setSelected(result.data.record);
      setPending(null);
      setAmbiguous(false);
      setAttempted(false);
      setReason('');
      setSolving(false);
      setSuccess({
        message:
          result.data.outcome === 'already_applied'
            ? `Server potvrdil dříve dokončenou změnu. ${actionGuidance[attempt.body.action].success}`
            : actionGuidance[attempt.body.action].success,
        auditId: result.data.audit.auditId,
      });
    }
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <h1>Účastníci</h1>
        <p>
          Najděte člověka a vyřešte jen problém, který jeho aktuální stav
          dovoluje.
        </p>
      </header>

      <section className={styles.panel} aria-labelledby="support-search-title">
        <h2 id="support-search-title">Najít účastníka</h2>
        <form
          className={styles.toolbar}
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
          role="search"
        >
          <label className={styles.field}>
            <span>Jméno, e-mail nebo reference vstupenky</span>
            <input
              autoComplete="off"
              aria-describedby={
                searchInvalid
                  ? 'admin-support-search-error'
                  : 'admin-support-search-help'
              }
              aria-invalid={searchInvalid}
              maxLength={80}
              onChange={(event) => {
                setQuery(event.target.value);
                if (searchInvalid) setSearchError(null);
                setSearchInvalid(false);
              }}
              disabled={pending !== null}
              type="search"
              value={query}
            />
            <span className={styles.helper} id="admin-support-search-help">
              Zadejte alespoň 2 znaky. Vyhledávání se neukládá do historie.
            </span>
          </label>
          <button
            className={styles.button}
            disabled={busy !== null || !canReadSupport || pending !== null}
            type="submit"
          >
            {busy === 'search' ? 'Vyhledávám…' : 'Vyhledat účastníka'}
          </button>
        </form>
        {searchError ? (
          <section
            className={searchInvalid ? styles.errorSummary : styles.warning}
            ref={searchInvalid ? searchErrorSummaryRef : undefined}
            role="alert"
            tabIndex={searchInvalid ? -1 : undefined}
          >
            <p id="admin-support-search-error">{searchError}</p>
          </section>
        ) : null}
        {searchOutcome === 'no_match' && !searchError ? (
          <p role="status">
            Nikoho jsme nenašli. Zkontrolujte zápis nebo zkuste jiný údaj.
          </p>
        ) : null}
        {searchOutcome === 'ambiguous' ? (
          <p className={styles.callout} role="status">
            Našli jsme více lidí. Vyberte správný záznam podle maskovaného
            kontaktu nebo reference.
          </p>
        ) : null}

        {records.length > 0 ? (
          <>
            <div className={styles.tableWrap} tabIndex={0}>
              <table className={styles.table}>
                <caption>Výsledky vyhledávání účastníků</caption>
                <thead>
                  <tr>
                    <th scope="col">Účastník</th>
                    <th scope="col">Kontakt</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Vstupenka</th>
                    <th scope="col">Přístup</th>
                    <th scope="col">Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.participantId}>
                      <td>
                        <strong>{record.displayName}</strong>
                      </td>
                      <td>{record.maskedContact}</td>
                      <td>••{record.referenceSuffix}</td>
                      <td>{ticketStateLabels[record.ticketState]}</td>
                      <td>{supportAccessStateLabels[record.accessState]}</td>
                      <td>
                        <button
                          className={styles.secondaryButton}
                          disabled={pending !== null}
                          onClick={() => selectRecord(record)}
                          type="button"
                        >
                          Zobrazit detail
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.cards}>
              <ul className={styles.cardList}>
                {records.map((record) => (
                  <li className={styles.dataCard} key={record.participantId}>
                    <div className={styles.panelHeader}>
                      <strong>{record.displayName}</strong>
                      <span className={styles.statusBadge}>
                        {ticketStateLabels[record.ticketState]}
                      </span>
                    </div>
                    <dl>
                      <dt>Kontakt</dt>
                      <dd>{record.maskedContact}</dd>
                      <dt>Reference</dt>
                      <dd>••{record.referenceSuffix}</dd>
                      <dt>Přístup</dt>
                      <dd>{supportAccessStateLabels[record.accessState]}</dd>
                    </dl>
                    <button
                      className={styles.secondaryButton}
                      disabled={pending !== null}
                      onClick={() => selectRecord(record)}
                      type="button"
                    >
                      Zobrazit detail
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </section>

      {selected ? (
        <section
          className={styles.panel}
          aria-labelledby="support-detail-title"
        >
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Detail účastníka</p>
              <h2 id="support-detail-title">{selected.displayName}</h2>
            </div>
            <span className={styles.statusBadge}>
              {ticketStateLabels[selected.ticketState]}
            </span>
          </div>
          <div className={styles.supportRecordSummary}>
            <span>{selected.maskedContact}</span>
            <span>••{selected.referenceSuffix}</span>
            <span>{ticketStateLabels[selected.ticketState]}</span>
            <span>{supportAccessStateLabels[selected.accessState]}</span>
          </div>

          {success ? (
            <section className={styles.success} role="status">
              <p>
                <strong>{success.message}</strong>
              </p>
              <p>
                <Link href="/admin/audit">Zobrazit v historii změn</Link>
              </p>
              <AdminTechnicalDetails>
                <dl className={styles.detailList}>
                  <dt>ID auditu</dt>
                  <dd>{success.auditId}</dd>
                </dl>
              </AdminTechnicalDetails>
            </section>
          ) : null}

          {canMutateSupport && availableActions.length > 0 && !solving ? (
            <button
              className={styles.button}
              onClick={openActions}
              type="button"
            >
              Vyřešit problém
            </button>
          ) : null}
          {canMutateSupport && availableActions.length === 0 ? (
            <p className={styles.callout}>
              Pro aktuální stav není dostupná žádná bezpečná akce.
            </p>
          ) : null}

          {canMutateSupport && solving ? (
            <div className={styles.stack}>
              <fieldset className={styles.supportActionPicker}>
                <legend>Co potřebujete vyřešit?</legend>
                {availableActions.map((availableAction) => (
                  <label key={availableAction}>
                    <input
                      checked={action === availableAction}
                      disabled={pending !== null}
                      name="support-action"
                      onChange={() => {
                        setAction(availableAction);
                        setAttempted(false);
                        setPending(null);
                        setAmbiguous(false);
                      }}
                      type="radio"
                      value={availableAction}
                    />
                    <span>
                      <strong>{supportActionLabels[availableAction]}</strong>
                      <small>
                        <b>Kdy použít:</b>{' '}
                        {actionGuidance[availableAction].when}
                      </small>
                    </span>
                  </label>
                ))}
              </fieldset>
              {selectedGuidance ? (
                <section
                  className={
                    selectedGuidance.danger ? styles.warning : styles.callout
                  }
                >
                  <h3>Dopad změny</h3>
                  <p>{selectedGuidance.impact}</p>
                  <p>
                    <strong>Co dělat potom:</strong> {selectedGuidance.recovery}
                  </p>
                </section>
              ) : null}
              {mutationValidationFailed || mutationError ? (
                <section
                  className={styles.errorSummary}
                  ref={mutationErrorSummaryRef}
                  role="alert"
                  tabIndex={-1}
                >
                  <h2>Změnu zatím nelze potvrdit</h2>
                  <p id="admin-support-mutation-error">
                    {mutationError ??
                      'Doplňte důvod změny o nejméně 8 viditelných znaků.'}
                  </p>
                </section>
              ) : null}
              <label className={styles.field}>
                <span>Důvod změny</span>
                <textarea
                  aria-describedby={
                    mutationInvalidPaths.has('reason')
                      ? 'admin-support-reason-error'
                      : 'admin-support-reason-help'
                  }
                  aria-invalid={mutationInvalidPaths.has('reason')}
                  disabled={pending !== null}
                  onChange={(event) => setReason(event.target.value)}
                  value={reason}
                />
                <span className={styles.helper} id="admin-support-reason-help">
                  Nejméně 8 znaků. Důvod se uloží do historie změn.
                </span>
                {mutationInvalidPaths.has('reason') ? (
                  <span
                    className={styles.helper}
                    id="admin-support-reason-error"
                  >
                    Důvod změny musí mít nejméně 8 viditelných znaků.
                  </span>
                ) : null}
              </label>
              <div className={styles.actionRow}>
                <button
                  className={
                    selectedGuidance?.danger
                      ? styles.dangerButton
                      : styles.button
                  }
                  disabled={busy !== null || pending !== null}
                  onClick={prepare}
                  type="button"
                >
                  Zkontrolovat změnu
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={busy !== null || pending !== null}
                  onClick={() => {
                    setSolving(false);
                    setReason('');
                    setAttempted(false);
                    setMutationError(null);
                  }}
                  type="button"
                >
                  Zrušit
                </button>
                {ambiguous && pending ? (
                  <button
                    className={styles.secondaryButton}
                    disabled={busy !== null}
                    onClick={() => void mutate(pending)}
                    type="button"
                  >
                    Zopakovat přesně stejný pokus
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {confirming && pending && isVisibleSupportAction(pending.body.action) ? (
        <AdminConfirmDialog
          acknowledgement="Ověřil/a jsem správného účastníka, dopad změny a uložený důvod."
          confirmLabel={supportActionLabels[pending.body.action]}
          danger={actionGuidance[pending.body.action].danger}
          description={actionGuidance[pending.body.action].impact}
          impact={
            <p>
              <strong>{selected?.displayName}</strong> · vstupenka ••
              {selected?.referenceSuffix}
            </p>
          }
          onConfirm={() => void mutate(pending)}
          onDismiss={() => {
            setConfirming(false);
            setPending(null);
          }}
          title={`${supportActionLabels[pending.body.action]}?`}
        />
      ) : null}
    </div>
  );
};
