'use client';

import {
  adminAuditQuerySchema,
  type AdminAuditCategory,
  type AdminAuditEntry,
  type AdminAuditQuery,
} from '@byzon/domain/contracts/admin';
import { AdminTechnicalDetails } from '@byzon/ui';
import { useEffect, useMemo, useState } from 'react';

import { requestAdminAudit } from '@/lib/admin-api';

import { zonedLocalToIso } from './admin-content-console';
import { adminCountForms, formatCzechCount } from './admin-copy';
import { AdminFormErrorSummary } from './admin-form-error-summary';
import { adminFailureMessage } from './admin-workspace-runtime';
import {
  isAdminSecurityFailure,
  useAdminRequestFence,
  useAdminWorkspace,
} from './admin-workspace-shell';
import styles from './admin-workspace.module.css';

const categoryLabels: Record<AdminAuditCategory, string> = {
  support: 'Účastníci',
  import: 'Aktualizace vstupenek',
  announcement: 'Oznámení',
  role: 'Tým',
  reservation: 'Rezervace',
  settings: 'Nastavení',
  export: 'Reporty',
};

const outcomeLabels: Record<AdminAuditEntry['outcome'], string> = {
  succeeded: 'Provedeno',
  rejected: 'Odmítnuto',
  queued: 'Zařazeno ke zpracování',
};

const actionLabels: Readonly<Record<string, string>> = {
  update_settings: 'Upravil nastavení akce',
  'settings.update': 'Upravil nastavení akce',
  cancel_reservation: 'Zrušil rezervaci',
  'reservation.admin_cancelled': 'Zrušil rezervaci',
  'session.capacity_updated': 'Změnil kapacitu aktivity',
  'announcement.send': 'Odeslal kritické oznámení',
  'role.grant': 'Přiřadil provozní roli',
  'role.revoke': 'Odebral provozní roli',
  'export.queued': 'Zařadil report ke zpracování',
  'export.download': 'Stáhl report',
  'ticket_import.preview_created': 'Načetl změny vstupenek',
  'support.block': 'Zablokoval přístup účastníka',
  'support.reactivate': 'Obnovil přístup účastníka',
  'support.resend': 'Znovu odeslal pozvánku',
};

const actionOptions = [
  ['settings.update', 'Upravil nastavení akce'],
  ['reservation.admin_cancelled', 'Zrušil rezervaci'],
  ['session.capacity_updated', 'Změnil kapacitu aktivity'],
  ['announcement.send', 'Odeslal kritické oznámení'],
  ['role.grant', 'Přiřadil provozní roli'],
  ['role.revoke', 'Odebral provozní roli'],
  ['export.queued', 'Zařadil report ke zpracování'],
] as const;

const actionLabel = (action: string): string =>
  actionLabels[action] ?? 'Jiná provozní změna';

const targetReferenceLabel = (reference: string): string =>
  reference
    .replace(/^event\b/i, 'akce')
    .replace(/^session\b/i, 'aktivita')
    .replace(/^reservation\b/i, 'rezervace');

export const AdminAuditRedesign = () => {
  const { api, eventId, eventTimezone, invalidateSensitive, permissions } =
    useAdminWorkspace();
  const requestFence = useAdminRequestFence();
  const canRead = permissions.includes('audit:read');
  const [category, setCategory] = useState<AdminAuditCategory | 'all'>('all');
  const [action, setAction] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [requestId, setRequestId] = useState('');
  const [items, setItems] = useState<readonly AdminAuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(canRead);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const query = useMemo<AdminAuditQuery | null>(() => {
    try {
      const candidate = adminAuditQuerySchema.safeParse({
        ...(category === 'all' ? {} : { category }),
        ...(action === 'all' ? {} : { action }),
        ...(from ? { from: zonedLocalToIso(from, eventTimezone) } : {}),
        ...(to ? { to: zonedLocalToIso(to, eventTimezone) } : {}),
        ...(requestId ? { requestId } : {}),
        limit: 25,
      });
      return candidate.success ? candidate.data : null;
    } catch {
      return null;
    }
  }, [action, category, eventTimezone, from, requestId, to]);

  useEffect(() => {
    if (!canRead || !query) return;
    const request = requestFence.begin('audit-list');
    void requestAdminAudit(api, eventId, query, request.signal).then(
      (result) => {
        if (!request.isCurrent()) return;
        request.finish();
        setBusy(false);
        if (!result.ok) {
          setItems([]);
          setNextCursor(null);
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
          setItems(result.data.items);
          setNextCursor(result.data.pageInfo.nextCursor);
          setError(null);
        }
      },
    );
    return () => requestFence.cancel('audit-list');
  }, [api, canRead, eventId, invalidateSensitive, query, reload, requestFence]);

  const changeFilters = (change: () => void) => {
    setBusy(true);
    setItems([]);
    setNextCursor(null);
    setError(null);
    change();
  };

  const loadMore = async () => {
    if (!nextCursor || !query) return;
    const request = requestFence.begin('audit-more');
    setBusy(true);
    const result = await requestAdminAudit(
      api,
      eventId,
      { ...query, cursor: nextCursor },
      request.signal,
    );
    if (!request.isCurrent()) return;
    request.finish();
    setBusy(false);
    if (!result.ok) {
      if (isAdminSecurityFailure(result)) {
        setItems([]);
        setNextCursor(null);
        invalidateSensitive(
          adminFailureMessage(result.failure, result.metadata?.requestId),
        );
        return;
      }
      setError(adminFailureMessage(result.failure, result.metadata?.requestId));
      return;
    }
    if (result.kind === 'success') {
      setItems((current) => [...current, ...result.data.items]);
      setNextCursor(result.data.pageInfo.nextCursor);
    }
  };

  if (!canRead) return null;

  return (
    <div className={styles.stack}>
      <header className={styles.pageHeader}>
        <h1>Historie změn</h1>
        <p>
          Zjistěte, kdo, kdy, co a proč změnil. Citlivé hodnoty zůstávají
          skryté.
        </p>
      </header>

      {error ? (
        <AdminFormErrorSummary
          descriptionId="admin-audit-error"
          heading="Historii změn se nepodařilo načíst"
          message={error}
        />
      ) : null}
      {!query ? (
        <AdminFormErrorSummary
          descriptionId="admin-audit-filter-error"
          heading="Zkontrolujte filtry"
          message="Období musí být platné a request ID musí mít podporovaný technický formát."
        />
      ) : null}

      <section className={styles.panel} aria-labelledby="audit-filters-title">
        <div className={styles.panelHeader}>
          <h2 id="audit-filters-title">Filtry</h2>
          <button
            className={styles.secondaryButton}
            onClick={() =>
              changeFilters(() => {
                setCategory('all');
                setAction('all');
                setFrom('');
                setTo('');
                setRequestId('');
                setReload((value) => value + 1);
              })
            }
            type="button"
          >
            Vymazat filtry
          </button>
        </div>
        <div className={styles.filters}>
          <label className={styles.field}>
            <span>Oblast</span>
            <select
              onChange={(event) =>
                changeFilters(() =>
                  setCategory(event.target.value as AdminAuditCategory | 'all'),
                )
              }
              value={category}
            >
              <option value="all">Všechny oblasti</option>
              {(Object.keys(categoryLabels) as AdminAuditCategory[]).map(
                (value) => (
                  <option key={value} value={value}>
                    {categoryLabels[value]}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className={styles.field}>
            <span>Změna</span>
            <select
              onChange={(event) =>
                changeFilters(() => setAction(event.target.value))
              }
              value={action}
            >
              <option value="all">Všechny změny</option>
              {actionOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Od ({eventTimezone})</span>
            <input
              onChange={(event) =>
                changeFilters(() => setFrom(event.target.value))
              }
              type="datetime-local"
              value={from}
            />
          </label>
          <label className={styles.field}>
            <span>Do ({eventTimezone})</span>
            <input
              onChange={(event) =>
                changeFilters(() => setTo(event.target.value))
              }
              type="datetime-local"
              value={to}
            />
          </label>
        </div>
        <AdminTechnicalDetails>
          <label className={styles.field}>
            <span>Request ID</span>
            <input
              onChange={(event) =>
                changeFilters(() => setRequestId(event.target.value))
              }
              placeholder="např. admin-request-0001"
              value={requestId}
            />
            <span className={styles.helper}>
              Uživatel a výsledek zatím server filtrovat neumí.
            </span>
          </label>
        </AdminTechnicalDetails>
      </section>

      <section className={styles.panel} aria-labelledby="audit-results-title">
        <div className={styles.panelHeader}>
          <h2 id="audit-results-title">Změny</h2>
          <span className={styles.badge}>
            {formatCzechCount(items.length, adminCountForms.item)}
          </span>
        </div>
        {busy && query && items.length === 0 ? (
          <p role="status">Načítám historii změn…</p>
        ) : items.length === 0 ? (
          <p className={styles.empty}>
            Zadaným filtrům neodpovídá žádná změna.
          </p>
        ) : (
          <ul className={styles.cardList}>
            {items.map((entry) => (
              <li className={styles.dataCard} key={entry.auditId}>
                <div className={styles.panelHeader}>
                  <div>
                    <strong>{actionLabel(entry.action)}</strong>
                    <p className={styles.muted}>
                      {categoryLabels[entry.category]} · {entry.actorLabel}
                    </p>
                  </div>
                  <span className={styles.statusBadge}>
                    {outcomeLabels[entry.outcome]}
                  </span>
                </div>
                <p>
                  {new Intl.DateTimeFormat('cs-CZ', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: eventTimezone,
                  }).format(new Date(entry.createdAt))}{' '}
                  · {targetReferenceLabel(entry.targetReference)}
                </p>
                <details>
                  <summary>Zobrazit důvod a podrobnosti</summary>
                  <p>{entry.reason}</p>
                  {entry.resultingVersion ? (
                    <p>Výsledná verze: {entry.resultingVersion}</p>
                  ) : null}
                  {entry.redacted ? <p>Citlivé údaje byly skryty.</p> : null}
                  <AdminTechnicalDetails>
                    <dl className={styles.detailList}>
                      <dt>ID auditu</dt>
                      <dd>{entry.auditId}</dd>
                    </dl>
                  </AdminTechnicalDetails>
                </details>
              </li>
            ))}
          </ul>
        )}
        {nextCursor ? (
          <button
            className={styles.secondaryButton}
            disabled={busy}
            onClick={() => void loadMore()}
            type="button"
          >
            Načíst další změny
          </button>
        ) : null}
      </section>
    </div>
  );
};
