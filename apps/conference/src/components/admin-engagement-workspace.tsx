'use client';

import {
  adminEngagementMutationRequestSchema,
  type AdminEngagementFeatures,
  type AdminEngagementMutationRequest,
  type AdminEngagementOverview,
  type AdminEngagementSession,
} from '@byzon/domain/contracts/admin-engagement';
import type { AdminPermission } from '@byzon/domain/contracts/admin';
import { useEffect, useMemo, useState } from 'react';

import {
  requestAdminEngagementMutation,
  requestAdminEngagementOverview,
} from '@/lib/admin-api';

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

type PendingMutation = Readonly<{
  body: AdminEngagementMutationRequest;
  idempotencyKey: string;
  title: string;
  description: string;
  acknowledgement: string;
  confirmLabel: string;
  danger: boolean;
}>;

const featureLabels: ReadonlyArray<{
  key: keyof AdminEngagementFeatures;
  title: string;
  description: string;
}> = [
  {
    key: 'networkingEnabled',
    title: 'Networking',
    description:
      'Zpřístupní adresář pouze lidem, kteří networking sami výslovně zapnuli.',
  },
  {
    key: 'questionsEnabled',
    title: 'Otázky pro řečníky',
    description:
      'Globální pojistka. Konkrétní přednášky se povolují samostatně níže.',
  },
  {
    key: 'ratingsEnabled',
    title: 'Hodnocení programu',
    description:
      'Po skončení přednášky umožní účastníkovi odeslat právě jedno hodnocení.',
  },
];

const requiredPermissions = [
  'event:settings:manage',
  'participant:operational:read',
  'program:manage',
  'role:manage',
] as const satisfies readonly AdminPermission[];

const sameFeatures = (
  left: AdminEngagementFeatures,
  right: AdminEngagementFeatures,
) => featureLabels.every(({ key }) => left[key] === right[key]);

const formatSessionTime = (value: string, timezone: string): string =>
  new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));

const sessionStatusLabel = (status: AdminEngagementSession['status']) =>
  status === 'published'
    ? 'Publikováno'
    : status === 'draft'
      ? 'Koncept'
      : status === 'cancelled'
        ? 'Zrušeno'
        : 'Archivováno';

export const AdminEngagementWorkspace = () => {
  const { api, eventId, eventTimezone, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const [overview, setOverview] = useState<AdminEngagementOverview | null>(
    null,
  );
  const [draftFeatures, setDraftFeatures] =
    useState<AdminEngagementFeatures | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'read' | 'mutation' | null>('read');
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMutation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [reload, setReload] = useState(0);

  const hasRequiredPermissions = requiredPermissions.every((permission) =>
    permissions.includes(permission),
  );

  useEffect(() => {
    if (!hasRequiredPermissions) return;
    const request = requestFence.begin('engagement-overview');
    void requestAdminEngagementOverview(api, eventId, request.signal).then(
      (result) => {
        if (!request.isCurrent()) return;
        request.finish();
        setBusy(null);
        if (!result.ok) {
          setOverview(null);
          setDraftFeatures(null);
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
        if (result.kind === 'success') {
          setError(null);
          setOverview(result.data);
          setDraftFeatures(result.data.features);
          setSelectedSessionId((current) =>
            result.data.sessions.some(({ sessionId }) => sessionId === current)
              ? current
              : (result.data.sessions.find(
                  ({ status }) =>
                    status !== 'cancelled' && status !== 'archived',
                )?.sessionId ?? ''),
          );
        }
      },
    );
    return () => requestFence.cancel('engagement-overview');
  }, [
    api,
    eventId,
    hasRequiredPermissions,
    invalidateSensitive,
    reload,
    requestFence,
  ]);

  const selectedSession = overview?.sessions.find(
    ({ sessionId }) => sessionId === selectedSessionId,
  );
  const availableCandidates = useMemo(() => {
    if (!overview || !selectedSession) return [];
    const assigned = new Set(
      selectedSession.moderators.map(({ userId }) => userId),
    );
    return overview.moderatorCandidates.filter(
      ({ userId }) => !assigned.has(userId),
    );
  }, [overview, selectedSession]);

  const effectiveSelectedCandidateId = availableCandidates.some(
    ({ userId }) => userId === selectedCandidateId,
  )
    ? selectedCandidateId
    : (availableCandidates[0]?.userId ?? '');

  const featuresDirty =
    overview !== null &&
    draftFeatures !== null &&
    !sameFeatures(overview.features, draftFeatures);
  const reasonValid = reason.trim().length >= 8;
  const validationFailed = attempted && !reasonValid;
  const moderatorAssignmentAllowed =
    overview?.features.questionsEnabled === true &&
    selectedSession?.questionsEnabled === true &&
    selectedSession.status !== 'cancelled' &&
    selectedSession.status !== 'archived';

  const queue = (
    body: AdminEngagementMutationRequest,
    copy: Omit<PendingMutation, 'body' | 'idempotencyKey'>,
  ) => {
    setAttempted(true);
    const parsed = adminEngagementMutationRequestSchema.safeParse(body);
    if (!parsed.success) return;
    setPending({
      ...copy,
      body: parsed.data,
      idempotencyKey: createAdminIdempotencyKey('engagement'),
    });
    setConfirming(true);
    setAmbiguous(false);
    setError(null);
  };

  const queueFeatureUpdate = () => {
    if (!overview || !draftFeatures) return;
    queue(
      {
        action: 'update_features',
        expectedSettingsVersion: overview.settingsVersion,
        features: draftFeatures,
        reason,
      },
      {
        title: 'Uložit dostupnost interaktivních funkcí?',
        description:
          'Změna se projeví pro celou akci a může okamžitě skrýt nebo zpřístupnit účastnické funkce.',
        acknowledgement:
          'Ověřil/a jsem dopad na účastníky a chci změnu uložit do historie změn.',
        confirmLabel: 'Uložit dostupnost',
        danger:
          overview.features.networkingEnabled &&
          !draftFeatures.networkingEnabled,
      },
    );
  };

  const queueSessionUpdate = (session: AdminEngagementSession) => {
    const enabled = !session.questionsEnabled;
    queue(
      {
        action: 'set_session_questions',
        sessionId: session.sessionId,
        expectedSessionVersion: session.version,
        enabled,
        reason,
      },
      {
        title: `${enabled ? 'Povolit' : 'Zakázat'} otázky pro přednášku?`,
        description: `${session.title} · změna se projeví po potvrzení a novém načtení aktuálního stavu.`,
        acknowledgement:
          'Potvrzuji správnou přednášku a dopad změny na účastníky i moderátory.',
        confirmLabel: enabled ? 'Povolit otázky' : 'Zakázat otázky',
        danger: !enabled,
      },
    );
  };

  const queueModeratorAssignment = () => {
    if (!overview || !selectedSession || !effectiveSelectedCandidateId) return;
    const candidate = availableCandidates.find(
      ({ userId }) => userId === effectiveSelectedCandidateId,
    );
    if (!candidate || !moderatorAssignmentAllowed) return;
    queue(
      {
        action: 'assign_moderator',
        sessionId: selectedSession.sessionId,
        userId: candidate.userId,
        expectedAssignmentsVersion: overview.assignmentsVersion,
        reason,
      },
      {
        title: 'Přiřadit moderátora?',
        description: `${candidate.displayName} bude moderovat přednášku „${selectedSession.title}“.`,
        acknowledgement:
          'Ověřil/a jsem osobu i přednášku a chci přiřazení uložit do historie změn.',
        confirmLabel: 'Přiřadit moderátora',
        danger: false,
      },
    );
  };

  const queueModeratorRemoval = (
    session: AdminEngagementSession,
    userId: string,
    displayName: string,
  ) => {
    if (!overview) return;
    queue(
      {
        action: 'remove_moderator',
        sessionId: session.sessionId,
        userId,
        expectedAssignmentsVersion: overview.assignmentsVersion,
        reason,
      },
      {
        title: 'Odebrat moderátora?',
        description: `${displayName} ztratí moderátorský přístup k přednášce „${session.title}“.`,
        acknowledgement:
          'Ověřil/a jsem osobu i přednášku a chci přístup odebrat.',
        confirmLabel: 'Odebrat moderátora',
        danger: true,
      },
    );
  };

  const execute = async (attempt: PendingMutation) => {
    const request = requestFence.begin('engagement-mutation');
    setBusy('mutation');
    setConfirming(false);
    setError(null);
    setSuccess(null);
    const result = await requestAdminEngagementMutation(
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
        setPending(null);
        setOverview(null);
        setDraftFeatures(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (isStaleAdminFailure(result.failure)) {
        setBusy('read');
        setPending(null);
        setAmbiguous(false);
        setError(
          `${adminFailureMessage(result.failure, result.metadata?.requestId)} Načítám aktuální stav.`,
        );
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
      setSuccess(
        result.data.outcome === 'already_applied'
          ? 'Server potvrdil, že stejný stav už platí.'
          : 'Změna byla bezpečně uložena do historie změn.',
      );
      setPending(null);
      setAmbiguous(false);
      setAttempted(false);
      setReason('');
      setBusy('read');
      setReload((value) => value + 1);
    }
  };

  if (!hasRequiredPermissions) {
    return (
      <section className={styles.forbidden} role="alert">
        <h1>Interaktivní funkce nejsou dostupné</h1>
        <p>
          Tato obrazovka vyžaduje správu nastavení, programu, rolí a bezpečný
          provozní přehled účastníků.
        </p>
      </section>
    );
  }

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>Interakce účastníků</p>
        <h1>Networking, otázky a hodnocení</h1>
        <p>
          Všechny funkce jsou ve výchozím stavu vypnuté. Tato část vyžaduje
          připojení; změny platí jen pro tuto akci a po potvrzení se zapíší do
          historie změn.
        </p>
      </header>

      {error ? (
        <>
          <AdminFormErrorSummary
            descriptionId="admin-engagement-error"
            heading="Změnu nyní nelze dokončit"
            message={error}
          />
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
        </>
      ) : null}
      {success ? (
        <p className={styles.success} role="status">
          {success}
        </p>
      ) : null}

      {!overview || !draftFeatures ? (
        <section
          aria-busy={busy === 'read'}
          className={styles.panel}
          role="status"
        >
          <p>
            {busy === 'read'
              ? 'Načítám aktuální nastavení interakcí…'
              : 'Nastavení interakcí není k dispozici.'}
          </p>
          {busy !== 'read' ? (
            <button
              className={styles.secondaryButton}
              onClick={() => {
                setBusy('read');
                setError(null);
                setReload((value) => value + 1);
              }}
              type="button"
            >
              Načíst znovu
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <section className={styles.panel} aria-labelledby="reason-title">
            <h2 id="reason-title">Důvod změny</h2>
            <p className={styles.muted}>
              Důvod se použije pro jednu následující operaci a po uložení se
              vymaže.
            </p>
            {validationFailed ? (
              <AdminFormErrorSummary
                descriptionId="admin-engagement-reason-error"
                heading="Doplňte důvod změny"
                message="Důvod musí mít alespoň 8 znaků a nesmí obsahovat HTML značky."
              />
            ) : null}
            <label className={styles.field}>
              <span>Důvod pro další operaci</span>
              <textarea
                aria-describedby={
                  validationFailed
                    ? 'admin-engagement-reason-error'
                    : 'admin-engagement-reason-help'
                }
                aria-invalid={validationFailed}
                disabled={busy !== null || pending !== null}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                value={reason}
              />
              <span className={styles.helper} id="admin-engagement-reason-help">
                Nejméně 8 znaků. Neuvádějte osobní údaje.
              </span>
            </label>
          </section>

          <section className={styles.panel} aria-labelledby="features-title">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="features-title">Dostupnost pro celou akci</h2>
                <p className={styles.muted}>
                  Globální přepínače fungují jako okamžitá bezpečnostní
                  pojistka.
                </p>
              </div>
              <span className={styles.badge}>
                Verze {overview.settingsVersion}
              </span>
            </div>
            <div className={styles.featureGrid}>
              {featureLabels.map((feature) => (
                <label className={styles.featureCard} key={feature.key}>
                  <span className={styles.featureToggleRow}>
                    <span>
                      <strong>{feature.title}</strong>
                      <small>{feature.description}</small>
                    </span>
                    <input
                      aria-label={`${feature.title}: ${draftFeatures[feature.key] ? 'zapnuto' : 'vypnuto'}`}
                      checked={draftFeatures[feature.key]}
                      disabled={busy !== null || pending !== null}
                      onChange={(event) =>
                        setDraftFeatures((current) =>
                          current
                            ? {
                                ...current,
                                [feature.key]: event.target.checked,
                              }
                            : current,
                        )
                      }
                      type="checkbox"
                    />
                  </span>
                  <span
                    className={`${styles.statusBadge} ${
                      draftFeatures[feature.key]
                        ? styles.statusHealthy
                        : styles.statusUnchanged
                    }`}
                  >
                    {draftFeatures[feature.key] ? 'Zapnuto' : 'Vypnuto'}
                  </span>
                </label>
              ))}
            </div>
            <div className={styles.actionRow}>
              <button
                className={styles.button}
                disabled={!featuresDirty || busy !== null || pending !== null}
                onClick={queueFeatureUpdate}
                type="button"
              >
                Zkontrolovat a uložit dostupnost
              </button>
              {featuresDirty ? (
                <button
                  className={styles.secondaryButton}
                  disabled={busy !== null || pending !== null}
                  onClick={() => setDraftFeatures(overview.features)}
                  type="button"
                >
                  Vrátit neuložené změny
                </button>
              ) : null}
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="sessions-title">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="sessions-title">Otázky podle přednášky</h2>
                <p className={styles.muted}>
                  Nastavení přednášek zůstává uložené i při vypnutí globální
                  pojistky.
                </p>
              </div>
              <span
                className={`${styles.statusBadge} ${
                  overview.features.questionsEnabled
                    ? styles.statusHealthy
                    : styles.statusAttention
                }`}
              >
                {overview.features.questionsEnabled
                  ? 'Globálně zapnuto'
                  : 'Globálně vypnuto'}
              </span>
            </div>
            {overview.sessions.length === 0 ? (
              <p className={styles.empty}>V programu nejsou žádné přednášky.</p>
            ) : (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <caption>
                      Přepínače otázek a aktuální moderátoři podle přednášky.
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Přednáška</th>
                        <th scope="col">Stav</th>
                        <th scope="col">Otázky</th>
                        <th scope="col">Moderátoři</th>
                        <th scope="col">Akce</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.sessions.map((session) => (
                        <tr key={session.sessionId}>
                          <th scope="row">
                            {session.title}
                            <small className={styles.sessionMeta}>
                              {formatSessionTime(
                                session.startsAt,
                                eventTimezone,
                              )}
                            </small>
                          </th>
                          <td>{sessionStatusLabel(session.status)}</td>
                          <td>
                            {session.questionsEnabled ? 'Povoleny' : 'Zakázány'}
                          </td>
                          <td>
                            {session.moderators.length > 0
                              ? session.moderators
                                  .map(({ displayName }) => displayName)
                                  .join(', ')
                              : 'Bez moderátora'}
                          </td>
                          <td>
                            <button
                              aria-label={`${session.questionsEnabled ? 'Zakázat' : 'Povolit'} otázky pro ${session.title}`}
                              className={styles.secondaryButton}
                              disabled={
                                busy !== null ||
                                pending !== null ||
                                session.status === 'cancelled' ||
                                session.status === 'archived'
                              }
                              onClick={() => queueSessionUpdate(session)}
                              type="button"
                            >
                              {session.questionsEnabled ? 'Zakázat' : 'Povolit'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.cards}>
                  <ul className={styles.cardList}>
                    {overview.sessions.map((session) => (
                      <li className={styles.dataCard} key={session.sessionId}>
                        <strong>{session.title}</strong>
                        <dl>
                          <dt>Začátek</dt>
                          <dd>
                            {formatSessionTime(session.startsAt, eventTimezone)}
                          </dd>
                          <dt>Stav</dt>
                          <dd>{sessionStatusLabel(session.status)}</dd>
                          <dt>Otázky</dt>
                          <dd>
                            {session.questionsEnabled ? 'Povoleny' : 'Zakázány'}
                          </dd>
                          <dt>Moderátoři</dt>
                          <dd>
                            {session.moderators.length > 0
                              ? session.moderators
                                  .map(({ displayName }) => displayName)
                                  .join(', ')
                              : 'Bez moderátora'}
                          </dd>
                        </dl>
                        <button
                          aria-label={`${session.questionsEnabled ? 'Zakázat' : 'Povolit'} otázky pro ${session.title}`}
                          className={styles.secondaryButton}
                          disabled={
                            busy !== null ||
                            pending !== null ||
                            session.status === 'cancelled' ||
                            session.status === 'archived'
                          }
                          onClick={() => queueSessionUpdate(session)}
                          type="button"
                        >
                          {session.questionsEnabled
                            ? 'Zakázat otázky'
                            : 'Povolit otázky'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="moderators-title">
            <div className={styles.panelHeader}>
              <div>
                <h2 id="moderators-title">Moderátoři přednášek</h2>
                <p className={styles.muted}>
                  Jednoho člověka lze přiřadit k více přednáškám. Kontaktní údaj
                  zůstává maskovaný.
                </p>
              </div>
              <span className={styles.badge}>
                Verze {overview.assignmentsVersion}
              </span>
            </div>
            <div className={styles.twoColumn}>
              <label className={styles.field}>
                <span>Přednáška</span>
                <select
                  disabled={busy !== null || pending !== null}
                  onChange={(event) => setSelectedSessionId(event.target.value)}
                  value={selectedSessionId}
                >
                  {overview.sessions.map((session) => (
                    <option key={session.sessionId} value={session.sessionId}>
                      {session.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Účastník</span>
                <select
                  disabled={
                    busy !== null ||
                    pending !== null ||
                    !moderatorAssignmentAllowed ||
                    availableCandidates.length === 0
                  }
                  onChange={(event) =>
                    setSelectedCandidateId(event.target.value)
                  }
                  value={effectiveSelectedCandidateId}
                >
                  {availableCandidates.length === 0 ? (
                    <option value="">Všichni dostupní už jsou přiřazeni</option>
                  ) : (
                    availableCandidates.map((candidate) => (
                      <option key={candidate.userId} value={candidate.userId}>
                        {candidate.displayName} · {candidate.maskedContact}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>
            {!moderatorAssignmentAllowed ? (
              <p className={styles.callout}>
                Pro přiřazení moderátora nejprve zapněte otázky globálně a pro
                vybranou přednášku.
              </p>
            ) : null}
            <button
              className={styles.button}
              disabled={
                busy !== null ||
                pending !== null ||
                !effectiveSelectedCandidateId ||
                !moderatorAssignmentAllowed
              }
              onClick={queueModeratorAssignment}
              type="button"
            >
              Zkontrolovat přiřazení moderátora
            </button>

            {selectedSession && selectedSession.moderators.length > 0 ? (
              <ul
                aria-label={`Moderátoři přednášky ${selectedSession.title}`}
                className={styles.moderatorList}
              >
                {selectedSession.moderators.map((moderator) => (
                  <li key={moderator.userId}>
                    <span>
                      <strong>{moderator.displayName}</strong>
                      <small>{moderator.maskedContact}</small>
                    </span>
                    <button
                      className={styles.dangerButton}
                      disabled={busy !== null || pending !== null}
                      onClick={() =>
                        queueModeratorRemoval(
                          selectedSession,
                          moderator.userId,
                          moderator.displayName,
                        )
                      }
                      type="button"
                    >
                      Odebrat
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>
                Vybraná přednáška zatím nemá moderátora.
              </p>
            )}
          </section>
        </>
      )}

      {confirming && pending ? (
        <AdminConfirmDialog
          acknowledgement={pending.acknowledgement}
          confirmLabel={pending.confirmLabel}
          danger={pending.danger}
          description={pending.description}
          onConfirm={() => void execute(pending)}
          onDismiss={() => {
            setConfirming(false);
            setPending(null);
          }}
          title={pending.title}
        />
      ) : null}
    </div>
  );
};
