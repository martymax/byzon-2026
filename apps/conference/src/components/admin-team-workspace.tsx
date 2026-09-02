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

import {
  requestAdminRoleAssignment,
  requestAdminRoleAssignments,
  requestAdminRolePeople,
  requestAdminRoleScopes,
} from '@/lib/admin-api';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import { AdminFormErrorSummary } from './admin-form-error-summary';
import { AdminModal } from './admin-modal';
import { AdminTeamMembers } from './admin-team-members';
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

class AdminTeamReadError extends Error {
  constructor(
    readonly securityFailure: boolean,
    message: string,
  ) {
    super(message);
  }
}

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
  const { api, context, eventId, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const canManage = permissions.includes('role:manage');
  const canGrant =
    canManage &&
    ['draft', 'activation_open', 'live'].includes(context.event.phase);
  const canRevoke = canManage && context.event.phase !== 'archived';
  const teamPort = useMemo<AdminTeamDataPort>(
    () =>
      dataPort ?? {
        loadAssignments: async (query, signal) => {
          const result = await requestAdminRoleAssignments(
            api,
            eventId,
            query,
            signal,
          );
          if (result.kind === 'failure') {
            throw new AdminTeamReadError(
              isAdminSecurityFailure(result),
              adminFailureMessage(result.failure, result.metadata?.requestId),
            );
          }
          if (!result.ok || result.kind !== 'success') {
            throw new AdminTeamReadError(false, 'Neaktuální odpověď serveru.');
          }
          return result.data;
        },
        searchPeople: async (body, signal) => {
          const result = await requestAdminRolePeople(
            api,
            eventId,
            body,
            signal,
          );
          if (result.kind === 'failure') {
            throw new AdminTeamReadError(
              isAdminSecurityFailure(result),
              adminFailureMessage(result.failure, result.metadata?.requestId),
            );
          }
          if (!result.ok || result.kind !== 'success') {
            throw new AdminTeamReadError(false, 'Neaktuální odpověď serveru.');
          }
          return result.data;
        },
        loadScopeOptions: async (body, signal) => {
          const result = await requestAdminRoleScopes(
            api,
            eventId,
            body,
            signal,
          );
          if (result.kind === 'failure') {
            throw new AdminTeamReadError(
              isAdminSecurityFailure(result),
              adminFailureMessage(result.failure, result.metadata?.requestId),
            );
          }
          if (!result.ok || result.kind !== 'success') {
            throw new AdminTeamReadError(false, 'Neaktuální odpověď serveru.');
          }
          return result.data;
        },
      },
    [api, dataPort, eventId],
  );
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
  const [revokeTarget, setRevokeTarget] = useState<AdminRoleAssignment | null>(
    null,
  );
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
  >(canManage ? 'list' : null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    message: string;
    auditId: string;
  } | null>(null);
  const [reload, setReload] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const listQuery = useMemo(
    () => ({
      ...(roleFilter === 'all' ? {} : { role: roleFilter }),
      ...(stateFilter === 'all' ? {} : { state: stateFilter }),
      ...(scopeFilter === 'all' ? {} : { scopeKind: scopeFilter }),
    }),
    [roleFilter, scopeFilter, stateFilter],
  );

  useEffect(() => {
    if (!canManage) return;
    const request = requestFence.begin('team-list');
    void teamPort
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
      .catch((caught: unknown) => {
        if (!request.isCurrent()) return;
        request.finish();
        setAssignments(null);
        setBusy(null);
        if (caught instanceof AdminTeamReadError && caught.securityFailure) {
          invalidateSensitive(caught.message);
          return;
        }
        setError('Seznam týmových oprávnění se nepodařilo bezpečně načíst.');
      });
    return () => requestFence.cancel('team-list');
  }, [
    canManage,
    eventId,
    invalidateSensitive,
    listQuery,
    reload,
    requestFence,
    teamPort,
  ]);

  useEffect(() => {
    if (!formOpen) return;
    const request = requestFence.begin('team-scopes');
    const body = adminRoleScopeOptionsRequestSchema.parse({ role });
    void teamPort
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
      .catch((caught: unknown) => {
        if (!request.isCurrent()) return;
        request.finish();
        setBusy(null);
        if (caught instanceof AdminTeamReadError && caught.securityFailure) {
          invalidateSensitive(caught.message);
          return;
        }
        setError('Povolené rozsahy role se nepodařilo načíst.');
      });
    return () => requestFence.cancel('team-scopes');
  }, [eventId, formOpen, invalidateSensitive, requestFence, role, teamPort]);

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
  const revokeCandidate =
    assignments && revokeTarget
      ? adminRoleAssignmentMutationRequestSchema.safeParse({
          action: 'revoke',
          assignmentId: revokeTarget.assignmentId,
          expectedVersion: assignments.assignmentsVersion,
          reason,
        })
      : null;

  const search = async () => {
    setAttempted(false);
    setSelectedPerson(null);
    const candidate = adminRolePersonSearchRequestSchema.safeParse({
      query: personQuery,
    });
    if (!candidate.success) {
      setError('Zadejte alespoň dva znaky jména nebo ověřeného kontaktu.');
      return;
    }
    const request = requestFence.begin('team-people');
    setBusy('search');
    setError(null);
    try {
      const response = await teamPort.searchPeople(
        candidate.data,
        request.signal,
      );
      if (!request.isCurrent()) return;
      const parsed = adminRolePersonSearchResponseSchema.parse(response);
      if (parsed.eventId !== eventId) throw new Error('Event mismatch.');
      request.finish();
      setPeople(parsed.items);
      setBusy(null);
    } catch (caught) {
      if (!request.isCurrent()) return;
      request.finish();
      setPeople([]);
      setBusy(null);
      if (caught instanceof AdminTeamReadError && caught.securityFailure) {
        invalidateSensitive(caught.message);
        return;
      }
      setError('Existující osobu se nepodařilo bezpečně vyhledat.');
    }
  };

  const loadMore = async () => {
    const cursor = assignments?.pageInfo.nextCursor;
    if (!assignments || !cursor) return;
    const request = requestFence.begin('team-list-more');
    setLoadingMore(true);
    setError(null);
    try {
      const response = await teamPort.loadAssignments(
        { ...listQuery, cursor },
        request.signal,
      );
      if (!request.isCurrent()) return;
      const parsed = adminRoleAssignmentListResponseSchema.parse(response);
      if (
        parsed.eventId !== eventId ||
        parsed.assignmentsVersion !== assignments.assignmentsVersion
      ) {
        throw new Error('Role assignment page mismatch.');
      }
      request.finish();
      setAssignments(parsed);
      setLoadingMore(false);
    } catch (caught) {
      if (!request.isCurrent()) return;
      request.finish();
      setLoadingMore(false);
      if (caught instanceof AdminTeamReadError && caught.securityFailure) {
        invalidateSensitive(caught.message);
        return;
      }
      setError('Další týmová oprávnění se nepodařilo bezpečně načíst.');
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

  const prepareRevoke = () => {
    setAttempted(true);
    if (!revokeCandidate?.success) return;
    setPending({
      body: revokeCandidate.data,
      idempotencyKey: createAdminIdempotencyKey('role-assignment'),
    });
    setConfirming(true);
    setAmbiguous(false);
  };

  const openRevokeEditor = (assignment: AdminRoleAssignment) => {
    setFormOpen(false);
    setRevokeTarget(assignment);
    setReason('');
    setAttempted(false);
    setPending(null);
    setAmbiguous(false);
    setError(null);
  };

  const closeRoleEditor = () => {
    const hasDraft = Boolean(
      reason.trim() || personQuery.trim() || selectedPerson,
    );
    if (
      hasDraft &&
      !window.confirm(
        'Opravdu chcete editor zavřít? Neuložené změny se zahodí.',
      )
    ) {
      return;
    }
    setFormOpen(false);
    setRevokeTarget(null);
    setPersonQuery('');
    setPeople([]);
    setSelectedPerson(null);
    setReason('');
    setAttempted(false);
    setPending(null);
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
        setRevokeTarget(null);
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
        setFormOpen(false);
        setRevokeTarget(null);
        setReason('');
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
      setRevokeTarget(null);
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
          Přidávejte a upravujte členy týmu, posílejte jim pozvánky a nastavujte
          administrátorské i omezené provozní role.
        </p>
      </header>

      {error && !formOpen && !revokeTarget ? (
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

      {canManage ? (
        <>
          {dataPort === undefined ? (
            <AdminTeamMembers
              onChanged={() => {
                setBusy('list');
                setReload((value) => value + 1);
              }}
            />
          ) : null}
          <section className={styles.panel} aria-labelledby="team-list-title">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="team-list-title">Provozní oprávnění</h2>
                <p className={styles.muted}>
                  Přidělte členům omezené role jen pro konkrétní stanoviště nebo
                  bod programu. Administrátorský přístup upravíte v detailu
                  člena výše.
                </p>
              </div>
              {canGrant ? (
                <button
                  className={styles.button}
                  onClick={() => {
                    setRevokeTarget(null);
                    setFormOpen(true);
                    setBusy('scopes');
                    setScopes([]);
                    setSelectedScopeId('');
                    setPersonQuery('');
                    setPeople([]);
                    setSelectedPerson(null);
                    setReason('');
                    setAttempted(false);
                    setPending(null);
                    setAmbiguous(false);
                  }}
                  type="button"
                >
                  Přiřadit roli
                </button>
              ) : null}
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
                            {canRevoke ? (
                              <button
                                className={styles.dangerButton}
                                onClick={() => openRevokeEditor(assignment)}
                                type="button"
                              >
                                Odebrat oprávnění
                              </button>
                            ) : (
                              'Pouze čtení'
                            )}
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
                        {canRevoke ? (
                          <button
                            className={styles.dangerButton}
                            onClick={() => openRevokeEditor(assignment)}
                            type="button"
                          >
                            Odebrat oprávnění
                          </button>
                        ) : (
                          <span>Pouze čtení</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                {assignments.pageInfo.hasMore ? (
                  <button
                    className={styles.secondaryButton}
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                    type="button"
                  >
                    {loadingMore ? 'Načítám další…' : 'Načíst další role'}
                  </button>
                ) : null}
              </>
            ) : null}
          </section>

          {formOpen && canGrant && !confirming ? (
            <AdminModal
              dismissDisabled={busy === 'mutation'}
              labelledBy="team-grant-title"
              onDismiss={closeRoleEditor}
              size="wide"
            >
              <div className={styles.dialogHeader}>
                <div>
                  <p className={styles.eyebrow}>Nové oprávnění</p>
                  <h2 id="team-grant-title" tabIndex={-1}>
                    Přiřadit provozní roli
                  </h2>
                </div>
                <button
                  className={styles.secondaryButton}
                  disabled={busy === 'mutation'}
                  onClick={closeRoleEditor}
                  type="button"
                >
                  Zavřít
                </button>
              </div>
              <div className={styles.dialogBody}>
                {error ? (
                  <AdminFormErrorSummary
                    descriptionId="admin-team-grant-dialog-error"
                    heading="Změnu oprávnění nelze dokončit"
                    message={error}
                  />
                ) : null}
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
                      data-modal-initial-focus="true"
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
                      <label
                        className={styles.dataCard}
                        key={person.operatorId}
                      >
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
                <label className={styles.field}>
                  <span>Důvod změny oprávnění</span>
                  <textarea
                    disabled={pending !== null}
                    onChange={(event) => setReason(event.target.value)}
                    value={reason}
                  />
                  <span className={styles.helper}>
                    Důvod se uloží do historie změn.
                  </span>
                </label>
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
                <div className={styles.dialogActions}>
                  <button
                    className={styles.secondaryButton}
                    disabled={busy === 'mutation'}
                    onClick={closeRoleEditor}
                    type="button"
                  >
                    Zrušit a zavřít
                  </button>
                  <button
                    className={styles.button}
                    disabled={busy !== null || pending !== null}
                    onClick={prepareGrant}
                    type="button"
                  >
                    Zkontrolovat přiřazení
                  </button>
                </div>
              </div>
            </AdminModal>
          ) : null}
        </>
      ) : null}

      {revokeTarget && canRevoke && !confirming ? (
        <AdminModal
          dismissDisabled={busy === 'mutation'}
          labelledBy="team-revoke-title"
          onDismiss={closeRoleEditor}
        >
          <div className={styles.dialogHeader}>
            <div>
              <p className={styles.eyebrow}>Úprava oprávnění</p>
              <h2 id="team-revoke-title" tabIndex={-1}>
                Odebrat provozní roli
              </h2>
            </div>
            <button
              className={styles.secondaryButton}
              disabled={busy === 'mutation'}
              onClick={closeRoleEditor}
              type="button"
            >
              Zavřít
            </button>
          </div>
          <div className={styles.dialogBody}>
            {error ? (
              <AdminFormErrorSummary
                descriptionId="admin-team-revoke-dialog-error"
                heading="Změnu oprávnění nelze dokončit"
                message={error}
              />
            ) : null}
            <p>
              <strong>{revokeTarget.operatorLabel}</strong> ·{' '}
              {roleLabels[revokeTarget.role]} · {revokeTarget.scope.label}
            </p>
            <label className={styles.field}>
              <span>Důvod změny oprávnění</span>
              <textarea
                aria-invalid={attempted && !revokeCandidate?.success}
                data-modal-initial-focus="true"
                disabled={pending !== null}
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
              <span className={styles.helper}>
                Důvod se uloží do historie změn a musí mít alespoň 8 znaků.
              </span>
            </label>
            {attempted && !revokeCandidate?.success ? (
              <p className={styles.errorSummary} role="alert">
                Doplňte důvod odebrání o alespoň 8 znaků.
              </p>
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
            <div className={styles.dialogActions}>
              <button
                className={styles.secondaryButton}
                disabled={busy === 'mutation'}
                onClick={closeRoleEditor}
                type="button"
              >
                Zrušit a zavřít
              </button>
              <button
                className={styles.dangerButton}
                disabled={busy !== null || pending !== null}
                onClick={prepareRevoke}
                type="button"
              >
                Zkontrolovat odebrání
              </button>
            </div>
          </div>
        </AdminModal>
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
