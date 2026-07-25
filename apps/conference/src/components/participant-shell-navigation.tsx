'use client';

import { ParticipantNavigation, type NavigationItem } from '@byzon/ui';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

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

const participantNavigationItems: NavigationItem[] = [
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
    id: 'speakers',
    href: '/app/recnici',
    label: 'Řečníci',
    icon: (
      <NavigationIcon>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3.5 19c.4-3.2 2.3-5 5.5-5s5.1 1.8 5.5 5M14 14.5c3.5-.6 5.8.9 6.5 3.5" />
      </NavigationIcon>
    ),
  },
  {
    id: 'partners',
    href: '/app/partneri',
    label: 'Partneři',
    icon: (
      <NavigationIcon>
        <rect height="13" rx="2" width="18" x="3" y="8" />
        <path d="M9 8V5h6v3M3 13h18M10 13v2h4v-2" />
      </NavigationIcon>
    ),
  },
  {
    id: 'information',
    href: '/app/informace',
    label: 'Informace',
    icon: (
      <NavigationIcon>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8h.01" />
      </NavigationIcon>
    ),
  },
];

export const participantNavigationActiveId = (pathname: string): string =>
  participantNavigationItems.find(
    ({ href }) =>
      pathname === href || (href !== '/app' && pathname.startsWith(`${href}/`)),
  )?.id ?? '';

export const ParticipantShellNavigation = () => {
  const pathname = usePathname();

  return (
    <ParticipantNavigation
      activeItemId={participantNavigationActiveId(pathname)}
      items={participantNavigationItems}
    />
  );
};
