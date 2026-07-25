'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  adminDemoRoleSchema,
  adminWorkspaceScopeSchema,
  canAccessAdminSection,
  type AdminDemoRole,
  type AdminWorkspaceScope,
  type AdminWorkspaceSection,
} from './admin-workspace-contracts';
import { adminDemoScope } from './admin-workspace-demo-data';
import styles from './admin-workspace.module.css';

const navigation = [
  { href: '/admin', label: 'Přehled', section: 'overview' },
  {
    href: '/admin/vstupenky',
    label: 'Import vstupenek',
    section: 'import',
  },
  { href: '/admin/ucastnici', label: 'Podpora', section: 'support' },
  {
    href: '/admin/oznameni',
    label: 'Oznámení',
    section: 'announcements',
  },
  { href: '/admin/role', label: 'Role operátorů', section: 'operations' },
  { href: '/admin/reporty', label: 'Reporty', section: 'operations' },
  {
    href: '/admin/rezervace',
    label: 'Rezervace',
    section: 'reservations',
  },
  { href: '/admin/audit', label: 'Audit', section: 'reservations' },
  {
    href: '/admin/nastaveni',
    label: 'Nastavení',
    section: 'reservations',
  },
  { href: '/admin/obsah', label: 'Obsah akce', section: 'content' },
] as const satisfies readonly {
  readonly href: string;
  readonly label: string;
  readonly section: AdminWorkspaceSection;
}[];

const legacySections: Readonly<Record<string, AdminWorkspaceSection>> = {
  '/admin/import': 'import',
  '/admin/support': 'support',
  '/admin/provoz': 'operations',
};

const roleLabels: Record<AdminDemoRole, string> = {
  organizer_admin: 'Administrátor',
  support_operator: 'Podpora',
  room_operator: 'Operátor sálu',
  participant: 'Účastník bez přístupu',
};

const sectionForPath = (pathname: string): AdminWorkspaceSection => {
  const match = [...navigation]
    .sort((left, right) => right.href.length - left.href.length)
    .find(({ href }) =>
      href === '/admin'
        ? pathname === href
        : pathname === href || pathname.startsWith(`${href}/`),
    );
  return (
    match?.section ??
    Object.entries(legacySections).find(
      ([path]) => pathname === path || pathname.startsWith(`${path}/`),
    )?.[1] ??
    'overview'
  );
};

const AdminNavigation = ({
  activeHref,
  label,
}: {
  readonly activeHref: string;
  readonly label: string;
}) => (
  <nav className={styles.navigation} aria-label={label}>
    {navigation.map((item) => (
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

const AdminWorkspaceContext = createContext<AdminWorkspaceScope | null>(null);

export const useAdminWorkspaceScope = (): AdminWorkspaceScope => {
  const context = useContext(AdminWorkspaceContext);
  if (!context) {
    throw new Error(
      'useAdminWorkspaceScope must be used inside AdminWorkspaceShell.',
    );
  }
  return context;
};

export const AdminWorkspaceShell = ({
  children,
  initialRole = 'organizer_admin',
}: {
  readonly children: ReactNode;
  readonly initialRole?: AdminDemoRole;
}) => {
  const pathname = usePathname();
  const [role, setRole] = useState<AdminDemoRole>(() =>
    adminDemoRoleSchema.parse(initialRole),
  );
  const previousPathname = useRef(pathname);
  const section = sectionForPath(pathname);
  const activeNavigation =
    navigation.find((item) => item.section === section) ?? navigation[0];
  const scope = useMemo(
    () =>
      adminWorkspaceScopeSchema.parse({
        ...adminDemoScope,
        role,
      }),
    [role],
  );
  const allowed = canAccessAdminSection(scope.role, section);

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      document.getElementById('admin-main')?.focus();
      previousPathname.current = pathname;
    }
  }, [pathname]);

  return (
    <AdminWorkspaceContext.Provider value={scope}>
      <div
        className={styles.workspace}
        data-admin-environment="mocked"
        data-admin-role={scope.role}
      >
        <a className={styles.skipLink} href="#admin-main">
          Přeskočit na hlavní obsah
        </a>
        <div className={styles.mockBanner} role="status">
          UI ready (mocked) · pouze syntetická data · žádná akce se neodesílá do
          produkce
        </div>
        <div className={styles.shell}>
          <aside className={styles.sidebar} aria-label="Administrace akce">
            <p className={styles.brand}>Byzon administrace</p>
            <p className={styles.scope}>
              {scope.eventName}
              <br />
              Rozsah: {scope.eventId}
            </p>
            <label className={styles.roleControl}>
              Demo role a oprávnění
              <select
                value={scope.role}
                onChange={(event) =>
                  setRole(adminDemoRoleSchema.parse(event.target.value))
                }
              >
                {adminDemoRoleSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {roleLabels[option]}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.desktopNavigation}>
              <AdminNavigation
                activeHref={activeNavigation.href}
                label="Hlavní administrace"
              />
            </div>
            <details className={styles.mobileNavigation}>
              <summary>Navigace administrace</summary>
              <AdminNavigation
                activeHref={activeNavigation.href}
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
              <span className={styles.roleBadge}>
                {roleLabels[scope.role]} · {scope.eventTimezone}
              </span>
            </header>
            <main className={styles.content} id="admin-main" tabIndex={-1}>
              <Fragment key={scope.role}>
                {allowed ? (
                  children
                ) : (
                  <section className={styles.forbidden} role="alert">
                    <p className={styles.eyebrow}>403 · omezený rozsah</p>
                    <h1>K této části nemáte oprávnění</h1>
                    <p>
                      Role {roleLabels[scope.role]} nemá v akci{' '}
                      {scope.eventName} přístup k části {activeNavigation.label}
                      . Žádná soukromá data nebyla načtena.
                    </p>
                    <Link href="/admin">Zpět na administraci</Link>
                  </section>
                )}
              </Fragment>
            </main>
          </div>
        </div>
      </div>
    </AdminWorkspaceContext.Provider>
  );
};
