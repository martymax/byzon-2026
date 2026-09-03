'use client';

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import {
  browserAdminContentPort,
  isAdminContentSecurityFailure,
  type AdminContentFailure,
  type AdminContentItem,
  type AdminContentPort,
  type AdminContentResource,
} from '../lib/admin-content-api';
import { ADMIN_CONTENT_SCOPE_CHANGE_EVENT } from '../lib/admin-content-dirty-guard';

import { AdminConfirmDialog } from './admin-confirm-dialog';
import {
  AdminContentAssetField,
  type AdminContentAssetPort,
} from './admin-content-asset-field';
import { AdminFormErrorSummary } from './admin-form-error-summary';
import styles from './admin-workspace.module.css';

const resourceLabels: Record<AdminContentResource, string> = {
  days: 'Dny akce',
  venues: 'Místa',
  rooms: 'Místnosti',
  sessions: 'Body programu',
  speakers: 'Řečníci',
  partners: 'Partneři',
  pages: 'Stránky',
  faqs: 'Časté dotazy',
};

type AdminContentArea =
  'program' | 'speakers' | 'places' | 'partners' | 'practical';

const contentAreas = [
  'program',
  'speakers',
  'places',
  'partners',
  'practical',
] as const satisfies readonly AdminContentArea[];

const contentAreaLabels: Record<AdminContentArea, string> = {
  program: 'Program',
  speakers: 'Řečníci',
  places: 'Místa a místnosti',
  partners: 'Partneři',
  practical: 'Praktické informace',
};

const contentAreaResources: Record<
  AdminContentArea,
  readonly AdminContentResource[]
> = {
  program: ['sessions', 'days'],
  speakers: ['speakers'],
  places: ['venues', 'rooms'],
  partners: ['partners'],
  practical: ['pages', 'faqs'],
};

const resourceArea = Object.fromEntries(
  contentAreas.flatMap((area) =>
    contentAreaResources[area].map((resource) => [resource, area]),
  ),
) as Record<AdminContentResource, AdminContentArea>;

const createLabels: Record<AdminContentResource, string> = {
  sessions: 'Přidat bod programu',
  days: 'Přidat den',
  speakers: 'Přidat řečníka',
  venues: 'Přidat místo',
  rooms: 'Přidat místnost',
  partners: 'Přidat partnera',
  pages: 'Přidat stránku',
  faqs: 'Přidat otázku',
};

const contentStatusLabels: Readonly<Record<string, string>> = {
  draft: 'Rozpracováno',
  published: 'Zveřejněno',
  cancelled: 'Zrušeno',
  archived: 'Archivováno',
};

const contentPublicationStateLabel = (item: AdminContentItem): string => {
  if (item.status === 'cancelled') return contentStatusLabels.cancelled!;
  if (item.publicationState === 'archived') {
    return contentStatusLabels.archived!;
  }
  if (item.publicationState === 'published') {
    return 'Ve zveřejněné verzi';
  }
  if (item.publicationState === 'unpublished') {
    return 'Čeká na zveřejnění';
  }
  return (
    contentStatusLabels[String(item.status)] ?? 'Stav zveřejnění není dostupný'
  );
};

const slugFromTitle = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);

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
  sessions: readonly AdminContentItem[];
  speakers: readonly AdminContentItem[];
  venues: readonly AdminContentItem[];
} => ({ days: [], rooms: [], sessions: [], speakers: [], venues: [] });

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

const programSlotLabel = (value: unknown, timezone: string) =>
  new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(String(value)));

export const programTimeRangeLabel = (
  startsAt: unknown,
  endsAt: unknown,
  timezone: string,
): string => {
  const start = new Date(String(startsAt));
  const end = new Date(String(endsAt));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return 'Čas neurčen';
  }
  const formatter = new Intl.DateTimeFormat('cs-CZ', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
  return `${formatter.format(start)}–${formatter.format(end)}`;
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
    body = {
      ...body,
      slug: value('slug'),
      firstName: value('firstName'),
      lastName: value('lastName'),
      jobTitle: value('jobTitle') || null,
      company: value('company') || null,
      bioMarkdown: value('bioMarkdown') || null,
      accountEmail: value('accountEmail').toLowerCase() || null,
      linkedinUrl: value('linkedinUrl') || null,
      instagramUrl: value('instagramUrl') || null,
      facebookUrl: value('facebookUrl') || null,
      websiteUrl: value('websiteUrl') || null,
      sessionIds: form.getAll('sessionIds').map(String),
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
  item.firstName && item.lastName
    ? `${String(item.firstName)} ${String(item.lastName)}`
    : String(
        item.title ??
          item.name ??
          item.question ??
          item.localDate ??
          'Položka bez názvu',
      );

const AdminContentItemList = memo(function AdminContentItemList({
  archiveBlocked,
  items,
  onArchive,
  onEdit,
  readOnly,
  references,
  resource,
  timezone,
  writesBlocked,
}: {
  readonly archiveBlocked: boolean;
  readonly items: readonly AdminContentItem[];
  readonly onArchive: (item: AdminContentItem) => void;
  readonly onEdit: (item: AdminContentItem) => void;
  readonly readOnly: boolean;
  readonly references: ReturnType<typeof emptyReferences>;
  readonly resource: AdminContentResource;
  readonly timezone: string;
  readonly writesBlocked: boolean;
}) {
  const roomsById = new Map(
    references.rooms.map((room) => [room.id, itemLabel(room)]),
  );
  const daysById = new Map(
    references.days.map((day) => [day.id, itemLabel(day)]),
  );
  const speakersById = new Map(
    references.speakers.map((speaker) => [speaker.id, itemLabel(speaker)]),
  );

  return (
    <ul className={styles.contentList}>
      {items.map((item) => (
        <li data-archived={item.status === 'archived'} key={item.id}>
          <span>
            <strong>{itemLabel(item)}</strong>
            {resource === 'sessions' ? (
              <dl className={styles.sessionMetadata}>
                <div>
                  <dt>Čas</dt>
                  <dd>
                    {daysById.get(String(item.dayId))
                      ? `${daysById.get(String(item.dayId))} · `
                      : ''}
                    {programTimeRangeLabel(
                      item.startsAt,
                      item.endsAt,
                      timezone,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Stage</dt>
                  <dd>
                    {roomsById.get(String(item.roomId)) ?? 'Stage neurčena'}
                  </dd>
                </div>
                <div>
                  <dt>Řečníci</dt>
                  <dd>
                    {Array.isArray(item.speakerIds) &&
                    item.speakerIds.length > 0
                      ? item.speakerIds
                          .map((id) => speakersById.get(String(id)))
                          .filter(Boolean)
                          .join(', ') || 'Řečník neurčen'
                      : 'Bez řečníka'}
                  </dd>
                </div>
              </dl>
            ) : null}
            <small>
              {resource === 'speakers' ? (
                <>
                  {[item.jobTitle, item.company]
                    .filter(Boolean)
                    .map(String)
                    .join(' · ') || 'Bez uvedené role'}
                  {' · '}
                  {Array.isArray(item.sessionIds)
                    ? `${item.sessionIds.length} vystoupení`
                    : '0 vystoupení'}
                  {' · '}
                </>
              ) : null}
              {contentPublicationStateLabel(item)}
            </small>
          </span>
          {!readOnly && item.status !== 'archived' ? (
            <span className={styles.contentActions}>
              <button
                aria-label={`Upravit: ${itemLabel(item)}`}
                className={styles.secondaryButton}
                disabled={writesBlocked}
                onClick={() => onEdit(item)}
                type="button"
              >
                Upravit
              </button>
              {resource !== 'days' ? (
                <button
                  aria-label={`Archivovat: ${itemLabel(item)}`}
                  className={styles.dangerButton}
                  disabled={archiveBlocked}
                  onClick={() => onArchive(item)}
                  type="button"
                >
                  Archivovat
                </button>
              ) : null}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
});

const failureMessage = (failure: AdminContentFailure): string =>
  failure.requestId
    ? `${failure.message} Reference požadavku: ${failure.requestId}.`
    : failure.message;

const fieldLabels: Readonly<Record<string, string>> = {
  answerMarkdown: 'Odpověď',
  bioMarkdown: 'Medailonek',
  bodyMarkdown: 'Obsah stránky',
  capacity: 'Kapacita',
  category: 'Kategorie',
  company: 'Firma',
  content: 'Obsah',
  dayId: 'Den',
  description: 'Popis',
  endsAt: 'Konec',
  firstName: 'Jméno',
  facebookUrl: 'Facebook URL',
  linkedinUrl: 'LinkedIn URL',
  instagramUrl: 'Instagram URL',
  lastName: 'Příjmení',
  localDate: 'Datum',
  mapQuery: 'Místo pro mapu',
  navigationMarkdown: 'Navigační pokyny',
  roomId: 'Místnost',
  slug: 'Adresa stránky',
  sortOrder: 'Pořadí',
  speakerIds: 'Řečníci',
  sessionIds: 'Body programu',
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
  assetPort,
  eventId,
  initialResource = 'sessions',
  showAreaNavigation = true,
  onContentChanged,
  onDirtyChange,
  onSecurityFailure,
  port = browserAdminContentPort,
  readOnly = false,
  timezone,
}: {
  readonly assetPort?: AdminContentAssetPort;
  readonly eventId: string;
  readonly initialResource?: AdminContentResource;
  readonly showAreaNavigation?: boolean;
  readonly onContentChanged?: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
  readonly onSecurityFailure?: (failure: AdminContentFailure) => void;
  readonly port?: AdminContentPort;
  readonly readOnly?: boolean;
  readonly timezone: string;
}) => {
  const [resource, setResource] =
    useState<AdminContentResource>(initialResource);
  const [selectedResource, setSelectedResource] =
    useState<AdminContentResource>(initialResource);
  const [items, setItems] = useState<readonly AdminContentItem[]>([]);
  const [references, setReferences] = useState(emptyReferences);
  const [editing, setEditing] = useState<AdminContentItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorFieldsReady, setEditorFieldsReady] = useState(false);
  const [listFilter, setListFilter] = useState<'active' | 'archived'>('active');
  const [speakerListQuery, setSpeakerListQuery] = useState('');
  const [slugValue, setSlugValue] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [sortOrder, setSortOrder] = useState(0);
  const [speakerSearch, setSpeakerSearch] = useState('');
  const [speakerSelection, setSpeakerSelection] = useState<readonly string[]>(
    [],
  );
  const [archiveCandidate, setArchiveCandidate] =
    useState<AdminContentItem | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'loading' | 'saving' | 'archiving' | null>(
    'loading',
  );
  const [error, setError] = useState<AdminContentFailure | null>(null);
  const [message, setMessage] = useState('');
  const [loadRequest, setLoadRequest] = useState({
    resource: initialResource,
    sequence: 0,
  });
  const [reconciliationRequired, setReconciliationRequired] = useState(false);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [localFormAvailable, setLocalFormAvailable] = useState(false);
  const working = busy !== null;
  const operationLocked = useRef(false);
  const activeMutation = useRef<AbortController | null>(null);
  const activeResource = useRef<AdminContentResource>(initialResource);
  const editorHistoryActive = useRef(false);
  const editorDialogRef = useRef<HTMLFormElement>(null);
  const editorTitleRef = useRef<HTMLHeadingElement>(null);
  const editorTriggerRef = useRef<HTMLElement | null>(null);
  const listTitleRef = useRef<HTMLHeadingElement>(null);
  const listScrollPosition = useRef(0);

  useUnsavedContentGuard(dirty);

  useEffect(() => {
    const closeFromHistory = () => {
      if (
        !editorHistoryActive.current ||
        window.history.state?.__byzonAdminContentEditor
      ) {
        return;
      }
      editorHistoryActive.current = false;
      setEditorOpen(false);
      setEditorFieldsReady(false);
      setEditing(null);
      setDirty(false);
      window.requestAnimationFrame(() =>
        window.scrollTo({ top: listScrollPosition.current }),
      );
    };
    window.addEventListener('popstate', closeFromHistory);
    return () => window.removeEventListener('popstate', closeFromHistory);
  }, []);

  useEffect(() => {
    if (!editorOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      setEditorFieldsReady(true);
      editorTitleRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [editorOpen]);

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
    setEditorOpen(false);
    setEditorFieldsReady(false);
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
    const referenceResources = [
      'days',
      'venues',
      'rooms',
      'sessions',
      'speakers',
    ] as const;
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
      setEditorOpen(false);
      setEditorFieldsReady(false);
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
    setEditorOpen(false);
    setEditorFieldsReady(false);
    setEditing(null);
    setListFilter('active');
    setSpeakerListQuery('');
    editorHistoryActive.current = false;
    setError(null);
    setMessage('');
    setLoadRequest(({ sequence }) => ({
      resource: next,
      sequence: sequence + 1,
    }));
    const query = new URLSearchParams();
    query.set('oblast', resourceArea[next]);
    if (contentAreaResources[resourceArea[next]].length > 1) {
      query.set('typ', next);
    }
    window.history.replaceState(
      { ...window.history.state, __byzonAdminContentEditor: undefined },
      '',
      `${window.location.pathname}?${query.toString()}`,
    );
  };

  const openEditor = useCallback(
    (item: AdminContentItem | null) => {
      if (editorHistoryActive.current) return;
      listScrollPosition.current = window.scrollY;
      editorTriggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      editorHistoryActive.current = true;
      window.history.pushState(
        { ...window.history.state, __byzonAdminContentEditor: true },
        '',
        `${window.location.pathname}${window.location.search}#uprava`,
      );
      window.requestAnimationFrame(() => {
        if (!editorHistoryActive.current) return;
        setEditing(item);
        setEditorFieldsReady(false);
        setError(null);
        setDirty(false);
        setSlugValue(String(item?.slug ?? ''));
        setSlugTouched(Boolean(item));
        setSortOrder(
          Number(
            item?.sortOrder ??
              Math.max(
                -1,
                ...items.map((candidate) => Number(candidate.sortOrder)),
              ) + 1,
          ),
        );
        setSpeakerSearch('');
        setSpeakerSelection(
          Array.isArray(item?.speakerIds)
            ? item.speakerIds.filter(
                (value): value is string => typeof value === 'string',
              )
            : [],
        );
        setEditorOpen(true);
      });
    },
    [items],
  );

  const closeEditor = useCallback((focusList = false) => {
    editorHistoryActive.current = false;
    setEditorOpen(false);
    setEditorFieldsReady(false);
    setEditing(null);
    setDirty(false);
    setError(null);
    window.history.replaceState(
      { ...window.history.state, __byzonAdminContentEditor: undefined },
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: listScrollPosition.current });
      const target = focusList
        ? listTitleRef.current
        : editorTriggerRef.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
      else listTitleRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const requestEditorClose = useCallback(() => {
    if (working) return;
    if (dirty && !window.confirm('Zahodit neuložené změny formuláře?')) {
      return;
    }
    closeEditor();
  }, [closeEditor, dirty, working]);

  const handleEditorKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      requestEditorClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      editorDialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary',
      ) ?? [],
    ).filter((element) => !element.hasAttribute('hidden'));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === editorTitleRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
    closeEditor(true);
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
    setMessage('Položka byla archivována a potvrzena serverem.');
    setEditorOpen(false);
    setEditorFieldsReady(false);
    onContentChanged?.();
    setLoadRequest(({ sequence }) => ({
      resource,
      sequence: sequence + 1,
    }));
  };

  const fieldErrors = error?.fieldErrors ?? {};
  const writesBlocked = working || reconciliationRequired || !snapshotReady;

  useLayoutEffect(() => {
    if (!editorOpen) return;
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      requestEditorClose();
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    return () => window.removeEventListener('keydown', handleWindowKeyDown);
  }, [editorOpen, requestEditorClose]);

  const bodyFieldName = bodyFieldNames[resource];
  const area = resourceArea[selectedResource];
  const areaResources = contentAreaResources[area];
  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        const statusMatches =
          listFilter === 'archived'
            ? item.status === 'archived'
            : item.status !== 'archived';
        if (!statusMatches || resource !== 'speakers') return statusMatches;
        const query = speakerListQuery.trim().toLocaleLowerCase('cs-CZ');
        return (
          !query ||
          [item.firstName, item.lastName, item.company, item.jobTitle]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase('cs-CZ')
            .includes(query)
        );
      }),
    [items, listFilter, resource, speakerListQuery],
  );
  const visibleSpeakers = references.speakers.filter((speaker) => {
    const query = speakerSearch.trim().toLocaleLowerCase('cs-CZ');
    return (
      !query ||
      `${String(speaker.firstName)} ${String(speaker.lastName)}`
        .toLocaleLowerCase('cs-CZ')
        .includes(query)
    );
  });
  const activeSpeakers =
    resource === 'speakers'
      ? items.filter((item) => item.status !== 'archived')
      : [];
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
          <p className={styles.eyebrow}>
            {resource === 'speakers'
              ? 'Profily, medailonky a vystoupení'
              : 'Jediný editor obsahu'}
          </p>
          <h2 id="admin-content-editor-title">
            {resource === 'speakers'
              ? 'Správa řečníků'
              : 'Program a publikované informace'}
          </h2>
        </div>
        {readOnly ? (
          <span className={styles.statusBadge}>Archiv · pouze čtení</span>
        ) : null}
      </div>

      {showAreaNavigation ? (
        <>
          <nav aria-label="Oblasti obsahu" className={styles.contentAreaTabs}>
            {contentAreas.map((item) => (
              <button
                aria-current={area === item ? 'page' : undefined}
                className={
                  area === item ? styles.filterActive : styles.filterButton
                }
                disabled={working}
                key={item}
                onClick={() => changeResource(contentAreaResources[item][0]!)}
                type="button"
              >
                {contentAreaLabels[item]}
              </button>
            ))}
          </nav>
          <label className={`${styles.field} ${styles.contentAreaSelect}`}>
            <span>Oblast obsahu</span>
            <select
              disabled={working}
              onChange={(event) =>
                changeResource(
                  contentAreaResources[
                    event.target.value as AdminContentArea
                  ][0]!,
                )
              }
              value={area}
            >
              {contentAreas.map((item) => (
                <option key={item} value={item}>
                  {contentAreaLabels[item]}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}

      {showAreaNavigation && areaResources.length > 1 ? (
        <fieldset className={styles.contentTypeSelector}>
          <legend>Typ obsahu</legend>
          <div>
            {areaResources.map((item) => (
              <button
                aria-pressed={selectedResource === item}
                className={
                  selectedResource === item
                    ? styles.filterActive
                    : styles.filterButton
                }
                disabled={working}
                key={item}
                onClick={() => changeResource(item)}
                type="button"
              >
                {resourceLabels[item]}
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {error && !editorOpen ? (
        <AdminFormErrorSummary
          descriptionId="admin-content-form-error"
          details={failureDetails(fieldErrors)}
          heading={
            error.kind === 'stale'
              ? 'Obsah na serveru se změnil'
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

      {reconciliationRequired && !editorOpen ? (
        <p className={styles.warning} role="status">
          {error?.kind === 'stale'
            ? 'Další zápisy jsou zamčené. Rozepsaný formulář zůstal zachovaný; před načtením aktuálního stavu potvrďte jeho zahození.'
            : 'Další zápisy jsou zamčené. Nejdřív načtěte aktuální stav ze serveru; rozepsaný formulář zůstane zachovaný, dokud načtení nepotvrdíte.'}
        </p>
      ) : null}

      {!reconciliationRequired &&
      !snapshotReady &&
      localFormAvailable &&
      error &&
      !editorOpen ? (
        <p className={styles.warning} role="status">
          Nový stav obsahu se nepodařilo potvrdit. Rozepsaný formulář zůstal
          zachovaný pouze pro kontrolu; zápisy jsou uzamčené, dokud nenačtete
          aktuální stav.
        </p>
      ) : null}

      {resource === 'speakers' && snapshotReady ? (
        <section
          aria-label="Souhrn řečníků"
          className={styles.speakerAdminSummary}
        >
          <article>
            <span>Aktivní profily</span>
            <strong>{activeSpeakers.length}</strong>
          </article>
          <article>
            <span>Zveřejněné</span>
            <strong>
              {
                activeSpeakers.filter((item) => item.status === 'published')
                  .length
              }
            </strong>
          </article>
          <article>
            <span>Bez programu</span>
            <strong>
              {
                activeSpeakers.filter(
                  (item) =>
                    !Array.isArray(item.sessionIds) ||
                    item.sessionIds.length === 0,
                ).length
              }
            </strong>
          </article>
        </section>
      ) : null}

      <section
        aria-busy={busy === 'loading'}
        aria-labelledby="content-list-title"
        className={styles.contentListPanel}
      >
        <div className={styles.panelHeader}>
          <div>
            <h3 id="content-list-title" ref={listTitleRef} tabIndex={-1}>
              {resourceLabels[resource]}
            </h3>
            <p className={styles.muted}>
              Nejdřív vyberte existující položku, nebo přidejte novou.
            </p>
          </div>
          <div className={styles.contentListHeaderActions}>
            {!readOnly && snapshotReady ? (
              <button
                className={styles.button}
                disabled={writesBlocked}
                onClick={() => openEditor(null)}
                type="button"
              >
                {createLabels[resource]}
              </button>
            ) : null}
            <button
              className={styles.secondaryButton}
              disabled={working}
              onClick={requestReload}
              type="button"
            >
              Obnovit seznam
            </button>
          </div>
        </div>
        <div aria-label="Zobrazené položky" className={styles.contentFilters}>
          {resource === 'speakers' ? (
            <label className={styles.contentListSearch}>
              <span>Filtrovat řečníky</span>
              <input
                onChange={(event) => setSpeakerListQuery(event.target.value)}
                placeholder="Jméno, firma nebo role"
                type="search"
                value={speakerListQuery}
              />
            </label>
          ) : null}
          <button
            aria-pressed={listFilter === 'active'}
            className={
              listFilter === 'active'
                ? styles.filterActive
                : styles.filterButton
            }
            onClick={() => setListFilter('active')}
            type="button"
          >
            Aktivní
          </button>
          <button
            aria-pressed={listFilter === 'archived'}
            className={
              listFilter === 'archived'
                ? styles.filterActive
                : styles.filterButton
            }
            onClick={() => setListFilter('archived')}
            type="button"
          >
            Archiv
          </button>
        </div>
        {busy === 'loading' ? (
          <p role="status">Načítám obsah…</p>
        ) : !snapshotReady ? (
          <p className={styles.empty} role="status">
            Aktuální seznam není dostupný. Zkuste znovu načíst obsah.
          </p>
        ) : visibleItems.length === 0 ? (
          <p className={styles.empty} role="status">
            {listFilter === 'archived'
              ? 'V archivu nejsou žádné položky.'
              : 'V této oblasti zatím není žádná položka.'}
          </p>
        ) : (
          <AdminContentItemList
            archiveBlocked={writesBlocked || dirty}
            items={visibleItems}
            onArchive={setArchiveCandidate}
            onEdit={openEditor}
            readOnly={readOnly}
            references={references}
            resource={resource}
            timezone={timezone}
            writesBlocked={writesBlocked}
          />
        )}
      </section>

      {!readOnly && localFormAvailable && editorOpen ? (
        <div
          className={styles.contentEditorScrim}
          onKeyDown={handleEditorKeyDown}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              requestEditorClose();
            }
          }}
        >
          <form
            aria-busy={!editorFieldsReady || busy === 'loading'}
            aria-labelledby="admin-content-form-title"
            aria-modal="true"
            className={`${styles.contentForm} ${styles.contentFormModal}`}
            inert={snapshotReady ? undefined : true}
            key={`${resource}:${editing?.id ?? 'new'}`}
            noValidate
            onChange={() => {
              if (!snapshotReady) return;
              setDirty(true);
              onDirtyChange?.(true);
            }}
            onSubmit={submit}
            ref={editorDialogRef}
            role="dialog"
          >
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.eyebrow}>
                  {editing ? 'Úprava obsahu' : 'Nový obsah'}
                </p>
                <h3
                  id="admin-content-form-title"
                  ref={editorTitleRef}
                  tabIndex={-1}
                >
                  {editing ? itemLabel(editing) : createLabels[resource]}
                </h3>
              </div>
              <div className={styles.actionRow}>
                {dirty ? (
                  <span className={styles.badge}>Neuložené změny</span>
                ) : null}
                <button
                  className={styles.secondaryButton}
                  disabled={working}
                  onClick={requestEditorClose}
                  type="button"
                >
                  Zavřít editor
                </button>
              </div>
            </div>
            {!editorFieldsReady ? (
              <p className={styles.contentWide} role="status">
                Připravuji editor…
              </p>
            ) : (
              <>
                {error ? (
                  <div className={styles.contentWide}>
                    <AdminFormErrorSummary
                      descriptionId="admin-content-modal-form-error"
                      details={failureDetails(fieldErrors)}
                      heading={
                        error.kind === 'stale'
                          ? 'Obsah na serveru se změnil'
                          : reconciliationRequired
                            ? 'Výsledek změny není potvrzen'
                            : error.kind === 'conflict'
                              ? 'Změna koliduje s obsahem'
                              : 'Obsahovou operaci nelze dokončit'
                      }
                      message={failureMessage(error)}
                    />
                  </div>
                ) : null}
                {reconciliationRequired ? (
                  <p
                    className={`${styles.warning} ${styles.contentWide}`}
                    role="status"
                  >
                    Další zápisy jsou zamčené. Nejdřív zavřete editor a načtěte
                    aktuální stav ze serveru.
                  </p>
                ) : null}
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
                        defaultValue={localInputValue(
                          editing?.startsAt,
                          timezone,
                        )}
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
                        defaultValue={localInputValue(
                          editing?.endsAt,
                          timezone,
                        )}
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
                    <fieldset
                      className={`${styles.speakerPicker} ${styles.contentWide}`}
                      {...fieldA11y(fieldErrors, 'speakerIds')}
                    >
                      <legend>Řečníci</legend>
                      <label className={styles.field}>
                        <span>Najít řečníka</span>
                        <input
                          onChange={(event) =>
                            setSpeakerSearch(event.target.value)
                          }
                          placeholder="Začněte psát jméno"
                          type="search"
                          value={speakerSearch}
                        />
                      </label>
                      {speakerSelection.length ? (
                        <ul
                          aria-label="Vybraní řečníci"
                          className={styles.speakerChips}
                        >
                          {speakerSelection.map((id) => {
                            const speaker = references.speakers.find(
                              (candidate) => candidate.id === id,
                            );
                            return speaker ? (
                              <li key={id}>
                                {String(speaker.firstName)}{' '}
                                {String(speaker.lastName)}
                              </li>
                            ) : null;
                          })}
                        </ul>
                      ) : (
                        <p className={styles.helper}>
                          Zatím není vybraný žádný řečník.
                        </p>
                      )}
                      <div className={styles.speakerOptions}>
                        {visibleSpeakers.map((item) => {
                          const selected = speakerSelection.includes(item.id);
                          return (
                            <label key={item.id}>
                              <input
                                checked={selected}
                                name="speakerIds"
                                onChange={(event) =>
                                  setSpeakerSelection((current) =>
                                    event.target.checked
                                      ? [...current, item.id]
                                      : current.filter((id) => id !== item.id),
                                  )
                                }
                                type="checkbox"
                                value={item.id}
                              />
                              <span>
                                {String(item.firstName)} {String(item.lastName)}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <FieldError errors={fieldErrors} name="speakerIds" />
                    </fieldset>
                  </>
                ) : null}
                {resource === 'rooms' ? (
                  <label className={styles.field}>
                    <span>Kapacita</span>
                    <input
                      defaultValue={
                        editing?.capacity == null
                          ? ''
                          : String(editing.capacity)
                      }
                      min="1"
                      name="capacity"
                      type="number"
                      {...fieldA11y(fieldErrors, 'capacity')}
                    />
                    <FieldError errors={fieldErrors} name="capacity" />
                  </label>
                ) : null}
                {resource === 'speakers' ? (
                  <>
                    <label className={styles.field}>
                      <span>Jméno</span>
                      <input
                        defaultValue={String(editing?.firstName ?? '')}
                        name="firstName"
                        onChange={(event) => {
                          if (
                            !editing &&
                            !slugTouched &&
                            event.currentTarget.form
                          ) {
                            const values = new FormData(
                              event.currentTarget.form,
                            );
                            setSlugValue(
                              slugFromTitle(
                                `${String(values.get('firstName') ?? '')} ${String(values.get('lastName') ?? '')}`,
                              ),
                            );
                          }
                        }}
                        required
                        {...fieldA11y(fieldErrors, 'firstName')}
                      />
                      <FieldError errors={fieldErrors} name="firstName" />
                    </label>
                    <label className={styles.field}>
                      <span>Příjmení</span>
                      <input
                        defaultValue={String(editing?.lastName ?? '')}
                        name="lastName"
                        onChange={(event) => {
                          if (
                            !editing &&
                            !slugTouched &&
                            event.currentTarget.form
                          ) {
                            const values = new FormData(
                              event.currentTarget.form,
                            );
                            setSlugValue(
                              slugFromTitle(
                                `${String(values.get('firstName') ?? '')} ${String(values.get('lastName') ?? '')}`,
                              ),
                            );
                          }
                        }}
                        required
                        {...fieldA11y(fieldErrors, 'lastName')}
                      />
                      <FieldError errors={fieldErrors} name="lastName" />
                    </label>
                  </>
                ) : (
                  <label className={styles.field}>
                    <span>{resource === 'faqs' ? 'Otázka' : 'Název'}</span>
                    <input
                      defaultValue={String(
                        editing?.title ??
                          editing?.name ??
                          editing?.question ??
                          '',
                      )}
                      name="title"
                      onChange={(event) => {
                        if (
                          !editing &&
                          !slugTouched &&
                          resource !== 'days' &&
                          resource !== 'faqs'
                        ) {
                          setSlugValue(slugFromTitle(event.target.value));
                        }
                      }}
                      required
                      {...fieldA11y(fieldErrors, 'title')}
                    />
                    <FieldError errors={fieldErrors} name="title" />
                  </label>
                )}
                {bodyFieldName ? (
                  <label className={`${styles.field} ${styles.contentWide}`}>
                    <span>
                      {resource === 'faqs'
                        ? 'Odpověď'
                        : resource === 'pages'
                          ? 'Obsah stránky'
                          : resource === 'partners'
                            ? 'Popis partnera'
                            : resource === 'speakers'
                              ? 'Pozice nebo role'
                              : 'Místo pro mapu'}
                    </span>
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
                    <FieldError
                      errors={fieldErrors}
                      name="navigationMarkdown"
                    />
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
                    <label className={`${styles.field} ${styles.contentWide}`}>
                      <span>E-mail účastnického účtu (nepovinný)</span>
                      <input
                        autoComplete="email"
                        defaultValue={String(editing?.accountEmail ?? '')}
                        name="accountEmail"
                        placeholder="jmeno@example.cz"
                        type="email"
                        {...fieldA11y(fieldErrors, 'accountEmail')}
                      />
                      <span className={styles.helper}>
                        Propojí profil s existujícím účastníkem. Pokud účet
                        ještě neexistuje, vytvořte ho nejdřív v části Účastníci.
                        Řečník pak může přepínat mezi účastnickou aplikací a
                        správou svých aktivit.
                      </span>
                      <FieldError errors={fieldErrors} name="accountEmail" />
                    </label>
                    {editing ? (
                      <AdminContentAssetField
                        eventId={eventId}
                        owner={{ kind: 'speaker', id: editing.id }}
                        ownerVersion={Number(editing.version ?? 1)}
                        {...(assetPort ? { port: assetPort } : {})}
                        purpose="speaker_photo"
                        readOnly={readOnly}
                      />
                    ) : (
                      <section
                        aria-label="Fotografie řečníka"
                        className={`${styles.assetPlaceholder} ${styles.contentWide}`}
                      >
                        <div aria-hidden="true">Foto</div>
                        <p>
                          <strong>
                            Fotografii lze přidat po uložení řečníka
                          </strong>
                          <span>Nejdřív vyplňte a uložte základní údaje.</span>
                        </p>
                      </section>
                    )}
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
                      <span>Medailonek</span>
                      <textarea
                        defaultValue={String(editing?.bioMarkdown ?? '')}
                        name="bioMarkdown"
                        {...fieldA11y(fieldErrors, 'bioMarkdown')}
                      />
                      <FieldError errors={fieldErrors} name="bioMarkdown" />
                    </label>
                    <label className={styles.field}>
                      <span>LinkedIn</span>
                      <input
                        defaultValue={String(editing?.linkedinUrl ?? '')}
                        name="linkedinUrl"
                        type="url"
                        {...fieldA11y(fieldErrors, 'linkedinUrl')}
                      />
                      <FieldError errors={fieldErrors} name="linkedinUrl" />
                    </label>
                    <label className={styles.field}>
                      <span>Instagram</span>
                      <input
                        defaultValue={String(editing?.instagramUrl ?? '')}
                        name="instagramUrl"
                        placeholder="https://www.instagram.com/…"
                        type="url"
                        {...fieldA11y(fieldErrors, 'instagramUrl')}
                      />
                      <FieldError errors={fieldErrors} name="instagramUrl" />
                    </label>
                    <label className={styles.field}>
                      <span>Facebook</span>
                      <input
                        defaultValue={String(editing?.facebookUrl ?? '')}
                        name="facebookUrl"
                        placeholder="https://www.facebook.com/…"
                        type="url"
                        {...fieldA11y(fieldErrors, 'facebookUrl')}
                      />
                      <FieldError errors={fieldErrors} name="facebookUrl" />
                    </label>
                    <label className={styles.field}>
                      <span>Osobní web</span>
                      <input
                        defaultValue={String(editing?.websiteUrl ?? '')}
                        name="websiteUrl"
                        type="url"
                        {...fieldA11y(fieldErrors, 'websiteUrl')}
                      />
                      <FieldError errors={fieldErrors} name="websiteUrl" />
                    </label>
                    <fieldset
                      className={`${styles.speakerProgramPicker} ${styles.contentWide}`}
                      {...fieldA11y(fieldErrors, 'sessionIds')}
                    >
                      <legend>Vystoupení v programu</legend>
                      <p className={styles.helper}>
                        Vyberte všechny body programu, ve kterých řečník
                        vystupuje. Vazba se projeví v programu i veřejném
                        profilu.
                      </p>
                      {references.sessions
                        .filter(
                          (session) =>
                            session.status === 'archived' &&
                            Array.isArray(editing?.sessionIds) &&
                            editing.sessionIds.includes(session.id),
                        )
                        .map((session) => (
                          <input
                            key={session.id}
                            name="sessionIds"
                            type="hidden"
                            value={session.id}
                          />
                        ))}
                      {references.sessions.filter(
                        (session) => session.status !== 'archived',
                      ).length ? (
                        <div className={styles.speakerProgramOptions}>
                          {references.sessions
                            .filter((session) => session.status !== 'archived')
                            .map((session) => (
                              <label key={session.id}>
                                <input
                                  defaultChecked={
                                    Array.isArray(editing?.sessionIds) &&
                                    editing.sessionIds.includes(session.id)
                                  }
                                  name="sessionIds"
                                  type="checkbox"
                                  value={session.id}
                                />
                                <span>
                                  <strong>{String(session.title)}</strong>
                                  <small>
                                    {programSlotLabel(
                                      session.startsAt,
                                      timezone,
                                    )}
                                    {session.status === 'cancelled'
                                      ? ' · Zrušeno'
                                      : ''}
                                  </small>
                                </span>
                              </label>
                            ))}
                        </div>
                      ) : (
                        <p className={styles.empty}>
                          Nejdřív vytvořte alespoň jeden bod programu.
                        </p>
                      )}
                      <FieldError errors={fieldErrors} name="sessionIds" />
                    </fieldset>
                  </>
                ) : null}
                {resource === 'partners' ? (
                  <>
                    {editing ? (
                      <AdminContentAssetField
                        eventId={eventId}
                        owner={{ kind: 'partner', id: editing.id }}
                        ownerVersion={Number(editing.version ?? 1)}
                        {...(assetPort ? { port: assetPort } : {})}
                        purpose="partner_logo"
                        readOnly={readOnly}
                      />
                    ) : (
                      <section
                        aria-label="Logo partnera"
                        className={`${styles.assetPlaceholder} ${styles.contentWide}`}
                      >
                        <div aria-hidden="true">Logo</div>
                        <p>
                          <strong>Logo lze přidat po uložení partnera</strong>
                          <span>Nejdřív vyplňte a uložte základní údaje.</span>
                        </p>
                      </section>
                    )}
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
                      <option value="draft">Rozpracováno</option>
                      <option value="published">Zveřejněno</option>
                      {resource === 'sessions' ? (
                        <option value="cancelled">Zrušeno</option>
                      ) : null}
                    </select>
                    <FieldError errors={fieldErrors} name="status" />
                  </label>
                ) : null}
                <details
                  className={`${styles.advancedFields} ${styles.contentWide}`}
                >
                  <summary>Pokročilé</summary>
                  <div>
                    {resource !== 'days' && resource !== 'faqs' ? (
                      <label className={styles.field}>
                        <span>Adresa stránky</span>
                        <input
                          name="slug"
                          onChange={(event) => {
                            setSlugTouched(true);
                            setSlugValue(event.target.value);
                          }}
                          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                          required
                          value={slugValue}
                          {...fieldA11y(fieldErrors, 'slug')}
                        />
                        <small>
                          Vytváří se automaticky z názvu. Měňte ji jen kvůli
                          stálému odkazu.
                        </small>
                        <FieldError errors={fieldErrors} name="slug" />
                      </label>
                    ) : null}
                    <div className={styles.field}>
                      <span>Pořadí</span>
                      <input name="sortOrder" type="hidden" value={sortOrder} />
                      <output aria-live="polite">Pozice {sortOrder + 1}</output>
                      <div className={styles.actionRow}>
                        <button
                          className={styles.secondaryButton}
                          disabled={sortOrder === 0}
                          onClick={() => {
                            setSortOrder((value) => Math.max(0, value - 1));
                            setDirty(true);
                          }}
                          type="button"
                        >
                          Posunout nahoru
                        </button>
                        <button
                          className={styles.secondaryButton}
                          onClick={() => {
                            setSortOrder((value) => value + 1);
                            setDirty(true);
                          }}
                          type="button"
                        >
                          Posunout dolů
                        </button>
                      </div>
                      <FieldError errors={fieldErrors} name="sortOrder" />
                    </div>
                  </div>
                </details>
                {busy === 'loading' ? null : (
                  <div
                    className={`${styles.actionRow} ${styles.contentWide} ${styles.contentFormActions}`}
                  >
                    <button
                      className={styles.button}
                      disabled={writesBlocked}
                      type="submit"
                    >
                      {busy === 'saving'
                        ? 'Ukládám…'
                        : editing
                          ? 'Uložit změny'
                          : 'Uložit novou položku'}
                    </button>
                    <button
                      className={styles.secondaryButton}
                      disabled={working}
                      onClick={requestEditorClose}
                      type="button"
                    >
                      Zrušit a zavřít
                    </button>
                  </div>
                )}
              </>
            )}
          </form>
        </div>
      ) : readOnly ? (
        <p className={styles.callout}>
          Archivovaná akce je pouze ke čtení. Obsah ani zveřejnění nelze měnit.
        </p>
      ) : !localFormAvailable ? (
        <p className={styles.muted} role="status">
          {busy === 'loading'
            ? 'Editor se připravuje z aktuálního obsahu…'
            : 'Editor zůstává uzamčený, dokud se nenačte úplný aktuální stav.'}
        </p>
      ) : null}

      {archiveCandidate ? (
        <AdminConfirmDialog
          acknowledgement="Ověřil/a jsem položku a rozumím tomu, že po archivaci zmizí z aktivního obsahu."
          confirmLabel="Archivovat položku"
          danger
          description="Položka se skryje z aktivního obsahu. Lze ji dál najít ve filtru Archiv."
          impact={<p>{itemLabel(archiveCandidate)}</p>}
          onConfirm={() => void archive()}
          onDismiss={() => setArchiveCandidate(null)}
          title="Archivovat obsah?"
        />
      ) : null}
    </section>
  );
};
