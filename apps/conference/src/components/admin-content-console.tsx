'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import {
  adminContentResources,
  browserAdminContentPort,
  isAdminContentSecurityFailure,
  type AdminContentFailure,
  type AdminContentItem,
  type AdminContentPort,
  type AdminContentResource,
} from '../lib/admin-content-api';
import { ADMIN_CONTENT_SCOPE_CHANGE_EVENT } from '../lib/admin-content-dirty-guard';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import { AdminFormErrorSummary } from './admin-form-error-summary';
import styles from './admin-workspace.module.css';

const resourceLabels: Record<AdminContentResource, string> = {
  days: 'Dny',
  venues: 'Místa',
  rooms: 'Místnosti',
  sessions: 'Program',
  speakers: 'Řečníci',
  partners: 'Partneři',
  pages: 'Stránky',
  faqs: 'FAQ',
};

const bodyFieldNames: Partial<Record<AdminContentResource, string>> = {
  venues: 'mapQuery',
  speakers: 'jobTitle',
  partners: 'descriptionMarkdown',
  pages: 'bodyMarkdown',
  faqs: 'answerMarkdown',
};

const emptyReferences = (): {
  days: readonly AdminContentItem[];
  rooms: readonly AdminContentItem[];
  speakers: readonly AdminContentItem[];
  venues: readonly AdminContentItem[];
} => ({ days: [], rooms: [], speakers: [], venues: [] });

export const localInputValue = (value: unknown, timezone: string) => {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(String(value)));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
};

export const zonedLocalToIso = (value: string, timezone: string) => {
  const [date, time] = value.split('T');
  const [year, month, day] = date?.split('-').map(Number) ?? [];
  const [hour, minute] = time?.split(':').map(Number) ?? [];
  if (!year || !month || !day || hour === undefined || minute === undefined) {
    throw new TypeError('Local date and time are incomplete.');
  }
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute);
  const parsedDate = new Date(wallClockUtc);
  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== month - 1 ||
    parsedDate.getUTCDate() !== day ||
    parsedDate.getUTCHours() !== hour ||
    parsedDate.getUTCMinutes() !== minute
  ) {
    throw new TypeError('Local date and time are invalid.');
  }
  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  });
  const localFormatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const offsetAt = (instant: number): number => {
    const offsetName = offsetFormatter
      .formatToParts(new Date(instant))
      .find(({ type }) => type === 'timeZoneName')?.value;
    if (offsetName === 'GMT') return 0;
    const match = offsetName?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!match) throw new TypeError('Timezone offset is unavailable.');
    return (
      (Number(match[2]) * 60 + Number(match[3] ?? 0)) *
      (match[1] === '+' ? 1 : -1)
    );
  };
  const expected = `${String(year).padStart(4, '0')}-${String(month).padStart(
    2,
    '0',
  )}-${String(day).padStart(2, '0')} ${String(hour).padStart(
    2,
    '0',
  )}:${String(minute).padStart(2, '0')}`;
  const offsets = new Set<number>();
  for (let deltaHours = -36; deltaHours <= 36; deltaHours += 6) {
    offsets.add(offsetAt(wallClockUtc + deltaHours * 3_600_000));
  }
  const candidates = [...offsets]
    .map((offset) => wallClockUtc - offset * 60_000)
    .filter(
      (instant) =>
        localFormatter.format(new Date(instant)).replace('T', ' ') === expected,
    )
    .sort((left, right) => left - right);
  if (candidates.length === 0) {
    throw new TypeError('Local time does not exist in the selected timezone.');
  }
  if (candidates.length > 1) {
    throw new TypeError('Local time is ambiguous in the selected timezone.');
  }
  return new Date(candidates[0]!).toISOString();
};

class AdminContentFormError extends Error {
  readonly fieldErrors: Readonly<Record<string, string>>;

  constructor(fieldErrors: Readonly<Record<string, string>>) {
    super('Admin content form is invalid.');
    this.fieldErrors = fieldErrors;
  }
}

export const adminContentBodyFromForm = (
  resource: AdminContentResource,
  form: FormData,
  timezone: string,
  editing?: AdminContentItem | null,
): Record<string, unknown> => {
  const value = (name: string) => String(form.get(name) ?? '').trim();
  let body: Record<string, unknown> = {
    sortOrder: Number(value('sortOrder') || 0),
  };
  if (resource === 'days') {
    body = {
      ...body,
      description: value('description') || null,
      localDate: value('localDate'),
      title: value('title'),
    };
  }
  if (resource === 'venues') {
    body = {
      ...body,
      slug: value('slug'),
      name: value('title'),
      mapQuery: value('mapQuery') || null,
      navigationMarkdown: value('navigationMarkdown') || null,
    };
  }
  if (resource === 'rooms') {
    body = {
      ...body,
      venueId: value('venueId'),
      slug: value('slug'),
      name: value('title'),
      description: value('description') || null,
      capacity: value('capacity') ? Number(value('capacity')) : null,
    };
  }
  if (resource === 'sessions') {
    const instant = (field: 'startsAt' | 'endsAt'): string => {
      try {
        return zonedLocalToIso(value(field), timezone);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'Invalid local time';
        const message = reason.includes('ambiguous')
          ? 'Tento místní čas nastává při změně času dvakrát. Zvolte jednoznačný čas mimo přechod.'
          : reason.includes('does not exist')
            ? 'Tento místní čas při změně času neexistuje. Zvolte jiný čas.'
            : 'Vyplňte platné datum a čas.';
        throw new AdminContentFormError({ [field]: message });
      }
    };
    const startsAt = instant('startsAt');
    const endsAt = instant('endsAt');
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new AdminContentFormError({
        endsAt: 'Konec musí následovat po začátku.',
      });
    }
    body = {
      ...body,
      dayId: value('dayId'),
      roomId: value('roomId') || null,
      slug: value('slug'),
      title: value('title'),
      type: value('type') || 'other',
      startsAt,
      endsAt,
      summary: value('summary') || null,
      description: value('description') || null,
      status: value('status') || undefined,
      speakerIds: form.getAll('speakerIds').map(String),
    };
  }
  if (resource === 'speakers') {
    const names = value('title').split(/\s+/).filter(Boolean);
    if (names.length < 2) {
      throw new AdminContentFormError({
        title: 'Zadejte jméno i příjmení.',
      });
    }
    body = {
      ...body,
      slug: value('slug'),
      firstName: names.slice(0, -1).join(' '),
      lastName: names.at(-1),
      jobTitle: value('jobTitle') || null,
      company: value('company') || null,
      bioMarkdown: value('bioMarkdown') || null,
      linkedinUrl: value('linkedinUrl') || null,
      websiteUrl: value('websiteUrl') || null,
    };
  }
  if (resource === 'partners') {
    body = {
      ...body,
      slug: value('slug'),
      name: value('title'),
      descriptionMarkdown: value('descriptionMarkdown') || null,
      websiteUrl: value('websiteUrl') || null,
      category: value('category') || null,
      tier: value('tier') || null,
    };
  }
  if (resource === 'pages') {
    body = {
      ...body,
      slug: value('slug'),
      kind: value('kind') || 'practical',
      title: value('title'),
      summary: value('summary') || null,
      bodyMarkdown: value('bodyMarkdown'),
    };
  }
  if (resource === 'faqs') {
    body = {
      ...body,
      question: value('title'),
      category: value('category') || null,
      answerMarkdown: value('answerMarkdown'),
    };
  }
  if (resource !== 'days' && value('status')) {
    body.status = value('status');
  }
  if (editing?.version !== undefined) body.version = editing.version;
  return body;
};

const itemLabel = (item: AdminContentItem): string =>
  String(
    item.title ??
      item.name ??
      item.question ??
      item.localDate ??
      'Položka bez názvu',
  );

const failureMessage = (failure: AdminContentFailure): string =>
  failure.requestId
    ? `${failure.message} Reference požadavku: ${failure.requestId}.`
    : failure.message;

const fieldLabels: Readonly<Record<string, string>> = {
  answerMarkdown: 'Odpověď',
  bioMarkdown: 'Bio',
  bodyMarkdown: 'Text stránky',
  capacity: 'Kapacita',
  category: 'Kategorie',
  company: 'Firma',
  content: 'Obsah',
  dayId: 'Den',
  description: 'Popis',
  endsAt: 'Konec',
  linkedinUrl: 'LinkedIn URL',
  localDate: 'Datum',
  mapQuery: 'Mapa',
  navigationMarkdown: 'Navigační pokyny',
  roomId: 'Místnost',
  slug: 'Slug',
  sortOrder: 'Pořadí',
  speakerIds: 'Řečníci',
  startsAt: 'Začátek',
  status: 'Stav',
  summary: 'Shrnutí',
  tier: 'Úroveň',
  title: 'Název nebo otázka',
  type: 'Typ',
  venueId: 'Místo',
  websiteUrl: 'Web URL',
};

const failureDetails = (
  errors: Readonly<Record<string, string>>,
): readonly string[] =>
  Object.entries(errors).map(
    ([field, message]) => `${fieldLabels[field] ?? field}: ${message}`,
  );

const requiresReconciliation = (failure: AdminContentFailure): boolean =>
  failure.kind === 'stale' ||
  failure.kind === 'transport' ||
  failure.kind === 'invalid_response' ||
  failure.kind === 'server';

const useUnsavedContentGuard = (dirty: boolean) => {
  const allowed = useRef(false);
  const guardedUrl = useRef('');
  useEffect(() => {
    if (!dirty) {
      allowed.current = false;
      guardedUrl.current = '';
      return;
    }
    guardedUrl.current = window.location.href;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowed.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const confirmLeave = (): boolean =>
      window.confirm(
        'Opravdu chcete editor opustit? Neuložené změny se zahodí.',
      );
    const guardLink = (event: MouseEvent) => {
      if (
        allowed.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href]')
          : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) {
        return;
      }
      const current = new URL(window.location.href);
      const destination = new URL(link.href, current);
      if (
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search &&
        destination.hash !== current.hash
      ) {
        return;
      }
      if (!confirmLeave()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      allowed.current = true;
    };
    const historyGuardToken = `admin-content-${crypto.randomUUID()}`;
    const state =
      window.history.state && typeof window.history.state === 'object'
        ? window.history.state
        : {};
    window.history.pushState(
      { ...state, __byzonAdminContentGuard: historyGuardToken },
      '',
      guardedUrl.current,
    );
    const guardPopState = () => {
      if (allowed.current) return;
      if (confirmLeave()) {
        allowed.current = true;
        window.history.back();
        return;
      }
      const currentState =
        window.history.state && typeof window.history.state === 'object'
          ? window.history.state
          : {};
      window.history.pushState(
        {
          ...currentState,
          __byzonAdminContentGuard: historyGuardToken,
        },
        '',
        guardedUrl.current,
      );
    };
    const guardScopeChange = (event: Event) => {
      if (allowed.current || confirmLeave()) {
        allowed.current = true;
        return;
      }
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', guardPopState);
    window.addEventListener(ADMIN_CONTENT_SCOPE_CHANGE_EVENT, guardScopeChange);
    document.addEventListener('click', guardLink, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('popstate', guardPopState);
      if (
        window.history.state?.__byzonAdminContentGuard === historyGuardToken
      ) {
        window.history.back();
      }
      window.removeEventListener(
        ADMIN_CONTENT_SCOPE_CHANGE_EVENT,
        guardScopeChange,
      );
      document.removeEventListener('click', guardLink, true);
    };
  }, [dirty]);
};

const FieldError = ({
  errors,
  name,
}: {
  readonly errors: Readonly<Record<string, string>>;
  readonly name: string;
}) =>
  errors[name] ? (
    <span className={styles.fieldError} id={`admin-content-${name}-error`}>
      {errors[name]}
    </span>
  ) : null;

const fieldA11y = (errors: Readonly<Record<string, string>>, name: string) => ({
  'aria-describedby': errors[name] ? `admin-content-${name}-error` : undefined,
  'aria-invalid': errors[name] ? (true as const) : undefined,
});

const nativeFieldErrors = (
  form: HTMLFormElement,
): Readonly<Record<string, string>> => {
  const errors: Record<string, string> = {};
  Array.from(form.elements).forEach((element) => {
    if (
      !(
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
      ) ||
      !element.name ||
      element.validity.valid
    ) {
      return;
    }
    errors[element.name] = element.validity.valueMissing
      ? 'Vyplňte povinné pole.'
      : element.validity.patternMismatch
        ? 'Dodržte požadovaný formát hodnoty.'
        : element.validity.typeMismatch
          ? 'Zadejte platnou hodnotu.'
          : element.validity.rangeUnderflow
            ? 'Hodnota je nižší než povolené minimum.'
            : element.validity.rangeOverflow
              ? 'Hodnota překračuje povolené maximum.'
              : 'Zkontrolujte hodnotu tohoto pole.';
  });
  return errors;
};

export const AdminContentConsole = ({
  eventId,
  onContentChanged,
  onDirtyChange,
  onSecurityFailure,
  port = browserAdminContentPort,
  readOnly = false,
  timezone,
}: {
  readonly eventId: string;
  readonly onContentChanged?: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly onSecurityFailure?: (failure: AdminContentFailure) => void;
  readonly port?: AdminContentPort;
  readonly readOnly?: boolean;
  readonly timezone: string;
}) => {
  const [resource, setResource] = useState<AdminContentResource>('sessions');
  const [selectedResource, setSelectedResource] =
    useState<AdminContentResource>('sessions');
  const [items, setItems] = useState<readonly AdminContentItem[]>([]);
  const [references, setReferences] = useState(emptyReferences);
  const [editing, setEditing] = useState<AdminContentItem | null>(null);
  const [archiveCandidate, setArchiveCandidate] =
    useState<AdminContentItem | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'loading' | 'saving' | 'archiving' | null>(
    'loading',
  );
  const [error, setError] = useState<AdminContentFailure | null>(null);
  const [message, setMessage] = useState('');
  const [loadRequest, setLoadRequest] = useState({
    resource: 'sessions' as AdminContentResource,
    sequence: 0,
  });
  const [reconciliationRequired, setReconciliationRequired] = useState(false);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [localFormAvailable, setLocalFormAvailable] = useState(false);
  const operationLocked = useRef(false);
  const activeMutation = useRef<AbortController | null>(null);
  const activeResource = useRef<AdminContentResource>('sessions');

  useUnsavedContentGuard(dirty);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  useEffect(
    () => () => {
      activeMutation.current?.abort();
      activeMutation.current = null;
      operationLocked.current = false;
    },
    [eventId, port],
  );

  const wipe = useCallback(() => {
    setItems([]);
    setReferences(emptyReferences());
    setEditing(null);
    setArchiveCandidate(null);
    setDirty(false);
    setMessage('');
    setSnapshotReady(false);
    setLocalFormAvailable(false);
    setReconciliationRequired(false);
  }, []);

  const acceptFailure = useCallback(
    (failure: AdminContentFailure) => {
      if (failure.kind === 'aborted') return;
      if (isAdminContentSecurityFailure(failure)) {
        wipe();
        onSecurityFailure?.(failure);
        return;
      }
      setError(failure);
    },
    [onSecurityFailure, wipe],
  );

  useEffect(() => {
    const controller = new AbortController();
    const targetResource = loadRequest.resource;
    // Scope changes intentionally invalidate every rendered row before the
    // replacement snapshot starts loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusy('loading');
    setError(null);
    setItems([]);
    setReferences(emptyReferences());
    setSnapshotReady(false);
    const referenceResources = ['days', 'venues', 'rooms', 'speakers'] as const;
    void Promise.all([
      port.list(eventId, targetResource, controller.signal),
      ...referenceResources.map((reference) =>
        port.list(eventId, reference, controller.signal),
      ),
    ]).then(([primary, ...referenceResults]) => {
      if (controller.signal.aborted) return;
      setBusy(null);
      if (!primary.ok) {
        setSelectedResource(activeResource.current);
        acceptFailure(primary.failure);
        return;
      }
      const referenceFailure = referenceResults.find(
        (result) => result && !result.ok,
      );
      if (referenceFailure && !referenceFailure.ok) {
        setSelectedResource(activeResource.current);
        acceptFailure(referenceFailure.failure);
        return;
      }
      activeResource.current = targetResource;
      setResource(targetResource);
      setSelectedResource(targetResource);
      setItems(primary.data.items);
      const next = emptyReferences();
      referenceResults.forEach((result, index) => {
        if (result?.ok) {
          next[referenceResources[index]!] = result.data.items;
        }
      });
      setReferences(next);
      setEditing(null);
      setDirty(false);
      setReconciliationRequired(false);
      setSnapshotReady(true);
      setLocalFormAvailable(true);
    });
    return () => controller.abort();
  }, [acceptFailure, eventId, loadRequest, port]);

  const changeResource = (next: AdminContentResource) => {
    if (
      dirty &&
      !window.confirm(
        'Změnit oblast a zahodit neuložené změny tohoto formuláře?',
      )
    ) {
      return;
    }
    setSelectedResource(next);
    setError(null);
    setMessage('');
    setLoadRequest(({ sequence }) => ({
      resource: next,
      sequence: sequence + 1,
    }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (operationLocked.current || readOnly || reconciliationRequired) return;
    const formElement = event.currentTarget;
    setMessage('');
    setError(null);
    if (!formElement.checkValidity()) {
      const fieldErrors = nativeFieldErrors(formElement);
      setError({
        kind: 'validation',
        message: 'Zkontrolujte povinná a neplatná pole formuláře.',
        fieldErrors,
      });
      window.requestAnimationFrame(() =>
        formElement.querySelector<HTMLElement>(':invalid')?.focus(),
      );
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = adminContentBodyFromForm(
        resource,
        new FormData(formElement),
        timezone,
        editing,
      );
    } catch (formError) {
      const fieldErrors =
        formError instanceof AdminContentFormError
          ? formError.fieldErrors
          : undefined;
      setError({
        kind: 'validation',
        message: 'Zkontrolujte označená pole formuláře.',
        ...(fieldErrors ? { fieldErrors } : {}),
      });
      const firstField = fieldErrors ? Object.keys(fieldErrors)[0] : undefined;
      window.requestAnimationFrame(() =>
        (firstField
          ? formElement.elements.namedItem(firstField)
          : null) instanceof HTMLElement
          ? (formElement.elements.namedItem(firstField!) as HTMLElement).focus()
          : undefined,
      );
      return;
    }
    operationLocked.current = true;
    setBusy('saving');
    const controller = new AbortController();
    activeMutation.current = controller;
    const result = await port.save({
      body,
      eventId,
      ...(editing ? { id: editing.id } : {}),
      resource,
      signal: controller.signal,
    });
    if (controller.signal.aborted || activeMutation.current !== controller) {
      return;
    }
    activeMutation.current = null;
    operationLocked.current = false;
    setBusy(null);
    if (!result.ok) {
      acceptFailure(result.failure);
      if (requiresReconciliation(result.failure)) {
        setReconciliationRequired(true);
        setItems([]);
        setReferences(emptyReferences());
        setSnapshotReady(false);
        onContentChanged?.();
      }
      return;
    }
    setMessage(
      result.data.status === 'created'
        ? 'Položka byla vytvořena a potvrzena serverem.'
        : 'Položka byla upravena a potvrzena serverem.',
    );
    setEditing(null);
    setDirty(false);
    onContentChanged?.();
    setLoadRequest(({ sequence }) => ({
      resource,
      sequence: sequence + 1,
    }));
  };

  const archive = async () => {
    const candidate = archiveCandidate;
    if (
      !candidate ||
      operationLocked.current ||
      readOnly ||
      reconciliationRequired
    ) {
      return;
    }
    operationLocked.current = true;
    setBusy('archiving');
    setError(null);
    setArchiveCandidate(null);
    const controller = new AbortController();
    activeMutation.current = controller;
    const result = await port.archive({
      eventId,
      id: candidate.id,
      resource,
      ...(candidate.version === undefined
        ? {}
        : { version: candidate.version }),
      signal: controller.signal,
    });
    if (controller.signal.aborted || activeMutation.current !== controller) {
      return;
    }
    activeMutation.current = null;
    operationLocked.current = false;
    setBusy(null);
    if (!result.ok) {
      acceptFailure(result.failure);
      if (requiresReconciliation(result.failure)) {
        setReconciliationRequired(true);
        setItems([]);
        setReferences(emptyReferences());
        setSnapshotReady(false);
        onContentChanged?.();
      }
      return;
    }
    setMessage(
      resource === 'days'
        ? 'Den byl trvale smazán a změna byla potvrzena serverem.'
        : 'Položka byla archivována a potvrzena serverem.',
    );
    onContentChanged?.();
    setLoadRequest(({ sequence }) => ({
      resource,
      sequence: sequence + 1,
    }));
  };

  const fieldErrors = error?.fieldErrors ?? {};
  const working = busy !== null;
  const writesBlocked = working || reconciliationRequired || !snapshotReady;
  const bodyFieldName = bodyFieldNames[resource];

  const requestReload = () => {
    if (
      dirty &&
      !window.confirm(
        'Načíst aktuální stav a zahodit neuložené změny formuláře?',
      )
    ) {
      return;
    }
    setSelectedResource(resource);
    setLoadRequest(({ sequence }) => ({
      resource,
      sequence: sequence + 1,
    }));
  };

  return (
    <section
      aria-labelledby="admin-content-editor-title"
      className={styles.contentEditor}
    >
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>Jediný editor obsahu</p>
          <h2 id="admin-content-editor-title">
            Program a publikované informace
          </h2>
        </div>
        {readOnly ? (
          <span className={styles.statusBadge}>Archiv · pouze čtení</span>
        ) : null}
      </div>

      <label className={styles.field}>
        <span>Oblast obsahu</span>
        <select
          aria-label="Oblast obsahu"
          disabled={working}
          onChange={(event) =>
            changeResource(event.target.value as AdminContentResource)
          }
          value={selectedResource}
        >
          {adminContentResources.map((item) => (
            <option key={item} value={item}>
              {resourceLabels[item]}
            </option>
          ))}
        </select>
      </label>

      {error ? (
        <AdminFormErrorSummary
          descriptionId="admin-content-form-error"
          details={failureDetails(fieldErrors)}
          heading={
            error.kind === 'stale'
              ? 'Snapshot obsahu se změnil'
              : reconciliationRequired
                ? 'Výsledek změny není potvrzen'
                : error.kind === 'conflict'
                  ? 'Změna koliduje s obsahem'
                  : 'Obsahovou operaci nelze dokončit'
          }
          message={failureMessage(error)}
        />
      ) : null}

      {message ? (
        <p className={styles.success} role="status">
          {message}
        </p>
      ) : null}

      {reconciliationRequired ? (
        <p className={styles.warning} role="status">
          {error?.kind === 'stale'
            ? 'Další zápisy jsou zamčené. Lokální formulář zůstal zachovaný; před načtením kanonického stavu potvrďte jeho zahození.'
            : 'Další zápisy jsou zamčené. Nejdřív načtěte kanonický stav; rozepsaný formulář zůstane zachovaný, dokud načtení nepotvrdíte.'}
        </p>
      ) : null}

      {!reconciliationRequired &&
      !snapshotReady &&
      localFormAvailable &&
      error ? (
        <p className={styles.warning} role="status">
          Nový snapshot se nepodařilo potvrdit. Lokální formulář zůstal
          zachovaný pouze pro kontrolu; zápisy jsou uzamčené, dokud nenačtete
          aktuální stav.
        </p>
      ) : null}

      {!readOnly && localFormAvailable ? (
        <form
          aria-busy={busy === 'loading'}
          className={styles.contentForm}
          inert={snapshotReady ? undefined : true}
          key={`${resource}:${editing?.id ?? 'new'}`}
          noValidate
          onChange={() => {
            if (!snapshotReady) return;
            setDirty(true);
            onDirtyChange?.(true);
          }}
          onSubmit={submit}
        >
          <div className={styles.panelHeader}>
            <h3>{editing ? 'Upravit položku' : 'Nová položka'}</h3>
            {dirty ? (
              <span className={styles.badge}>Neuložené změny</span>
            ) : null}
          </div>
          {resource === 'days' ? (
            <label className={styles.field}>
              <span>Datum</span>
              <input
                defaultValue={String(editing?.localDate ?? '')}
                name="localDate"
                required
                type="date"
                {...fieldA11y(fieldErrors, 'localDate')}
              />
              <FieldError errors={fieldErrors} name="localDate" />
            </label>
          ) : null}
          {resource !== 'days' && resource !== 'faqs' ? (
            <label className={styles.field}>
              <span>Slug</span>
              <input
                defaultValue={String(editing?.slug ?? '')}
                name="slug"
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                required
                {...fieldA11y(fieldErrors, 'slug')}
              />
              <FieldError errors={fieldErrors} name="slug" />
            </label>
          ) : null}
          {resource === 'rooms' ? (
            <label className={styles.field}>
              <span>Místo</span>
              <select
                defaultValue={String(editing?.venueId ?? '')}
                name="venueId"
                required
                {...fieldA11y(fieldErrors, 'venueId')}
              >
                <option value="">Vyberte místo</option>
                {references.venues.map((item) => (
                  <option key={item.id} value={item.id}>
                    {String(item.name)}
                  </option>
                ))}
              </select>
              <FieldError errors={fieldErrors} name="venueId" />
            </label>
          ) : null}
          {resource === 'sessions' ? (
            <>
              <label className={styles.field}>
                <span>Den</span>
                <select
                  defaultValue={String(editing?.dayId ?? '')}
                  name="dayId"
                  required
                  {...fieldA11y(fieldErrors, 'dayId')}
                >
                  <option value="">Vyberte den</option>
                  {references.days.map((item) => (
                    <option key={item.id} value={item.id}>
                      {itemLabel(item)}
                    </option>
                  ))}
                </select>
                <FieldError errors={fieldErrors} name="dayId" />
              </label>
              <label className={styles.field}>
                <span>Místnost</span>
                <select
                  defaultValue={String(editing?.roomId ?? '')}
                  name="roomId"
                  {...fieldA11y(fieldErrors, 'roomId')}
                >
                  <option value="">Bez místnosti</option>
                  {references.rooms.map((item) => (
                    <option key={item.id} value={item.id}>
                      {itemLabel(item)}
                    </option>
                  ))}
                </select>
                <FieldError errors={fieldErrors} name="roomId" />
              </label>
              <label className={styles.field}>
                <span>Začátek ({timezone})</span>
                <input
                  defaultValue={localInputValue(editing?.startsAt, timezone)}
                  name="startsAt"
                  required
                  type="datetime-local"
                  {...fieldA11y(fieldErrors, 'startsAt')}
                />
                <FieldError errors={fieldErrors} name="startsAt" />
              </label>
              <label className={styles.field}>
                <span>Konec ({timezone})</span>
                <input
                  defaultValue={localInputValue(editing?.endsAt, timezone)}
                  name="endsAt"
                  required
                  type="datetime-local"
                  {...fieldA11y(fieldErrors, 'endsAt')}
                />
                <FieldError errors={fieldErrors} name="endsAt" />
              </label>
              <label className={styles.field}>
                <span>Typ</span>
                <select
                  defaultValue={String(editing?.type ?? 'talk')}
                  name="type"
                  {...fieldA11y(fieldErrors, 'type')}
                >
                  <option value="talk">Přednáška</option>
                  <option value="panel">Panel</option>
                  <option value="workshop">Workshop</option>
                  <option value="mastermind">Mastermind</option>
                  <option value="coaching">Koučink</option>
                  <option value="networking">Networking</option>
                  <option value="break">Přestávka</option>
                  <option value="meal">Jídlo</option>
                  <option value="gala">Gala</option>
                  <option value="other">Jiné</option>
                </select>
                <FieldError errors={fieldErrors} name="type" />
              </label>
              <label className={styles.field}>
                <span>Řečníci</span>
                <select
                  defaultValue={
                    (editing?.speakerIds as string[] | undefined) ?? []
                  }
                  multiple
                  name="speakerIds"
                  {...fieldA11y(fieldErrors, 'speakerIds')}
                >
                  {references.speakers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {`${String(item.firstName)} ${String(item.lastName)}`}
                    </option>
                  ))}
                </select>
                <FieldError errors={fieldErrors} name="speakerIds" />
              </label>
            </>
          ) : null}
          {resource === 'rooms' ? (
            <label className={styles.field}>
              <span>Kapacita</span>
              <input
                defaultValue={
                  editing?.capacity == null ? '' : String(editing.capacity)
                }
                min="1"
                name="capacity"
                type="number"
                {...fieldA11y(fieldErrors, 'capacity')}
              />
              <FieldError errors={fieldErrors} name="capacity" />
            </label>
          ) : null}
          <label className={styles.field}>
            <span>
              {resource === 'faqs'
                ? 'Otázka'
                : resource === 'speakers'
                  ? 'Celé jméno'
                  : 'Název'}
            </span>
            <input
              defaultValue={String(
                editing?.title ??
                  editing?.name ??
                  editing?.question ??
                  (resource === 'speakers'
                    ? `${String(editing?.firstName ?? '')} ${String(
                        editing?.lastName ?? '',
                      )}`.trim()
                    : ''),
              )}
              name="title"
              required
              {...fieldA11y(fieldErrors, 'title')}
            />
            <FieldError errors={fieldErrors} name="title" />
          </label>
          {bodyFieldName ? (
            <label className={`${styles.field} ${styles.contentWide}`}>
              <span>{resource === 'faqs' ? 'Odpověď' : 'Text'}</span>
              <textarea
                defaultValue={String(
                  editing?.bodyMarkdown ??
                    editing?.answerMarkdown ??
                    editing?.descriptionMarkdown ??
                    editing?.jobTitle ??
                    editing?.mapQuery ??
                    '',
                )}
                name={bodyFieldName}
                required={resource === 'pages' || resource === 'faqs'}
                {...fieldA11y(fieldErrors, bodyFieldName)}
              />
              <FieldError errors={fieldErrors} name={bodyFieldName} />
            </label>
          ) : null}
          {resource === 'venues' ? (
            <label className={`${styles.field} ${styles.contentWide}`}>
              <span>Navigační pokyny</span>
              <textarea
                defaultValue={String(editing?.navigationMarkdown ?? '')}
                name="navigationMarkdown"
                {...fieldA11y(fieldErrors, 'navigationMarkdown')}
              />
              <FieldError errors={fieldErrors} name="navigationMarkdown" />
            </label>
          ) : null}
          {resource === 'days' || resource === 'rooms' ? (
            <label className={`${styles.field} ${styles.contentWide}`}>
              <span>Popis</span>
              <textarea
                defaultValue={String(editing?.description ?? '')}
                name="description"
                {...fieldA11y(fieldErrors, 'description')}
              />
              <FieldError errors={fieldErrors} name="description" />
            </label>
          ) : null}
          {resource === 'sessions' ? (
            <>
              <label className={`${styles.field} ${styles.contentWide}`}>
                <span>Shrnutí</span>
                <textarea
                  defaultValue={String(editing?.summary ?? '')}
                  name="summary"
                  {...fieldA11y(fieldErrors, 'summary')}
                />
                <FieldError errors={fieldErrors} name="summary" />
              </label>
              <label className={`${styles.field} ${styles.contentWide}`}>
                <span>Detail</span>
                <textarea
                  defaultValue={String(editing?.description ?? '')}
                  name="description"
                  {...fieldA11y(fieldErrors, 'description')}
                />
                <FieldError errors={fieldErrors} name="description" />
              </label>
            </>
          ) : null}
          {resource === 'speakers' ? (
            <>
              <label className={styles.field}>
                <span>Firma</span>
                <input
                  defaultValue={String(editing?.company ?? '')}
                  name="company"
                  {...fieldA11y(fieldErrors, 'company')}
                />
                <FieldError errors={fieldErrors} name="company" />
              </label>
              <label className={`${styles.field} ${styles.contentWide}`}>
                <span>Bio</span>
                <textarea
                  defaultValue={String(editing?.bioMarkdown ?? '')}
                  name="bioMarkdown"
                  {...fieldA11y(fieldErrors, 'bioMarkdown')}
                />
                <FieldError errors={fieldErrors} name="bioMarkdown" />
              </label>
              <label className={styles.field}>
                <span>LinkedIn URL</span>
                <input
                  defaultValue={String(editing?.linkedinUrl ?? '')}
                  name="linkedinUrl"
                  type="url"
                  {...fieldA11y(fieldErrors, 'linkedinUrl')}
                />
                <FieldError errors={fieldErrors} name="linkedinUrl" />
              </label>
              <label className={styles.field}>
                <span>Web URL</span>
                <input
                  defaultValue={String(editing?.websiteUrl ?? '')}
                  name="websiteUrl"
                  type="url"
                  {...fieldA11y(fieldErrors, 'websiteUrl')}
                />
                <FieldError errors={fieldErrors} name="websiteUrl" />
              </label>
            </>
          ) : null}
          {resource === 'partners' ? (
            <>
              <label className={styles.field}>
                <span>Web URL</span>
                <input
                  defaultValue={String(editing?.websiteUrl ?? '')}
                  name="websiteUrl"
                  type="url"
                  {...fieldA11y(fieldErrors, 'websiteUrl')}
                />
                <FieldError errors={fieldErrors} name="websiteUrl" />
              </label>
              <label className={styles.field}>
                <span>Kategorie</span>
                <input
                  defaultValue={String(editing?.category ?? '')}
                  name="category"
                  {...fieldA11y(fieldErrors, 'category')}
                />
                <FieldError errors={fieldErrors} name="category" />
              </label>
              <label className={styles.field}>
                <span>Úroveň</span>
                <input
                  defaultValue={String(editing?.tier ?? '')}
                  name="tier"
                  {...fieldA11y(fieldErrors, 'tier')}
                />
                <FieldError errors={fieldErrors} name="tier" />
              </label>
            </>
          ) : null}
          {resource === 'pages' ? (
            <>
              <label className={styles.field}>
                <span>Druh</span>
                <select
                  defaultValue={String(editing?.kind ?? 'practical')}
                  name="kind"
                  {...fieldA11y(fieldErrors, 'kind')}
                >
                  <option value="practical">Praktické</option>
                  <option value="marketing">Marketing</option>
                  <option value="other">Jiné</option>
                </select>
                <FieldError errors={fieldErrors} name="kind" />
              </label>
              <label className={styles.field}>
                <span>Shrnutí</span>
                <input
                  defaultValue={String(editing?.summary ?? '')}
                  name="summary"
                  {...fieldA11y(fieldErrors, 'summary')}
                />
                <FieldError errors={fieldErrors} name="summary" />
              </label>
            </>
          ) : null}
          {resource === 'faqs' ? (
            <label className={styles.field}>
              <span>Kategorie</span>
              <input
                defaultValue={String(editing?.category ?? '')}
                name="category"
                {...fieldA11y(fieldErrors, 'category')}
              />
              <FieldError errors={fieldErrors} name="category" />
            </label>
          ) : null}
          {resource !== 'days' ? (
            <label className={styles.field}>
              <span>Stav</span>
              <select
                defaultValue={String(editing?.status ?? 'draft')}
                name="status"
                {...fieldA11y(fieldErrors, 'status')}
              >
                <option value="draft">Draft</option>
                <option value="published">Publikováno</option>
                {resource === 'sessions' ? (
                  <option value="cancelled">Zrušeno</option>
                ) : null}
              </select>
              <FieldError errors={fieldErrors} name="status" />
            </label>
          ) : null}
          <label className={styles.field}>
            <span>Pořadí</span>
            <input
              defaultValue={String(editing?.sortOrder ?? 0)}
              min="0"
              name="sortOrder"
              type="number"
              {...fieldA11y(fieldErrors, 'sortOrder')}
            />
            <FieldError errors={fieldErrors} name="sortOrder" />
          </label>
          {busy === 'loading' ? null : (
            <div className={`${styles.actionRow} ${styles.contentWide}`}>
              <button
                className={styles.button}
                disabled={writesBlocked}
                type="submit"
              >
                {busy === 'saving'
                  ? 'Ukládám…'
                  : editing
                    ? 'Uložit změny'
                    : 'Vytvořit položku'}
              </button>
              {editing || dirty ? (
                <button
                  className={styles.secondaryButton}
                  disabled={writesBlocked}
                  onClick={() => {
                    if (
                      dirty &&
                      !window.confirm('Zahodit neuložené změny formuláře?')
                    ) {
                      return;
                    }
                    setEditing(null);
                    setDirty(false);
                    setError(null);
                  }}
                  type="button"
                >
                  Zrušit úpravy
                </button>
              ) : null}
            </div>
          )}
        </form>
      ) : readOnly ? (
        <p className={styles.callout}>
          Archivovaný event je pouze ke čtení. Obsah ani publikaci nelze měnit.
        </p>
      ) : (
        <p className={styles.muted} role="status">
          {busy === 'loading'
            ? 'Editor se připravuje z aktuálního snapshotu…'
            : 'Editor zůstává uzamčený, dokud se nenačte úplný aktuální snapshot.'}
        </p>
      )}

      <section
        aria-busy={busy === 'loading'}
        aria-labelledby="content-list-title"
      >
        <div className={styles.panelHeader}>
          <h3 id="content-list-title">{resourceLabels[resource]}</h3>
          <button
            className={styles.secondaryButton}
            disabled={working}
            onClick={requestReload}
            type="button"
          >
            Načíst aktuální stav
          </button>
        </div>
        {busy === 'loading' ? (
          <p role="status">Načítám obsah…</p>
        ) : !snapshotReady ? (
          <p className={styles.empty} role="status">
            Aktuální seznam není dostupný. Zkuste znovu načíst celý snapshot.
          </p>
        ) : items.length === 0 ? (
          <p className={styles.empty} role="status">
            V této oblasti zatím není žádná položka.
          </p>
        ) : (
          <ul className={styles.contentList}>
            {items.map((item) => (
              <li key={item.id}>
                <span>
                  <strong>{itemLabel(item)}</strong>
                  <small>
                    {String(item.status ?? 'bez stavového příznaku')} · verze{' '}
                    {String(item.version ?? '—')}
                  </small>
                </span>
                {!readOnly ? (
                  <span className={styles.contentActions}>
                    <button
                      aria-label={`Upravit: ${itemLabel(item)}`}
                      className={styles.secondaryButton}
                      disabled={writesBlocked || item.status === 'archived'}
                      onClick={() => {
                        if (
                          dirty &&
                          !window.confirm(
                            'Otevřít jinou položku a zahodit neuložené změny?',
                          )
                        ) {
                          return;
                        }
                        setEditing(item);
                        setDirty(false);
                        setError(null);
                      }}
                      type="button"
                    >
                      Upravit
                    </button>
                    <button
                      aria-label={`${
                        resource === 'days' ? 'Trvale smazat den' : 'Archivovat'
                      }: ${itemLabel(item)}`}
                      className={styles.dangerButton}
                      disabled={
                        writesBlocked || dirty || item.status === 'archived'
                      }
                      onClick={() => setArchiveCandidate(item)}
                      type="button"
                    >
                      {resource === 'days' ? 'Smazat' : 'Archivovat'}
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {archiveCandidate ? (
        <AdminConfirmDialog
          acknowledgement={
            resource === 'days'
              ? 'Ověřil/a jsem den a rozumím tomu, že smazání je trvalé.'
              : 'Ověřil/a jsem položku, její aktuální verzi a dopad archivace.'
          }
          confirmLabel={
            resource === 'days' ? 'Trvale smazat den' : 'Archivovat položku'
          }
          danger
          description={
            resource === 'days'
              ? 'Den bude trvale odstraněn. Pokud na něj odkazuje program, server smazání bezpečně odmítne.'
              : 'Položka se skryje z aktivního obsahu. Server před změnou znovu ověří event scope a verzi.'
          }
          impact={
            <p>
              {itemLabel(archiveCandidate)} · verze{' '}
              {String(archiveCandidate.version ?? '—')}
            </p>
          }
          onConfirm={() => void archive()}
          onDismiss={() => setArchiveCandidate(null)}
          title={
            resource === 'days' ? 'Trvale smazat den?' : 'Archivovat obsah?'
          }
        />
      ) : null}
    </section>
  );
};
