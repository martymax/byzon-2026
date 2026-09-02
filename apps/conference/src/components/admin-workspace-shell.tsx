'use client';

import type {
  AdminContextResponse,
  AdminPermission,
} from '@byzon/domain/contracts/admin';
import type { ApiFailure, ApiProblem } from '@byzon/domain/contracts';
import { AdminTechnicalDetails } from '@byzon/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { ApiPort } from '@/lib/api/endpoint';
import { mayLeaveAdminContentDraft } from '@/lib/admin-content-dirty-guard';
import { browserAdminApi, requestAdminContext } from '@/lib/admin-api';

import { adminActorRoleLabels, adminPhaseLabels } from './admin-ui-registry';
import { isAdminSecurityFailure } from './admin-workspace-runtime';
import styles from './admin-workspace.module.css';

export { isAdminSecurityFailure };

type AdminWorkspaceSection =
  | 'overview'
  | 'tickets'
  | 'participants'
  | 'announcements'
  | 'engagement'
  | 'reservations'
  | 'content'
  | 'roles'
  | 'reports'
  | 'audit'
  | 'settings';

type AdminNavigationIcon =
  | 'overview'
  | 'content'
  | 'participants'
  | 'tickets'
  | 'reservations'
  | 'announcements'
  | 'checkin'
  | 'roles'
  | 'reports'
  | 'audit'
  | 'settings';

interface AdminNavigationItem {
  readonly href: string;
  readonly icon: AdminNavigationIcon;
  readonly label: string;
  readonly permission?: AdminPermission;
  readonly section?: AdminWorkspaceSection;
  readonly capability?: 'canEnterCheckin';
  readonly feature?: 'announcementsEnabled';
}

interface AdminNavigationGroup {
  readonly label?: string;
  readonly items: readonly AdminNavigationItem[];
}

const navigationGroups: readonly AdminNavigationGroup[] = [
  {
    items: [
      {
        href: '/admin',
        icon: 'overview',
        label: 'Přehled',
        permission: 'operations:read',
        section: 'overview',
      },
    ],
  },
  {
    label: 'Obsah akce',
    items: [
      {
        href: '/admin/obsah',
        icon: 'content',
        label: 'Program a obsah',
        permission: 'program:manage',
        section: 'content',
      },
    ],
  },
  {
    label: 'Účastníci a vstupenky',
    items: [
      {
        href: '/admin/ucastnici',
        icon: 'participants',
        label: 'Účastníci',
        permission: 'participant:operational:read',
        section: 'participants',
      },
      {
        href: '/admin/vstupenky',
        icon: 'tickets',
        label: 'Aktualizace vstupenek',
        permission: 'ticket:any:manage',
        section: 'tickets',
      },
    ],
  },
  {
    label: 'Provoz akce',
    items: [
      {
        href: '/admin/rezervace',
        icon: 'reservations',
        label: 'Rezervace a kapacity',
        permission: 'reservation:any:read',
        section: 'reservations',
      },
      {
        href: '/admin/oznameni',
        icon: 'announcements',
        label: 'Oznámení',
        permission: 'announcement:send',
        section: 'announcements',
        feature: 'announcementsEnabled',
      },
      {
        href: '/check-in',
        icon: 'checkin',
        label: 'Odbavení',
        capability: 'canEnterCheckin',
      },
    ],
  },
  {
    label: 'Správa',
    items: [
      {
        href: '/admin/role',
        icon: 'roles',
        label: 'Tým a oprávnění',
        permission: 'role:manage',
        section: 'roles',
      },
      {
        href: '/admin/reporty',
        icon: 'reports',
        label: 'Reporty',
        permission: 'operations:read',
        section: 'reports',
      },
      {
        href: '/admin/audit',
        icon: 'audit',
        label: 'Historie změn',
        permission: 'audit:read',
        section: 'audit',
      },
      {
        href: '/admin/nastaveni',
        icon: 'settings',
        label: 'Nastavení akce',
        permission: 'event:settings:manage',
        section: 'settings',
      },
    ],
  },
] as const;

const navigation: readonly AdminNavigationItem[] = navigationGroups.flatMap(
  ({ items }) => items,
);

const legacySections: Readonly<Record<string, AdminWorkspaceSection>> = {
  '/admin/import': 'tickets',
  '/admin/support': 'participants',
  '/admin/provoz': 'roles',
};

const legacyNavigationTargets: Readonly<Record<string, string>> = {
  '/admin/import': '/admin/vstupenky',
  '/admin/support': '/admin/ucastnici',
  '/admin/provoz': '/admin/role',
};

const sectionPermissions: Readonly<
  Record<AdminWorkspaceSection, readonly AdminPermission[]>
> = {
  overview: ['operations:read'],
  tickets: ['ticket:any:manage'],
  participants: ['participant:operational:read'],
  announcements: ['announcement:send'],
  engagement: [
    'event:settings:manage',
    'participant:operational:read',
    'program:manage',
    'role:manage',
  ],
  reservations: ['reservation:any:read'],
  content: ['program:manage'],
  roles: ['role:manage'],
  reports: ['operations:read'],
  audit: ['audit:read'],
  settings: ['event:settings:manage'],
};

const previewPersonas = {
  organizer: 'Administrátor',
  room_operator: 'Vedoucí aktivity',
  denied: 'Účet bez přístupu',
} as const;

type PreviewPersona = keyof typeof previewPersonas;

const personaApi = (api: ApiPort, persona: PreviewPersona): ApiPort => ({
  request: (endpoint, options) =>
    api.request(endpoint, {
      ...options,
      path:
        options.path === '/api/v1/admin/context'
          ? `/api/v1/admin/context?persona=${encodeURIComponent(persona)}`
          : options.path,
    }),
});

const canonicalPathForNavigation = (pathname: string): string => {
  const legacyPath = Object.keys(legacyNavigationTargets).find(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (!legacyPath) return pathname;
  return `${legacyNavigationTargets[legacyPath]}${pathname.slice(legacyPath.length)}`;
};

const itemForPath = (pathname: string) => {
  const canonicalPathname = canonicalPathForNavigation(pathname);
  return [...navigation]
    .sort((left, right) => right.href.length - left.href.length)
    .find(({ href }) =>
      href === '/admin'
        ? canonicalPathname === href
        : canonicalPathname === href ||
          canonicalPathname.startsWith(`${href}/`),
    );
};

const sectionForPath = (pathname: string): AdminWorkspaceSection =>
  itemForPath(pathname)?.section ??
  Object.entries(legacySections).find(
    ([path]) => pathname === path || pathname.startsWith(`${path}/`),
  )?.[1] ??
  'overview';

const mayAccess = (
  context: AdminContextResponse,
  section: AdminWorkspaceSection,
): boolean =>
  sectionPermissions[section].every((permission) =>
    context.actor.permissions.includes(permission),
  );

const AdminNavigationIcon = ({
  name,
}: {
  readonly name: AdminNavigationIcon;
}) => {
  const paths: Record<AdminNavigationIcon, ReactNode> = {
    overview: (
      <>
        <rect height="7" width="7" x="3" y="3" />
        <rect height="7" width="7" x="14" y="3" />
        <rect height="7" width="7" x="3" y="14" />
        <rect height="7" width="7" x="14" y="14" />
      </>
    ),
    content: (
      <>
        <path d="M8 2v4M16 2v4M3 9h18" />
        <rect height="18" rx="2" width="18" x="3" y="4" />
      </>
    ),
    participants: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    tickets: (
      <>
        <path d="M20 12a2 2 0 0 0 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 0 0-4V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 0-2 2Z" />
        <path d="M13 5v2M13 17v2M13 11v2" />
      </>
    ),
    reservations: (
      <>
        <path d="M5 11V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5" />
        <path d="M3 11h18v8H3zM5 19v2M19 19v2" />
      </>
    ),
    announcements: (
      <>
        <path d="m3 11 18-5v12L3 13v-2Z" />
        <path d="m11.6 15.4.9 4.1a2 2 0 0 1-3.9.9L7.5 14.3" />
      </>
    ),
    checkin: (
      <>
        <path d="M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 12h10" />
      </>
    ),
    roles: (
      <>
        <circle cx="9" cy="7" r="4" />
        <path d="M3 21v-2a6 6 0 0 1 12 0v2M19 8v6M16 11h6" />
      </>
    ),
    reports: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
    audit: (
      <>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
        <path d="M3 3v5h5M12 7v5l3 2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 9 19.35a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.63 15 1.7 1.7 0 0 0 3.07 14H3v-4h.09A1.7 1.7 0 0 0 4.65 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.63 1.7 1.7 0 0 0 10 3.07V3h4v.09A1.7 1.7 0 0 0 15 4.65a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.37 9 1.7 1.7 0 0 0 20.93 10H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
    >
      {paths[name]}
    </svg>
  );
};

const visibleNavigationGroups = (
  context: AdminContextResponse,
): readonly AdminNavigationGroup[] =>
  navigationGroups.flatMap((group) => {
    const items = group.items.filter((item) => {
      if (item.capability) return context.capabilities[item.capability];
      return item.permission
        ? context.actor.permissions.includes(item.permission)
        : false;
    });
    return items.length > 0 ? [{ ...group, items }] : [];
  });

const AdminNavigation = ({
  activeHref,
  context,
  label,
  onNavigate,
}: {
  readonly activeHref: string;
  readonly context: AdminContextResponse;
  readonly label: string;
  readonly onNavigate?: () => void;
}) => {
  const groups = visibleNavigationGroups(context);
  return (
    <nav className={styles.navigation} aria-label={label}>
      {groups.map((group, index) => (
        <section
          className={styles.navigationGroup}
          key={group.label ?? `primary-${index}`}
        >
          {group.label ? (
            <p className={styles.navigationGroupLabel}>{group.label}</p>
          ) : null}
          <ul>
            {group.items.map((item) => {
              const featureOff =
                item.feature !== undefined && !context.features[item.feature];
              return (
                <li key={item.href}>
                  <Link
                    aria-current={item.href === activeHref ? 'page' : undefined}
                    href={item.href}
                    prefetch={false}
                    {...(onNavigate ? { onClick: onNavigate } : {})}
                  >
                    <AdminNavigationIcon name={item.icon} />
                    <span>{item.label}</span>
                    {featureOff ? (
                      <span className={styles.navigationState}>Vypnuto</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
};

const AdminNavigationDrawer = ({
  children,
  dialogRef,
  onClose,
}: {
  readonly children: ReactNode;
  readonly dialogRef: React.RefObject<HTMLDialogElement | null>;
  readonly onClose: () => void;
}) => {
  const titleId = useId();

  return (
    <dialog
      aria-labelledby={titleId}
      className={styles.navigationDrawer}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <header className={styles.navigationDrawerHeader}>
        <h2 id={titleId}>Navigace administrace</h2>
        <button aria-label="Zavřít" onClick={onClose} type="button">
          Zavřít
        </button>
      </header>
      <div className={styles.navigationDrawerBody}>{children}</div>
    </dialog>
  );
};

export interface AdminWorkspaceValue {
  readonly api: ApiPort;
  readonly context: AdminContextResponse;
  readonly eventId: string;
  readonly eventName: string;
  readonly eventTimezone: string;
  readonly permissions: readonly AdminPermission[];
  readonly assignedSessionIds: readonly string[];
  readonly securityEpoch: number;
  readonly refreshContext: () => void;
  readonly invalidateSensitive: (message?: string) => void;
}

const AdminWorkspaceContext = createContext<AdminWorkspaceValue | null>(null);

export const useAdminWorkspace = (): AdminWorkspaceValue => {
  const context = useContext(AdminWorkspaceContext);
  if (!context) {
    throw new Error(
      'useAdminWorkspace must be used inside AdminWorkspaceShell.',
    );
  }
  return context;
};

/** @deprecated Use `useAdminWorkspace`; retained for route-level compatibility. */
export const useAdminWorkspaceScope = useAdminWorkspace;

interface ActiveAdminRequest {
  readonly controller: AbortController;
  readonly scope: string;
  readonly token: symbol;
}

export interface AdminRequestLease {
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly finish: () => void;
}

export interface AdminRequestFence {
  readonly begin: (channel: string) => AdminRequestLease;
  readonly cancel: (channel: string) => void;
}

/**
 * Ties every request to the current event and security epoch. A replacement
 * request aborts the previous request on that channel; unmounting or changing
 * the authenticated scope aborts all in-flight work.
 */
export const useAdminRequestFence = (): AdminRequestFence => {
  const { eventId, securityEpoch } = useAdminWorkspace();
  const scope = `${eventId}:${securityEpoch}`;
  const scopeRef = useRef(scope);
  const activeRef = useRef(new Map<string, ActiveAdminRequest>());

  useEffect(() => {
    const activeRequests = activeRef.current;
    scopeRef.current = scope;
    return () => {
      activeRequests.forEach(({ controller }) => controller.abort());
      activeRequests.clear();
    };
  }, [scope]);

  const begin = useCallback(
    (channel: string): AdminRequestLease => {
      activeRef.current.get(channel)?.controller.abort();
      const controller = new AbortController();
      const token = Symbol(channel);
      activeRef.current.set(channel, { controller, scope, token });

      const isCurrent = () => {
        const active = activeRef.current.get(channel);
        return (
          !controller.signal.aborted &&
          scopeRef.current === scope &&
          active?.scope === scope &&
          active.token === token
        );
      };

      return {
        signal: controller.signal,
        isCurrent,
        finish: () => {
          if (isCurrent()) activeRef.current.delete(channel);
        },
      };
    },
    [scope],
  );

  const cancel = useCallback((channel: string) => {
    activeRef.current.get(channel)?.controller.abort();
    activeRef.current.delete(channel);
  }, []);

  return useMemo(() => ({ begin, cancel }), [begin, cancel]);
};

type ShellState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly context: AdminContextResponse }
  | {
      readonly kind: 'blocked';
      readonly loginRequired: boolean;
      readonly message: string;
    };

const requiresLogin = (failure: ApiFailure<ApiProblem>): boolean =>
  failure.kind === 'session_expired' ||
  (failure.kind === 'problem' && failure.problem.status === 401);

const failureMessage = (failure: ApiFailure<ApiProblem>): string => {
  if (failure.kind === 'offline') {
    return 'Tato část administrace vyžaduje připojení. Citlivá data jsme skryli. Zkontrolujte internet a zkuste to znovu.';
  }
  if (failure.kind === 'session_expired') {
    return 'Přihlášení vypršelo. Citlivá rozpracovaná data jsme skryli. Přihlaste se znovu a změnu znovu připravte a zkontrolujte.';
  }
  if (failure.kind === 'problem' && failure.problem.status === 403) {
    return 'K této části nemáte přístup. Pokud ji potřebujete pro svou práci, obraťte se na správce týmu.';
  }
  if (failure.kind === 'problem' && failure.problem.status === 401) {
    return 'Pro otevření administrace je nutné ověřit přihlášení.';
  }
  return 'Tuto část se nepodařilo načíst. Zkuste to znovu. Pokud problém trvá, otevřete Technické údaje a předejte referenci podpoře.';
};

const AdminWorkspaceView = ({
  banner,
  children,
  environment,
  onPersonaChange,
  previewPersona,
  refreshContext,
  securityEpoch,
  state,
  value,
}: {
  readonly banner?: ReactNode;
  readonly children: ReactNode;
  readonly environment: 'production' | 'mocked';
  readonly onPersonaChange: (persona: PreviewPersona) => void;
  readonly previewPersona: PreviewPersona;
  readonly refreshContext: () => void;
  readonly securityEpoch: number;
  readonly state: ShellState;
  readonly value: AdminWorkspaceValue | null;
}) => {
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const [accountOpen, setAccountOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const bodyOverflowRef = useRef('');
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const section = sectionForPath(pathname);
  const activeNavigation = itemForPath(pathname) ?? navigation[0]!;
  const loginReturnTo = canonicalPathForNavigation(pathname);
  const blockedReferenceMatch =
    state.kind === 'blocked'
      ? state.message.match(
          /^(.*) Reference požadavku: ([A-Za-z0-9._:-]{8,128})\.$/,
        )
      : null;
  const blockedMessage =
    blockedReferenceMatch?.[1] ??
    (state.kind === 'blocked' ? state.message : '');
  const blockedRequestReference = blockedReferenceMatch?.[2];

  const closeDrawer = useCallback(() => {
    const dialog = drawerRef.current;
    if (dialog?.open) dialog.close();
    document.body.style.overflow = bodyOverflowRef.current;
    menuButtonRef.current?.setAttribute('aria-expanded', 'false');
    menuButtonRef.current?.focus();
  }, []);

  const openDrawer = useCallback(() => {
    const dialog = drawerRef.current;
    if (!dialog || dialog.open) return;
    bodyOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    menuButtonRef.current?.setAttribute('aria-expanded', 'true');
    dialog.showModal();
  }, []);

  useEffect(() => {
    if (
      previousPathname.current === '/' &&
      (pathname === '/admin' || pathname.startsWith('/admin/'))
    ) {
      previousPathname.current = pathname;
      return;
    }
    if (previousPathname.current !== pathname) {
      closeDrawer();
      setAccountOpen(false);
      document.getElementById('admin-main')?.focus();
      previousPathname.current = pathname;
    }
  }, [closeDrawer, pathname]);

  useEffect(
    () => () => {
      document.body.style.overflow = bodyOverflowRef.current;
    },
    [],
  );

  useEffect(() => {
    if (!accountOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setAccountOpen(false);
      accountButtonRef.current?.focus();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [accountOpen]);

  const allowed =
    state.kind === 'ready' ? mayAccess(state.context, section) : false;
  const featureUnavailable =
    state.kind === 'ready' &&
    section === 'announcements' &&
    !state.context.features.announcementsEnabled;
  const primaryRole =
    state.kind === 'ready' ? state.context.actor.roles[0] : undefined;

  return (
    <div
      className={styles.workspace}
      data-admin-root=""
      data-admin-environment={environment}
      data-admin-role={primaryRole}
    >
      <a className={styles.skipLink} href="#admin-main">
        Přeskočit na hlavní obsah
      </a>
      {banner}
      {environment === 'mocked' && !banner ? (
        <div className={styles.mockBanner} role="status">
          <span>
            UI ready (mocked) · pouze syntetická data · vývojový transport
          </span>
          <label className={styles.roleControl}>
            Demo persona
            <select
              onChange={(event) => {
                if (!mayLeaveAdminContentDraft()) return;
                onPersonaChange(event.target.value as PreviewPersona);
              }}
              value={previewPersona}
            >
              {Object.entries(previewPersonas).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <div className={styles.shell}>
        <aside className={styles.sidebar} aria-label="Administrace akce">
          <div className={styles.sidebarBrand}>BYZON</div>
          {state.kind === 'ready' ? (
            <AdminNavigation
              activeHref={activeNavigation.href}
              context={state.context}
              label="Hlavní administrace"
            />
          ) : null}
        </aside>
        <div className={styles.mainColumn}>
          <header className={styles.topbar}>
            <button
              aria-expanded="false"
              aria-haspopup="dialog"
              aria-label="Otevřít navigaci administrace"
              className={styles.menuButton}
              onClick={openDrawer}
              ref={menuButtonRef}
              type="button"
            >
              <span aria-hidden="true">☰</span>
            </button>
            {state.kind === 'ready' && primaryRole ? (
              <>
                <div className={styles.eventContext}>
                  <strong>{state.context.event.name}</strong>
                  <span>{adminPhaseLabels[state.context.event.phase]}</span>
                </div>
                <div className={styles.account}>
                  <button
                    aria-expanded={accountOpen}
                    aria-haspopup="menu"
                    className={styles.accountButton}
                    onClick={() => setAccountOpen((current) => !current)}
                    ref={accountButtonRef}
                    type="button"
                  >
                    <span>{state.context.actor.displayLabel}</span>
                    <span aria-hidden="true">⌄</span>
                  </button>
                  {accountOpen ? (
                    <div className={styles.accountMenu} role="menu">
                      <p role="none">{adminActorRoleLabels[primaryRole]}</p>
                      <Link href="/app" prefetch={false} role="menuitem">
                        Přejít do aplikace účastníka
                      </Link>
                      {state.context.actor.permissions.includes(
                        'event:settings:manage',
                      ) ? (
                        <Link
                          href="/admin/nastaveni"
                          onClick={() => setAccountOpen(false)}
                          prefetch={false}
                          role="menuitem"
                        >
                          Nastavení akce
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </header>
          <main className={styles.content} id="admin-main" tabIndex={-1}>
            {state.kind === 'loading' ? (
              <section className={styles.panel} aria-busy="true">
                <p className={styles.eyebrow}>Ověřuji přístup</p>
                <h1>Načítám administrační kontext…</h1>
                <p>Soukromé zdroje se načtou až po ověření akce a oprávnění.</p>
              </section>
            ) : state.kind === 'blocked' ? (
              <section className={styles.forbidden} role="alert">
                <p className={styles.eyebrow}>Přístup uzavřen</p>
                <h1>Administraci nelze bezpečně zobrazit</h1>
                <p>{blockedMessage}</p>
                {blockedRequestReference ? (
                  <AdminTechnicalDetails>
                    <dl>
                      <dt>Reference požadavku</dt>
                      <dd>
                        <code>{blockedRequestReference}</code>
                      </dd>
                    </dl>
                  </AdminTechnicalDetails>
                ) : null}
                {state.loginRequired ? (
                  <Link
                    className={styles.secondaryButton}
                    href={`/prihlaseni?returnTo=${encodeURIComponent(loginReturnTo)}`}
                  >
                    Přihlásit se
                  </Link>
                ) : (
                  <button
                    className={styles.secondaryButton}
                    onClick={refreshContext}
                    type="button"
                  >
                    Ověřit přístup znovu
                  </button>
                )}
              </section>
            ) : (
              <AdminWorkspaceContext.Provider value={value}>
                <Fragment key={`${state.context.event.id}-${securityEpoch}`}>
                  {allowed && !featureUnavailable ? (
                    children
                  ) : featureUnavailable ? (
                    <section className={styles.forbidden} role="status">
                      <p className={styles.eyebrow}>Funkce je vypnutá</p>
                      <h1>Oznámení nejsou pro tuto akci dostupná</h1>
                      <p>
                        Oprávnění máte, ale oznámení jsou v nastavení akce
                        vypnutá. Po zapnutí této funkce se zde zpřístupní jejich
                        příprava a odeslání.
                      </p>
                      {state.context.actor.permissions.includes(
                        'event:settings:manage',
                      ) ? (
                        <Link href="/admin/nastaveni" prefetch={false}>
                          Otevřít nastavení akce
                        </Link>
                      ) : null}
                    </section>
                  ) : (
                    <section className={styles.forbidden} role="alert">
                      <p className={styles.eyebrow}>Přístup není dostupný</p>
                      <h1>K této části nemáte přístup</h1>
                      <p>
                        K této části nemáte přístup. Pokud ji potřebujete pro
                        svou práci, obraťte se na správce týmu.
                      </p>
                      <Link href="/admin">Zpět na přehled</Link>
                    </section>
                  )}
                </Fragment>
              </AdminWorkspaceContext.Provider>
            )}
          </main>
        </div>
      </div>
      {state.kind === 'ready' ? (
        <AdminNavigationDrawer dialogRef={drawerRef} onClose={closeDrawer}>
          <AdminNavigation
            activeHref={activeNavigation.href}
            context={state.context}
            label="Mobilní administrace"
            onNavigate={closeDrawer}
          />
        </AdminNavigationDrawer>
      ) : null}
    </div>
  );
};

/**
 * Owns transport selection and the authoritative context lifecycle. The view
 * above receives only normalized state, so mocked preview routing cannot alter
 * production navigation or fail-closed rendering rules.
 */
export const AdminWorkspaceShell = ({
  api = browserAdminApi,
  banner,
  children,
  environment = 'production',
}: {
  readonly api?: ApiPort;
  readonly banner?: ReactNode;
  readonly children: ReactNode;
  readonly environment?: 'production' | 'mocked';
}) => {
  const [previewPersona, setPreviewPersona] =
    useState<PreviewPersona>('organizer');
  const [state, setState] = useState<ShellState>({ kind: 'loading' });
  const [reload, setReload] = useState(0);
  const [securityEpoch, setSecurityEpoch] = useState(0);
  const effectiveApi = useMemo(
    () => (environment === 'mocked' ? personaApi(api, previewPersona) : api),
    [api, environment, previewPersona],
  );

  const invalidateSensitive = useCallback((message?: string) => {
    setSecurityEpoch((current) => current + 1);
    setState({
      kind: 'blocked',
      loginRequired: false,
      message:
        message ??
        'Oprávnění nebo připojení se změnilo. Soukromá data byla odstraněna.',
    });
  }, []);

  const refreshContext = useCallback(() => {
    setSecurityEpoch((current) => current + 1);
    setState({ kind: 'loading' });
    setReload((current) => current + 1);
  }, []);

  const onPersonaChange = useCallback((persona: PreviewPersona) => {
    setSecurityEpoch((current) => current + 1);
    setState({ kind: 'loading' });
    setPreviewPersona(persona);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void requestAdminContext(effectiveApi, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setSecurityEpoch((current) => current + 1);
        setState({
          kind: 'blocked',
          loginRequired: requiresLogin(result.failure),
          message: failureMessage(result.failure),
        });
        return;
      }
      if (result.kind === 'not_modified') {
        setState({
          kind: 'blocked',
          loginRequired: false,
          message: 'Administrace neposkytla úplný aktuální stav.',
        });
        return;
      }
      if (!result.data.actor.roles.includes('organizer_admin')) {
        setSecurityEpoch((current) => current + 1);
        setState({
          kind: 'blocked',
          loginRequired: false,
          message:
            'Tento účet používá jiný provozní režim a do administrace nemá přístup.',
        });
        return;
      }
      setState({ kind: 'ready', context: result.data });
    });
    return () => controller.abort();
  }, [effectiveApi, reload]);

  const value = useMemo<AdminWorkspaceValue | null>(() => {
    if (state.kind !== 'ready') return null;
    return {
      api: effectiveApi,
      context: state.context,
      eventId: state.context.event.id,
      eventName: state.context.event.name,
      eventTimezone: state.context.event.timezone,
      permissions: state.context.actor.permissions,
      assignedSessionIds: state.context.actor.assignedSessions.map(
        ({ sessionId }) => sessionId,
      ),
      securityEpoch,
      refreshContext,
      invalidateSensitive,
    };
  }, [effectiveApi, invalidateSensitive, refreshContext, securityEpoch, state]);

  return (
    <AdminWorkspaceView
      banner={banner}
      environment={environment}
      onPersonaChange={onPersonaChange}
      previewPersona={previewPersona}
      refreshContext={refreshContext}
      securityEpoch={securityEpoch}
      state={state}
      value={value}
    >
      {children}
    </AdminWorkspaceView>
  );
};
