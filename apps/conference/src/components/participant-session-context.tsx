'use client';

import { ActionLink } from '@byzon/ui';
import { createContext, useContext } from 'react';

import type { ParticipantSessionContext } from '@/lib/participant-session-context';

export const ParticipantSessionContextProvider =
  createContext<ParticipantSessionContext | null>(null);

export const useParticipantSessionContext = () =>
  useContext(ParticipantSessionContextProvider);

export const ParticipantAdminNotice = () => {
  const session = useParticipantSessionContext();
  if (!session?.isAdmin) return null;
  return (
    <aside
      className="participant-admin-notice"
      aria-label="Administrátorský přístup"
    >
      <p>Prohlížíte účastnickou aplikaci jako administrátor.</p>
      <ActionLink href="/admin" variant="secondary">
        Zpět do administrace
      </ActionLink>
    </aside>
  );
};
