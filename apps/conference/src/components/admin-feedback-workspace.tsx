'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type {
  FeedbackAdminOverview,
  FeedbackQuestionReport,
  FeedbackRecipient,
} from '@byzon/domain/contracts';
import { AdminConfirmDialog, AdminSkeleton } from '@byzon/ui';
import {
  feedbackPath,
  requestFeedbackOverview,
  sendFeedbackInvitations,
  type FeedbackFilters,
} from '@/lib/admin-feedback-api';
import {
  feedbackEmailCount,
  feedbackMailStatusLabels,
  feedbackRecipientIneligibility,
  feedbackRoleLabels,
  feedbackStatusLabels,
  type FeedbackMailKind,
} from '@/lib/admin-feedback';
import {
  adminFailureMessage,
  createAdminIdempotencyKey,
  isAmbiguousAdminMutationFailure,
} from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';
import feedbackStyles from './admin-feedback-workspace.module.css';

const number = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 1 });
const percent = (count: number, total: number) =>
  total > 0 ? Math.round((count / total) * 100) : 0;
const pageSize = 25;

const QuestionReport = ({ question }: { question: FeedbackQuestionReport }) => {
  const [showAll, setShowAll] = useState(false);
  const numericAnswers = question.answered - question.notApplicable;
  const maximum = Math.max(
    0,
    ...question.options
      .map((option) => Number(option.value))
      .filter(Number.isFinite),
  );
  return (
    <details
      className={feedbackStyles.question}
      open={question.id === 'score' ? true : undefined}
    >
      <summary>
        <span className={feedbackStyles.questionTitle}>{question.label}</span>
        <span className={feedbackStyles.questionMeta}>
          {question.average !== null ? (
            <strong>
              {number.format(question.average)}
              {maximum ? ` / ${maximum}` : ''}
            </strong>
          ) : null}
          <span>Odpovědi: {question.answered}</span>
        </span>
      </summary>
      <div className={feedbackStyles.questionBody}>
        <p className={feedbackStyles.note}>
          Odpovědělo {question.answered} z {question.eligible} lidí, kterých se
          otázka týká.
          {question.notApplicable > 0
            ? ` Z toho ${question.notApplicable} zvolilo „netýká se mě“ nebo „nevyužil/a jsem“.`
            : ''}
          {question.average !== null
            ? ` Číselných hodnocení pro výpočet průměru: ${numericAnswers}.`
            : ''}
        </p>
        {question.type === 'text' ? (
          question.comments.length > 0 ? (
            <>
              <ul className={feedbackStyles.comments}>
                {question.comments
                  .slice(0, showAll ? undefined : 10)
                  .map((comment, index) => (
                    <li key={index}>
                      <p>{comment.value}</p>
                      <span>
                        {feedbackRoleLabels[comment.role]} ·{' '}
                        {feedbackStatusLabels[comment.status]}
                      </span>
                    </li>
                  ))}
              </ul>
              {!showAll && question.comments.length > 10 ? (
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => setShowAll(true)}
                >
                  Zobrazit dalších {question.comments.length - 10} odpovědí
                </button>
              ) : null}
            </>
          ) : (
            <p className={feedbackStyles.note}>Zatím bez slovních odpovědí.</p>
          )
        ) : (
          <ul
            className={feedbackStyles.distribution}
            aria-label="Rozložení odpovědí"
          >
            {question.options.map((option) => (
              <li key={option.value}>
                <span>{option.label}</span>
                <div className={feedbackStyles.barTrack} aria-hidden="true">
                  <span
                    style={
                      {
                        '--answer-share': `${percent(option.count, question.answered)}%`,
                      } as CSSProperties
                    }
                  />
                </div>
                <span className={feedbackStyles.distributionCount}>
                  {option.count}{' '}
                  <small>({percent(option.count, question.answered)} %)</small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
};

interface PendingSend {
  kind: FeedbackMailKind;
  participantIds: string[];
  key: string;
  previewNames: string[];
}

export const AdminFeedbackWorkspace = () => {
  const { api, eventId, eventTimezone, invalidateSensitive } =
    useAdminWorkspace();
  const fence = useAdminRequestFence();
  const [view, setView] = useState<'results' | 'mail'>('results');
  const [filters, setFilters] = useState<FeedbackFilters>({
    role: 'all',
    status: 'all',
  });
  const [report, setReport] = useState<FeedbackAdminOverview | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [kind, setKind] = useState<FeedbackMailKind>('invitation');
  const [search, setSearch] = useState('');
  const [questionSearch, setQuestionSearch] = useState('');
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat('cs-CZ', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: eventTimezone,
      }),
    [eventTimezone],
  );

  useEffect(() => {
    const request = fence.begin('feedback-overview');
    void requestFeedbackOverview(api, eventId, filters, request.signal).then(
      (result) => {
        if (!request.isCurrent()) return;
        request.finish();
        setLoading(false);
        if (!result.ok) {
          setReport(null);
          if (isAdminSecurityFailure(result)) return invalidateSensitive();
          setError(
            adminFailureMessage(result.failure, result.metadata?.requestId),
          );
          return;
        }
        if (result.kind !== 'success' || result.data.data.eventId !== eventId) {
          setReport(null);
          invalidateSensitive(
            'Hodnocení nelze bezpečně přiřadit k aktuální akci.',
          );
          return;
        }
        setReport(result.data.data);
        setError(null);
      },
    );
    return () => fence.cancel('feedback-overview');
  }, [api, eventId, filters, reload, fence, invalidateSensitive]);

  const refresh = () => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setReload((current) => current + 1);
  };
  const changeFilters = (next: FeedbackFilters) => {
    setFilters(next);
    setReport(null);
    setLoading(true);
    setSelected(new Set());
    setPage(0);
    setNotice(null);
  };
  const recipients = useMemo(
    () =>
      (report?.recipients ?? []).filter((recipient) =>
        `${recipient.name} ${recipient.email}`
          .toLocaleLowerCase('cs')
          .includes(search.toLocaleLowerCase('cs').trim()),
      ),
    [report, search],
  );
  const eligible = recipients.filter(
    (recipient) => !feedbackRecipientIneligibility(recipient, kind),
  );
  const selectedRecipients = eligible.filter((recipient) =>
    selected.has(recipient.id),
  );
  const pages = Math.max(1, Math.ceil(recipients.length / pageSize));
  const safePage = Math.min(page, pages - 1);
  const pageRecipients = recipients.slice(
    safePage * pageSize,
    (safePage + 1) * pageSize,
  );
  const questions = (report?.questions ?? []).filter(
    (question) =>
      (includeEmpty || question.answered > 0) &&
      question.label
        .toLocaleLowerCase('cs')
        .includes(questionSearch.toLocaleLowerCase('cs').trim()),
  );
  const locked = sending || pending !== null;

  const prepare = () => {
    if (loading || selectedRecipients.length === 0 || locked) return;
    setPending({
      kind,
      participantIds: selectedRecipients.map((recipient) => recipient.id),
      key: createAdminIdempotencyKey('feedback-send'),
      previewNames: selectedRecipients
        .slice(0, 5)
        .map((recipient) => `${recipient.name} (${recipient.email})`),
    });
    setAmbiguous(false);
    setConfirming(true);
  };

  const send = async (operation: PendingSend) => {
    if (sending) return;
    const request = fence.begin('feedback-send');
    setSending(true);
    setError(null);
    setNotice(null);
    setConfirming(false);
    const result = await sendFeedbackInvitations(
      api,
      eventId,
      {
        kind: operation.kind,
        participantIds: operation.participantIds,
      },
      operation.key,
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setSending(false);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) return invalidateSensitive();
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      const uncertain = isAmbiguousAdminMutationFailure(result);
      setAmbiguous(uncertain);
      if (!uncertain) setPending(null);
      return;
    }
    if (result.kind !== 'success') {
      setError(
        'Výsledek zařazení e-mailů není potvrzený. Ověřte stejnou dávku znovu.',
      );
      setAmbiguous(true);
      return;
    }
    const { queued, skipped } = result.data.data;
    setNotice(
      `Do fronty jsme zařadili ${feedbackEmailCount(queued)}.${skipped ? ` Vynecháno: ${skipped}. Jejich stav nebo nastavení se mezitím změnilo.` : ''} Průběh odesílání najdete v přehledu příjemců.`,
    );
    setPending(null);
    setAmbiguous(false);
    refresh();
  };

  const toggleRecipient = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const date = (value: string | null) =>
    value ? formatter.format(new Date(value)) : '—';

  return (
    <div className={styles.stack}>
      <header className={feedbackStyles.header}>
        <div className={styles.pageHeader}>
          <h1>Hodnocení konference</h1>
          <p>
            Každá odpověď se počítá. Sledujte i rozpracovaná hodnocení a pozvěte
            účastníky k vyplnění.
          </p>
        </div>
        <a
          className={styles.secondaryButton}
          href="/hodnoceni/demo"
          target="_blank"
          rel="noreferrer"
        >
          Otevřít demo pro tým <span aria-hidden="true">↗</span>
        </a>
      </header>

      <div className={feedbackStyles.viewSwitch} aria-label="Část hodnocení">
        <button
          className={feedbackStyles.viewButton}
          type="button"
          aria-pressed={view === 'results'}
          onClick={() => setView('results')}
        >
          Výsledky
        </button>
        <button
          className={feedbackStyles.viewButton}
          type="button"
          aria-pressed={view === 'mail'}
          onClick={() => setView('mail')}
        >
          Rozesílání e-mailů
        </button>
      </div>

      <div className={feedbackStyles.filters}>
        <label className={styles.field}>
          <span>Role na konferenci</span>
          <select
            value={filters.role}
            disabled={locked}
            onChange={(event) =>
              changeFilters({
                ...filters,
                role: event.target.value as FeedbackFilters['role'],
              })
            }
          >
            <option value="all">Všechny role</option>
            {Object.entries(feedbackRoleLabels).map(([role, label]) => (
              <option key={role} value={role}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Stav hodnocení</span>
          <select
            value={filters.status}
            disabled={locked}
            onChange={(event) =>
              changeFilters({
                ...filters,
                status: event.target.value as FeedbackFilters['status'],
              })
            }
          >
            <option value="all">Všechna hodnocení</option>
            {Object.entries(feedbackStatusLabels).map(([status, label]) => (
              <option key={status} value={status}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={loading || sending}
          onClick={refresh}
        >
          Obnovit data
        </button>
      </div>

      {error ? (
        <div className={styles.errorSummary} role="alert">
          <strong>Data zatím nelze potvrdit</strong>
          <p>{error}</p>
        </div>
      ) : null}
      {notice ? (
        <div className={styles.success} role="status">
          {notice}
        </div>
      ) : null}
      {ambiguous && pending ? (
        <div className={feedbackStyles.retry}>
          <p>
            Ověříme původní dávku se stejnými příjemci. Tím nevznikne další
            rozesílka.
          </p>
          <button
            className={styles.button}
            disabled={sending}
            onClick={() => void send(pending)}
            type="button"
          >
            {sending ? 'Ověřuji…' : 'Ověřit původní dávku'}
          </button>
        </div>
      ) : null}

      {loading && !report ? (
        <AdminSkeleton label="Načítám hodnocení konference" />
      ) : null}
      {report ? (
        <div aria-busy={loading} className={styles.stack}>
          <dl
            className={feedbackStyles.summary}
            aria-label="Přehled vybraných účastníků"
          >
            <div>
              <dt>Účastníků ve výběru</dt>
              <dd>{report.summary.total}</dd>
            </div>
            <div>
              <dt>Pozvaných</dt>
              <dd>{report.summary.invited}</dd>
            </div>
            <div>
              <dt>Rozpracováno</dt>
              <dd>{report.summary.inProgress}</dd>
            </div>
            <div>
              <dt>Dokončeno</dt>
              <dd>{report.summary.completed}</dd>
            </div>
            <div>
              <dt>Zatím nezačalo</dt>
              <dd>{report.summary.notStarted}</dd>
            </div>
          </dl>

          {view === 'results' ? (
            <section
              className={styles.panel}
              aria-labelledby="feedback-results-title"
            >
              <div className={feedbackStyles.sectionHeader}>
                <div>
                  <h2 id="feedback-results-title">Co nám účastníci říkají</h2>
                  <p className={feedbackStyles.note}>
                    Zahrnujeme i nedokončené dotazníky. Průměry nezahrnují
                    nevyplněné otázky ani odpovědi „netýká se mě“.
                  </p>
                </div>
                <a
                  className={styles.secondaryButton}
                  href={feedbackPath(eventId, filters, true)}
                  download
                >
                  Stáhnout odpovědi CSV
                </a>
              </div>
              {report.summary.started > 0 ? (
                <div className={feedbackStyles.responseRate}>
                  <strong>
                    Zapojilo se {report.summary.started} z{' '}
                    {report.summary.total} účastníků (
                    {percent(report.summary.started, report.summary.total)} %).
                  </strong>
                  <span>
                    Rozpracovaná hodnocení mají stejnou váhu jako dokončená.
                  </span>
                </div>
              ) : (
                <div className={feedbackStyles.empty}>
                  <h3>První odpovědi teprve přijdou</h3>
                  <p>
                    Jakmile účastník vyplní první bod, uvidíte jej ve
                    výsledcích. Nemusí dokončit celý dotazník.
                  </p>
                  <button
                    className={styles.button}
                    type="button"
                    onClick={() => setView('mail')}
                  >
                    Připravit rozesílku
                  </button>
                </div>
              )}
              <div className={feedbackStyles.reportControls}>
                <label className={styles.field}>
                  <span>Najít otázku</span>
                  <input
                    type="search"
                    value={questionSearch}
                    placeholder="Například hudba, oběd nebo spolupráce"
                    onChange={(event) => setQuestionSearch(event.target.value)}
                  />
                </label>
                <label className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={includeEmpty}
                    onChange={(event) => setIncludeEmpty(event.target.checked)}
                  />
                  <span>Zobrazit i otázky bez odpovědí</span>
                </label>
              </div>
              {questions.map((question) => (
                <QuestionReport
                  key={`${filters.role}:${filters.status}:${question.id}`}
                  question={question}
                />
              ))}
              {questions.length === 0 &&
              (report.summary.started > 0 || questionSearch) ? (
                <p className={feedbackStyles.empty}>
                  Žádné otázky neodpovídají výběru. Změňte hledání nebo zobrazte
                  i otázky bez odpovědí.
                </p>
              ) : null}
              <p className={feedbackStyles.footnote}>
                CSV obsahuje jednotlivé uložené odpovědi podle aktuálního
                filtru. Demo se do výsledků nezapočítává.
              </p>
            </section>
          ) : (
            <section
              className={styles.panel}
              aria-labelledby="feedback-mail-title"
            >
              <div className={feedbackStyles.sectionHeader}>
                <div>
                  <h2 id="feedback-mail-title">Pozvat k hodnocení</h2>
                  <p className={feedbackStyles.note}>
                    Každý příjemce dostane svůj opakovaně použitelný odkaz.
                    Otevře pouze hodnocení a naváže na uložené odpovědi.
                  </p>
                </div>
                <a
                  href="/hodnoceni/demo#email"
                  target="_blank"
                  rel="noreferrer"
                >
                  Náhled e-mailu
                </a>
              </div>
              <fieldset className={feedbackStyles.mailKind} disabled={locked}>
                <legend>Typ e-mailu</legend>
                <label>
                  <input
                    type="radio"
                    name="feedback-mail-kind"
                    value="invitation"
                    checked={kind === 'invitation'}
                    onChange={() => {
                      setKind('invitation');
                      setSelected(new Set());
                    }}
                  />
                  <span>
                    <strong>První pozvánka</strong>
                    <small>Lidem, kteří ji ještě nedostali.</small>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="feedback-mail-kind"
                    value="reminder"
                    checked={kind === 'reminder'}
                    onChange={() => {
                      setKind('reminder');
                      setSelected(new Set());
                    }}
                  />
                  <span>
                    <strong>Jemné připomenutí</strong>
                    <small>Jednou pozvaným, kteří ještě nedokončili.</small>
                  </span>
                </label>
              </fieldset>
              <label className={styles.field}>
                <span>Najít příjemce</span>
                <input
                  type="search"
                  placeholder="Jméno nebo e-mail"
                  value={search}
                  disabled={locked}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setSelected(new Set());
                    setPage(0);
                  }}
                />
              </label>
              <div className={feedbackStyles.selectionBar}>
                <p>
                  <strong>Vybráno: {selectedRecipients.length}</strong>
                  <span> · Vhodných k odeslání: {eligible.length}</span>
                </p>
                <div>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={
                      locked ||
                      loading ||
                      eligible.length === 0 ||
                      eligible.length > 5000
                    }
                    onClick={() =>
                      setSelected(
                        new Set(eligible.map((recipient) => recipient.id)),
                      )
                    }
                  >
                    Vybrat vhodné ({eligible.length})
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={locked || selected.size === 0}
                    onClick={() => setSelected(new Set())}
                  >
                    Zrušit výběr
                  </button>
                </div>
              </div>
              {eligible.length > 5000 ? (
                <p className={feedbackStyles.note}>
                  Jedna dávka pojme nejvýše 5 000 příjemců. Zúžete výběr rolí
                  nebo stavem hodnocení.
                </p>
              ) : null}
              <div
                className={styles.tableWrap}
                role="region"
                aria-label="Příjemci hodnocení"
                tabIndex={0}
              >
                <table
                  className={`${styles.table} ${feedbackStyles.recipients}`}
                >
                  <caption className={feedbackStyles.visuallyHidden}>
                    Příjemci podle vybraných filtrů; dokončená hodnocení a
                    vypnuté e-maily jsou z rozesílky vynechány.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Vybrat</th>
                      <th scope="col">Účastník</th>
                      <th scope="col">Role</th>
                      <th scope="col">Hodnocení</th>
                      <th scope="col">E-mail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRecipients.map((recipient) => (
                      <RecipientRow
                        key={recipient.id}
                        recipient={recipient}
                        selected={selected.has(recipient.id)}
                        disabled={locked || loading}
                        kind={kind}
                        toggle={toggleRecipient}
                        date={date}
                      />
                    ))}
                  </tbody>
                </table>
                {recipients.length === 0 ? (
                  <p className={feedbackStyles.empty}>
                    Tomuto výběru neodpovídá žádný účastník. Změňte filtry nebo
                    hledání.
                  </p>
                ) : null}
              </div>
              <ul
                className={feedbackStyles.recipientList}
                aria-label="Příjemci hodnocení"
              >
                {recipients.length === 0 ? (
                  <li>
                    Tomuto výběru neodpovídá žádný účastník. Změňte filtry nebo
                    hledání.
                  </li>
                ) : null}
                {pageRecipients.map((recipient) => {
                  const reason = feedbackRecipientIneligibility(
                    recipient,
                    kind,
                  );
                  return (
                    <li
                      key={recipient.id}
                      data-selected={selected.has(recipient.id)}
                    >
                      <label className={feedbackStyles.mobileRecipientName}>
                        <input
                          type="checkbox"
                          checked={selected.has(recipient.id) && !reason}
                          disabled={locked || loading || !!reason}
                          onChange={() => toggleRecipient(recipient.id)}
                          aria-label={`Vybrat ${recipient.name} (${recipient.email})`}
                          aria-describedby={
                            reason
                              ? `feedback-mobile-${recipient.id}`
                              : undefined
                          }
                        />
                        <span>
                          <strong>{recipient.name}</strong>
                          <span>{recipient.email}</span>
                        </span>
                      </label>
                      <dl>
                        <div>
                          <dt>Role</dt>
                          <dd>{feedbackRoleLabels[recipient.role]}</dd>
                        </div>
                        <div>
                          <dt>Hodnocení</dt>
                          <dd>{feedbackStatusLabels[recipient.status]}</dd>
                        </div>
                        <div>
                          <dt>E-mail</dt>
                          <dd>
                            {feedbackMailStatusLabels[recipient.mailStatus]}
                          </dd>
                        </div>
                      </dl>
                      {recipient.invitedAt ? (
                        <p className={feedbackStyles.note}>
                          Pozvánka: {date(recipient.invitedAt)}
                        </p>
                      ) : null}
                      {recipient.remindedAt ? (
                        <p className={feedbackStyles.note}>
                          Připomenutí: {date(recipient.remindedAt)}
                        </p>
                      ) : null}
                      {reason ? (
                        <p
                          className={feedbackStyles.recipientReason}
                          id={`feedback-mobile-${recipient.id}`}
                        >
                          {reason}
                        </p>
                      ) : null}
                      {recipient.mailStatus === 'failed' && !reason ? (
                        <p className={feedbackStyles.note}>
                          Vyberte příjemce a zopakujte odeslání.
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <div className={feedbackStyles.pagination}>
                <p>
                  {recipients.length
                    ? `${safePage * pageSize + 1}–${Math.min((safePage + 1) * pageSize, recipients.length)} z ${recipients.length} příjemců`
                    : '0 příjemců'}
                </p>
                {pages > 1 ? (
                  <div>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={safePage === 0}
                      onClick={() => setPage(safePage - 1)}
                    >
                      Předchozí
                    </button>
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={safePage === pages - 1}
                      onClick={() => setPage(safePage + 1)}
                    >
                      Další
                    </button>
                  </div>
                ) : null}
              </div>
              <div className={feedbackStyles.sendFooter}>
                <p>
                  Odešleme pouze vybraným příjemcům. Před odesláním výběr ještě
                  zkontrolujete.
                </p>
                <button
                  className={styles.button}
                  type="button"
                  disabled={
                    locked ||
                    loading ||
                    selectedRecipients.length === 0 ||
                    selectedRecipients.length > 5000
                  }
                  onClick={prepare}
                >
                  {sending
                    ? 'Zařazuji e-maily…'
                    : `Zkontrolovat a odeslat (${selectedRecipients.length})`}
                </button>
              </div>
              {report.summary.optedOut > 0 ? (
                <p className={feedbackStyles.footnote}>
                  {report.summary.optedOut} účastníků ve výběru má e-maily
                  vypnuté. Respektujeme jejich nastavení.
                </p>
              ) : null}
            </section>
          )}
          <p className={feedbackStyles.footnote}>
            Aktualizováno {date(report.updatedAt)} · Role vychází z odpovědi
            účastníka; před vyplněním z údajů v seznamu účastníků.
          </p>
        </div>
      ) : null}

      <AdminConfirmDialog
        open={confirming && pending !== null}
        title={
          pending?.kind === 'reminder'
            ? 'Odeslat připomenutí hodnocení?'
            : 'Odeslat pozvánku k hodnocení?'
        }
        actionLabel={`Odeslat ${feedbackEmailCount(pending?.participantIds.length ?? 0)}`}
        onCancel={() => {
          setConfirming(false);
          setPending(null);
        }}
        onConfirm={() => {
          if (pending) void send(pending);
        }}
        working={sending}
      >
        <p>
          Do fronty zařadíme{' '}
          <strong>
            {feedbackEmailCount(pending?.participantIds.length ?? 0)}
          </strong>{' '}
          s osobním odkazem k hodnocení konference.
        </p>
        <ul className={feedbackStyles.confirmRecipients}>
          {pending?.previewNames.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        {pending && pending.participantIds.length > 5 ? (
          <p>
            A dalších {pending.participantIds.length - 5} vybraných příjemců.
          </p>
        ) : null}
        <p>
          Příjemce, který mezitím hodnocení dokončil nebo vypnul e-maily,
          automaticky vynecháme.
        </p>
      </AdminConfirmDialog>
    </div>
  );
};

const RecipientRow = ({
  recipient,
  selected,
  disabled,
  kind,
  toggle,
  date,
}: {
  recipient: FeedbackRecipient;
  selected: boolean;
  disabled: boolean;
  kind: FeedbackMailKind;
  toggle: (id: string) => void;
  date: (value: string | null) => string;
}) => {
  const reason = feedbackRecipientIneligibility(recipient, kind);
  return (
    <tr data-bulk-selected={selected ? 'true' : undefined}>
      <td>
        <input
          className={feedbackStyles.recipientCheckbox}
          type="checkbox"
          checked={selected && !reason}
          disabled={disabled || !!reason}
          onChange={() => toggle(recipient.id)}
          aria-label={`Vybrat ${recipient.name} (${recipient.email})`}
          aria-describedby={
            reason ? `feedback-recipient-${recipient.id}` : undefined
          }
        />
      </td>
      <th scope="row">
        <strong>{recipient.name}</strong>
        <span className={feedbackStyles.recipientEmail}>{recipient.email}</span>
        {reason ? (
          <small
            id={`feedback-recipient-${recipient.id}`}
            className={feedbackStyles.recipientReason}
          >
            {reason}
          </small>
        ) : null}
      </th>
      <td>
        {feedbackRoleLabels[recipient.role]}
        {recipient.status === 'not_started' ? (
          <small className={feedbackStyles.recipientEmail}>
            Předpokládaná role
          </small>
        ) : null}
      </td>
      <td>
        <span className={feedbackStyles.status} data-status={recipient.status}>
          {feedbackStatusLabels[recipient.status]}
        </span>
      </td>
      <td>
        <span data-mail-state={recipient.mailStatus}>
          {feedbackMailStatusLabels[recipient.mailStatus]}
        </span>
        {recipient.mailStatus === 'failed' && !reason ? (
          <small className={feedbackStyles.recipientEmail}>
            Vyberte příjemce a zopakujte odeslání.
          </small>
        ) : null}
        {recipient.invitedAt ? (
          <small className={feedbackStyles.recipientEmail}>
            Pozvánka: {date(recipient.invitedAt)}
          </small>
        ) : null}
        {recipient.remindedAt ? (
          <small className={feedbackStyles.recipientEmail}>
            Připomenutí: {date(recipient.remindedAt)}
          </small>
        ) : null}
      </td>
    </tr>
  );
};
