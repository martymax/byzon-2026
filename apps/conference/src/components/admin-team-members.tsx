'use client';

import {
  adminRoleScopeOptionsResponseSchema,
  adminTeamMemberListResponseSchema,
  adminTeamMemberMutationRequestSchema,
  type AdminAssignmentRole,
  type AdminAssignmentScope,
  type AdminTeamMember,
  type AdminTeamMemberListResponse,
  type AdminTeamMemberMutationRequest,
  type AdminTeamRole,
} from '@byzon/domain/contracts/admin';
import { useEffect, useMemo, useState } from 'react';

import {
  requestAdminRoleScopes,
  requestAdminTeamInvitation,
  requestAdminTeamMemberMutation,
  requestAdminTeamMembers,
} from '@/lib/admin-api';

import { AdminFormErrorSummary } from './admin-form-error-summary';
import { AdminModal } from './admin-modal';
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

type Editor =
  | { kind: 'add' }
  | { kind: 'edit'; member: AdminTeamMember }
  | { kind: 'remove'; member: AdminTeamMember }
  | null;

type PendingChange = Readonly<{
  body: AdminTeamMemberMutationRequest;
  idempotencyKey: string;
  sendInvitation: boolean;
}>;

const roleLabels: Record<AdminTeamRole, string> = {
  organizer_admin: 'Administrátor',
  checkin_operator: 'Obsluha odbavení',
  moderator: 'Moderátor',
  room_operator: 'Vedoucí aktivity',
};

const operationalRoles: readonly AdminAssignmentRole[] = [
  'checkin_operator',
  'moderator',
  'room_operator',
];

const invitationLabels: Record<
  AdminTeamMember['invitation']['status'],
  string
> = {
  not_sent: 'Pozvánka neodeslána',
  sent: 'Pozvánka odeslána',
  accepted: 'Přístup aktivní',
};

const scopeId = (scope: AdminAssignmentScope): string =>
  scope.kind === 'event'
    ? 'event'
    : scope.kind === 'station'
      ? scope.stationId
      : scope.sessionId;

const initialForm = {
  displayName: '',
  email: '',
  role: 'organizer_admin' as AdminTeamRole,
  scopeId: '',
  administrator: false,
  sendInvitation: true,
  reason: '',
};

export const AdminTeamMembers = ({
  onChanged,
}: Readonly<{ onChanged?: () => void }>) => {
  const { api, context, eventId, invalidateSensitive } = useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const editable = context.event.phase !== 'archived';
  const canAdd = !['ended', 'archived'].includes(context.event.phase);
  const [data, setData] = useState<AdminTeamMemberListResponse | null>(null);
  const [editor, setEditor] = useState<Editor>(null);
  const [form, setForm] = useState(initialForm);
  const [scopes, setScopes] = useState<readonly AdminAssignmentScope[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    AdminTeamMember['invitation']['status'] | 'all'
  >('all');
  const [busy, setBusy] = useState<
    'list' | 'scopes' | 'mutation' | 'invite' | null
  >('list');
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const request = requestFence.begin('team-members-list');
    void requestAdminTeamMembers(api, eventId, request.signal)
      .then((result) => {
        if (!request.isCurrent()) return;
        request.finish();
        setBusy(null);
        if (!result.ok) {
          if (isAdminSecurityFailure(result)) {
            invalidateSensitive(
              adminFailureMessage(result.failure, result.metadata?.requestId),
            );
            return;
          }
          setError(
            adminFailureMessage(result.failure, result.metadata?.requestId),
          );
          return;
        }
        if (result.kind !== 'success') {
          setError('Server vrátil neaktuální seznam členů týmu.');
          return;
        }
        setData(adminTeamMemberListResponseSchema.parse(result.data));
      })
      .catch(() => {
        if (!request.isCurrent()) return;
        request.finish();
        setBusy(null);
        setError('Seznam členů týmu se nepodařilo bezpečně načíst.');
      });
    return () => requestFence.cancel('team-members-list');
  }, [api, eventId, invalidateSensitive, reload, requestFence]);

  useEffect(() => {
    if (editor?.kind !== 'add' || form.role === 'organizer_admin') {
      return;
    }
    const request = requestFence.begin('team-member-scopes');
    void requestAdminRoleScopes(
      api,
      eventId,
      { role: form.role },
      request.signal,
    )
      .then((result) => {
        if (!request.isCurrent()) return;
        request.finish();
        setBusy(null);
        if (!result.ok || result.kind !== 'success') {
          if (result.kind === 'failure' && isAdminSecurityFailure(result)) {
            invalidateSensitive(
              adminFailureMessage(result.failure, result.metadata?.requestId),
            );
            return;
          }
          setError('Rozsahy vybrané role se nepodařilo načíst.');
          return;
        }
        const parsed = adminRoleScopeOptionsResponseSchema.parse(result.data);
        setScopes(parsed.options);
        setForm((current) => ({
          ...current,
          scopeId: parsed.options[0] ? scopeId(parsed.options[0]) : '',
        }));
      })
      .catch(() => {
        if (!request.isCurrent()) return;
        request.finish();
        setBusy(null);
        setError('Rozsahy vybrané role se nepodařilo načíst.');
      });
    return () => requestFence.cancel('team-member-scopes');
  }, [
    api,
    editor?.kind,
    eventId,
    form.role,
    invalidateSensitive,
    requestFence,
  ]);

  const filteredMembers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('cs');
    return (data?.members ?? []).filter(
      (member) =>
        (statusFilter === 'all' || member.invitation.status === statusFilter) &&
        (!needle ||
          member.displayName.toLocaleLowerCase('cs').includes(needle) ||
          member.email.toLocaleLowerCase('cs').includes(needle)),
    );
  }, [data?.members, query, statusFilter]);

  const openAdd = () => {
    setEditor({ kind: 'add' });
    setForm(initialForm);
    setScopes([]);
    setAttempted(false);
    setPending(null);
    setError(null);
  };

  const openEdit = (member: AdminTeamMember) => {
    setEditor({ kind: 'edit', member });
    setForm({
      ...initialForm,
      displayName: member.displayName,
      email: member.email,
      administrator: member.roles.includes('organizer_admin'),
      sendInvitation: false,
    });
    setAttempted(false);
    setPending(null);
    setError(null);
  };

  const openRemove = (member: AdminTeamMember) => {
    setEditor({ kind: 'remove', member });
    setForm({ ...initialForm, reason: '' });
    setAttempted(false);
    setPending(null);
    setError(null);
  };

  const closeEditor = () => {
    const dirty =
      editor?.kind === 'add'
        ? Boolean(form.displayName || form.email || form.reason)
        : editor?.kind === 'edit'
          ? Boolean(
              form.displayName !== editor.member.displayName ||
              form.email !== editor.member.email ||
              form.administrator !==
                editor.member.roles.includes('organizer_admin') ||
              form.reason,
            )
          : Boolean(form.reason);
    if (
      dirty &&
      !window.confirm(
        'Opravdu chcete editor zavřít? Neuložené změny se zahodí.',
      )
    ) {
      return;
    }
    setEditor(null);
    setPending(null);
    setAttempted(false);
    setError(null);
  };

  const candidate = useMemo(() => {
    if (!data || !editor) return null;
    if (editor.kind === 'remove') {
      return adminTeamMemberMutationRequestSchema.safeParse({
        action: 'remove',
        memberId: editor.member.memberId,
        expectedVersion: data.teamVersion,
        reason: form.reason,
      });
    }
    if (editor.kind === 'edit') {
      return adminTeamMemberMutationRequestSchema.safeParse({
        action: 'update',
        memberId: editor.member.memberId,
        displayName: form.displayName,
        email: form.email,
        administrator: form.administrator,
        expectedVersion: data.teamVersion,
        reason: form.reason,
      });
    }
    const scope = scopes.find((option) => scopeId(option) === form.scopeId);
    return adminTeamMemberMutationRequestSchema.safeParse({
      action: 'add',
      displayName: form.displayName,
      email: form.email,
      access:
        form.role === 'organizer_admin'
          ? { role: 'organizer_admin' }
          : { role: form.role, scope },
      expectedVersion: data.teamVersion,
      reason: form.reason,
    });
  }, [data, editor, form, scopes]);

  const prepare = () => {
    setAttempted(true);
    if (!candidate?.success) return;
    const body = candidate.data;
    const change: PendingChange = {
      body,
      idempotencyKey: createAdminIdempotencyKey('team-member'),
      sendInvitation: body.action === 'add' && form.sendInvitation,
    };
    setPending(change);
    void execute(change);
  };

  const sendInvitation = async (member: AdminTeamMember) => {
    const request = requestFence.begin(`team-member-invite-${member.memberId}`);
    setBusy('invite');
    setInvitingId(member.memberId);
    setError(null);
    const result = await requestAdminTeamInvitation(
      api,
      eventId,
      { memberId: member.memberId },
      createAdminIdempotencyKey('team-invitation'),
      request.signal,
    );
    if (!request.isCurrent()) return false;
    request.finish();
    setBusy(null);
    setInvitingId(null);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return false;
      }
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return false;
    }
    setSuccess(
      result.kind === 'success' && result.data.outcome === 'already_sent'
        ? 'Pozvánka už byla odeslána při předchozím pokusu.'
        : `Pozvánka byla odeslána na ${member.email}.`,
    );
    setReload((value) => value + 1);
    return true;
  };

  const execute = async (change: PendingChange) => {
    const request = requestFence.begin('team-member-mutation');
    setBusy('mutation');
    setError(null);
    const result = await requestAdminTeamMemberMutation(
      api,
      eventId,
      change.body,
      change.idempotencyKey,
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(null);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
        setData(null);
        setEditor(null);
        setPending(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        setEditor(null);
        setPending(null);
        setError(
          'Tým se mezitím změnil. Načetli jsme aktuální seznam; změnu připravte znovu.',
        );
        setReload((value) => value + 1);
        return;
      }
      if (!isAmbiguousAdminMutationFailure(result)) setPending(null);
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    if (result.kind !== 'success') {
      setError('Server nepotvrdil změnu člena týmu.');
      return;
    }
    const member = result.data.member;
    const message =
      result.data.outcome === 'already_applied'
        ? 'Tato změna už byla provedena při předchozím pokusu.'
        : change.body.action === 'add'
          ? 'Člen týmu byl přidán.'
          : change.body.action === 'update'
            ? 'Údaje a přístup člena byly upraveny.'
            : 'Člen byl z týmu odebrán a jeho relace byly ukončeny.';
    setSuccess(message);
    setEditor(null);
    setPending(null);
    setAttempted(false);
    setReload((value) => value + 1);
    onChanged?.();
    if (change.sendInvitation && member) {
      await sendInvitation(member);
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="team-members-title">
      <div className={styles.panelHeader}>
        <div>
          <h2 id="team-members-title">Členové týmu</h2>
          <p className={styles.muted}>
            Přidávejte uživatele, spravujte jejich administrátorský přístup a
            posílejte nebo obnovujte zvací odkazy.
          </p>
        </div>
        {canAdd ? (
          <button className={styles.button} onClick={openAdd} type="button">
            Přidat člena
          </button>
        ) : null}
      </div>

      {error && !editor ? (
        <AdminFormErrorSummary
          descriptionId="admin-team-members-error"
          heading="Správu týmu nelze dokončit"
          message={error}
        />
      ) : null}
      {success ? (
        <p className={styles.success} role="status">
          {success}
        </p>
      ) : null}

      {data ? (
        <>
          <div className={styles.summaryGrid} aria-label="Souhrn týmu">
            <article className={styles.metric}>
              <small>Členové týmu</small>
              <strong>{data.summary.total}</strong>
            </article>
            <article className={styles.metric}>
              <small>Administrátoři</small>
              <strong>{data.summary.administrators}</strong>
            </article>
            <article className={styles.metric}>
              <small>Čeká na přijetí</small>
              <strong>{data.summary.awaitingInvitation}</strong>
            </article>
          </div>
          <div className={styles.filters}>
            <label className={styles.field}>
              <span>Hledat člena</span>
              <input
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Jméno nebo e-mail"
                type="search"
                value={query}
              />
            </label>
            <label className={styles.field}>
              <span>Stav pozvánky</span>
              <select
                onChange={(event) =>
                  setStatusFilter(event.target.value as typeof statusFilter)
                }
                value={statusFilter}
              >
                <option value="all">Všechny stavy</option>
                <option value="accepted">Přístup aktivní</option>
                <option value="sent">Pozvánka odeslána</option>
                <option value="not_sent">Pozvánka neodeslána</option>
              </select>
            </label>
          </div>
          {filteredMembers.length === 0 ? (
            <p className={styles.empty}>
              {data.members.length === 0
                ? 'V týmu zatím není žádný člen.'
                : 'Žádný člen neodpovídá zvoleným filtrům.'}
            </p>
          ) : (
            <>
              <div className={styles.tableWrap} tabIndex={0}>
                <table className={styles.table}>
                  <caption>Aktivní členové organizačního týmu</caption>
                  <thead>
                    <tr>
                      <th>Člen</th>
                      <th>Přístup</th>
                      <th>Stav</th>
                      <th>Akce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMembers.map((member) => (
                      <tr key={member.memberId}>
                        <td className={styles.identityCell}>
                          <strong>{member.displayName}</strong>
                          <span>{member.email}</span>
                          {member.isCurrentActor ? <small>Vy</small> : null}
                        </td>
                        <td>
                          {member.roles
                            .map((role) => roleLabels[role])
                            .join(', ')}
                        </td>
                        <td>
                          <span className={styles.statusBadge}>
                            {invitationLabels[member.invitation.status]}
                          </span>
                        </td>
                        <td>
                          <div className={styles.actionRow}>
                            {editable ? (
                              <button
                                className={styles.secondaryButton}
                                onClick={() => openEdit(member)}
                                type="button"
                              >
                                Upravit
                              </button>
                            ) : null}
                            {editable ? (
                              <button
                                className={styles.secondaryButton}
                                disabled={
                                  busy !== null &&
                                  invitingId === member.memberId
                                }
                                onClick={() => void sendInvitation(member)}
                                type="button"
                              >
                                {invitingId === member.memberId
                                  ? 'Odesílám…'
                                  : member.invitation.status === 'not_sent'
                                    ? 'Poslat pozvánku'
                                    : 'Poslat znovu'}
                              </button>
                            ) : null}
                            {editable && !member.isCurrentActor ? (
                              <button
                                className={styles.dangerButton}
                                onClick={() => openRemove(member)}
                                type="button"
                              >
                                Odebrat
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.cards}>
                <ul className={styles.cardList}>
                  {filteredMembers.map((member) => (
                    <li className={styles.dataCard} key={member.memberId}>
                      <strong>{member.displayName}</strong>
                      <p>{member.email}</p>
                      <p>
                        {member.roles
                          .map((role) => roleLabels[role])
                          .join(', ')}
                      </p>
                      <span className={styles.statusBadge}>
                        {invitationLabels[member.invitation.status]}
                      </span>
                      <div className={styles.dialogActions}>
                        {editable ? (
                          <button
                            className={styles.secondaryButton}
                            onClick={() => openEdit(member)}
                            type="button"
                          >
                            Upravit
                          </button>
                        ) : null}
                        {editable ? (
                          <button
                            className={styles.secondaryButton}
                            disabled={invitingId === member.memberId}
                            onClick={() => void sendInvitation(member)}
                            type="button"
                          >
                            {invitingId === member.memberId
                              ? 'Odesílám…'
                              : member.invitation.status === 'not_sent'
                                ? 'Poslat pozvánku'
                                : 'Poslat znovu'}
                          </button>
                        ) : null}
                        {editable && !member.isCurrentActor ? (
                          <button
                            className={styles.dangerButton}
                            onClick={() => openRemove(member)}
                            type="button"
                          >
                            Odebrat
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </>
      ) : busy === 'list' ? (
        <p className={styles.empty} role="status">
          Načítám členy týmu…
        </p>
      ) : null}

      {editor ? (
        <AdminModal
          dismissDisabled={busy === 'mutation'}
          labelledBy="team-member-editor-title"
          onDismiss={closeEditor}
          size="wide"
        >
          <div className={styles.dialogHeader}>
            <div>
              <p className={styles.eyebrow}>
                {editor.kind === 'add'
                  ? 'Nový přístup'
                  : editor.kind === 'edit'
                    ? 'Detail člena'
                    : 'Odebrání přístupu'}
              </p>
              <h2 id="team-member-editor-title" tabIndex={-1}>
                {editor.kind === 'add'
                  ? 'Přidat člena týmu'
                  : editor.kind === 'edit'
                    ? 'Upravit člena týmu'
                    : 'Odebrat člena týmu'}
              </h2>
            </div>
            <button
              className={styles.secondaryButton}
              disabled={busy === 'mutation'}
              onClick={closeEditor}
              type="button"
            >
              Zavřít
            </button>
          </div>
          <div className={styles.dialogBody}>
            {error ? (
              <AdminFormErrorSummary
                descriptionId="admin-team-member-editor-error"
                heading="Změnu člena nelze dokončit"
                message={error}
              />
            ) : null}
            {attempted && !candidate?.success ? (
              <AdminFormErrorSummary
                descriptionId="admin-team-member-validation-error"
                heading="Zkontrolujte zadané údaje"
                message="Vyplňte jméno, platný e-mail, přístup a důvod změny o alespoň 8 znacích."
              />
            ) : null}
            {editor.kind === 'remove' ? (
              <>
                <p>
                  Odebíráte <strong>{editor.member.displayName}</strong> (
                  {editor.member.email}) z této akce. Jeho role budou zrušeny a
                  aktivní přihlášení ukončena.
                </p>
                <p className={styles.warning}>
                  Globální účet se nemaže; odebírá se pouze členství v této
                  akci.
                </p>
              </>
            ) : (
              <div className={styles.twoColumn}>
                <label className={styles.field}>
                  <span>Jméno</span>
                  <input
                    autoComplete="name"
                    data-modal-initial-focus="true"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        displayName: event.target.value,
                      }))
                    }
                    value={form.displayName}
                  />
                </label>
                <label className={styles.field}>
                  <span>E-mail</span>
                  <input
                    autoComplete="email"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    type="email"
                    value={form.email}
                  />
                  {editor.kind === 'edit' &&
                  form.email.trim().toLowerCase() !== editor.member.email ? (
                    <span className={styles.helper}>
                      Změna e-mailu ukončí stávající přihlášení a nový e-mail
                      bude potřeba ověřit pozvánkou.
                    </span>
                  ) : null}
                </label>
              </div>
            )}
            {editor.kind === 'add' ? (
              <>
                <label className={styles.field}>
                  <span>Počáteční role</span>
                  <select
                    onChange={(event) => {
                      const nextRole = event.target.value as AdminTeamRole;
                      setScopes([]);
                      setBusy(nextRole === 'organizer_admin' ? null : 'scopes');
                      setForm((current) => ({
                        ...current,
                        role: nextRole,
                        scopeId: '',
                      }));
                    }}
                    value={form.role}
                  >
                    <option value="organizer_admin">Administrátor</option>
                    {operationalRoles.map((role) => (
                      <option key={role} value={role}>
                        {roleLabels[role]}
                      </option>
                    ))}
                  </select>
                </label>
                {form.role !== 'organizer_admin' ? (
                  <label className={styles.field}>
                    <span>Povolený rozsah</span>
                    <select
                      disabled={busy === 'scopes' || scopes.length === 0}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          scopeId: event.target.value,
                        }))
                      }
                      value={form.scopeId}
                    >
                      {scopes.map((scope) => (
                        <option key={scopeId(scope)} value={scopeId(scope)}>
                          {scope.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className={styles.checkRow}>
                  <input
                    checked={form.sendInvitation}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        sendInvitation: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>Po přidání ihned odeslat zvací odkaz</span>
                </label>
              </>
            ) : null}
            {editor.kind === 'edit' ? (
              <>
                <label className={styles.checkRow}>
                  <input
                    checked={form.administrator}
                    disabled={editor.member.isCurrentActor}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        administrator: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>Administrátor – plný přístup k administraci akce</span>
                </label>
                <p className={styles.helper}>
                  Provozní role a jejich konkrétní rozsahy upravíte v části
                  „Provozní oprávnění“ pod seznamem členů.
                </p>
              </>
            ) : null}
            <label className={styles.field}>
              <span>Důvod změny</span>
              <textarea
                data-modal-initial-focus={
                  editor.kind === 'remove' ? 'true' : undefined
                }
                disabled={pending !== null}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
                value={form.reason}
              />
              <span className={styles.helper}>
                Důvod se uloží do historie změn a musí mít alespoň 8 znaků.
              </span>
            </label>
            {pending && error ? (
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
                onClick={closeEditor}
                type="button"
              >
                Zrušit a zavřít
              </button>
              <button
                className={
                  editor.kind === 'remove' ? styles.dangerButton : styles.button
                }
                disabled={busy !== null || pending !== null}
                onClick={prepare}
                type="button"
              >
                {busy === 'mutation'
                  ? 'Ukládám…'
                  : editor.kind === 'add'
                    ? 'Přidat člena'
                    : editor.kind === 'edit'
                      ? 'Uložit změny'
                      : 'Odebrat z týmu'}
              </button>
            </div>
          </div>
        </AdminModal>
      ) : null}
    </section>
  );
};
