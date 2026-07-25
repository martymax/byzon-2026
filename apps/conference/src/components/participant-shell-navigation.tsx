'use client';

import { ParticipantNavigation, type NavigationItem } from '@byzon/ui';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export type ParticipantShellNavigationMode =
  'active' | 'archived' | 'unavailable';

const NavigationIcon = ({ children }: { readonly children: ReactNode }) => (
  <svg
    aria-hidden="true"
    fill="none"
    focusable="false"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="1.8"
    viewBox="0 0 24 24"
  >
    {children}
  </svg>
);

const overviewNavigationItem: NavigationItem = {
  id: 'overview',
  href: '/app',
  label: 'Přehled',
  icon: (
    <NavigationIcon>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10M9 20v-6h6v6" />
    </NavigationIcon>
  ),
};

const participantNavigationItems: NavigationItem[] = [
  overviewNavigationItem,
  {
    id: 'program',
    href: '/app/program',
    label: 'Program',
    icon: (
      <NavigationIcon>
        <rect height="16" rx="2" width="18" x="3" y="5" />
        <path d="M8 3v4M16 3v4M3 10h18M7 14h3M14 14h3M7 18h3" />
      </NavigationIcon>
    ),
  },
  {
    id: 'announcements',
    href: '/app/oznameni',
    label: 'Oznámení',
    icon: (
      <NavigationIcon>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </NavigationIcon>
    ),
  },
  {
    id: 'more',
    href: '/app/vice',
    label: 'Více',
    icon: (
      <NavigationIcon>
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
      </NavigationIcon>
    ),
  },
];

const archivedNavigationItems: NavigationItem[] = [
  overviewNavigationItem,
  {
    id: 'privacy',
    href: '/app/soukromi',
    label: 'Soukromí',
    icon: (
      <NavigationIcon>
        <path d="M12 3 5 6v5c0 4.8 2.8 8.2 7 10 4.2-1.8 7-5.2 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </NavigationIcon>
    ),
  },
  {
    id: 'settings',
    href: '/app/nastaveni',
    label: 'Nastavení',
    icon: (
      <NavigationIcon>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </NavigationIcon>
    ),
  },
];

const moreDestinations = [
  '/app/vice',
  '/app/profil',
  '/app/soukromi',
  '/app/nastaveni',
  '/app/vstupenka',
  '/app/recnici',
  '/app/partneri',
  '/app/informace',
] as const;

const isDestination = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

export const participantNavigationActiveId = (pathname: string): string => {
  if (pathname === '/app') return 'overview';
  if (isDestination(pathname, '/app/program')) return 'program';
  if (isDestination(pathname, '/app/oznameni')) return 'announcements';
  return moreDestinations.some((href) => isDestination(pathname, href))
    ? 'more'
    : '';
};

export const participantNavigationItemsForMode = (
  mode: ParticipantShellNavigationMode,
): NavigationItem[] => {
  if (mode === 'archived') return archivedNavigationItems;
  if (mode === 'unavailable') return [];
  return participantNavigationItems;
};

export const archivedNavigationActiveId = (pathname: string): string => {
  if (pathname === '/app') return 'overview';
  if (isDestination(pathname, '/app/soukromi')) return 'privacy';
  if (isDestination(pathname, '/app/nastaveni')) return 'settings';
  return '';
};

export const ParticipantShellNavigation = ({
  mode = 'active',
}: {
  readonly mode?: ParticipantShellNavigationMode;
}) => {
  const pathname = usePathname();
  const items = participantNavigationItemsForMode(mode);

  if (items.length === 0) return null;

  return (
    <ParticipantNavigation
      activeItemId={
        mode === 'archived'
          ? archivedNavigationActiveId(pathname)
          : participantNavigationActiveId(pathname)
      }
      items={items}
      label={
        mode === 'archived' ? 'Navigace archivovaného účtu' : 'Hlavní navigace'
      }
    />
  );
};
