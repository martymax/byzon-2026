'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  AdminEmailDetail,
  AdminEmailKind,
  AdminEmailSummary,
} from '@byzon/domain/contracts';
import { requestAdminEmail, requestAdminEmails } from '@/lib/admin-api';
import { adminFailureMessage } from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';
import mailStyles from './admin-email-workspace.module.css';

export const emailKindLabels: Record<AdminEmailKind, string> = {
  'sign-in': 'Přihlášení',
  'account-activation': 'Aktivace účtu',
  'participant-invitation': 'Pozvánka účastníka',
  'team-invitation': 'Pozvánka do týmu',
  reservation_confirmed: 'Potvrzení rezervace',
  reservation_cancelled: 'Zrušení rezervace',
  waitlist_joined: 'Zařazení do čekací listiny',
  waitlist_left: 'Odhlášení z čekací listiny',
  waitlist_promoted: 'Uvolněné místo',
  program_changed: 'Změna programu',
  announcement: 'Oznámení',
  rating_reminder: 'Hodnocení konference',
};

const previewDocument = (html: string) =>
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'"><base target="_blank">${html}`;

const EmailContent = ({ message }: { message: AdminEmailDetail }) => {
  const [format, setFormat] = useState<'html' | 'text'>(
    message.html ? 'html' : 'text',
  );
  return (
    <>
      <dl>
        <dt>Od</dt>
        <dd>{message.sender ?? 'Odesílatel nebyl uložen'}</dd>
        <dt>Komu</dt>
        <dd>{message.recipient ?? 'Původní adresa nebyla uložena'}</dd>
      </dl>
      {message.authLinkRedacted ? (
        <p className={mailStyles.note}>
          Jednorázový přihlašovací nebo aktivační odkaz je v archivu skrytý.
          Ostatní obsah zprávy je zachovaný.
        </p>
      ) : null}
      {!message.contentAvailable ? (
        <p className={mailStyles.note}>
          Tento e-mail byl odeslán před zavedením archivu. Jeho původní obsah se
          neukládal a není k dispozici.
        </p>
      ) : (
        <>
          <div className={mailStyles.formats} aria-label="Zobrazení obsahu">
            <button
              className={styles.filterButton}
              type="button"
              aria-pressed={format === 'html'}
              disabled={!message.html}
              onClick={() => setFormat('html')}
            >
              HTML náhled
            </button>
            <button
              className={styles.filterButton}
              type="button"
              aria-pressed={format === 'text'}
              disabled={!message.text}
              onClick={() => setFormat('text')}
            >
              Prostý text
            </button>
          </div>
          {format === 'html' && message.html ? (
            <iframe
              className={mailStyles.preview}
              title={`Obsah e-mailu: ${message.subject ?? emailKindLabels[message.kind]}`}
              sandbox=""
              referrerPolicy="no-referrer"
              srcDoc={previewDocument(message.html)}
            />
          ) : (
            <pre className={mailStyles.text}>{message.text}</pre>
          )}
        </>
      )}
    </>
  );
};

export const AdminEmailWorkspace = () => {
  const { api, eventId, eventTimezone, invalidateSensitive } =
    useAdminWorkspace();
  const fence = useAdminRequestFence();
  const [searchInput, setSearchInput] = useState('');
  const [kindInput, setKindInput] = useState<AdminEmailKind | ''>('');
  const [filters, setFilters] = useState({
    search: '',
    kind: '' as AdminEmailKind | '',
    revision: 0,
  });
  const [items, setItems] = useState<AdminEmailSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminEmailDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat('cs-CZ', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: eventTimezone,
      }),
    [eventTimezone],
  );
  const query = useMemo(
    () => ({
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.kind ? { kind: filters.kind } : {}),
      limit: 25,
    }),
    [filters],
  );

  useEffect(() => {
    const request = fence.begin('email-list');
    void requestAdminEmails(api, eventId, query, request.signal).then(
      (result) => {
        if (!request.isCurrent()) return;
        request.finish();
        setBusy(false);
        if (!result.ok) {
          if (isAdminSecurityFailure(result)) {
            invalidateSensitive();
            return;
          }
          setError(
            adminFailureMessage(result.failure, result.metadata?.requestId),
          );
        } else if (result.kind === 'success') {
          setItems(result.data.items);
          setCursor(result.data.nextCursor);
          setTotal(result.data.total);
        }
      },
    );
    return () => fence.cancel('email-list');
  }, [api, eventId, query, fence, invalidateSensitive]);

  useEffect(() => {
    if (!selected) return;
    const request = fence.begin('email-detail');
    void requestAdminEmail(api, eventId, selected, request.signal).then(
      (result) => {
        if (!request.isCurrent()) return;
        request.finish();
        if (!result.ok) {
          if (isAdminSecurityFailure(result)) {
            invalidateSensitive();
            return;
          }
          setDetailError(
            adminFailureMessage(result.failure, result.metadata?.requestId),
          );
        } else if (result.kind === 'success') setDetail(result.data);
      },
    );
    return () => fence.cancel('email-detail');
  }, [api, eventId, selected, detailRevision, fence, invalidateSensitive]);

  const refresh = () => {
    fence.cancel('email-list');
    fence.cancel('email-more');
    fence.cancel('email-detail');
    setItems([]);
    setCursor(null);
    setTotal(0);
    setError(null);
    setSelected(null);
    setDetail(null);
    setBusy(true);
    setFilters({
      search: searchInput.trim(),
      kind: kindInput,
      revision: filters.revision + 1,
    });
  };
  const loadMore = async () => {
    if (!cursor || busy) return;
    const request = fence.begin('email-more');
    setBusy(true);
    setError(null);
    const result = await requestAdminEmails(
      api,
      eventId,
      { ...query, cursor },
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(false);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
        invalidateSensitive();
        return;
      }
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
    } else if (result.kind === 'success') {
      setItems((current) => [
        ...current,
        ...result.data.items.filter(
          (item) => !current.some((existing) => existing.id === item.id),
        ),
      ]);
      setCursor(result.data.nextCursor);
      setTotal(result.data.total);
    }
  };

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <h1>Odeslané e-maily</h1>
        <p>
          Pozvánky, přihlášení a oznámení na jednom místě. Vyberte zprávu a
          prohlédněte si její obsah.
        </p>
      </header>
      <section
        className={styles.panel}
        aria-label="Historie odeslaných e-mailů"
      >
        <form
          className={mailStyles.filters}
          onSubmit={(event) => {
            event.preventDefault();
            refresh();
          }}
        >
          <label className={styles.field}>
            <span>Příjemce nebo předmět</span>
            <input
              type="search"
              value={searchInput}
              maxLength={200}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Hledat v e-mailech"
            />
          </label>
          <label className={styles.field}>
            <span>Typ e-mailu</span>
            <select
              value={kindInput}
              onChange={(event) =>
                setKindInput(event.target.value as AdminEmailKind | '')
              }
            >
              <option value="">Všechny typy</option>
              {Object.entries(emailKindLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className={styles.button} type="submit">
            Zobrazit
          </button>
        </form>
        <p className={mailStyles.note}>
          Archiv zahrnuje zprávy přijaté poštovním serverem k odeslání. U
          starších zpráv je dostupný jen dochovaný záznam; dřívější přihlašovací
          e-maily se neevidovaly.
        </p>
        <div className={styles.panelHeader}>
          <p className={styles.muted} role="status">
            {busy && !items.length
              ? 'Načítám e-maily…'
              : `Zobrazeno ${items.length} z ${total}`}
          </p>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={refresh}
            disabled={busy}
          >
            Obnovit
          </button>
        </div>
        {error ? (
          <div className={styles.errorSummary} role="alert">
            <p>{error}</p>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={cursor ? loadMore : refresh}
            >
              Zkusit znovu
            </button>
          </div>
        ) : null}
        {!busy && !error && !items.length ? (
          <div className={styles.empty}>
            <h2>
              {filters.search || filters.kind
                ? 'Žádný e-mail neodpovídá filtrům'
                : 'Zatím žádné odeslané e-maily'}
            </h2>
            <p>
              {filters.search || filters.kind
                ? 'Zkuste jiného příjemce, předmět nebo typ zprávy.'
                : 'Nové odeslané zprávy se zde zobrazí automaticky.'}
            </p>
          </div>
        ) : null}
        <ol
          className={mailStyles.list}
          aria-label="Odeslané zprávy"
          aria-busy={busy}
        >
          {items.map((item) => (
            <li key={item.id}>
              <button
                className={mailStyles.message}
                type="button"
                aria-expanded={selected === item.id}
                aria-controls={`email-${item.id}`}
                onClick={() => {
                  fence.cancel('email-detail');
                  setDetail(null);
                  setDetailError(null);
                  setSelected(selected === item.id ? null : item.id);
                }}
              >
                <strong>{item.subject ?? emailKindLabels[item.kind]}</strong>
                <time
                  className={`${mailStyles.meta} ${mailStyles.time}`}
                  dateTime={item.sentAt}
                >
                  {formatter.format(new Date(item.sentAt))}
                </time>
                <span className={mailStyles.meta}>
                  {item.recipient ?? 'Původní adresa nebyla uložena'}
                </span>
                <span className={mailStyles.meta}>
                  {emailKindLabels[item.kind]}
                  {!item.contentAvailable ? ' · Bez uloženého obsahu' : ''}
                </span>
              </button>
              {selected === item.id ? (
                <div id={`email-${item.id}`} className={mailStyles.detail}>
                  {detail ? (
                    <EmailContent key={detail.id} message={detail} />
                  ) : detailError ? (
                    <div role="alert">
                      <p>{detailError}</p>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => {
                          setDetailError(null);
                          setDetailRevision((value) => value + 1);
                        }}
                      >
                        Načíst obsah znovu
                      </button>
                    </div>
                  ) : (
                    <p role="status">Načítám obsah zprávy…</p>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {cursor ? (
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={busy}
            onClick={loadMore}
          >
            {busy ? 'Načítám…' : 'Načíst další e-maily'}
          </button>
        ) : null}
      </section>
    </div>
  );
};
