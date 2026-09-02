'use client';

import {
  adminRoleAssignmentMutationRequestSchema,
  adminRoleAssignmentListResponseSchema,
  adminRolePersonSearchRequestSchema,
  adminRolePersonSearchResponseSchema,
  adminRoleScopeOptionsRequestSchema,
  adminRoleScopeOptionsResponseSchema,
  type AdminAssignmentRole,
  type AdminAssignmentScope,
  type AdminRoleAssignment,
  type AdminRoleAssignmentListQuery,
  type AdminRoleAssignmentListResponse,
  type AdminRoleAssignmentMutationRequest,
  type AdminRolePerson,
  type AdminRolePersonSearchRequest,
  type AdminRolePersonSearchResponse,
  type AdminRoleScopeOptionsRequest,
  type AdminRoleScopeOptionsResponse,
} from '@byzon/domain/contracts/admin';
import { AdminTechnicalDetails } from '@byzon/ui';
import { useEffect, useMemo, useState } from 'react';

import { requestAdminRoleAssignment } from '@/lib/admin-api';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import { AdminFormErrorSummary } from './admin-form-error-summary';
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

export interface AdminTeamDataPort {
  readonly loadAssignments: (
    query: AdminRoleAssignmentListQuery,
    signal: AbortSignal,
  ) => Promise<AdminRoleAssignmentListResponse>;
  readonly searchPeople: (
    request: AdminRolePersonSearchRequest,
    signal: AbortSignal,
  ) => Promise<AdminRolePersonSearchResponse>;
  readonly loadScopeOptions: (
    request: AdminRoleScopeOptionsRequest,
    signal: AbortSignal,
  ) => Promise<AdminRoleScopeOptionsResponse>;
}

type PendingChange = Readonly<{
  body: AdminRoleAssignmentMutationRequest;
  idempotencyKey: string;
}>;

const roleLabels: Record<AdminAssignmentRole, string> = {
  checkin_operator: 'Obsluha odbavení',
  moderator: 'Moderátor',
  room_operator: 'Vedoucí aktivity',
};

const roleDescriptions: Record<AdminAssignmentRole, string> = {
  checkin_operator: 'Odbavuje účastníky na přiděleném stanovišti.',
  moderator:
    'Má pouze serverem schválená oprávnění k přiděleným bodům programu.',
  room_operator:
    'Vidí read-only seznam rezervovaných účastníků u svých aktivit.',
};

const stateLabels: Record<AdminRoleAssignment['state'], string> = {
  active: 'Aktivní',
  scheduled: 'Naplánované',
};

const scopeId = (scope: AdminAssignmentScope): string =>
  scope.kind === 'event'
    ? 'event'
    : scope.kind === 'station'
      ? scope.stationId
      : scope.sessionId;

export const AdminTeamRedesign = ({
  dataPort,
}: Readonly<{ dataPort?: AdminTeamDataPort }>) => {
  const { api, eventId, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const canManage = permissions.includes('role:manage');
  const [assignments, setAssignments] =
    useState<AdminRoleAssignmentListResponse | null>(null);
  const [roleFilter, setRoleFilter] = useState<AdminAssignmentRole | 'all'>(
    'all',
  );
  const [stateFilter, setStateFilter] = useState<
    AdminRoleAssignment['state'] | 'all'
  >('all');
  const [scopeFilter, setScopeFilter] = useState<
    AdminAssignmentScope['kind'] | 'all'
  >('all');
  const [formOpen, setFormOpen] = useState(false);
  const [personQuery, setPersonQuery] = useState('');
  const [people, setPeople] = useState<readonly AdminRolePerson[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<AdminRolePerson | null>(
    null,
  );
  const [role, setRole] = useState<AdminAssignmentRole>('checkin_operator');
  const [scopes, setScopes] = useState<readonly AdminAssignmentScope[]>([]);
  const [selectedScopeId, setSelectedScopeId] = useState('');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState<
    'list' | 'search' | 'scopes' | 'mutation' | null
  >(dataPort && canManage ? 'list' : null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    message: string;
    auditId: string;
  } | null>(null);
  const [reload, setReload] = useState(0);

  const listQuery = useMemo(
    () => ({
      ...(roleFilter === 'all' ? {} : { role: roleFilter }),
      ...(stateFilter === 'all' ? {} : { state: stateFilter }),
      ...(scopeFilter === 'all' ? {} : { scopeKind: scopeFilter }),
    }),
    [roleFilter, scopeFilter, stateFilter],
  );

  useEffect(() => {
    if (!dataPort || !canManage) return;
    const request = requestFence.begin('team-list');
    void dataPort
      .loadAssignments(listQuery, request.signal)
      .then((response) => {
        if (!request.isCurrent()) return;
        const parsed = adminRoleAssignmentListResponseSchema.parse(response);
        if (parsed.eventId !== eventId) {
          throw new Error('Role assignment event mismatch.');
        }
        request.finish();
        setAssignments(parsed);
        setBusy(null);
      })
      .catch(() => {
        if (!request.isCurrent()) return;
        request.finish();
        setAssignments(null);
        setBusy(null);
        setError('Seznam týmových oprávnění se nepodařilo bezpečně načíst.');
      });
    return () => requestFence.cancel('team-list');
  }, [canManage, dataPort, eventId, listQuery, reload, requestFence]);

  useEffect(() => {
    if (!dataPort || !formOpen) return;
    const request = requestFence.begin('team-scopes');
    const body = adminRoleScopeOptionsRequestSchema.parse({ role });
    void dataPort
      .loadScopeOptions(body, request.signal)
      .then((response) => {
        if (!request.isCurrent()) return;
        const parsed = adminRoleScopeOptionsResponseSchema.parse(response);
        if (parsed.eventId !== eventId || parsed.role !== role) {
          throw new Error('Role scope response mismatch.');
        }
        request.finish();
        setScopes(parsed.options);
        setSelectedScopeId(parsed.options[0] ? scopeId(parsed.options[0]) : '');
        setBusy(null);
      })
      .catch(() => {
        if (!request.isCurrent()) return;
        request.finish();
        setBusy(null);
        setError('Povolené rozsahy role se nepodařilo načíst.');
      });
    return () => requestFence.cancel('team-scopes');
  }, [dataPort, eventId, formOpen, requestFence, role]);

  const selectedScope = scopes.find(
    (option) => scopeId(option) === selectedScopeId,
  );
  const grantCandidate = adminRoleAssignmentMutationRequestSchema.safeParse({
    action: 'grant',
    operatorId: selectedPerson?.operatorId ?? '',
    role,
    scope: selectedScope,
    expectedVersion: assignments?.assignmentsVersion ?? 0,
    reason,
  });
  const grantInvalid = attempted && !grantCandidate.success;

  const search = async () => {
    setAttempted(false);
    setSelectedPerson(null);
    const candidate = adminRolePersonSearchRequestSchema.safeParse({
      query: personQuery,
    });
    if (!candidate.success || !dataPort) {
      setError('Zadejte alespoň dva znaky jména nebo ověřeného kontaktu.');
      return;
    }
    const request = requestFence.begin('team-people');
    setBusy('search');
    setError(null);
    try {
      const response = await dataPort.searchPeople(
        candidate.data,
        request.signal,
      );
      if (!request.isCurrent()) return;
      const parsed = adminRolePersonSearchResponseSchema.parse(response);
      if (parsed.eventId !== eventId) throw new Error('Event mismatch.');
      request.finish();
      setPeople(parsed.items);
      setBusy(null);
    } catch {
      if (!request.isCurrent()) return;
      request.finish();
      setPeople([]);
      setBusy(null);
      setError('Existující osobu se nepodařilo bezpečně vyhledat.');
    }
  };

  const prepareGrant = () => {
    setAttempted(true);
    if (!grantCandidate.success || grantCandidate.data.action !== 'grant') {
      return;
    }
    setPending({
      body: grantCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('role-assignment'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const prepareRevoke = (assignment: AdminRoleAssignment) => {
    if (!assignments) return;
    const body = adminRoleAssignmentMutationRequestSchema.parse({
      action: 'revoke',
      assignmentId: assignment.assignmentId,
      expectedVersion: assignments.assignmentsVersion,
      reason,
    });
    setPending({
      body,
      idempotencyKey: createAdminIdempotencyKey('role-assignment'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const execute = async (attempt: PendingChange) => {
    const request = requestFence.begin('team-mutation');
    setBusy('mutation');
    setConfirming(false);
    setError(null);
    setRecoveryMessage(null);
    const result = await requestAdminRoleAssignment(
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
        setAssignments(null);
        setPeople([]);
        setScopes([]);
        setSelectedPerson(null);
        setReason('');
        setPending(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        setPending(null);
        setAmbiguous(false);
        setRecoveryMessage(
          'Oprávnění se mezitím změnila. Načetli jsme aktuální seznam; změnu připravte znovu.',
        );
        setBusy('list');
        setReload((value) => value + 1);
        return;
      }
      const retryable = isAmbiguousAdminMutationFailure(result);
      setAmbiguous(retryable);
      if (!retryable) setPending(null);
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    if (result.kind === 'success') {
      setSuccess({
        message:
          attempt.body.action === 'grant'
            ? result.data.outcome === 'already_applied'
              ? 'Tato role už byla přiřazená. Další přiřazení nevzniklo.'
              : 'Role byla přiřazena.'
            : result.data.outcome === 'already_applied'
              ? 'Toto oprávnění už bylo odebrané.'
              : 'Oprávnění bylo odebráno.',
        auditId: result.data.audit.auditId,
      });
      setPending(null);
      setAmbiguous(false);
      setReason('');
      setAttempted(false);
      setFormOpen(false);
      setSelectedPerson(null);
      setPeople([]);
      setBusy('list');
      setReload((value) => value + 1);
    }
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <h1>Tým a oprávnění</h1>
        <p>
          Spravujte omezené provozní role existujících členů týmu a vždy
          zkontrolujte jejich konkrétní rozsah.
        </p>
      </header>

      {!dataPort ? (
        <section className={styles.warning} role="status">
          <strong>Správa týmových rolí zatím není připojená.</strong>
          <p>
            Ruční identifikátory nejsou bezpečná náhrada. Formulář se zobrazí,
            až server poskytne seznam, vyhledání osob a pojmenované rozsahy.
          </p>
        </section>
      ) : null}

      {error ? (
        <AdminFormErrorSummary
          descriptionId="admin-team-error"
          heading="Změnu oprávnění nelze dokončit"
          message={error}
        />
      ) : null}
      {recoveryMessage ? (
        <p className={styles.warning} role="status">
          {recoveryMessage}
        </p>
      ) : null}
      {success ? (
        <section className={styles.success} role="status">
          <strong>{success.message}</strong>
          <AdminTechnicalDetails>
            <dl className={styles.detailList}>
              <dt>ID auditu</dt>
              <dd>{success.auditId}</dd>
            </dl>
          </AdminTechnicalDetails>
        </section>
      ) : null}

      {dataPort && canManage ? (
        <>
          <section className={styles.panel} aria-labelledby="team-list-title">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="team-list-title">Provozní role</h2>
                <p className={styles.muted}>
                  Administrátorská role se na této stránce nepřiděluje.
                </p>
              </div>
              <button
                className={styles.button}
                onClick={() => {
                  setFormOpen(true);
                  setBusy('scopes');
                  setScopes([]);
                  setSelectedScopeId('');
                }}
                type="button"
              >
                Přiřadit roli
              </button>
            </div>
            <div className={styles.filters}>
              <label className={styles.field}>
                <span>Role</span>
                <select
                  onChange={(event) => {
                    setBusy('list');
                    setError(null);
                    setRoleFilter(
                      event.target.value as AdminAssignmentRole | 'all',
                    );
                  }}
                  value={roleFilter}
                >
                  <option value="all">Všechny role</option>
                  {Object.entries(roleLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Stav</span>
                <select
                  onChange={(event) => {
                    setBusy('list');
                    setError(null);
                    setStateFilter(
                      event.target.value as
                        AdminRoleAssignment['state'] | 'all',
                    );
                  }}
                  value={stateFilter}
                >
                  <option value="all">Všechny stavy</option>
                  <option value="active">Aktivní</option>
                  <option value="scheduled">Naplánované</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Oblast</span>
                <select
                  onChange={(event) => {
                    setBusy('list');
                    setError(null);
                    setScopeFilter(
                      event.target.value as
                        AdminAssignmentScope['kind'] | 'all',
                    );
                  }}
                  value={scopeFilter}
                >
                  <option value="all">Všechny oblasti</option>
                  <option value="event">Celá akce</option>
                  <option value="station">Stanoviště</option>
                  <option value="session">Aktivity</option>
                </select>
              </label>
            </div>
            {busy === 'list' ? (
              <p role="status">Načítám týmová oprávnění…</p>
            ) : assignments?.items.length === 0 ? (
              <p className={styles.empty}>
                Nikdo zatím nemá přidělenou provozní roli.
              </p>
            ) : assignments ? (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Člen týmu</th>
                        <th scope="col">Role</th>
                        <th scope="col">Oblast</th>
                        <th scope="col">Stav</th>
                        <th scope="col">Akce</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.items.map((assignment) => (
                        <tr key={assignment.assignmentId}>
                          <th scope="row">{assignment.operatorLabel}</th>
                          <td>{roleLabels[assignment.role]}</td>
                          <td>{assignment.scope.label}</td>
                          <td>{stateLabels[assignment.state]}</td>
                          <td>
                            <button
                              className={styles.dangerButton}
                              disabled={reason.trim().length < 8}
                              onClick={() => prepareRevoke(assignment)}
                              type="button"
                            >
                              Odebrat oprávnění
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.cards}>
                  <ul className={styles.cardList}>
                    {assignments.items.map((assignment) => (
                      <li
                        className={styles.dataCard}
                        key={assignment.assignmentId}
                      >
                        <strong>{assignment.operatorLabel}</strong>
                        <p>
                          {roleLabels[assignment.role]} ·{' '}
                          {assignment.scope.label}
                        </p>
                        <span className={styles.statusBadge}>
                          {stateLabels[assignment.state]}
                        </span>
                        <button
                          className={styles.dangerButton}
                          disabled={reason.trim().length < 8}
                          onClick={() => prepareRevoke(assignment)}
                          type="button"
                        >
                          Odebrat oprávnění
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                {assignments.pageInfo.hasMore ? (
                  <p className={styles.warning}>
                    Seznam má další stránku. Produkční stránkování doplní
                    integrační řez.
                  </p>
                ) : null}
              </>
            ) : null}
          </section>

          <label className={styles.field}>
            <span>Důvod změny oprávnění</span>
            <textarea
              disabled={pending !== null}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
            <span className={styles.helper}>
              Důvod se uloží do auditní historie. Je potřeba i pro odebrání.
            </span>
          </label>

          {formOpen ? (
            <section
              className={styles.panel}
              aria-labelledby="team-grant-title"
            >
              <div className={styles.panelHeader}>
                <h2 id="team-grant-title">Přiřadit provozní roli</h2>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setFormOpen(false)}
                  type="button"
                >
                  Zavřít
                </button>
              </div>
              {grantInvalid ? (
                <AdminFormErrorSummary
                  descriptionId="admin-team-grant-error"
                  heading="Přiřazení role zatím nelze potvrdit"
                  message="Vyberte existující osobu, roli, povolený rozsah a doplňte důvod změny."
                />
              ) : null}
              <div className={styles.actionRow}>
                <label className={styles.field}>
                  <span>Jméno nebo ověřený kontakt</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => setPersonQuery(event.target.value)}
                    value={personQuery}
                  />
                </label>
                <button
                  className={styles.secondaryButton}
                  disabled={busy !== null}
                  onClick={() => void search()}
                  type="button"
                >
                  Vyhledat osobu
                </button>
              </div>
              {people.length === 0 &&
              personQuery.trim().length >= 2 &&
              busy !== 'search' ? (
                <p className={styles.empty}>
                  Žádná existující osoba neodpovídá hledání.
                </p>
              ) : (
                <div className={styles.summaryGrid}>
                  {people.map((person) => (
                    <label className={styles.dataCard} key={person.operatorId}>
                      <input
                        checked={
                          selectedPerson?.operatorId === person.operatorId
                        }
                        name="team-person"
                        onChange={() => setSelectedPerson(person)}
                        type="radio"
                      />
                      <strong>{person.displayName}</strong>
                      <span>{person.maskedVerifiedContact}</span>
                    </label>
                  ))}
                </div>
              )}
              <fieldset className={styles.fieldset}>
                <legend>Role a její dopad</legend>
                <div className={styles.summaryGrid}>
                  {(Object.keys(roleLabels) as AdminAssignmentRole[]).map(
                    (option) => (
                      <label className={styles.dataCard} key={option}>
                        <input
                          checked={role === option}
                          name="team-role"
                          onChange={() => {
                            setBusy('scopes');
                            setScopes([]);
                            setSelectedScopeId('');
                            setRole(option);
                          }}
                          type="radio"
                        />
                        <strong>{roleLabels[option]}</strong>
                        <span>{roleDescriptions[option]}</span>
                      </label>
                    ),
                  )}
                </div>
              </fieldset>
              <label className={styles.field}>
                <span>Povolený rozsah</span>
                <select
                  disabled={busy === 'scopes' || scopes.length === 0}
                  onChange={(event) => setSelectedScopeId(event.target.value)}
                  value={selectedScopeId}
                >
                  {scopes.map((scope) => (
                    <option key={scopeId(scope)} value={scopeId(scope)}>
                      {scope.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={styles.button}
                disabled={busy !== null || pending !== null}
                onClick={prepareGrant}
                type="button"
              >
                Zkontrolovat přiřazení
              </button>
            </section>
          ) : null}
        </>
      ) : null}

      {ambiguous && pending ? (
        <button
          className={styles.secondaryButton}
          disabled={busy !== null}
          onClick={() => void execute(pending)}
          type="button"
        >
          Zopakovat přesně stejný pokus
        </button>
      ) : null}

      {confirming && pending ? (
        <AdminConfirmDialog
          acknowledgement="Ověřil/a jsem osobu, roli, rozsah a dopad změny."
          confirmLabel={
            pending.body.action === 'grant'
              ? 'Přiřadit roli'
              : 'Odebrat oprávnění'
          }
          danger={pending.body.action === 'revoke'}
          description={
            pending.body.action === 'grant'
              ? `Osoba získá roli ${roleLabels[pending.body.role]} pouze v rozsahu ${pending.body.scope.label}.`
              : 'Vybraná provozní role přestane platit. Ostatní oprávnění osoby se nezmění.'
          }
          onConfirm={() => void execute(pending)}
          onDismiss={() => {
            setConfirming(false);
            setPending(null);
          }}
          title={
            pending.body.action === 'grant'
              ? 'Přiřadit tuto provozní roli?'
              : 'Odebrat toto oprávnění?'
          }
        />
      ) : null}
    </div>
  );
};
