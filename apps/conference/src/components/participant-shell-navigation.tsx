'use client';

import { ParticipantNavigation, type NavigationItem } from '@byzon/ui';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { useParticipantAccountResourceOptional } from './participant-account-resource';

export type ParticipantShellNavigationMode =
  'active' | 'active-preview' | 'archived' | 'archived-preview' | 'unavailable';

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

const programNavigationItem: NavigationItem = {
  id: 'program',
  href: '/app/program',
  label: 'Program',
  icon: (
    <NavigationIcon>
      <rect height="16" rx="2" width="18" x="3" y="5" />
      <path d="M8 3v4M16 3v4M3 10h18M7 14h3M14 14h3M7 18h3" />
    </NavigationIcon>
  ),
};

const accountNavigationItem: NavigationItem = {
  id: 'account',
  href: '/app/vice',
  label: 'Můj účet',
  icon: (
    <NavigationIcon>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </NavigationIcon>
  ),
};

const activityManagementNavigationItem: NavigationItem = {
  id: 'activity-management',
  href: '/host/aktivity',
  label: 'Správa aktivit',
  icon: (
    <NavigationIcon>
      <rect height="15" rx="2" width="18" x="3" y="5" />
      <path d="M8 3v4M16 3v4M3 10h18M8 15h8M8 18h5" />
    </NavigationIcon>
  ),
};

const participantNavigationItems: NavigationItem[] = [
  programNavigationItem,
  {
    id: 'agenda',
    href: '/app/agenda',
    label: 'Agenda',
    icon: (
      <NavigationIcon>
        <rect height="16" rx="2" width="16" x="4" y="5" />
        <path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 18h6" />
        <path d="m14.5 14.5 1.3 1.3 2.7-3" />
      </NavigationIcon>
    ),
  },
  {
    id: 'networking',
    href: '/app/networking',
    label: 'Networking',
    icon: (
      <NavigationIcon>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="10" r="2.5" />
        <path d="M3 20a6 6 0 0 1 12 0M14 15.5a5 5 0 0 1 7 4.5" />
      </NavigationIcon>
    ),
  },
  {
    id: 'speakers',
    href: '/app/recnici',
    label: 'Řečníci',
    icon: (
      <NavigationIcon>
        <rect height="11" rx="4" width="8" x="8" y="3" />
        <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" />
      </NavigationIcon>
    ),
  },
  accountNavigationItem,
];

const archivedPreviewNavigationItems: NavigationItem[] = [
  {
    id: 'overview',
    href: '/app',
    label: 'Přehled',
    icon: (
      <NavigationIcon>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v10h14V10M9 20v-6h6v6" />
      </NavigationIcon>
    ),
  },
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

const accountDestinations = [
  '/app/vice',
  '/app/profil',
  '/app/soukromi',
  '/app/nastaveni',
  '/app/vstupenka',
  '/app/informace',
] as const;

const isDestination = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);

export const participantNavigationActiveId = (pathname: string): string => {
  if (isDestination(pathname, '/app/program')) return 'program';
  if (isDestination(pathname, '/app/agenda')) return 'agenda';
  if (isDestination(pathname, '/app/networking')) return 'networking';
  if (isDestination(pathname, '/app/recnici')) return 'speakers';
  return accountDestinations.some((href) => isDestination(pathname, href))
    ? 'account'
    : '';
};

export const participantNavigationItemsForMode = (
  mode: ParticipantShellNavigationMode,
): NavigationItem[] => {
  if (mode === 'archived-preview' || mode === 'archived') {
    return archivedPreviewNavigationItems;
  }
  if (mode === 'unavailable') return [];
  return participantNavigationItems;
};

export const archivedNavigationActiveId = (pathname: string): string => {
  if (pathname === '/app') return 'overview';
  if (isDestination(pathname, '/app/soukromi')) return 'privacy';
  if (isDestination(pathname, '/app/nastaveni')) return 'settings';
  return '';
};

export const participantActivityContextAction = (
  roles: readonly string[],
  mode: ParticipantShellNavigationMode,
): NavigationItem | undefined =>
  (mode === 'active' || mode === 'active-preview') &&
  (roles.includes('speaker') || roles.includes('room_operator'))
    ? activityManagementNavigationItem
    : undefined;

export const ParticipantShellNavigation = ({
  mode = 'active',
}: {
  readonly mode?: ParticipantShellNavigationMode;
}) => {
  const pathname = usePathname();
  const account = useParticipantAccountResourceOptional();
  const items = participantNavigationItemsForMode(mode);
  const archived = mode === 'archived' || mode === 'archived-preview';
  const contextAction = participantActivityContextAction(
    account?.state.status === 'ready'
      ? account.state.data.membership.roles
      : [],
    mode,
  );

  if (items.length === 0) return null;

  return (
    <ParticipantNavigation
      activeItemId={
        archived
          ? archivedNavigationActiveId(pathname)
          : participantNavigationActiveId(pathname)
      }
      {...(contextAction ? { contextAction } : {})}
      items={items}
      label={archived ? 'Navigace archivovaného účtu' : 'Hlavní navigace'}
    />
  );
};
