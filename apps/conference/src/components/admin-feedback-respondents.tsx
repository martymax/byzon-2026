'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type {
  FeedbackRespondents,
  FeedbackRespondentDetail,
  FeedbackRespondentsQuery,
} from '@byzon/domain/contracts';
import { AdminSkeleton } from '@byzon/ui';
import {
  feedbackRespondentsParameters,
  requestFeedbackRespondents,
  requestFeedbackRespondent,
} from '@/lib/admin-feedback-api';
import { feedbackRoleLabels, feedbackStatusLabels } from '@/lib/admin-feedback';
import { adminFailureMessage } from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';
import feedbackStyles from './admin-feedback-workspace.module.css';
import peopleStyles from './admin-feedback-respondents.module.css';

const basePath = '/admin/hodnoceni/ucastnici';
const defaults: FeedbackRespondentsQuery = {
  role: 'all',
  status: 'all',
  search: '',
  page: 1,
  sort: 'updated',
};

export function AdminFeedbackRespondents(props: {
  participantId?: string;
  initialQuery?: FeedbackRespondentsQuery;
}) {
  const { eventId } = useAdminWorkspace();
  return (
    <RespondentsView
      key={`${eventId}:${props.participantId ?? 'list'}`}
      {...props}
    />
  );
}

function RespondentsView({
  participantId,
  initialQuery = defaults,
}: {
  participantId?: string;
  initialQuery?: FeedbackRespondentsQuery;
}) {
  const { api, eventId, eventTimezone, invalidateSensitive } =
    useAdminWorkspace();
  const fence = useAdminRequestFence();
  const [query, setQuery] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery.search);
  const [list, setList] = useState<FeedbackRespondents | null>(null);
  const [detail, setDetail] = useState<FeedbackRespondentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat('cs-CZ', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: eventTimezone,
      }),
    [eventTimezone],
  );
  const date = (value: string | null) =>
    value ? formatter.format(new Date(value)) : '—';
  const changeQuery = (update: Partial<FeedbackRespondentsQuery>) => {
    setList(null);
    setLoading(true);
    setError(null);
    setQuery((current) => ({ ...current, page: 1, ...update }));
  };
  useEffect(() => {
    if (search === query.search) return;
    const timer = setTimeout(() => {
      setList(null);
      setLoading(true);
      setQuery((current) => ({ ...current, search: search.trim(), page: 1 }));
    }, 300);
    return () => clearTimeout(timer);
  }, [search, query.search]);
  useEffect(() => {
    const request = fence.begin('feedback-respondents');
    const load = async () => {
      const result = participantId
        ? await requestFeedbackRespondent(
            api,
            eventId,
            participantId,
            request.signal,
          )
        : await requestFeedbackRespondents(api, eventId, query, request.signal);
      if (!request.isCurrent()) return;
      request.finish();
      setLoading(false);
      if (!result.ok) {
        if (isAdminSecurityFailure(result)) return invalidateSensitive();
        setError(
          ['transport', 'timeout', 'invalid_response'].includes(
            result.failure.kind,
          )
            ? 'Data se nepodařilo načíst. Zkontrolujte připojení a zkuste to znovu.'
            : adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      if (result.kind !== 'success' || result.data.data.eventId !== eventId) {
        invalidateSensitive(
          'Hodnocení nelze bezpečně přiřadit k aktuální akci.',
        );
        return;
      }
      const data = result.data.data;
      if ('respondent' in data) {
        if (data.respondent.id !== participantId) {
          invalidateSensitive(
            'Odpovědi nelze bezpečně přiřadit k účastníkovi.',
          );
          return;
        }
        setDetail(data);
      } else setList(data);
    };
    void load();
    return () => fence.cancel('feedback-respondents');
  }, [
    api,
    eventId,
    participantId,
    query,
    revision,
    fence,
    invalidateSensitive,
  ]);

  const refresh = () => {
    setList(null);
    setDetail(null);
    setLoading(true);
    setError(null);
    setRevision((current) => current + 1);
  };
  const returnPath = `${basePath}?${feedbackRespondentsParameters(query)}`;
  const sections =
    detail?.sections
      .map((section) => ({
        ...section,
        answers: section.answers.filter(
          (answer) => includeEmpty || answer.value !== null,
        ),
      }))
      .filter((section) => section.answers.length) ?? [];

  return (
    <div className={styles.stack}>
      <header className={feedbackStyles.header}>
        <div className={styles.pageHeader}>
          <h1>
            {participantId ? 'Odpovědi účastníka' : 'Hodnocení podle účastníků'}
          </h1>
          <p>
            {participantId
              ? 'Uložené odpovědi včetně rozpracovaných částí dotazníku.'
              : 'Najděte konkrétního člověka a projděte si jeho zkušenost s BYZONem.'}
          </p>
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={loading}
          onClick={refresh}
        >
          Obnovit data
        </button>
      </header>
      {participantId ? (
        <Link className={peopleStyles.back} href={returnPath}>
          Zpět na přehled účastníků
        </Link>
      ) : (
        <nav className={feedbackStyles.viewSwitch} aria-label="Část hodnocení">
          <Link className={feedbackStyles.viewButton} href="/admin/hodnoceni">
            Souhrnné výsledky a rozesílání
          </Link>
          <Link
            className={`${feedbackStyles.viewButton} ${peopleStyles.activeTab}`}
            aria-current="page"
            href={basePath}
          >
            Podle účastníků
          </Link>
        </nav>
      )}
      {!participantId ? (
        <div className={peopleStyles.filters}>
          <label className={styles.field}>
            <span>Hledat účastníka</span>
            <input
              type="search"
              maxLength={200}
              placeholder="Jméno nebo e-mail"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span>Role na konferenci</span>
            <select
              value={query.role}
              onChange={(event) =>
                changeQuery({
                  role: event.target.value as FeedbackRespondentsQuery['role'],
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
              value={query.status}
              onChange={(event) =>
                changeQuery({
                  status: event.target
                    .value as FeedbackRespondentsQuery['status'],
                })
              }
            >
              <option value="all">Všichni respondenti</option>
              <option value="completed">Dokončeno</option>
              <option value="in_progress">Rozpracováno</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Řazení</span>
            <select
              value={query.sort}
              onChange={(event) =>
                changeQuery({
                  sort: event.target.value as FeedbackRespondentsQuery['sort'],
                })
              }
            >
              <option value="updated">Poslední změna</option>
              <option value="name">Jméno A–Z</option>
            </select>
          </label>
        </div>
      ) : null}
      {error ? (
        <div className={styles.errorSummary} role="alert">
          <strong>Odpovědi se nepodařilo načíst</strong>
          <p>{error}</p>
          <button
            type="button"
            onClick={refresh}
            className={styles.secondaryButton}
          >
            Zkusit znovu
          </button>
        </div>
      ) : null}
      {loading ? (
        <AdminSkeleton
          label={
            participantId ? 'Načítám odpovědi účastníka' : 'Načítám respondenty'
          }
        />
      ) : null}
      {list ? (
        <section className={styles.panel} aria-labelledby="respondents-title">
          <div className={feedbackStyles.sectionHeader}>
            <div>
              <h2 id="respondents-title">
                Respondenti{' '}
                <span className={peopleStyles.count}>({list.total})</span>
              </h2>
              <p className={feedbackStyles.note}>
                Lidé s alespoň jednou uloženou odpovědí. Zahrnujeme i
                nedokončená hodnocení.
              </p>
            </div>
          </div>
          {list.items.length ? (
            <>
              <div className={peopleStyles.tableWrap}>
                <table className={peopleStyles.table}>
                  <caption className={feedbackStyles.visuallyHidden}>
                    Hodnocení jednotlivých účastníků
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Účastník</th>
                      <th scope="col">Role a stav</th>
                      <th scope="col">Celkový dojem</th>
                      <th scope="col">Odpovědi</th>
                      <th scope="col">Poslední změna</th>
                      <th scope="col">
                        <span className={feedbackStyles.visuallyHidden}>
                          Detail hodnocení
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.items.map((person) => (
                      <tr key={person.id}>
                        <th scope="row">
                          <strong>{person.name}</strong>
                          <span className={feedbackStyles.recipientEmail}>
                            {person.email}
                          </span>
                        </th>
                        <td>
                          {feedbackRoleLabels[person.role]}
                          <span className={peopleStyles.meta}>
                            {feedbackStatusLabels[person.status]}
                          </span>
                        </td>
                        <td>{person.overallRating ?? 'Bez odpovědi'}</td>
                        <td>{person.answerCount}</td>
                        <td>{date(person.updatedAt)}</td>
                        <td>
                          <Link
                            className={peopleStyles.detailLink}
                            href={`${basePath}/${person.id}?${feedbackRespondentsParameters(query)}`}
                            aria-label={`Zobrazit odpovědi: ${person.name}`}
                          >
                            Zobrazit odpovědi
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className={peopleStyles.mobileList}>
                {list.items.map((person) => (
                  <li key={person.id}>
                    <h3>{person.name}</h3>
                    <p className={peopleStyles.email}>{person.email}</p>
                    <p>
                      {feedbackRoleLabels[person.role]} ·{' '}
                      {feedbackStatusLabels[person.status]}
                    </p>
                    <dl>
                      <div>
                        <dt>Celkový dojem</dt>
                        <dd>{person.overallRating ?? 'Bez odpovědi'}</dd>
                      </div>
                      <div>
                        <dt>Odpovědi</dt>
                        <dd>{person.answerCount}</dd>
                      </div>
                      <div>
                        <dt>Poslední změna</dt>
                        <dd>{date(person.updatedAt)}</dd>
                      </div>
                    </dl>
                    <Link
                      className={peopleStyles.detailLink}
                      href={`${basePath}/${person.id}?${feedbackRespondentsParameters(query)}`}
                      aria-label={`Zobrazit odpovědi: ${person.name}`}
                    >
                      Zobrazit odpovědi
                    </Link>
                  </li>
                ))}
              </ul>
              <div className={feedbackStyles.pagination}>
                <p>
                  Strana {list.page} z{' '}
                  {Math.max(1, Math.ceil(list.total / list.pageSize))} · Celkem{' '}
                  {list.total} respondentů
                </p>
                <div>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={list.page <= 1}
                    onClick={() => changeQuery({ page: list.page - 1 })}
                  >
                    Předchozí
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={list.page * list.pageSize >= list.total}
                    onClick={() => changeQuery({ page: list.page + 1 })}
                  >
                    Další
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className={feedbackStyles.empty}>
              <h3>Žádní respondenti v tomto výběru</h3>
              <p>
                Zkuste změnit hledání nebo filtry. Účastník se zde objeví po
                uložení první odpovědi.
              </p>
            </div>
          )}
        </section>
      ) : null}
      {detail ? (
        <>
          <section className={styles.panel} aria-labelledby="respondent-name">
            <h2 id="respondent-name">{detail.respondent.name}</h2>
            <p className={peopleStyles.email}>{detail.respondent.email}</p>
            <dl className={peopleStyles.personMeta}>
              <div>
                <dt>Role</dt>
                <dd>{feedbackRoleLabels[detail.respondent.role]}</dd>
              </div>
              <div>
                <dt>Stav</dt>
                <dd>{feedbackStatusLabels[detail.respondent.status]}</dd>
              </div>
              <div>
                <dt>Uložených odpovědí</dt>
                <dd>{detail.respondent.answerCount}</dd>
              </div>
              <div>
                <dt>Poslední změna</dt>
                <dd>{date(detail.respondent.updatedAt)}</dd>
              </div>
              {detail.respondent.completedAt ? (
                <div>
                  <dt>Dokončeno</dt>
                  <dd>{date(detail.respondent.completedAt)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
          <label className={peopleStyles.emptyToggle}>
            <input
              type="checkbox"
              checked={includeEmpty}
              onChange={(event) => setIncludeEmpty(event.target.checked)}
            />
            Zobrazit i nezodpovězené otázky
          </label>
          <div className={styles.panel}>
            {sections.map((section) => (
              <section
                className={peopleStyles.answerSection}
                key={section.id}
                aria-labelledby={`answers-${section.id}`}
              >
                <h2 id={`answers-${section.id}`}>{section.title}</h2>
                <dl className={peopleStyles.answers}>
                  {section.answers.map((answer) => (
                    <div key={answer.id}>
                      <dt>{answer.label}</dt>
                      <dd
                        className={
                          answer.value === null
                            ? peopleStyles.unanswered
                            : undefined
                        }
                      >
                        {answer.value ?? 'Bez odpovědi'}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
