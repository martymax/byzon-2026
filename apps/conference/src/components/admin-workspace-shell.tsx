'use client';

import type {
  AdminContextResponse,
  AdminPermission,
} from '@byzon/domain/contracts/admin';
import type { ApiFailure, ApiProblem } from '@byzon/domain/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { ApiPort } from '@/lib/api/endpoint';
import { mayLeaveAdminContentDraft } from '@/lib/admin-content-dirty-guard';
import { browserAdminApi, requestAdminContext } from '@/lib/admin-api';

import { isAdminSecurityFailure } from './admin-workspace-runtime';
import styles from './admin-workspace.module.css';

export { isAdminSecurityFailure };

type AdminWorkspaceSection =
  | 'overview'
  | 'import'
  | 'support'
  | 'announcements'
  | 'operations'
  | 'engagement'
  | 'reservations'
  | 'content';

const navigation = [
  { href: '/admin', integrated: true, label: 'Přehled', section: 'overview' },
  {
    href: '/admin/vstupenky',
    integrated: true,
    label: 'Import účastníků',
    section: 'import',
  },
  {
    href: '/admin/ucastnici',
    integrated: true,
    label: 'Podpora',
    section: 'support',
  },
  {
    href: '/admin/oznameni',
    integrated: true,
    label: 'Oznámení',
    section: 'announcements',
  },
  {
    href: '/admin/role',
    integrated: true,
    label: 'Role operátorů',
    section: 'operations',
  },
  {
    href: '/admin/reporty',
    integrated: true,
    label: 'Reporty',
    section: 'operations',
  },
  {
    href: '/admin/interakce',
    integrated: true,
    label: 'Interakce',
    section: 'engagement',
  },
  {
    href: '/admin/rezervace',
    integrated: true,
    label: 'Rezervace',
    section: 'reservations',
  },
  {
    href: '/admin/audit',
    integrated: true,
    label: 'Audit',
    section: 'reservations',
  },
  {
    href: '/admin/nastaveni',
    integrated: true,
    label: 'Nastavení',
    section: 'reservations',
  },
  {
    href: '/admin/obsah',
    integrated: true,
    label: 'Obsah akce',
    section: 'content',
  },
] as const satisfies readonly {
  readonly href: string;
  readonly integrated: boolean;
  readonly label: string;
  readonly section: AdminWorkspaceSection;
}[];

const legacySections: Readonly<Record<string, AdminWorkspaceSection>> = {
  '/admin/import': 'import',
  '/admin/support': 'support',
  '/admin/provoz': 'operations',
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
  import: ['ticket:any:manage'],
  support: ['participant:operational:read'],
  announcements: ['announcement:send'],
  operations: [
    'operations:read',
    'role:manage',
    'personal-data:operational:export',
  ],
  engagement: [
    'event:settings:manage',
    'participant:operational:read',
    'program:manage',
    'role:manage',
  ],
  reservations: ['reservation:any:read', 'audit:read', 'event:settings:manage'],
  content: ['program:manage'],
};

const roleLabels = {
  organizer_admin: 'Administrátor',
  checkin_operator: 'Operátor check-inu',
  moderator: 'Moderátor',
  room_operator: 'Vedoucí aktivity',
} as const;

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
  section === 'engagement'
    ? sectionPermissions[section].every((permission) =>
        context.actor.permissions.includes(permission),
      )
    : sectionPermissions[section].some((permission) =>
        context.actor.permissions.includes(permission),
      );

const AdminNavigation = ({
  activeHref,
  items,
  label,
}: {
  readonly activeHref: string;
  readonly items: readonly (typeof navigation)[number][];
  readonly label: string;
}) => (
  <nav className={styles.navigation} aria-label={label}>
    {items.map((item) => (
      <Link
        aria-current={item.href === activeHref ? 'page' : undefined}
        href={item.href}
        key={item.href}
      >
        {item.label}
      </Link>
    ))}
  </nav>
);

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
  | { readonly kind: 'blocked'; readonly message: string };

const failureMessage = (failure: ApiFailure<ApiProblem>): string => {
  if (failure.kind === 'offline') {
    return 'Administrace je online-only. Soukromá data byla odstraněna; obnovte připojení a načtěte kontext znovu.';
  }
  if (failure.kind === 'session_expired') {
    return 'Relace vypršela. Soukromá data byla odstraněna a je nutné se znovu přihlásit.';
  }
  if (failure.kind === 'problem' && failure.problem.status === 403) {
    return 'Aktuální účet nemá přístup k této akci. Žádná soukromá data nebyla ponechána.';
  }
  if (failure.kind === 'problem' && failure.problem.status === 401) {
    return 'Pro otevření administrace je nutné ověřit přihlášení.';
  }
  return 'Administrační kontext se nepodařilo bezpečně ověřit. Zkuste načtení zopakovat.';
};

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
  const pathname = usePathname();
  const previousPathname = useRef(pathname);
  const [previewPersona, setPreviewPersona] =
    useState<PreviewPersona>('organizer');
  const [state, setState] = useState<ShellState>({ kind: 'loading' });
  const [reload, setReload] = useState(0);
  const [securityEpoch, setSecurityEpoch] = useState(0);
  const section = sectionForPath(pathname);
  const activeNavigation = itemForPath(pathname) ?? navigation[0];
  const effectiveApi = useMemo(
    () => (environment === 'mocked' ? personaApi(api, previewPersona) : api),
    [api, environment, previewPersona],
  );
  const visibleNavigation = useMemo(
    () =>
      environment === 'mocked'
        ? navigation
        : navigation.filter(({ integrated }) => integrated),
    [environment],
  );

  const invalidateSensitive = useCallback((message?: string) => {
    setSecurityEpoch((current) => current + 1);
    setState({
      kind: 'blocked',
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

  useEffect(() => {
    const controller = new AbortController();
    void requestAdminContext(effectiveApi, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setSecurityEpoch((current) => current + 1);
        setState({
          kind: 'blocked',
          message: failureMessage(result.failure),
        });
        return;
      }
      if (result.kind === 'not_modified') {
        setState({
          kind: 'blocked',
          message: 'Administrační kontext neposkytl úplný bezpečný snapshot.',
        });
        return;
      }
      setState({ kind: 'ready', context: result.data });
    });
    return () => controller.abort();
  }, [effectiveApi, reload]);

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      document.getElementById('admin-main')?.focus();
      previousPathname.current = pathname;
    }
  }, [pathname]);

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

  const allowed =
    state.kind === 'ready' ? mayAccess(state.context, section) : false;
  const primaryRole =
    state.kind === 'ready' ? state.context.actor.roles[0] : undefined;

  return (
    <div
      className={styles.workspace}
      data-admin-environment={environment}
      data-admin-role={primaryRole}
    >
      <a className={styles.skipLink} href="#admin-main">
        Přeskočit na hlavní obsah
      </a>
      {banner}
      {environment === 'mocked' && !banner ? (
        <div className={styles.mockBanner} role="status">
          UI ready (mocked) · pouze syntetická data · scénáře obsluhuje vývojový
          mock transport
        </div>
      ) : null}
      <div className={styles.shell}>
        <aside className={styles.sidebar} aria-label="Administrace akce">
          <p className={styles.brand}>Byzon administrace</p>
          <p className={styles.scope}>
            {state.kind === 'ready' ? (
              <>
                {state.context.event.name}
                <br />
                Rozsah: {state.context.event.id}
              </>
            ) : (
              'Bez ověřeného rozsahu'
            )}
          </p>
          {environment === 'mocked' ? (
            <label className={styles.roleControl}>
              Demo persona
              <select
                onChange={(event) => {
                  if (!mayLeaveAdminContentDraft()) return;
                  setSecurityEpoch((current) => current + 1);
                  setState({ kind: 'loading' });
                  setPreviewPersona(event.target.value as PreviewPersona);
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
          ) : null}
          <div className={styles.desktopNavigation}>
            <AdminNavigation
              activeHref={activeNavigation.href}
              items={visibleNavigation}
              label="Hlavní administrace"
            />
          </div>
          <details className={styles.mobileNavigation}>
            <summary>Navigace administrace</summary>
            <AdminNavigation
              activeHref={activeNavigation.href}
              items={visibleNavigation}
              label="Mobilní administrace"
            />
          </details>
        </aside>
        <div className={styles.mainColumn}>
          <header className={styles.topbar}>
            <nav aria-label="Drobečková navigace">
              <ol className={styles.breadcrumbs}>
                <li>
                  {section === 'overview' ? (
                    <span>Administrace</span>
                  ) : (
                    <Link href="/admin">Administrace</Link>
                  )}
                </li>
                {section !== 'overview' ? (
                  <li aria-current="page">{activeNavigation.label}</li>
                ) : null}
              </ol>
            </nav>
            {state.kind === 'ready' && primaryRole ? (
              <span className={styles.roleBadge}>
                {roleLabels[primaryRole]} · {state.context.event.timezone}
              </span>
            ) : null}
          </header>
          <main className={styles.content} id="admin-main" tabIndex={-1}>
            {state.kind === 'loading' ? (
              <section className={styles.panel} aria-busy="true">
                <p className={styles.eyebrow}>Ověřuji přístup</p>
                <h1>Načítám administrační kontext…</h1>
                <p>
                  Soukromé zdroje se načtou až po ověření eventu a oprávnění.
                </p>
              </section>
            ) : state.kind === 'blocked' ? (
              <section className={styles.forbidden} role="alert">
                <p className={styles.eyebrow}>Přístup uzavřen</p>
                <h1>Administraci nelze bezpečně zobrazit</h1>
                <p>{state.message}</p>
                <button
                  className={styles.secondaryButton}
                  onClick={refreshContext}
                  type="button"
                >
                  Ověřit přístup znovu
                </button>
              </section>
            ) : (
              <AdminWorkspaceContext.Provider value={value}>
                <Fragment key={`${state.context.event.id}-${securityEpoch}`}>
                  {allowed ? (
                    children
                  ) : (
                    <section className={styles.forbidden} role="alert">
                      <p className={styles.eyebrow}>403 · omezený rozsah</p>
                      <h1>K této části nemáte oprávnění</h1>
                      <p>
                        Oprávnění pro část {activeNavigation.label} není
                        součástí autoritativního kontextu. Žádná data této části
                        nebyla načtena.
                      </p>
                      <Link href="/admin">Zpět na administraci</Link>
                    </section>
                  )}
                </Fragment>
              </AdminWorkspaceContext.Provider>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};
