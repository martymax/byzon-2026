'use client';

import type { ReactNode } from 'react';

import type { ApiPort } from '@/lib/api';

import {
  ParticipantAccountResourceProvider,
  type ParticipantAccountScope,
} from './participant-account-resource';
import {
  ParticipantShellNavigation,
  type ParticipantShellNavigationMode,
} from './participant-shell-navigation';
import { ParticipantNotificationCenter } from './participant-notification-center';
import { RouteFocus } from './route-focus';

export const ParticipantLayoutShell = ({
  accountApi,
  accountScope,
  announcementApi,
  announcementPollIntervalMs,
  children,
  navigationMode = 'active',
  notificationsEnabled = false,
}: {
  readonly accountApi?: ApiPort;
  readonly accountScope: ParticipantAccountScope;
  readonly announcementApi?: ApiPort;
  readonly announcementPollIntervalMs?: number;
  readonly children: ReactNode;
  readonly navigationMode?: ParticipantShellNavigationMode;
  readonly notificationsEnabled?: boolean;
}) => {
  const accountScopeKey =
    accountScope.kind === 'active'
      ? `active:${accountScope.eventId}`
      : accountScope.kind === 'archived'
        ? `archived:${accountScope.eventFingerprint}`
        : accountScope.kind;
  return (
    <ParticipantAccountResourceProvider
      key={accountScopeKey}
      {...(accountApi ? { api: accountApi } : {})}
      scope={accountScope}
    >
      <RouteFocus />
      {notificationsEnabled &&
      accountScope.kind === 'active' &&
      (navigationMode === 'active' || navigationMode === 'active-preview') ? (
        <ParticipantNotificationCenter
          eventId={accountScope.eventId}
          key={accountScope.eventId}
          {...(announcementApi ? { api: announcementApi } : {})}
          {...(announcementPollIntervalMs !== undefined
            ? { pollIntervalMs: announcementPollIntervalMs }
            : {})}
        />
      ) : null}
      <ParticipantShellNavigation mode={navigationMode} />
      <div className="participant-shell-content">{children}</div>
    </ParticipantAccountResourceProvider>
  );
};
