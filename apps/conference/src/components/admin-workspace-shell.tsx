'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useContext,
  useMemo,
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
  { href: '/admin/import', label: 'Import vstupenek', section: 'import' },
  { href: '/admin/support', label: 'Podpora', section: 'support' },
  {
    href: '/admin/oznameni',
    label: 'Oznámení',
    section: 'announcements',
  },
  { href: '/admin/provoz', label: 'Role a provoz', section: 'operations' },
  {
    href: '/admin/rezervace',
    label: 'Rezervace a audit',
    section: 'reservations',
  },
  { href: '/admin/obsah', label: 'Obsah akce', section: 'content' },
] as const satisfies readonly {
  readonly href: string;
  readonly label: string;
  readonly section: AdminWorkspaceSection;
}[];

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
  return match?.section ?? 'overview';
};

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
            <nav className={styles.navigation} aria-label="Hlavní administrace">
              {navigation.map((item) => (
                <a
                  aria-current={
                    item.section === activeNavigation.section
                      ? 'page'
                      : undefined
                  }
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </aside>
          <div className={styles.mainColumn}>
            <header className={styles.topbar}>
              <nav aria-label="Drobečková navigace">
                <ol className={styles.breadcrumbs}>
                  <li>
                    {section === 'overview' ? (
                      <span>Administrace</span>
                    ) : (
                      <a href="/admin">Administrace</a>
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
              {allowed ? (
                children
              ) : (
                <section className={styles.forbidden} role="alert">
                  <p className={styles.eyebrow}>403 · omezený rozsah</p>
                  <h1>K této části nemáte oprávnění</h1>
                  <p>
                    Role {roleLabels[scope.role]} nemá v akci {scope.eventName}{' '}
                    přístup k části {activeNavigation.label}. Žádná soukromá
                    data nebyla načtena.
                  </p>
                  <a href="/admin">Zpět na administraci</a>
                </section>
              )}
            </main>
          </div>
        </div>
      </div>
    </AdminWorkspaceContext.Provider>
  );
};
