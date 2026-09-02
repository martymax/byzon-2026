'use client';

import {
  adminParticipantListRequestSchema,
  adminParticipantUpdateRequestSchema,
  type AdminParticipantDetail,
  type AdminParticipantListItem,
  type AdminParticipantNetworkingState,
  type SupportTicketState,
} from '@byzon/domain/contracts/support';
import { AdminTechnicalDetails } from '@byzon/ui';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  requestAdminParticipantDetail,
  requestAdminParticipantInvite,
  requestAdminParticipantList,
  requestAdminParticipantUpdate,
  requestAdminSupportMutation,
} from '@/lib/admin-api';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import { supportActionLabels, ticketStateLabels } from './admin-ui-registry';
import {
  adminFailureMessage,
  createAdminIdempotencyKey,
  isStaleAdminFailure,
} from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

const participantPageSize = 100;
const participantBulkInvitationLimit = 25;
type ParticipantBulkAction = 'invite' | 'block' | 'reactivate';
const bulkActions = [
  'invite',
  'block',
  'reactivate',
] as const satisfies readonly ParticipantBulkAction[];

const networkingStateLabels: Record<AdminParticipantNetworkingState, string> = {
  enabled: 'Zapnutý',
  disabled: 'Vypnutý',
  moderated: 'Skrytý správcem',
};

const invitationStatusLabels = {
  not_sent: 'Pozvánka neodeslána',
  sent: 'Pozvánka odeslána',
  accepted: 'Přihlášení aktivováno',
} as const;

const huntingLabels = {
  know_how: 'Know-how',
  team: 'Lidé do týmu',
  investors: 'Investoři',
  business_partners: 'Obchodní partneři',
  suppliers: 'Dodavatelé',
  clients: 'Klienti',
} as const;

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value));

const ParticipantIcon = ({ children }: { readonly children: ReactNode }) => (
  <svg
    aria-hidden="true"
    fill="none"
    height="18"
    viewBox="0 0 24 24"
    width="18"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.8"
  >
    {children}
  </svg>
);

const StateBadge = ({
  children,
  tone = 'neutral',
}: {
  readonly children: ReactNode;
  readonly tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) => (
  <span className={styles.participantBadge} data-tone={tone}>
    {children}
  </span>
);

const ticketTone = (
  state: SupportTicketState,
): 'success' | 'warning' | 'danger' =>
  state === 'active' ? 'success' : state === 'blocked' ? 'warning' : 'danger';

const SelectionCheckbox = ({
  checked,
  indeterminate = false,
  label,
  onChange,
}: {
  readonly checked: boolean;
  readonly indeterminate?: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      aria-label={label}
      checked={checked}
      className={styles.participantCheckbox}
      onChange={(event) => onChange(event.target.checked)}
      ref={ref}
      type="checkbox"
    />
  );
};

export const AdminSupportWorkspace = () => {
  const { api, eventId, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const canMutate = permissions.includes('ticket:any:manage');
  const requestFence = useAdminRequestFence();
  const [query, setQuery] = useState('');
  const [ticketState, setTicketState] = useState<SupportTicketState | ''>('');
  const [networkingState, setNetworkingState] = useState<
    AdminParticipantNetworkingState | ''
  >('');
  const [items, setItems] = useState<readonly AdminParticipantListItem[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    networkingEnabled: 0,
    checkedIn: 0,
  });
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<ParticipantBulkAction | null>(
    null,
  );
  const [bulkReason, setBulkReason] = useState('');

  const load = async (append = false) => {
    const offset = append ? items.length : 0;
    const parsed = adminParticipantListRequestSchema.safeParse({
      query,
      ticketStates: ticketState ? [ticketState] : [],
      networkingStates: networkingState ? [networkingState] : [],
      limit: participantPageSize,
      offset,
    });
    if (!parsed.success) return;
    const request = requestFence.begin('participant-list');
    setBusy(true);
    setError(null);
    const result = await requestAdminParticipantList(
      api,
      eventId,
      parsed.data,
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(false);
    if (!result.ok) {
      setItems([]);
      setSelectedIds(new Set());
      if (isAdminSecurityFailure(result)) {
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    if (result.kind !== 'success') return;
    setItems((current) =>
      append ? [...current, ...result.data.items] : result.data.items,
    );
    setSummary(result.data.summary);
    setFilteredTotal(result.data.pageInfo.total);
    setHasMore(result.data.pageInfo.hasMore);
    if (!append)
      setSelectedIds((current) => {
        const visible = new Set(
          result.data.items.map(({ participantId }) => participantId),
        );
        return new Set([...current].filter((id) => visible.has(id)));
      });
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), query ? 250 : 0);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ticketState, networkingState, eventId]);

  const selected = useMemo(
    () => items.filter(({ participantId }) => selectedIds.has(participantId)),
    [items, selectedIds],
  );
  const allSelected = items.length > 0 && selected.length === items.length;
  const commonActions = bulkActions.filter((action) =>
    selected.every((participant) =>
      action === 'invite'
        ? selected.length <= participantBulkInvitationLimit &&
          participant.ticketState === 'active'
        : participant.availableActions.includes(action),
    ),
  );

  const runBulkAction = async () => {
    if (
      !bulkAction ||
      selected.length === 0 ||
      (bulkAction !== 'invite' && bulkReason.trim().length < 8)
    )
      return;
    const appliedAction = bulkAction;
    setBulkAction(null);
    setBusy(true);
    setError(null);
    const results = await Promise.all(
      selected.map((participant) =>
        appliedAction === 'invite'
          ? requestAdminParticipantInvite(
              api,
              eventId,
              participant.participantId,
              { participantId: participant.participantId },
              createAdminIdempotencyKey('participant-invite'),
            )
          : requestAdminSupportMutation(
              api,
              eventId,
              {
                participantId: participant.participantId,
                ticketId: participant.ticketId,
                action: appliedAction,
                expectedVersion: participant.ticketVersion,
                reason: bulkReason.trim(),
                targetTicketId: null,
              },
              createAdminIdempotencyKey('participant-bulk'),
            ),
      ),
    );
    const succeeded = results.filter((result) => result.ok).length;
    setBusy(false);
    setBulkReason('');
    setSelectedIds(new Set());
    setNotice(
      succeeded === selected.length
        ? appliedAction === 'invite'
          ? `Pozvánka byla odeslána ${succeeded} účastníkům.`
          : `Hromadná změna byla provedena u ${succeeded} účastníků.`
        : `${appliedAction === 'invite' ? 'Pozvánka byla odeslána' : 'Změna proběhla'} u ${succeeded} z ${selected.length} účastníků. Zkontrolujte aktuální stav seznamu.`,
    );
    await load();
  };

  return (
    <div className={styles.participantWorkspace}>
      <header className={styles.participantPageHeader}>
        <div>
          <h1>Účastníci</h1>
          <p>Kompletní přehled účastníků, jejich přístupu a networkingu.</p>
        </div>
        <Link className={styles.secondaryButton} href="/admin/reporty">
          Exportovat seznam
        </Link>
      </header>

      <section
        className={styles.participantMetrics}
        aria-label="Souhrn účastníků"
      >
        <article>
          <span>Celkem</span>
          <strong>{summary.total}</strong>
        </article>
        <article>
          <span>Aktivní přístup</span>
          <strong>{summary.active}</strong>
        </article>
        <article>
          <span>Zapnutý networking</span>
          <strong>{summary.networkingEnabled}</strong>
        </article>
        <article>
          <span>Odbavení</span>
          <strong>{summary.checkedIn}</strong>
        </article>
      </section>

      <section
        className={styles.participantListPanel}
        aria-labelledby="participant-list-title"
      >
        <div className={styles.participantListHeading}>
          <div>
            <h2 id="participant-list-title">Seznam účastníků</h2>
            <p>{filteredTotal} odpovídá aktuálním filtrům</p>
          </div>
          <button
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => void load()}
            type="button"
          >
            Obnovit
          </button>
        </div>

        <div className={styles.participantFilters} role="search">
          <label className={styles.participantSearch}>
            <span className={styles.visuallyHidden}>Filtrovat účastníky</span>
            <ParticipantIcon>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </ParticipantIcon>
            <input
              autoComplete="off"
              maxLength={80}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Jméno, e-mail, firma nebo vstupenka…"
              type="search"
              value={query}
            />
          </label>
          <label className={styles.participantFilterField}>
            <span>Vstupenka</span>
            <select
              onChange={(event) =>
                setTicketState(event.target.value as SupportTicketState | '')
              }
              value={ticketState}
            >
              <option value="">Všechny stavy</option>
              <option value="active">Aktivní</option>
              <option value="blocked">Zablokované</option>
              <option value="cancelled">Zrušené</option>
              <option value="refunded">Vrácené</option>
            </select>
          </label>
          <label className={styles.participantFilterField}>
            <span>Networking</span>
            <select
              onChange={(event) =>
                setNetworkingState(
                  event.target.value as AdminParticipantNetworkingState | '',
                )
              }
              value={networkingState}
            >
              <option value="">Všechny stavy</option>
              <option value="enabled">Zapnutý</option>
              <option value="disabled">Vypnutý</option>
              <option value="moderated">Skrytý správcem</option>
            </select>
          </label>
          {query || ticketState || networkingState ? (
            <button
              className={styles.participantClearFilters}
              onClick={() => {
                setQuery('');
                setTicketState('');
                setNetworkingState('');
              }}
              type="button"
            >
              Zrušit filtry
            </button>
          ) : null}
        </div>

        {selected.length > 0 ? (
          <div
            className={styles.participantBulkBar}
            role="region"
            aria-label="Hromadné akce"
          >
            <strong>Vybráno: {selected.length}</strong>
            <span>
              {selected.length > participantBulkInvitationLimit
                ? `Pozvánky lze odeslat nejvýše ${participantBulkInvitationLimit} účastníkům najednou; ostatní společné akce zůstávají dostupné.`
                : commonActions.length > 0
                  ? 'Dostupné akce platí pro celý výběr.'
                  : 'Vybraní účastníci nemají společnou stavovou akci.'}
            </span>
            <div>
              {canMutate && commonActions.includes('invite') ? (
                <button
                  className={styles.button}
                  onClick={() => setBulkAction('invite')}
                  type="button"
                >
                  Poslat pozvánku
                </button>
              ) : null}
              {canMutate && commonActions.includes('block') ? (
                <button
                  className={styles.dangerButton}
                  onClick={() => setBulkAction('block')}
                  type="button"
                >
                  Zablokovat přístup
                </button>
              ) : null}
              {canMutate && commonActions.includes('reactivate') ? (
                <button
                  className={styles.button}
                  onClick={() => setBulkAction('reactivate')}
                  type="button"
                >
                  Obnovit přístup
                </button>
              ) : null}
              <button
                className={styles.secondaryButton}
                onClick={() => setSelectedIds(new Set())}
                type="button"
              >
                Zrušit výběr
              </button>
            </div>
          </div>
        ) : null}

        {error ? (
          <section className={styles.errorSummary} role="alert">
            <p>{error}</p>
          </section>
        ) : null}
        {notice ? (
          <section className={styles.success} role="status">
            <p>{notice}</p>
          </section>
        ) : null}
        {busy && items.length === 0 ? (
          <p className={styles.participantLoading} role="status">
            Načítám účastníky…
          </p>
        ) : null}
        {!busy && !error && items.length === 0 ? (
          <div className={styles.participantEmpty}>
            <strong>Žádný účastník neodpovídá filtrům.</strong>
            <span>Zkuste filtry zrušit nebo upravit hledaný výraz.</span>
          </div>
        ) : null}

        {items.length > 0 ? (
          <>
            <div className={styles.participantTableWrap}>
              <table className={styles.participantTable}>
                <caption className={styles.visuallyHidden}>
                  Účastníci akce
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <SelectionCheckbox
                        checked={allSelected}
                        indeterminate={selected.length > 0 && !allSelected}
                        label="Vybrat všechny zobrazené účastníky"
                        onChange={(checked) =>
                          setSelectedIds(
                            checked
                              ? new Set(
                                  items.map(
                                    ({ participantId }) => participantId,
                                  ),
                                )
                              : new Set(),
                          )
                        }
                      />
                    </th>
                    <th scope="col">Účastník</th>
                    <th scope="col">Firma a pozice</th>
                    <th scope="col">Vstupenka</th>
                    <th scope="col">Networking</th>
                    <th scope="col">Aktivita</th>
                    <th scope="col">
                      <span className={styles.visuallyHidden}>Detail</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((participant) => (
                    <tr key={participant.participantId}>
                      <td>
                        <SelectionCheckbox
                          checked={selectedIds.has(participant.participantId)}
                          label={`Vybrat ${participant.displayName}`}
                          onChange={(checked) =>
                            setSelectedIds((current) => {
                              const next = new Set(current);
                              if (checked) next.add(participant.participantId);
                              else next.delete(participant.participantId);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className={styles.participantIdentityCell}>
                        <Link
                          href={`/admin/ucastnici/${participant.participantId}`}
                        >
                          {participant.displayName}
                        </Link>
                        <span>{participant.contactEmail}</span>
                      </td>
                      <td className={styles.participantCompanyCell}>
                        <strong>{participant.company || '—'}</strong>
                        <span>{participant.jobTitle || 'Neuvedeno'}</span>
                      </td>
                      <td>
                        <StateBadge tone={ticketTone(participant.ticketState)}>
                          {ticketStateLabels[participant.ticketState]}
                        </StateBadge>
                        <small className={styles.participantCellNote}>
                          ••{participant.referenceSuffix}
                        </small>
                        <small className={styles.participantCellNote}>
                          {
                            invitationStatusLabels[
                              participant.invitation.status
                            ]
                          }
                        </small>
                      </td>
                      <td>
                        <StateBadge
                          tone={
                            participant.networkingState === 'enabled'
                              ? 'success'
                              : participant.networkingState === 'moderated'
                                ? 'warning'
                                : 'neutral'
                          }
                        >
                          {networkingStateLabels[participant.networkingState]}
                        </StateBadge>
                      </td>
                      <td>
                        <strong>
                          {participant.reservationCount} rezervací
                        </strong>
                        <span className={styles.participantCellNote}>
                          {participant.checkedIn ? 'Odbaven/a' : 'Neodbaven/a'}
                        </span>
                      </td>
                      <td>
                        <Link
                          aria-label={`Zobrazit detail: ${participant.displayName}`}
                          className={styles.participantDetailLink}
                          href={`/admin/ucastnici/${participant.participantId}`}
                        >
                          <ParticipantIcon>
                            <path d="m9 18 6-6-6-6" />
                          </ParticipantIcon>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className={styles.participantCards}>
              {items.map((participant) => (
                <li key={participant.participantId}>
                  <div className={styles.participantCardHeader}>
                    <SelectionCheckbox
                      checked={selectedIds.has(participant.participantId)}
                      label={`Vybrat ${participant.displayName}`}
                      onChange={(checked) =>
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (checked) next.add(participant.participantId);
                          else next.delete(participant.participantId);
                          return next;
                        })
                      }
                    />
                    <div>
                      <Link
                        href={`/admin/ucastnici/${participant.participantId}`}
                      >
                        {participant.displayName}
                      </Link>
                      <span>{participant.contactEmail}</span>
                    </div>
                    <ParticipantIcon>
                      <path d="m9 18 6-6-6-6" />
                    </ParticipantIcon>
                  </div>
                  <div className={styles.participantCardBody}>
                    <p>
                      <span>Firma</span>
                      <strong>{participant.company || '—'}</strong>
                    </p>
                    <p>
                      <span>Vstupenka</span>
                      <StateBadge tone={ticketTone(participant.ticketState)}>
                        {ticketStateLabels[participant.ticketState]}
                      </StateBadge>
                    </p>
                    <p>
                      <span>Networking</span>
                      <strong>
                        {networkingStateLabels[participant.networkingState]}
                      </strong>
                    </p>
                    <p>
                      <span>Přístup</span>
                      <strong>
                        {invitationStatusLabels[participant.invitation.status]}
                      </strong>
                    </p>
                    <p>
                      <span>Rezervace</span>
                      <strong>{participant.reservationCount}</strong>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {hasMore ? (
          <div className={styles.participantLoadMore}>
            <p>
              Zobrazeno {items.length} z {filteredTotal} odpovídajících
              účastníků.
            </p>
            <button
              className={styles.secondaryButton}
              disabled={busy}
              onClick={() => void load(true)}
              type="button"
            >
              {busy ? 'Načítám…' : 'Načíst další účastníky'}
            </button>
          </div>
        ) : null}
      </section>

      {bulkAction ? (
        <AdminConfirmDialog
          acknowledgement={
            bulkAction === 'invite'
              ? 'Potvrzuji odeslání jednorázových odkazů vybraným účastníkům.'
              : 'Rozumím dopadu této změny na všechny vybrané účastníky.'
          }
          confirmLabel={
            bulkAction === 'invite'
              ? 'Odeslat pozvánky'
              : supportActionLabels[bulkAction]
          }
          confirmDisabled={
            bulkAction !== 'invite' && bulkReason.trim().length < 8
          }
          danger={bulkAction === 'block'}
          description={
            bulkAction === 'invite'
              ? `${selected.length} vybraným účastníkům odešleme e-mail s jednorázovým odkazem do jejich účastnické části. Odkaz platí 5 minut.`
              : `Změna se provede u ${selected.length} vybraných účastníků.`
          }
          impact={
            bulkAction === 'invite' ? undefined : (
              <label className={styles.field}>
                <span>Důvod změny</span>
                <textarea
                  minLength={8}
                  onChange={(event) => setBulkReason(event.target.value)}
                  placeholder="Alespoň 8 znaků; důvod se uloží do historie změn."
                  value={bulkReason}
                />
              </label>
            )
          }
          onConfirm={() => void runBulkAction()}
          onDismiss={() => {
            setBulkAction(null);
            setBulkReason('');
          }}
          title={
            bulkAction === 'invite'
              ? 'Odeslat vybraným účastníkům pozvánky?'
              : bulkAction === 'block'
                ? 'Zablokovat vybrané přístupy?'
                : 'Obnovit vybrané přístupy?'
          }
        />
      ) : null}
    </div>
  );
};

const detailToDraft = (detail: AdminParticipantDetail) => ({
  firstName: detail.firstName,
  lastName: detail.lastName,
  contactEmail: detail.contactEmail,
  phone: detail.phone ?? '',
  company: detail.company,
  jobTitle: detail.jobTitle,
  introduction: detail.introduction,
  linkedinUrl: detail.linkedinUrl ?? '',
  todayHunting: [...detail.todayHunting],
  networkingEnabled: detail.networkingEnabled,
  moderationStatus: detail.moderationStatus,
});

export const AdminParticipantDetailWorkspace = ({
  participantId,
}: {
  readonly participantId: string;
}) => {
  const { api, eventId, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const canMutate = permissions.includes('ticket:any:manage');
  const requestFence = useAdminRequestFence();
  const [detail, setDetail] = useState<AdminParticipantDetail | null>(null);
  const [draft, setDraft] = useState<ReturnType<typeof detailToDraft> | null>(
    null,
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'load' | 'save' | 'action' | null>('load');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [ticketAction, setTicketAction] = useState<
    'block' | 'reactivate' | null
  >(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const load = async (staleMessage?: string) => {
    const request = requestFence.begin('participant-detail');
    setBusy('load');
    setError(null);
    const result = await requestAdminParticipantDetail(
      api,
      eventId,
      participantId,
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(null);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
        setDetail(null);
        setDraft(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    if (result.kind !== 'success') return;
    setDetail(result.data);
    setDraft(detailToDraft(result.data));
    if (staleMessage) setError(staleMessage);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, participantId]);

  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (
        !detail ||
        !draft ||
        JSON.stringify(draft) === JSON.stringify(detailToDraft(detail))
      )
        return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, [detail, draft]);

  const save = async () => {
    if (!detail || !draft || !canMutate) return;
    const parsed = adminParticipantUpdateRequestSchema.safeParse({
      participantId,
      expectedProfileVersion: detail.profileVersion,
      reason,
      profile: {
        ...draft,
        phone: draft.phone || null,
        linkedinUrl: draft.linkedinUrl || null,
      },
    });
    if (!parsed.success) {
      setError(
        'Zkontrolujte vyplněná pole. Důvod změny musí mít alespoň 8 znaků, telefon musí být v mezinárodním formátu.',
      );
      return;
    }
    const request = requestFence.begin('participant-update');
    setBusy('save');
    setError(null);
    setSuccess(null);
    const result = await requestAdminParticipantUpdate(
      api,
      eventId,
      participantId,
      parsed.data,
      createAdminIdempotencyKey('participant-update'),
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(null);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
        setDetail(null);
        setDraft(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        await load(
          'Profil mezitím změnil někdo jiný. Načetli jsme aktuální údaje; změny zkontrolujte znovu.',
        );
        return;
      }
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    if (result.kind !== 'success') return;
    setDetail(result.data.detail);
    setDraft(detailToDraft(result.data.detail));
    setReason('');
    setSuccess('Změny účastníka byly uloženy.');
  };

  const mutateTicket = async () => {
    if (!detail || !ticketAction || reason.trim().length < 8) return;
    const appliedAction = ticketAction;
    setTicketAction(null);
    setBusy('action');
    const result = await requestAdminSupportMutation(
      api,
      eventId,
      {
        participantId,
        ticketId: detail.ticketId,
        action: appliedAction,
        expectedVersion: detail.ticket.version,
        reason: reason.trim(),
        targetTicketId: null,
      },
      createAdminIdempotencyKey('participant-ticket'),
    );
    setBusy(null);
    if (!result.ok) {
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    setReason('');
    setSuccess(
      appliedAction === 'block'
        ? 'Přístup byl zablokován.'
        : 'Přístup byl obnoven.',
    );
    await load();
  };

  const sendInvitation = async () => {
    if (!detail || !canMutate) return;
    setInviteOpen(false);
    setBusy('action');
    setError(null);
    setSuccess(null);
    const result = await requestAdminParticipantInvite(
      api,
      eventId,
      participantId,
      { participantId },
      createAdminIdempotencyKey('participant-invite'),
    );
    setBusy(null);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
        setDetail(null);
        setDraft(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    if (result.kind !== 'success') return;
    setDetail({ ...detail, invitation: result.data.invitation });
    setSuccess(`Pozvánka byla odeslána na ${detail.contactEmail}.`);
  };

  if (busy === 'load' && !detail)
    return (
      <p className={styles.participantLoading} role="status">
        Načítám detail účastníka…
      </p>
    );
  if (!detail || !draft)
    return (
      <div className={styles.stack}>
        <Link className={styles.participantBackLink} href="/admin/ucastnici">
          ← Zpět na účastníky
        </Link>
        <section className={styles.errorSummary} role="alert">
          <h1>Detail nelze zobrazit</h1>
          <p>{error ?? 'Účastník není dostupný.'}</p>
        </section>
      </div>
    );

  const displayName = `${detail.firstName} ${detail.lastName}`;
  const isDirty =
    JSON.stringify(draft) !== JSON.stringify(detailToDraft(detail));
  return (
    <div className={styles.participantDetailWorkspace}>
      <Link className={styles.participantBackLink} href="/admin/ucastnici">
        ← Zpět na účastníky
      </Link>
      <header className={styles.participantDetailHeader}>
        <div className={styles.participantAvatar} aria-hidden="true">
          {detail.firstName.slice(0, 1)}
          {detail.lastName.slice(0, 1)}
        </div>
        <div>
          <p className={styles.eyebrow}>Detail účastníka</p>
          <h1>{displayName}</h1>
          <p>
            {detail.contactEmail}
            {detail.company ? ` · ${detail.company}` : ''}
          </p>
        </div>
        <StateBadge tone={ticketTone(detail.ticket.state)}>
          {ticketStateLabels[detail.ticket.state]}
        </StateBadge>
      </header>

      {error ? (
        <section className={styles.errorSummary} role="alert">
          <p>{error}</p>
        </section>
      ) : null}
      {success ? (
        <section className={styles.success} role="status">
          <p>{success}</p>
        </section>
      ) : null}

      <div className={styles.participantDetailLayout}>
        <main className={styles.participantDetailMain}>
          <section
            className={styles.participantDetailSection}
            aria-labelledby="basic-data-title"
          >
            <div className={styles.participantSectionHeading}>
              <div>
                <h2 id="basic-data-title">Základní údaje</h2>
                <p>Identita a kontaktní údaje používané v aplikaci.</p>
              </div>
            </div>
            <div className={styles.participantFormGrid}>
              <label className={styles.field}>
                <span>Jméno</span>
                <input
                  disabled={!canMutate}
                  maxLength={128}
                  onChange={(event) =>
                    setDraft({ ...draft, firstName: event.target.value })
                  }
                  value={draft.firstName}
                />
              </label>
              <label className={styles.field}>
                <span>Příjmení</span>
                <input
                  disabled={!canMutate}
                  maxLength={128}
                  onChange={(event) =>
                    setDraft({ ...draft, lastName: event.target.value })
                  }
                  value={draft.lastName}
                />
              </label>
              <label className={styles.field}>
                <span>E-mail</span>
                <input
                  autoComplete="email"
                  disabled={!canMutate}
                  onChange={(event) =>
                    setDraft({ ...draft, contactEmail: event.target.value })
                  }
                  type="email"
                  value={draft.contactEmail}
                />
              </label>
              <label className={styles.field}>
                <span>Telefon</span>
                <input
                  autoComplete="tel"
                  disabled={!canMutate}
                  onChange={(event) =>
                    setDraft({ ...draft, phone: event.target.value })
                  }
                  placeholder="+420…"
                  type="tel"
                  value={draft.phone}
                />
              </label>
              <label className={styles.field}>
                <span>Firma</span>
                <input
                  disabled={!canMutate}
                  maxLength={160}
                  onChange={(event) =>
                    setDraft({ ...draft, company: event.target.value })
                  }
                  value={draft.company}
                />
              </label>
              <label className={styles.field}>
                <span>Pozice</span>
                <input
                  disabled={!canMutate}
                  maxLength={160}
                  onChange={(event) =>
                    setDraft({ ...draft, jobTitle: event.target.value })
                  }
                  value={draft.jobTitle}
                />
              </label>
            </div>
          </section>

          <section
            className={styles.participantDetailSection}
            aria-labelledby="networking-data-title"
          >
            <div className={styles.participantSectionHeading}>
              <div>
                <h2 id="networking-data-title">Networking</h2>
                <p>Veřejný profil a jeho viditelnost v adresáři účastníků.</p>
              </div>
              <label className={styles.participantSwitch}>
                <input
                  checked={draft.networkingEnabled}
                  disabled={!canMutate}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      networkingEnabled: event.target.checked,
                    })
                  }
                  type="checkbox"
                />
                <span>{draft.networkingEnabled ? 'Zapnutý' : 'Vypnutý'}</span>
              </label>
            </div>
            <div className={styles.participantFormGrid}>
              <label
                className={`${styles.field} ${styles.participantWideField}`}
              >
                <span>Představení</span>
                <textarea
                  disabled={!canMutate}
                  maxLength={1000}
                  onChange={(event) =>
                    setDraft({ ...draft, introduction: event.target.value })
                  }
                  value={draft.introduction}
                />
              </label>
              <label className={styles.field}>
                <span>LinkedIn</span>
                <input
                  disabled={!canMutate}
                  onChange={(event) =>
                    setDraft({ ...draft, linkedinUrl: event.target.value })
                  }
                  placeholder="https://www.linkedin.com/in/…"
                  type="url"
                  value={draft.linkedinUrl}
                />
              </label>
              <label className={styles.field}>
                <span>Moderování profilu</span>
                <select
                  disabled={!canMutate}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      moderationStatus: event.target.value as
                        'visible' | 'hidden',
                    })
                  }
                  value={draft.moderationStatus}
                >
                  <option value="visible">Profil je v pořádku</option>
                  <option value="hidden">Skrýt profil správcem</option>
                </select>
              </label>
              <fieldset
                className={`${styles.fieldset} ${styles.participantWideField}`}
              >
                <legend>Co dnes hledá</legend>
                <div className={styles.participantChoiceGrid}>
                  {Object.entries(huntingLabels).map(([value, label]) => (
                    <label key={value}>
                      <input
                        checked={draft.todayHunting.includes(
                          value as keyof typeof huntingLabels,
                        )}
                        disabled={!canMutate}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            todayHunting: event.target.checked
                              ? [
                                  ...draft.todayHunting,
                                  value as keyof typeof huntingLabels,
                                ]
                              : draft.todayHunting.filter(
                                  (item) => item !== value,
                                ),
                          })
                        }
                        type="checkbox"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </section>

          <section
            className={styles.participantDetailSection}
            aria-labelledby="reservations-title"
          >
            <div className={styles.participantSectionHeading}>
              <div>
                <h2 id="reservations-title">Rezervace</h2>
                <p>Aktivity spojené s tímto účastníkem.</p>
              </div>
              <strong>{detail.reservations.length}</strong>
            </div>
            {detail.reservations.length > 0 ? (
              <ul className={styles.participantReservationList}>
                {detail.reservations.map((reservation) => (
                  <li key={reservation.reservationId}>
                    <div>
                      <strong>{reservation.title}</strong>
                      <span>{formatDateTime(reservation.startsAt)}</span>
                    </div>
                    <StateBadge
                      tone={
                        reservation.status === 'confirmed'
                          ? 'success'
                          : 'neutral'
                      }
                    >
                      {reservation.status === 'confirmed'
                        ? 'Potvrzeno'
                        : 'Zrušeno'}
                    </StateBadge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>Účastník nemá žádné rezervace.</p>
            )}
          </section>
        </main>

        <aside
          className={styles.participantDetailAside}
          aria-label="Provozní údaje"
        >
          <section>
            <h2>Vstupenka a přístup</h2>
            <dl>
              <div>
                <dt>Stav</dt>
                <dd>{ticketStateLabels[detail.ticket.state]}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd>••{detail.ticket.referenceSuffix}</dd>
              </div>
              <div>
                <dt>Přístup</dt>
                <dd>
                  {detail.invitation.status === 'accepted'
                    ? 'Přihlášení aktivováno'
                    : detail.invitation.status === 'sent'
                      ? 'Pozvánka odeslána'
                      : 'Pozvánka neodeslána'}
                </dd>
              </div>
              {detail.invitation.lastSentAt ? (
                <div>
                  <dt>Poslední pozvánka</dt>
                  <dd>{formatDateTime(detail.invitation.lastSentAt)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Onboarding</dt>
                <dd>
                  {detail.onboardingCompleted ? 'Dokončen' : 'Nedokončen'}
                </dd>
              </div>
              <div>
                <dt>Členství</dt>
                <dd>
                  {detail.membershipStatus === 'active'
                    ? 'Aktivní'
                    : detail.membershipStatus === 'suspended'
                      ? 'Pozastavené'
                      : 'Odebrané'}
                </dd>
              </div>
            </dl>
            {canMutate && detail.ticket.state === 'active' ? (
              <button
                className={styles.button}
                disabled={busy !== null || isDirty}
                onClick={() => setInviteOpen(true)}
                title={
                  isDirty
                    ? 'Před odesláním pozvánky nejprve uložte změny profilu.'
                    : undefined
                }
                type="button"
              >
                {busy === 'action'
                  ? 'Odesílám…'
                  : detail.invitation.status === 'not_sent'
                    ? 'Poslat pozvánku'
                    : detail.invitation.status === 'sent'
                      ? 'Poslat pozvánku znovu'
                      : 'Poslat přihlašovací odkaz'}
              </button>
            ) : null}
            {canMutate && detail.ticket.availableActions.includes('block') ? (
              <button
                className={styles.dangerButton}
                onClick={() => setTicketAction('block')}
                type="button"
              >
                Zablokovat přístup
              </button>
            ) : null}
            {canMutate &&
            detail.ticket.availableActions.includes('reactivate') ? (
              <button
                className={styles.button}
                onClick={() => setTicketAction('reactivate')}
                type="button"
              >
                Obnovit přístup
              </button>
            ) : null}
          </section>
          <section>
            <h2>Účast na místě</h2>
            <dl>
              <div>
                <dt>Odbavení</dt>
                <dd>{detail.checkIn ? 'Ano' : 'Ne'}</dd>
              </div>
              {detail.checkIn ? (
                <div>
                  <dt>Čas odbavení</dt>
                  <dd>{formatDateTime(detail.checkIn.occurredAt)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
          <AdminTechnicalDetails>
            <dl className={styles.detailList}>
              <dt>ID účastníka</dt>
              <dd>{detail.participantId}</dd>
              <dt>
                {detail.ticket.source === 'simpleshop'
                  ? 'ID záznamu SimpleShop'
                  : 'ID vstupenky'}
              </dt>
              <dd>{detail.ticketId}</dd>
              <dt>Vytvořeno</dt>
              <dd>{formatDateTime(detail.createdAt)}</dd>
              <dt>Upraveno</dt>
              <dd>{formatDateTime(detail.updatedAt)}</dd>
            </dl>
          </AdminTechnicalDetails>
        </aside>
      </div>

      {canMutate ? (
        <div className={styles.participantSaveBar}>
          <div>
            <strong>
              {isDirty ? 'Máte neuložené změny' : 'Všechny změny jsou uložené'}
            </strong>
            <span>Důvod se uloží do historie změn.</span>
          </div>
          <label className={styles.field}>
            <span>Důvod změny</span>
            <input
              minLength={8}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Např. oprava na žádost účastníka"
              value={reason}
            />
          </label>
          <button
            className={styles.button}
            disabled={!isDirty || busy !== null || reason.trim().length < 8}
            onClick={() => void save()}
            type="button"
          >
            {busy === 'save' ? 'Ukládám…' : 'Uložit změny'}
          </button>
        </div>
      ) : (
        <p className={styles.callout}>
          Údaje můžete zobrazit, ale nemáte oprávnění je měnit.
        </p>
      )}

      {ticketAction ? (
        <AdminConfirmDialog
          acknowledgement="Rozumím dopadu změny na přístup účastníka."
          confirmLabel={
            ticketAction === 'block' ? 'Zablokovat přístup' : 'Obnovit přístup'
          }
          confirmDisabled={reason.trim().length < 8}
          danger={ticketAction === 'block'}
          description={
            ticketAction === 'block'
              ? 'Účastník ztratí přístup a jeho aktivní rezervace budou zrušeny.'
              : 'Účastník znovu získá přístup; zrušené rezervace se neobnoví.'
          }
          impact={
            <label className={styles.field}>
              <span>Důvod změny</span>
              <textarea
                minLength={8}
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
            </label>
          }
          onConfirm={() => void mutateTicket()}
          onDismiss={() => setTicketAction(null)}
          title={
            ticketAction === 'block'
              ? 'Zablokovat přístup?'
              : 'Obnovit přístup?'
          }
        />
      ) : null}

      {inviteOpen ? (
        <AdminConfirmDialog
          acknowledgement="Potvrzuji odeslání jednorázového odkazu tomuto účastníkovi."
          confirmLabel="Odeslat pozvánku"
          description={`Na ${detail.contactEmail} odešleme e-mail s jednorázovým odkazem do účastnické části. Odkaz platí 5 minut.`}
          onConfirm={() => void sendInvitation()}
          onDismiss={() => setInviteOpen(false)}
          title={
            detail.invitation.status === 'not_sent'
              ? 'Poslat účastníkovi pozvánku?'
              : 'Poslat nový přihlašovací odkaz?'
          }
        />
      ) : null}
    </div>
  );
};
