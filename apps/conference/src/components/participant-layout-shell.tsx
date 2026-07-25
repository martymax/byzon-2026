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
import { RouteFocus } from './route-focus';

export const ParticipantLayoutShell = ({
  accountApi,
  accountScope,
  children,
  navigationMode = 'active',
}: {
  readonly accountApi?: ApiPort;
  readonly accountScope: ParticipantAccountScope;
  readonly children: ReactNode;
  readonly navigationMode?: ParticipantShellNavigationMode;
}) => {
  const accountScopeKey =
    accountScope.kind === 'active'
      ? `active:${accountScope.eventId}`
      : accountScope.kind === 'archived'
        ? `archived:${accountScope.eventFingerprint}`
        : accountScope.kind;
  return (
    <ParticipantAccountResourceProvider
      {...(accountApi ? { api: accountApi } : {})}
      key={accountScopeKey}
      scope={accountScope}
    >
      <RouteFocus />
      <ParticipantShellNavigation mode={navigationMode} />
      <div className="participant-shell-content">{children}</div>
    </ParticipantAccountResourceProvider>
  );
};
